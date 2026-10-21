"""Finish one explicitly bounded deployment stage, funded in small groups.

The default stage is 25 existing contracts through 175 verified contracts.
Explicit baseline/target controls define a new stage; an existing run cannot be
retargeted. Previously completed work within the boundary counts toward its total.
Each new group is at most four independent transactions, signed and durably
journaled before broadcast. Existing active journals resume with identical bytes.
"""
import argparse
import fcntl
import hashlib
import json
import os
import stat
import sys
import time
from decimal import Decimal
from pathlib import Path

import deploy as d

BASELINE = 25
TARGET = 175
CHAIN = 4663
POSTING_RESERVE = 12000000
FUNDING_POLL_SECONDS = 10
FUNDING_TIMEOUT_SECONDS = 1800


def funded_prefix(entries, available):
    """Choose the largest funded prefix; never skip a nonce or job."""
    selected, maximum = [], 0
    for entry in entries[:d.RPC_GROUP]:
        if maximum + entry['maximum_fee_wei'] > available:
            break
        selected.append(entry)
        maximum += entry['maximum_fee_wei']
    return selected


def completed(state, all_jobs, baseline=BASELINE, target=TARGET):
    rows = state['receipts']
    d.require(all(r['status'] == 1 and r['runtime_verified'] for r in rows),
              'Failed or unverified deployment in state')
    names = [r['name'] for r in sorted(rows, key=lambda r: r['nonce'])]
    d.require(len(set(names)) == len(names), 'Duplicate deployment names')
    d.require(len({r['nonce'] for r in rows}) == len(rows), 'Duplicate deployment nonces')
    d.require(baseline <= len(rows) <= target, 'State outside immutable stage boundary')
    d.require(names == [j['name'] for j in all_jobs[:len(rows)]], 'Deployment sequence is not the pinned prefix')
    return len(rows)


