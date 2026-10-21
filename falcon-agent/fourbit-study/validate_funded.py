"""Exercise the funded controller offline; never contact a real RPC or wallet.

All jobs, state, receipts and RPC responses are synthetic. A newly generated
throwaway key exists only in a temporary folder, removed when validation ends.
"""
import contextlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import deploy as d
import deploy_funded as f


def main():
    checks = []

    def check(name, condition):
        assert condition, name
        checks.append(name)
        print('PASS ' + name, flush=True)

    sample = [{'maximum_fee_wei': 3}, {'maximum_fee_wei': 4}, {'maximum_fee_wei': 5}]
    check('Funded prefix shrinks safely without skipping jobs',
          f.funded_prefix(sample, 7) == sample[:2])
    check('An unfunded first job stays unsigned', not f.funded_prefix(sample, 2))
    check('Funded groups never exceed four transactions',
          len(f.funded_prefix([{'maximum_fee_wei': 1}] * 9, 99)) == 4)
    account = d.Account.create()
    jobs = [{'name': 'FourBitAffine64' if i == 0 else f'fourbit-weights-{i-1:04d}',
             'init': bytes.fromhex('60006000f3') + i.to_bytes(2, 'big'),
             'runtime': b'\0' + i.to_bytes(2, 'big'), 'modeled_gas': 1000}
            for i in range(380)]
    observed = {'verified': 0, 'sent': 0, 'counts': [], 'journaled_first': True}
    with tempfile.TemporaryDirectory(prefix='funded-controller-validation-') as folder:
        folder = Path(folder)
        key = folder / 'ephemeral-key'
        key.write_text(account.key.hex())
        key.chmod(0o600)
        state_file, run_file, report_file = [folder / name for name in ('state.json', 'run.json', 'report.json')]
        rows = [{'name': jobs[i]['name'], 'hash': '0x' + format(i + 1, '064x'),
                 'nonce': i + 2, 'status': 1, 'runtime_verified': True,
                 'gas_used': 1000, 'modeled_gas': 1000, 'fee_wei': 20000000000}
                for i in range(173)]
        state = {'schema': 1, 'chain_id': 4663, 'sender': account.address,
                 'weights_sha256': d.PIN, 'receipts': rows, 'active_bundle': None, 'batches': []}
        d.save(state_file, state)

        class MockRPC:
            def __init__(self, url):
                assert url == 'mock-only-no-network'

            def __call__(self, method, params=()):
                current = json.loads(state_file.read_text())
                if method == 'eth_chainId':
                    return hex(4663)
                if method == 'eth_getBalance':
                    return hex(10**18)
                if method == 'eth_gasPrice':
                    return hex(20000000)
                if method == 'eth_getTransactionCount':
                    return hex(max(r['nonce'] for r in current['receipts']) + 1)
                raise AssertionError('Unexpected mock RPC: ' + method)

            def batch(self, calls):
                assert all(method == 'eth_call' for method, params in calls)
                return [{'result': '0x' + d.encode(
                    ['uint64', 'uint64', 'uint256', 'uint256'],
                    [1000, 0, 20000000, 0]).hex()} for _ in calls]

        def verify(*args):
            observed['verified'] += 1

        def broadcast(rpc, current, entries, raw, job_map, path, timeout):
            observed['counts'].append(len(entries))
            assert len(entries) <= 4 and current['active_bundle'] is not None
            persisted = json.loads(path.read_text())
            journaled = all(e.get('hash') and e['hash'] in raw
                            for e in persisted['active_bundle']['transactions'])
            observed['journaled_first'] &= journaled
            assert journaled
            for entry in entries:
                current['receipts'].append(dict(entry, status=1, runtime_verified=True,
                    gas_used=1000, modeled_gas=1000, fee_wei=1000 * entry['gas_price_wei']))
            observed['sent'] += len(entries)
            d.save(path, current)

        argv = ['deploy_funded.py', '--weights', str(folder / 'unused-weights'),
                '--creation-cache', str(folder / 'unused-cache'), '--sender', account.address,
                '--state', str(state_file), '--run', str(run_file), '--report', str(report_file),
                '--key-file', str(key), '--rpc-url-env', 'FUNDED_CONTROLLER_MOCK_URL']
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(d, 'RPC', MockRPC))
            stack.enter_context(patch.object(d, 'jobs', lambda *args: jobs))
            stack.enter_context(patch.object(d, 'verify_saved', verify))
            stack.enter_context(patch.object(d, 'reconcile', lambda *args: None))
            stack.enter_context(patch.object(d, 'limits', lambda *args: 32000000))
            stack.enter_context(patch.object(d, 'broadcast_group', broadcast))
            stack.enter_context(patch.dict(os.environ, {'FUNDED_CONTROLLER_MOCK_URL': 'mock-only-no-network'}))
            stack.enter_context(patch.object(sys, 'argv', argv))
            with contextlib.redirect_stdout(io.StringIO()):
                code = f.main()
            final, run = json.loads(state_file.read_text()), json.loads(run_file.read_text())
            check('A run starting at 173 stops exactly at 175',
                  code == 0 and len(final['receipts']) == 175 and observed['sent'] == 2)
            check('Baseline 25 counts exactly 150 logical deployments',
                  run['baseline_contracts'] == 25 and run['target_contracts'] == 175 and
                  run['logical_contracts_verified'] == 150 and run['logical_contracts_remaining'] == 0)
            check('Signed transaction hashes are journaled before mock broadcast', observed['journaled_first'])
            check('The active journal clears only after the complete group is verified',
                  final['active_bundle'] is None and len(final['batches']) == 1 and
                  observed['counts'] == [2] and run['status'] == 'logical_batch_complete_paused')
            check('Historical receipts are verified once at controller startup', observed['verified'] == 1)
            run['target_contracts'] = 176
            d.save(run_file, run)
            rejected = False
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    f.main()
            except RuntimeError as error:
                rejected = 'boundary or identity changed' in str(error)
            check('The logical target cannot change on resume', rejected)

            # Reusing the old 25-to-175 run for a new stage must fail before work.
            run['target_contracts'] = 175
            d.save(run_file, run)
            argv.extend(['--baseline-contracts', '175', '--target-contracts', '375'])
            rejected = False
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    f.main()
            except RuntimeError as error:
                rejected = 'boundary or identity changed' in str(error)
            check('A new 175-to-375 stage cannot reuse the old run identity', rejected)

            next_run_file, next_report_file = folder / 'run-next200.json', folder / 'report-next200.json'
            argv[argv.index('--run') + 1] = str(next_run_file)
            argv[argv.index('--report') + 1] = str(next_report_file)
            observed.update(verified=0, sent=0, counts=[], journaled_first=True)
            with contextlib.redirect_stdout(io.StringIO()):
                next_code = f.main()
            next_state = json.loads(state_file.read_text())
            next_run = json.loads(next_run_file.read_text())
            check('The explicit 175-to-375 stage deploys exactly 200 new contracts and pauses',
                  next_code == 0 and len(next_state['receipts']) == 375 and observed['sent'] == 200 and
                  next_run['baseline_contracts'] == 175 and next_run['target_contracts'] == 375 and
                  next_run['authorized_new_contracts'] == 200 and
                  next_run['logical_contracts_verified'] == 200 and next_run['logical_contracts_remaining'] == 0 and
                  next_run['status'] == 'logical_batch_complete_paused')
            new_names = [r['name'] for r in next_state['receipts'][175:]]
            check('The next 200 are exactly weight shards 0174 through 0373 in groups of four',
                  new_names == [f'fourbit-weights-{i:04d}' for i in range(174, 374)] and
                  observed['counts'] == [4] * 50 and observed['journaled_first'] and observed['verified'] == 1)
            sent_before_resume = observed['sent']
            with contextlib.redirect_stdout(io.StringIO()):
                resume_code = f.main()
            check('Resuming a completed 375-contract stage never deploys beyond its target',
                  resume_code == 0 and observed['sent'] == sent_before_resume and
                  len(json.loads(state_file.read_text())['receipts']) == 375)
            argv[argv.index('--target-contracts') + 1] = '376'
            rejected = False
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    f.main()
            except RuntimeError as error:
                rejected = 'boundary or identity changed' in str(error)
            check('The new stage also refuses changing its target on the same run file', rejected)
    del account
    d.save(d.ROOT / 'funded-validation.json', {
        'status': 'passed', 'checks': checks, 'checks_passed': len(checks),
        'network_calls': 0, 'public_transactions_sent': 0,
        'synthetic_start_contracts': 173, 'immutable_baseline_contracts': 25,
        'immutable_target_contracts': 175,
        'explicit_stage_baseline_contracts': 175, 'explicit_stage_target_contracts': 375,
        'explicit_stage_new_contracts': 200,
        'signing_key': 'newly generated throwaway key; temporary directory removed'})
    print(json.dumps({'funded_controller_checks_passed': len(checks),
                      'network_calls': 0, 'public_transactions_sent': 0}))


if __name__ == '__main__':
    main()
