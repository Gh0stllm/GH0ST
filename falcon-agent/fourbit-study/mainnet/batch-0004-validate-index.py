"""Validate the final index from all 495 actual shard addresses on loopback Anvil.

Historical pre-index validator; requires the 496-contract journal snapshot.
Never contacts a public RPC, reads a
signing key, signs a mainnet transaction, or modifies deployment state.
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

WORKSPACE = Path('/workspace/scratch/be1e363a306a')
STUDY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STUDY))
import deploy as d
from local import EVM


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, default=WORKSPACE / 'gh0st-rh-live/fourbit-state.json')
    parser.add_argument('--weights', type=Path, default=WORKSPACE / 'gh0st-model-cache/fourbit-study/affine64_s12z4/weights.bin')
    parser.add_argument('--creation-cache', type=Path, default=WORKSPACE / 'gh0st-model-cache/fourbit-creation')
    parser.add_argument('--anvil', type=Path, default=WORKSPACE / 'block-tools/anvil')
    parser.add_argument('--output', type=Path, default=WORKSPACE / 'gh0st-rh-live/final-index-local-validation.json')
    parser.add_argument('--port', type=int, default=18698)
    args = parser.parse_args()
    d.require(args.output.resolve() not in {args.state.resolve(), args.weights.resolve(), Path(__file__).resolve()},
              'Validation input/output overlap')
    d.require(not args.output.resolve().is_relative_to(d.REPO), 'Keep this validation output outside the repository')
    state = json.loads(args.state.read_text())
    d.require(state['chain_id'] == 4663 and state['weights_sha256'] == d.PIN, 'State identity mismatch')
    rows = state['receipts']
    d.require(len(rows) == 496 and state['active_bundle'] is None,
              'Requires 496 completed contracts and no active bundle before the index')
    d.require(all(r['status'] == 1 and r['runtime_verified'] for r in rows), 'Unverified receipt in state')
    d.require(len({r['name'] for r in rows}) == 496 and len({r['nonce'] for r in rows}) == 496,
              'Duplicate receipt names or nonces')
    by_name = {r['name']: r for r in rows}
    names = ['FourBitAffine64'] + [f'fourbit-weights-{i:04d}' for i in range(495)]
    d.require(set(by_name) == set(names), 'Missing or unexpected deployed jobs')
    sender = bytes.fromhex(state['sender'][2:])
    addresses = []
    for name in names:
        row = by_name[name]
        address = bytes.fromhex(row['address'][2:])
        d.require(len(address) == 20 and any(address), 'Invalid deployed address')
        expected = d.keccak(d.rlp.encode([sender, row['nonce']]))[-20:]
        d.require(address == expected, 'Receipt address does not match sender and creation nonce')
        if name != 'FourBitAffine64':
            addresses.append(row['address'])
    d.require(len({a.lower() for a in addresses}) == 495, 'Repeated shard address')
    data = args.weights.read_bytes()
    d.require(len(data) == 48626528 and hashlib.sha256(data).hexdigest() == d.PIN, 'Weight digest mismatch')
    jobs = d.jobs(args.weights, state, args.creation_cache)
    d.require(len(jobs) == 497 and jobs[-1]['name'] == 'FourBitWeightIndex', 'Final index not available as the sole last job')
    d.require(all(by_name[j['name']]['runtime_keccak256'] == d.digest(j['runtime']) for j in jobs[:-1]),
              'Recorded shard or kernel runtime pin mismatch')
    index = jobs[-1]
    # Construct independently from the documented big-endian binary format.
    expected_runtime = (b'\0G4IX' + struct.pack('>IQ', 98303, len(data)) +
                        hashlib.sha256(data).digest() +
                        b''.join(bytes.fromhex(a[2:]) for a in addresses))
    runtime = index['runtime']
    checks = []

    def check(name, condition):
        d.require(condition, name)
        checks.append(name)
        print('PASS ' + name, flush=True)

    check('Index layout exactly matches STOP, G4IX, dimensions, weight digest and actual ordered addresses',
          runtime == expected_runtime and len(runtime) == 9949 and
          runtime[1:5] == b'G4IX' and int.from_bytes(runtime[5:9], 'big') == 98303 and
          int.from_bytes(runtime[9:17], 'big') == len(data) and runtime[17:49].hex() == d.PIN)
    check('All 495 packed addresses are exactly 20 bytes and ordered by shard 0000 through 0494',
          [runtime[49 + i * 20:69 + i * 20].hex() for i in range(495)] ==
          [a[2:].lower() for a in addresses] and len(runtime[49:]) == 495 * 20)
    check('Constructor copies the complete exact runtime from its 12-byte prefix',
          index['init'][:1] == b'\x61' and int.from_bytes(index['init'][1:3], 'big') == len(runtime) and
          index['init'][3:12] == bytes.fromhex('80600c6000396000f3') and index['init'][12:] == runtime)
    incomplete = dict(state, receipts=[r for r in rows if r['name'] != 'fourbit-weights-0494'])
    check('The index remains unavailable if any one weight shard is missing',
          not any(j['name'] == 'FourBitWeightIndex' for j in d.jobs(args.weights, incomplete, args.creation_cache)))
    next_nonce = max(r['nonce'] for r in rows) + 1
    signed_size_bound = d.maximum_transaction_size(4663, next_nonce, 32000000, 10**9, index['init'])
    check('Index creation fits the conservative public-chain signed transaction size guard', signed_size_bound <= 95000)
    evm = EVM(args.anvil.resolve(), port=args.port)
    try:
        local_address, local_gas = evm.deploy(index['init'])
        actual = bytes.fromhex(evm.rpc('eth_getCode', [local_address, 'latest'])[2:])
        check('Loopback Cancun deployment returns every exact index runtime byte', actual == runtime)
        check('Actual local deployment gas equals the address-specific creation model',
              local_gas == index['modeled_gas'] == d.creation_gas(runtime[1:]))
    finally:
        evm.close()
    result = {'status': 'passed', 'verified_at_utc': d.now(), 'checks': checks, 'checks_passed': len(checks),
              'mainnet_chain_id': 4663, 'local_chain_id': 31337, 'public_rpc_calls': 0,
              'public_transactions_sent': 0, 'local_index_deployments': 1,
              'verified_weight_shards': 495, 'file_bytes': len(data), 'payload_limit': 98303,
              'weights_sha256': d.PIN, 'index_runtime_bytes': len(runtime),
              'index_runtime_keccak256': d.digest(runtime),
              'runtime_keccak256': d.digest(runtime), 'exact_runtime_verified': True,
              'index_init_sha256': hashlib.sha256(index['init']).hexdigest(),
              'init_sha256': hashlib.sha256(index['init']).hexdigest(),
              'weight_address_count': len(addresses),
              'index_init_bytes': len(index['init']), 'maximum_signed_tx_bytes': signed_size_bound,
              'local_cancun_gas': local_gas, 'next_mainnet_creation_nonce': next_nonce,
              'first_weight_address': addresses[0], 'last_weight_address': addresses[-1],
              'ordered_weight_addresses_sha256': hashlib.sha256(runtime[49:]).hexdigest(),
              'note': 'Uses existing saved runtime attestations; live receipt/runtime re-verification remains the mainnet controller gate. Local gas excludes parent posting.'}
    d.save(args.output, result)
    print(json.dumps({k: result[k] for k in ('status', 'checks_passed', 'index_runtime_bytes',
          'index_runtime_keccak256', 'local_cancun_gas', 'public_transactions_sent')}), flush=True)


if __name__ == '__main__':
    main()