def validate_active(state, job_map, target_names):
    bundle = state.get('active_bundle')
    if not bundle:
        return
    entries = bundle['transactions']
    d.require(entries and len({e['name'] for e in entries}) == len(entries), 'Invalid active journal jobs')
    nonces = [e['nonce'] for e in entries]
    d.require(nonces == list(range(nonces[0], nonces[0] + len(entries))), 'Noncontiguous active journal nonces')
    d.require(sum(e['maximum_fee_wei'] for e in entries) == bundle['maximum_fee_wei'], 'Active journal maximum mismatch')
    d.require(bundle['maximum_fee_wei'] <= bundle['fee_cap_wei'], 'Active journal exceeds its recorded fee cap')
    for entry in entries:
        d.require(entry['name'] in target_names and entry['name'] in job_map, 'Active journal exceeds authorized target')
        job = job_map[entry['name']]
        d.require(entry.get('init_sha256') == hashlib.sha256(job['init']).hexdigest(), 'Active creation pin mismatch')
        d.require(entry.get('runtime_keccak256') == d.digest(job['runtime']), 'Active runtime pin mismatch')
        d.require(isinstance(entry.get('hash'), str) and len(entry['hash']) == 66, 'Active journal lacks signed hash')
        d.require(entry['maximum_fee_wei'] == entry['gas_limit'] * entry['gas_price_wei'], 'Active transaction fee mismatch')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--creation-cache', type=Path, required=True)
    parser.add_argument('--sender', required=True)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--key-file', type=Path, required=True)
    parser.add_argument('--rpc-url-env', default='GH0ST_RH_RPC_URL')
    parser.add_argument('--reserve-eth', type=Decimal, default=Decimal('0.002'))
    parser.add_argument('--receipt-timeout', type=int, default=180)
    parser.add_argument('--baseline-contracts', type=int, default=BASELINE)
    parser.add_argument('--target-contracts', type=int, default=TARGET)
    args = parser.parse_args()
    baseline, target = args.baseline_contracts, args.target_contracts
    d.require(0 < baseline < target <= d.TOTAL, 'Invalid deployment stage boundary')
    d.require(args.reserve_eth.is_finite() and args.reserve_eth >= 0 and args.receipt_timeout > 0,
              'Invalid funded deployment controls')
    paths = [args.weights, args.state, args.run, args.report, args.key_file]
    d.require(len({p.resolve() for p in paths}) == len(paths), 'Input/output paths overlap')
    d.require(args.state.is_file(), 'Existing deployment state required')
    d.require(not args.key_file.resolve().is_relative_to(d.REPO), 'Key must stay outside repository')
    d.require(stat.S_IMODE(args.key_file.stat().st_mode) == 0o600, 'Key file must have mode 600')
    sender = d.to_checksum_address(args.sender)
    reserve = int(args.reserve_eth * 10**18)
    rpc = d.RPC(os.environ[args.rpc_url_env])
    d.require(int(rpc('eth_chainId'), 16) == CHAIN, 'Wrong chain; nothing signed')
    lock = args.state.with_suffix('.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    state = json.loads(args.state.read_text())
    d.require(state['chain_id'] == CHAIN and state['sender'] == sender and state['weights_sha256'] == d.PIN,
              'State identity mismatch')
    all_jobs = d.jobs(args.weights, state, args.creation_cache)
    d.require(target <= len(all_jobs), 'Target includes jobs unavailable at this stage')
    job_map = {j['name']: j for j in all_jobs}
    target_names = {j['name'] for j in all_jobs[baseline:target]}
    count = completed(state, all_jobs, baseline, target)
    baseline_rows = sorted(state['receipts'], key=lambda r: r['nonce'])[:baseline]
    identity = {'chain_id': CHAIN, 'sender': sender, 'weights_sha256': d.PIN,
                'baseline_contracts': baseline, 'target_contracts': target,
                'authorized_new_contracts': target - baseline,
                'baseline_receipt_hashes': [r['hash'] for r in baseline_rows]}
    run_id = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    if args.run.exists():
        run = json.loads(args.run.read_text())
        d.require(all(run.get(k) == value for k, value in identity.items()) and run.get('run_id') == run_id,
                  'Logical run boundary or identity changed')
    else:
        balance = int(rpc('eth_getBalance', [sender, 'latest']), 16)
        run = dict(identity, schema=1, run_id=run_id, started_at_utc=d.now(), groups=[],
                   controller_start_balance_wei=balance,
                   controller_start_cumulative_fee_wei=sum(r['fee_wei'] for r in state['receipts']))
    last_balance = run.get('wallet_balance_wei', run['controller_start_balance_wei'])

    def progress(status, **extra):
        nonlocal last_balance
        try:
            last_balance = int(rpc('eth_getBalance', [sender, 'latest']), 16)
            unavailable = False
        except Exception:
            unavailable = True
        rows = [r for r in state['receipts'] if r['name'] in target_names]
        fees = sum(r['fee_wei'] for r in rows)
        cumulative_fees = sum(r['fee_wei'] for r in state['receipts'])
        run.update(status=status, updated_at_utc=d.now(), completed_contracts=len(state['receipts']),
                   logical_contracts_verified=len(rows), logical_contracts_remaining=target - baseline - len(rows),
                   logical_gas_used=sum(r['gas_used'] for r in rows), logical_fee_wei=fees,
                   logical_fee_eth=d.eth(fees), cumulative_fee_wei=cumulative_fees,
                   wallet_balance_wei=last_balance, wallet_balance_eth=d.eth(last_balance),
                   wallet_balance_unavailable=unavailable, reserve_wei=reserve,
                   net_external_balance_flows_since_controller_start_wei=(last_balance -
                       run['controller_start_balance_wei'] + cumulative_fees -
                       run['controller_start_cumulative_fee_wei']),
                   unresolved_bundle=state.get('active_bundle'), **extra)
        d.save(args.run, run)
        d.save(args.report, run)
        print(json.dumps({k: run[k] for k in ('status', 'completed_contracts', 'logical_contracts_verified',
              'logical_contracts_remaining', 'logical_fee_eth', 'wallet_balance_eth')}), flush=True)

    def await_funding(required):
        deadline = time.monotonic() + FUNDING_TIMEOUT_SECONDS
        while True:
            d.require(int(rpc('eth_chainId'), 16) == CHAIN, 'RPC chain changed')
            balance = int(rpc('eth_getBalance', [sender, 'latest']), 16)
            if balance >= required + reserve:
                return True
            top_up = required + reserve - balance
            print(json.dumps({'status': 'funding_required', 'address': sender,
                              'wallet_balance_eth': d.eth(balance),
                              'suggested_top_up_eth': d.eth(top_up),
                              'required_transaction_maximum_eth': d.eth(required),
                              'reserve_eth': d.eth(reserve)}), flush=True)
            progress('waiting_for_funding', suggested_top_up_wei=top_up)
            if time.monotonic() >= deadline:
                progress('paused_awaiting_funding')
                return False
            time.sleep(FUNDING_POLL_SECONDS)

    def sign(entries):
        d.check_submission_sizes(CHAIN, entries, job_map)
        account = d.Account.from_key(args.key_file.read_text().strip())
        try:
            d.require(account.address == sender, 'Key does not match sender')
            return d.signed_bundle(account, CHAIN, entries, job_map)
        finally:
            del account

    try:
        # Historical receipt/runtime verification is deliberately performed once.
        d.verify_saved(rpc, state, job_map)
        validate_active(state, job_map, target_names)
        d.reconcile(rpc, state, job_map, args.state)
        completed(state, all_jobs, baseline, target)
        progress('running')
        while True:
            count = completed(state, all_jobs, baseline, target)
            if count == target and not state.get('active_bundle'):
                progress('logical_batch_complete_paused')
                return 0
            d.require(int(rpc('eth_chainId'), 16) == CHAIN, 'RPC chain changed')
            if not state.get('active_bundle'):
                market = int(rpc('eth_gasPrice'), 16)
                ceiling = d.bump(market, 2000)
                limit = d.limits(rpc, False)
                quote = d.snapshot(rpc, sender, all_jobs, state, min(d.RPC_GROUP, target - count),
                                   reserve, limit, ceiling, True, POSTING_RESERVE)
                d.require(quote['next_batch'], 'No deployable jobs inside authorized boundary')
                if quote['current_gas_price_wei'] > ceiling:
                    continue  # Refresh an unsigned quote only.
                balance = int(rpc('eth_getBalance', [sender, 'latest']), 16)
                entries = funded_prefix(quote['next_batch'], max(0, balance - reserve))
                if not entries:
                    if not await_funding(quote['next_batch'][0]['maximum_fee_wei']):
                        return 3
                    continue  # New funding always gets a fresh market/estimate quote.
                d.require(all(e['name'] in target_names for e in entries), 'Quote exceeds authorized boundary')
                nonce = int(rpc('eth_getTransactionCount', [sender, 'latest']), 16)
                d.require(int(rpc('eth_getTransactionCount', [sender, 'pending']), 16) == nonce,
                          'Unknown pending transactions; nothing signed')
                d.require(nonce == max(r['nonce'] for r in state['receipts']) + 1,
                          'Nonce consumed outside the deployment journal; nothing signed')
                entries = [dict(entry, nonce=nonce + i) for i, entry in enumerate(entries)]
                maximum = sum(e['maximum_fee_wei'] for e in entries)
                balance = int(rpc('eth_getBalance', [sender, 'latest']), 16)
                d.require(maximum <= max(0, balance - reserve), 'Funding changed before signing; nothing signed')
                bundle = {'created_at_utc': d.now(), 'maximum_fee_wei': maximum,
                          'fee_cap_wei': balance - reserve, 'reserve_wei': reserve,
                          'wallet_balance_at_signing_wei': balance,
                          'fixed_gas_price_ceiling_wei': ceiling, 'logical_run_id': run_id,
                          'price_policy': 'Fresh market plus 20 percent, fixed after signing',
                          'transactions': entries}
                raw = sign(entries)
                d.require(int(rpc('eth_chainId'), 16) == CHAIN, 'RPC chain changed')
                d.require(int(rpc('eth_getTransactionCount', [sender, 'pending']), 16) == nonce,
                          'Nonce changed before journaling; nothing broadcast')
                state['active_bundle'] = bundle
                d.save(args.state, state)
            else:
                bundle = state['active_bundle']
                validate_active(state, job_map, target_names)
                entries = bundle['transactions']
                raw = sign(entries)  # Existing journal hashes must reproduce exactly.
            try:
                progress('broadcasting')
                for offset in range(0, len(entries), d.RPC_GROUP):
                    group = entries[offset:offset + d.RPC_GROUP]
                    recorded = {r['hash'] for r in state['receipts']}
                    outstanding = [e for e in group if e['hash'] not in recorded]
                    if not outstanding:
                        continue
                    required = sum(e['maximum_fee_wei'] for e in outstanding)
                    if not await_funding(required):
                        return 3
                    d.require(int(rpc('eth_chainId'), 16) == CHAIN, 'RPC chain changed')
                    d.broadcast_group(rpc, state, group, raw, job_map, args.state, args.receipt_timeout)
                    completed(state, all_jobs, baseline, target)
                    progress('group_confirmed')
                recorded = {r['hash'] for r in state['receipts'] if r['status'] == 1 and r['runtime_verified']}
                d.require(all(e['hash'] in recorded for e in entries), 'Active bundle still unresolved')
                finished = dict(bundle, completed_at_utc=d.now(), status='batch_complete_paused')
                state['batches'].append(finished)
                state['active_bundle'] = None
                d.save(args.state, state)
                rows = [r for r in state['receipts'] if r['hash'] in {e['hash'] for e in entries}]
                run['groups'].append({'completed_at_utc': finished['completed_at_utc'],
                    'names': [e['name'] for e in entries], 'maximum_fee_wei': bundle['maximum_fee_wei'],
                    'gas_used': sum(r['gas_used'] for r in rows),
                    'fee_wei': sum(r['fee_wei'] for r in rows)})
                progress('running')
            finally:
                del raw
    except Exception as error:
        progress('stopped', stop_reason=d.safe_rpc_reason(str(error)) if isinstance(error, RuntimeError) else type(error).__name__)
        return 2
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'status': 'stopped', 'reason': d.safe_rpc_reason(str(error))
              if isinstance(error, RuntimeError) else type(error).__name__}), flush=True)
        sys.exit(2)
