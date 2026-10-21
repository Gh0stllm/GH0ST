"""Execute the benchmark ONLY in a local, disposable Py-EVM chain.

All transaction signing/funding below belongs to EthereumTester's fake accounts.
This script has no external RPC connection and cannot broadcast to Robinhood.
"""
import hashlib
import importlib.metadata
import json
import random
from datetime import datetime, timezone
from pathlib import Path
from eth_abi import encode
from eth_tester import EthereumTester, PyEVMBackend
from eth_tester.exceptions import TransactionFailed
from web3 import Web3, EthereumTesterProvider
from web3.exceptions import ContractLogicError

ROOT = Path(__file__).resolve().parent
SIM_KERNEL = '0x0000000000000000000000000000000000001001'
SIM_SHARD = '0x0000000000000000000000000000000000001002'
SIM_SENDER = '0x0000000000000000000000000000000000001003'


def pack_weights(matrix):
    flat = [x for row in matrix for x in row]
    return bytes((flat[i] & 15) | (((flat[i+1] if i+1 < len(flat) else 0) & 15) << 4)
                 for i in range(0, len(flat), 2))


def pack_activations(values):
    return b''.join(x.to_bytes(2, 'little', signed=True) for x in values)


def main():
    artifacts = json.loads((ROOT / 'compiled.json').read_text())
    sample = json.loads((ROOT / 'lfm-slice.json').read_text())
    backend = PyEVMBackend()
    tester = EthereumTester(backend=backend)
    web3 = Web3(EthereumTesterProvider(tester))
    sender = web3.eth.accounts[0]
    contracts = artifacts['contracts']

    def submit(fn):
        receipt = web3.eth.wait_for_transaction_receipt(fn.transact({'from': sender, 'gas': 15_000_000}))
        assert receipt.status == 1, 'Local transaction reverted'
        return receipt

    def deploy(name, *args):
        item = contracts[name]
        factory = web3.eth.contract(abi=item['abi'], bytecode=item['evm']['bytecode']['object'])
        receipt = submit(factory.constructor(*args))
        return web3.eth.contract(address=receipt.contractAddress, abi=item['abi']), receipt.gasUsed

    kernel, kernel_deploy_gas = deploy('Int4Kernel')
    checks = []
    rng = random.Random(20261020)
    fixtures = [
        ('zero', [[0] * 3], [0] * 3),
        ('signed_extremes', [[-8, 7, -1, 0], [7, -8, 1, 0]], [-32768, 32767, -1, 0]),
        ('accumulator_bound', [[-8] * 1024], [-32768] * 1024),
    ]
    for rows, cols in [(1,1), (1,2), (2,3), (3,31), (4,64), (8,1024)]:
        fixtures.append((f'random_{rows}x{cols}',
            [[rng.randint(-8, 7) for _ in range(cols)] for _ in range(rows)],
            [rng.randint(-32768,32767) for _ in range(cols)]))
    for name, matrix, values in fixtures:
        expected = [sum(w*x for w,x in zip(row, values)) for row in matrix]
        args = (pack_weights(matrix), pack_activations(values), len(matrix), len(values))
        actual = kernel.functions.dotCalldata(*args).call()
        assert actual == expected, (name, actual, expected)
        shard, _ = deploy('WeightShard', args[0])
        from_code = kernel.functions.dotFromCode(shard.address, args[1], args[2], args[3]).call()
        assert from_code == expected, (name, from_code, expected)
        checks.append({'name':name, 'calldata_matches':True, 'code_shard_matches':True})

    invalid = [
        ('zero_rows', b'', b'', 0, 1),
        ('too_many_rows', b'', b'', 9, 1),
        ('zero_cols', b'', b'', 1, 0),
        ('too_many_cols', b'', b'', 1, 1025),
        ('missing_weight', b'', b'\x00\x00', 1, 1),
        ('missing_activation', b'\x00', b'\x00', 1, 1),
        ('excess_weight', b'\x00\x00', b'\x00\x00', 1, 1),
    ]
    for name, *args in invalid:
        try:
            kernel.functions.dotCalldata(*args).call()
        except (TransactionFailed, ContractLogicError):
            checks.append({'name':name, 'rejected':True})
        else:
            raise AssertionError(f'{name} accepted invalid data')
    try:
        kernel.functions.dotFromCode(sender, b'\x00\x00', 1, 1).call()
    except (TransactionFailed, ContractLogicError):
        checks.append({'name':'missing_code_shard', 'rejected':True})
    else:
        raise AssertionError('Empty shard accepted')

    weights = bytes.fromhex(sample['packed_weights_hex'])
    activations = bytes.fromhex(sample['packed_activations_hex'])
    measurements = []
    for rows in (1,2,4):
        packed = weights[:rows * 512]
        expected = sample['expected_integer_outputs'][:rows]
        shard, shard_gas = deploy('WeightShard', packed)
        calldata = kernel.functions.dotCalldata(packed, activations, rows, 1024)
        from_code = kernel.functions.dotFromCode(shard.address, activations, rows, 1024)
        assert calldata.call() == from_code.call() == expected
        measurements.append({'rows':rows, 'columns':1024, 'multiply_accumulates':rows*1024,
            'integer_outputs':expected, 'exact_integer_parity':True,
            'weight_bytes':len(packed), 'shard_deployment_gas':shard_gas,
            'calldata_transaction_gas':submit(calldata).gasUsed,
            'code_shard_transaction_gas':submit(from_code).gasUsed})
    expected_hash = web3.keccak(encode(['int256[]'], [sample['expected_integer_outputs']]))
    first = submit(kernel.functions.computeAndStore(shard.address, activations, 4, 1024))
    assert kernel.functions.runs().call() == 1 and kernel.functions.resultHash().call() == expected_hash
    repeat = submit(kernel.functions.computeAndStore(shard.address, activations, 4, 1024))
    assert kernel.functions.runs().call() == 2 and kernel.functions.resultHash().call() == expected_hash
    checks.append({'name':'state_commitment_and_counter', 'passed':True})
    report = {'status':'local_evm_execution_only', 'created_at':datetime.now(timezone.utc).isoformat(),
        'external_transactions_broadcast':0, 'robinhood_gas_measured':False, 'stylus_benchmarked':False,
        'vm':type(backend.chain.get_vm()).__name__, 'compiler':artifacts['compiler'],
        'compiler_settings':artifacts['settings'],
        'packages':{p:importlib.metadata.version(p) for p in ['web3','eth-tester','py-evm','eth-abi']},
        'kernel_deployment_gas':kernel_deploy_gas,
        'kernel_runtime_bytes':len(bytes.fromhex(contracts['Int4Kernel']['evm']['deployedBytecode']['object'])),
        'real_lfm_slice_measurements':measurements, 'checks':checks,
        'first_result_commitment_transaction_gas':first.gasUsed,
        'repeated_same_result_transaction_gas':repeat.gasUsed,
        'limitations':['Local Ethereum EVM receipts omit Robinhood-specific fee components.',
            'Four rows of one matrix projection; no scale application, activation function, attention or token generation.',
            'Result commitment is not storage of all layer outputs or resumable model state.',
            'No model-quality claim follows from exact integer-kernel parity.']}
    out = ROOT.parent / 'results' / 'contract-local.json'
    out.write_text(json.dumps(report,indent=2)+'\n')
    sim = web3.eth.contract(address=SIM_KERNEL,abi=contracts['Int4Kernel']['abi'])
    kernel_factory = web3.eth.contract(abi=contracts['Int4Kernel']['abi'],bytecode=contracts['Int4Kernel']['evm']['bytecode']['object'])
    shard_factory = web3.eth.contract(abi=contracts['WeightShard']['abi'],bytecode=contracts['WeightShard']['evm']['bytecode']['object'])
    request = {'purpose':'Read-only RPC simulation, never a signed transaction.',
        'sender':SIM_SENDER, 'kernel_address':SIM_KERNEL,'shard_address':SIM_SHARD,
        'kernel_runtime':'0x'+contracts['Int4Kernel']['evm']['deployedBytecode']['object'],
        'shard_runtime':'0x00'+weights.hex(),
        'kernel_creation_data':kernel_factory.constructor().data_in_transaction,
        'shard_creation_data':shard_factory.constructor(weights).data_in_transaction,
        'dot_call_data':sim.encode_abi('dotFromCode',args=[SIM_SHARD,activations,4,1024]),
        'commit_call_data':sim.encode_abi('computeAndStore',args=[SIM_SHARD,activations,4,1024]),
        'expected_outputs':sample['expected_integer_outputs'],
        'expected_commitment_hex':expected_hash.to_0x_hex()}
    (ROOT/'simulation-input.json').write_text(json.dumps(request,indent=2)+'\n')
    print(json.dumps({'checks':len(checks),'kernel_deployment_gas':kernel_deploy_gas,
        'measurements':measurements,'first_commit_gas':first.gasUsed,'repeat_commit_gas':repeat.gasUsed},indent=2))


if __name__ == '__main__':
    main()
