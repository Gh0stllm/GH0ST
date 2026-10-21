"""Local integration checks only; creates and removes an ephemeral Anvil signer."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('manual', ROOT / 'manual.py')
manual = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manual)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--anvil', type=Path, required=True)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'local-validation.json')
    args = parser.parse_args()
    port = 18577
    url = f'http://127.0.0.1:{port}'
    os.environ['GH0ST_RH_RPC_URL'] = url
    child = subprocess.Popen([str(args.anvil.resolve()), '--host', '127.0.0.1', '--port', str(port),
                              '--chain-id', '31337', '--hardfork', 'cancun', '--gas-limit', '16777216',
                              '--code-size-limit', '98304', '--silent'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    rpc = manual.RPC(url)
    checks = []
    def check(name, condition):
        assert condition, name
        checks.append(name)
    try:
        for _ in range(100):
            try:
                if rpc('eth_chainId') == hex(31337):
                    break
            except RuntimeError:
                time.sleep(.05)
        else:
            raise RuntimeError('Local Anvil failed to start')
        with tempfile.TemporaryDirectory(prefix='gh0st-local-signing-') as temp:
            folder = Path(temp)
            account = manual.Account.create()
            key = folder / 'ephemeral-test-key'
            key.write_text(account.key.hex())
            key.chmod(0o600)
            rpc('anvil_setBalance', [account.address, hex(10**19)])
            state_path = folder / 'state.json'
            def run(label, extra=(), state=state_path, rpc_type=None):
                report = folder / (label + '.json')
                argv = ['manual.py', '--weights', str(args.weights), '--sender', account.address,
                        '--state', str(state), '--report', str(report), '--local-test', *extra]
                old_argv, old_rpc = sys.argv, manual.RPC
                sys.argv = argv
                if rpc_type:
                    manual.RPC = rpc_type
                try:
                    with contextlib.redirect_stdout(io.StringIO()):
                        try:
                            code = manual.main()
                        except RuntimeError as error:
                            return 2, {'stop_reason': str(error)}
                finally:
                    sys.argv, manual.RPC = old_argv, old_rpc
                return code, json.loads(report.read_text())
            signed = ['--broadcast', '--key-file', str(key), '--max-batch-fee-eth', '1']
            code, quoted = run('quote')
            check('Quote creates no transaction or deployment state', code == 0 and not state_path.exists() and rpc('eth_getTransactionCount', [account.address, 'latest']) == '0x0')
            check('Pilot quote includes exactly kernel plus first weight shard', [q['name'] for q in quoted['before']['next_batch']] == ['SixBitFast', 'weights-0000'])
            code, cap = run('cap', ['--broadcast', '--key-file', str(key), '--max-batch-fee-eth', '0.000000000000000001'])
            check('Too-small batch cap blocks every signature', code == 2 and rpc('eth_getTransactionCount', [account.address, 'latest']) == '0x0')
            code, reserve = run('reserve', [*signed, '--reserve-eth', '10'])
            check('Reserve and top-up check block underfunded batch', code == 2 and 'top-up' in reserve['stop_reason'])
            code, pilot = run('pilot', signed)
            check('Pilot stops after exactly two successful deployments', code == 0 and pilot['batch_contracts'] == 2 and rpc('eth_getTransactionCount', [account.address, 'latest']) == '0x2')
            check('Deployed runtimes match exact pinned bytes', all(r['runtime_verified'] for r in pilot['batch_receipts']))
            fees = sum(r['fee_wei'] for r in pilot['batch_receipts'])
            check('Wallet decrement equals receipt fees', pilot['before']['wallet_balance_wei'] - pilot['after']['wallet_balance_wei'] == fees)
            check('Next batch top-up formula includes reserve and current balance', pilot['after']['suggested_next_batch_top_up_wei'] == max(0, pilot['after']['next_batch_maximum_fee_wei'] - pilot['after']['wallet_balance_wei']))
            check('Remaining contract count decreases accurately', pilot['after']['remaining_contracts'] == 1172)
            code, resumed = run('resumed', [*signed, '--count', '1'])
            check('Resume deploys only next shard and stops at new limit', code == 0 and [r['name'] for r in resumed['batch_receipts']] == ['weights-0001'] and rpc('eth_getTransactionCount', [account.address, 'latest']) == '0x3')
            check('Cumulative fees and gas equal all saved receipts', resumed['after']['cumulative_fee_wei'] == fees + sum(r['fee_wei'] for r in resumed['batch_receipts']) and resumed['after']['cumulative_gas_used'] == pilot['batch_gas_used'] + resumed['batch_gas_used'])
            # Uncertain transport must never cause a second deployment automatically.
            unresolved = json.loads(state_path.read_text())
            unresolved['pending'] = {'name': 'weights-0002', 'hash': '0x' + 'ab'*32, 'nonce': 3,
                                     'runtime_keccak256': json.loads((ROOT.parent/'deployment-manifest.json').read_text())['shards'][2]['runtime_keccak256']}
            pending_path = folder / 'pending.json'
            manual.write_json(pending_path, unresolved)
            code, stopped = run('pending', signed, state=pending_path)
            check('Unknown pending hash blocks continuation without re-sending', code == 2 and 'Unresolved transaction' in stopped['stop_reason'] and rpc('eth_getTransactionCount', [account.address, 'latest']) == '0x3')
            # Inject a fee increase after one mined transaction, while using real Anvil signing/deployment.
            base_rpc = manual.RPC
            class RisingFees(base_rpc):
                observed = False
                def __call__(self, method, params=()):
                    value = super().__call__(method, params)
                    if method == 'eth_getTransactionReceipt' and value and value.get('transactionHash') not in {r['hash'] for r in unresolved['receipts']}:
                        self.observed = True
                    if method == 'eth_gasPrice' and self.observed:
                        return hex(int(value, 16) * 10000)
                    return value
            code, jumped = run('fee-rise', signed, rpc_type=RisingFees)
            check('Mid-batch fee rise stops before the next signature', code == 2 and jumped['batch_contracts'] == 1 and 'cap' in jumped['stop_reason'] and rpc('eth_getTransactionCount', [account.address, 'latest']) == '0x4')
            # The default public-chain guard must reject this local chain.
            old_argv = sys.argv
            sys.argv = ['manual.py', '--weights', str(args.weights), '--sender', account.address,
                        '--state', str(state_path)]
            try:
                try:
                    manual.main()
                    rejected = False
                except RuntimeError as error:
                    rejected = 'Wrong chain' in str(error)
                check('Default RH chain guard rejects chain 31337', rejected)
            finally:
                sys.argv = old_argv
            output = {'status': 'passed', 'chain_id': 31337, 'public_transactions_broadcast': 0,
                      'checks': checks, 'pilot_gas_used': pilot['batch_gas_used'],
                      'pilot_contract_gas': [{'name': r['name'], 'gas_used': r['gas_used']} for r in pilot['batch_receipts']],
                      'scope': 'Local control-flow and receipt accounting validation; no live RH fee quote or production deployment'}
            manual.write_json(args.output, output)
            print(json.dumps(output))
    finally:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()


if __name__ == '__main__':
    main()
