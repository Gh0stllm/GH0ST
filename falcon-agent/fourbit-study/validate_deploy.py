"""Exercise real local deployments plus provider failure/recovery; never public RPC."""
import argparse
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import deploy as d


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--anvil', required=True, type=Path)
    parser.add_argument('--weights', required=True, type=Path)
    parser.add_argument('--creation-cache', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=d.ROOT / 'deployment-validation.json')
    args = parser.parse_args()
    url = 'http://127.0.0.1:18596'
    os.environ['GH0ST_RH_RPC_URL'] = url
    child = subprocess.Popen([str(args.anvil.resolve()), '--host', '127.0.0.1', '--port', '18596',
                              '--chain-id', '31337', '--hardfork', 'cancun', '--code-size-limit', '98304',
                              '--gas-limit', '32000000', '--base-fee', '10000000', '--gas-price', '20000000', '--silent'],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    rpc = d.RPC(url)
    checks = []
    def check(name, value):
        assert value, name
        checks.append(name)
        print('PASS ' + name, flush=True)
    try:
        for _ in range(100):
            try:
                if rpc('eth_chainId') == hex(31337):
                    break
            except RuntimeError:
                time.sleep(.05)
        else:
            raise RuntimeError('Local Anvil did not start')
        with tempfile.TemporaryDirectory(prefix='gh0st-fourbit-validation-') as temp:
            folder = Path(temp)
            account = d.Account.create()
            key = folder / 'local-key'
            key.write_text(account.key.hex())
            key.chmod(0o600)
            rpc('anvil_setBalance', [account.address, hex(10**19)])
            state = folder / 'state.json'
            def run(name, flags=(), rpc_class=None):
                report = folder / (name + '.json')
                original_argv, original_rpc = sys.argv, d.RPC
                sys.argv = ['deploy.py', '--weights', str(args.weights), '--sender', account.address,
                            '--state', str(state), '--report', str(report), '--local-test', '--creation-cache', str(args.creation_cache), *flags]
                if rpc_class:
                    d.RPC = rpc_class
                try:
                    with contextlib.redirect_stdout(io.StringIO()):
                        code = d.main()
                finally:
                    sys.argv, d.RPC = original_argv, original_rpc
                return code, json.loads(report.read_text())
            def nonce():
                return int(rpc('eth_getTransactionCount', [account.address, 'latest']), 16)
            flags = ['--broadcast', '--key-file', str(key), '--max-batch-fee-eth', '1', '--reserve-eth', '1']
            code, quote = run('quote')
            check('Unsigned 25-contract quote does not sign or create deployment state', code == 0 and nonce() == 0 and not state.exists() and len(quote['before']['next_batch']) == 25)
            sample_jobs = {j['name']: j for j in d.jobs(args.weights, {'receipts': []}, args.creation_cache)}
            entries = [dict(q, nonce=i + 2) for i, q in enumerate(quote['before']['next_batch'])]
            d.check_submission_sizes(4663, entries, sample_jobs)
            check('Lossless batch fits conservative RH signed-transaction limit', nonce() == 0 and not state.exists())
            raw_jobs = {name: dict(job, init=d.initcode(job['runtime'][1:])) for name, job in sample_jobs.items()}
            rejected = False
            try:
                d.check_submission_sizes(4663, entries, raw_jobs)
            except RuntimeError as error:
                rejected = 'submission limit' in str(error)
            check('RH size guard still rejects oversized raw creation payloads', rejected)
            code, report = run('cap', [*flags, '--max-batch-fee-eth', '0.000000000000000001'])
            check('Insufficient fee cap stops before signing', code == 2 and nonce() == 0 and not state.exists())
            code, report = run('reserve', [*flags, '--reserve-eth', '10'])
            check('Insufficient wallet reserve stops before signing', code == 2 and nonce() == 0 and not state.exists())
            code, report = run('batch25', flags)
            check('First bundle deploys exactly kernel plus 24 weight shards and pauses', code == 0 and report['status'] == 'batch_complete_paused' and report['batch_contracts'] == 25 and nonce() == 25)
            check('All 25 full runtimes match pinned code', all(r['runtime_verified'] for r in report['batch_receipts']))
            fees = sum(r['fee_wei'] for r in report['batch_receipts'])
            check('Receipt fees equal wallet balance reduction', fees == report['before']['wallet_balance_wei'] - report['after']['wallet_balance_wei'])
            check('Receipt gas matches local creation measurements', all(r['gas_used'] == r['modeled_gas'] for r in report['batch_receipts']))
            check('Index included in remaining count but deferred until all shards exist', report['after']['remaining_contracts'] == 472 and not any(q['name'] == 'FourBitWeightIndex' for q in report['after']['next_batch']))
            saved = json.loads(state.read_text())
            check('Completed bundle journal retained; no active batch', saved['active_bundle'] is None and len(saved['batches'][0]['transactions']) == 25)
            base = d.RPC
            class Partial(base):
                injected = False
                def batch(self, calls):
                    if len(calls) > 1 and calls[0][0] == 'eth_sendRawTransaction' and not self.injected:
                        self.injected = True
                        return super().batch(calls[:1]) + [{'error_code': -32000}] * (len(calls) - 1)
                    return super().batch(calls)
            code, report = run('partial', [*flags, '--count', '4'], Partial)
            check('Out-of-order/partial rejection repairs gaps using identical hashes', code == 0 and report['batch_contracts'] == 4 and nonce() == 29)
            class Ambiguous(base):
                injected = False
                def batch(self, calls):
                    result = super().batch(calls)
                    if calls[0][0] == 'eth_sendRawTransaction' and not self.injected:
                        self.injected = True
                        raise RuntimeError('Simulated timeout after accepted broadcast')
                    return result
            code, report = run('ambiguous', [*flags, '--count', '4'], Ambiguous)
            check('Lost broadcast response reconciles receipts without duplicate deployments', code == 0 and report['batch_contracts'] == 4 and nonce() == 33)
            class Offline(base):
                def batch(self, calls):
                    if calls[0][0] == 'eth_sendRawTransaction':
                        raise RuntimeError('Simulated transport unavailable')
                    return super().batch(calls)
            code, report = run('offline', [*flags, '--count', '4', '--receipt-timeout', '1'], Offline)
            saved = json.loads(state.read_text())
            hashes = [e['hash'] for e in saved['active_bundle']['transactions']]
            check('Unsent/ambiguous group stops with all bounded hashes persisted', code == 2 and nonce() == 33 and len(hashes) == 4)
            code, report = run('blocked-new', [*flags, '--count', '4'])
            check('Unresolved journal blocks a new batch', code == 2 and nonce() == 33)
            code, report = run('resume', [*flags, '--count', '4', '--resume-bundle'])
            check('Explicit resume sends only the original four hashes and pauses', code == 0 and nonce() == 37 and [r['hash'] for r in report['batch_receipts']] == hashes)
            mark = rpc('evm_snapshot')
            rpc('evm_setAutomine', [False])
            tx = account.sign_transaction({'chainId': 31337, 'nonce': nonce(), 'to': account.address,
                                           'value': 0, 'gas': 21000, 'gasPrice': 10**9})
            rpc('eth_sendRawTransaction', ['0x' + tx.raw_transaction.hex()])
            code, report = run('external-pending', [*flags, '--count', '1'])
            check('Unrelated pending wallet transaction blocks a new bundle', code == 2 and 'pending' in report['stop_reason'])
            rpc('evm_revert', [mark])
            original = sys.argv
            sys.argv = ['deploy.py', '--weights', str(args.weights), '--sender', account.address,
                        '--state', str(state), '--report', str(folder / 'wrong-chain.json')]
            try:
                rejected = False
                try:
                    d.main()
                except RuntimeError as error:
                    rejected = 'Wrong chain' in str(error)
                check('Mainnet mode rejects local chain before signing', rejected)
            finally:
                sys.argv = original
            d.save(args.output, {'status': 'passed', 'chain_id': 31337, 'checks': checks,
                                'checks_passed': len(checks), 'local_contracts_deployed': nonce(),
                                'public_transactions_sent': 0, 'weights_sha256': d.PIN})
    finally:
        child.terminate()
        child.wait(timeout=5)


if __name__ == '__main__':
    main()
