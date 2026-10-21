"""One bounded RH deployment batch per invocation; defaults to an unsigned quote."""
import argparse
import fcntl
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

import requests
from eth_account import Account
from eth_utils import keccak, to_checksum_address

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
PIN = '1aca236cbf553bab84bd5aa934a9d5e73d82748113e7c8b8272f4382f41e23fc'
sys.path.insert(0, str(ROOT.parent))
from prepare_deployment import init_code


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def eth(wei):
    return format(Decimal(wei) / 10**18, '.18f')


def bump(value):
    return (value * 120 + 99) // 100


def now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, indent=2) + '\n')
    tmp.replace(path)


def jobs(weights):
    data = weights.read_bytes()
    require(len(data) == 72045528 and hashlib.sha256(data).hexdigest() == PIN, 'Wrong six-bit export')
    manifest = json.loads((ROOT.parent / 'selected-weight-manifest.json').read_text())
    for tensor in manifest['tensors']:
        span = data[tensor['offset']:tensor['offset'] + tensor['byte_count']]
        require(hashlib.sha256(span).hexdigest() == tensor['sha256'], 'Tensor digest mismatch: ' + tensor['name'])
    artifact = json.loads((ROOT.parent / 'sixbit-optimization/compiled.json').read_text())
    contract = artifact['contracts']['SixBitFast']['evm']
    result = [{'name': 'SixBitFast', 'init': bytes.fromhex(contract['bytecode']['object']),
               'runtime': bytes.fromhex(contract['deployedBytecode']['object']), 'modeled_gas': 830442}]
    plan = json.loads((ROOT.parent / 'deployment-manifest.json').read_text())
    require(plan['weights_sha256'] == PIN, 'Deployment manifest mismatch')
    for i, start in enumerate(range(0, len(data), 61439)):
        init, runtime = init_code(data[start:start + 61439])
        shard = plan['shards'][i]
        require(shard['runtime_keccak256'] == '0x' + keccak(runtime).hex(), 'Shard digest mismatch')
        result.append({'name': f'weights-{i:04d}', 'init': init, 'runtime': runtime,
                       'modeled_gas': shard['modeled_cancun_creation_gas']})
    return result


class RPC:
    def __init__(self, url):
        self.url = url
        self.session = requests.Session()
        # Honor the environment's configured HTTPS route for public RPCs.
        # Local Anvil traffic must remain local, independent of proxy settings.
        self.session.trust_env = urlparse(url).hostname not in ('127.0.0.1', 'localhost', '::1')

    def __call__(self, method, params=()):
        try:
            response = self.session.post(self.url, json={'jsonrpc': '2.0', 'id': 1, 'method': method,
                                                        'params': list(params)}, timeout=30)
            response.raise_for_status()
            result = response.json()
        except (requests.RequestException, ValueError) as error:
            raise RuntimeError(f'RPC transport failed ({type(error).__name__}); endpoint omitted') from None
        if 'error' in result:
            # Provider error messages can echo URLs or signed transactions: do not log them.
            raise RuntimeError(f'RPC {method} failed, code {result["error"].get("code", "unknown")}')
        return result['result']


def quote_job(rpc, sender, job, price):
    estimate = int(rpc('eth_estimateGas', [{'from': sender, 'data': '0x' + job['init'].hex(), 'value': '0x0'}]), 16)
    return {'name': job['name'], 'estimated_gas': estimate, 'gas_limit': bump(estimate),
            'gas_price_wei': bump(price), 'maximum_fee_wei': bump(estimate) * bump(price),
            'runtime_keccak256': '0x' + keccak(job['runtime']).hex(), 'modeled_gas': job['modeled_gas']}


def snapshot(rpc, sender, all_jobs, state, count, reserve):
    completed = {row['name'] for row in state['receipts'] if row['status'] == 1 and row.get('runtime_verified')}
    remaining = [job for job in all_jobs if job['name'] not in completed]
    price = int(rpc('eth_gasPrice'), 16)
    balance = int(rpc('eth_getBalance', [sender, 'pending']), 16)
    quotes = [quote_job(rpc, sender, job, price) for job in remaining[:count]]
    # Use sampled data-shard ratios; a kernel-only quote probes the first remaining shard too.
    samples = [q for q in quotes if q['name'].startswith('weights-')]
    if not samples and any(j['name'].startswith('weights-') for j in remaining):
        samples = [quote_job(rpc, sender, next(j for j in remaining if j['name'].startswith('weights-')), price)]
    ratios = [Decimal(q['estimated_gas']) / q['modeled_gas'] for q in samples]
    ratios += [Decimal(r['gas_used']) / r['modeled_gas'] for r in state['receipts'][-10:]
               if r['name'].startswith('weights-') and r['status'] == 1]
    ratio = max(ratios + [Decimal(1)])
    modeled = sum(j['modeled_gas'] for j in remaining)
    estimated_remaining = int((Decimal(modeled) * ratio).to_integral_value(rounding='ROUND_CEILING'))
    next_max = sum(q['maximum_fee_wei'] for q in quotes)
    return {'as_of_utc': now(), 'wallet_balance_wei': balance, 'wallet_balance_eth': eth(balance),
            'current_gas_price_wei': price, 'completed_contracts': len(completed),
            'total_contracts': len(all_jobs), 'remaining_contracts': len(remaining),
            'cumulative_gas_used': sum(r['gas_used'] for r in state['receipts']),
            'cumulative_fee_wei': sum(r['fee_wei'] for r in state['receipts']),
            'cumulative_fee_eth': eth(sum(r['fee_wei'] for r in state['receipts'])),
            'remaining_modeled_gas': modeled, 'remaining_estimated_gas': estimated_remaining,
            'remaining_estimated_fee_eth': eth(estimated_remaining * price),
            'remaining_buffered_fee_eth': eth(bump(estimated_remaining) * bump(price)),
            'remaining_estimate_basis': 'Cancun model calibrated by sampled live estimates and recent receipts; prices and L1 posting charges can change',
            'reserve_eth': eth(reserve), 'next_batch': quotes,
            'next_batch_maximum_fee_wei': next_max, 'next_batch_maximum_fee_eth': eth(next_max),
            'suggested_next_batch_top_up_wei': max(0, next_max + reserve - balance),
            'suggested_next_batch_top_up_eth': eth(max(0, next_max + reserve - balance)),
            'pending_transaction': state['pending'],
            'next_batch_requires_separate_invocation': True}


def render_report(report):
    lines = ['# GH0ST six-bit deployment batch', '', f"Status: {report['status']}",
             f"Chain ID: {report['chain_id']}", '',
             f"This batch: {report['batch_contracts']} verified contracts, {report['batch_gas_used']:,} gas, {report['batch_fee_eth']} ETH.", '']
    snap = report.get('after') or report.get('before')
    if snap:
        lines += ['| Measure | Value |', '|---|---:|',
                  f"| Completed / total contracts | {snap['completed_contracts']} / {snap['total_contracts']} |",
                  f"| Cumulative actual gas | {snap['cumulative_gas_used']:,} |",
                  f"| Cumulative actual cost | {snap['cumulative_fee_eth']} ETH |",
                  f"| Wallet balance at snapshot | {snap['wallet_balance_eth']} ETH |",
                  f"| Contracts remaining | {snap['remaining_contracts']} |",
                  f"| Estimated remaining gas | {snap['remaining_estimated_gas']:,} |",
                  f"| Estimated remaining cost at snapshot price | {snap['remaining_estimated_fee_eth']} ETH |",
                  f"| Next batch contracts | {len(snap['next_batch'])} |",
                  f"| Next batch maximum fee at quoted limits | {snap['next_batch_maximum_fee_eth']} ETH |",
                  f"| Suggested top-up for next batch including reserve | {snap['suggested_next_batch_top_up_eth']} ETH |", '',
                  'Actual spending comes from receipts. Remaining gas and fees are estimates, not a fixed gas balance. '
                  'Gas limits and gas price each have a 20% buffer. The fee cap remains the hard spending bound.', '']
        lines += ['Snapshot time (UTC): ' + snap['as_of_utc'], '']
    if report.get('after_snapshot_unavailable'):
        lines += ['The post-batch balance/quote could not be refreshed. The table above is the pre-batch snapshot; obtain a fresh quote before funding or continuing.', '']
    if report.get('stop_reason'):
        lines += ['Stopped: ' + report['stop_reason'], '']
    if report.get('pending'):
        lines += ['Unresolved transaction: ' + report['pending']['hash'], 'No further transaction may be sent until it is reconciled.', '']
    lines += ['No automatic next batch. Review this report and explicitly start the next batch.',
              'Scope: matrix kernel and immutable six-bit data; the full inference engine is not implemented.', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--sender', required=True)
    parser.add_argument('--rpc-url-env', default='GH0ST_RH_RPC_URL')
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--report', type=Path, help='JSON report; also writes a Markdown sibling')
    parser.add_argument('--count', type=int, default=2, help='Hard maximum new contracts in this invocation; default pilot: 2')
    parser.add_argument('--broadcast', action='store_true')
    parser.add_argument('--key-file', type=Path)
    parser.add_argument('--password-file', type=Path)
    parser.add_argument('--max-batch-fee-eth', type=Decimal, help='Required hard maximum fee for this batch')
    parser.add_argument('--max-total-fee-eth', type=Decimal, help='Optional additional lifetime spending cap')
    parser.add_argument('--reserve-eth', type=Decimal, default=Decimal('0'), help='ETH balance to leave available')
    parser.add_argument('--local-test', action='store_true', help='Only localhost chain 31337')
    args = parser.parse_args()
    require(0 < args.count <= 1174 and args.reserve_eth >= 0, 'Invalid batch size or reserve')
    url = os.environ[args.rpc_url_env]
    sender = to_checksum_address(args.sender)
    if args.local_test:
        require(urlparse(url).hostname in ['127.0.0.1', 'localhost', '::1'], 'Local test requires localhost')
    chain = 31337 if args.local_test else 4663
    rpc = RPC(url)
    require(int(rpc('eth_chainId'), 16) == chain, 'Wrong chain; nothing signed')
    all_jobs = jobs(args.weights)
    args.state.parent.mkdir(parents=True, exist_ok=True)
    # A single sender/state must not be used by two deployment processes concurrently.
    lock = args.state.with_suffix(args.state.suffix + '.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError('This deployment state is already in use') from None
    state = json.loads(args.state.read_text()) if args.state.exists() else {
        'chain_id': chain, 'sender': sender, 'weights_sha256': PIN, 'receipts': [], 'pending': None, 'batches': []}
    require(state['chain_id'] == chain and state['sender'] == sender and state['weights_sha256'] == PIN, 'State mismatch')
    require(len({r['name'] for r in state['receipts']}) == len(state['receipts']), 'Duplicate state entries')
    job_map = {j['name']: j for j in all_jobs}

    def verify(receipt, pending):
        require(receipt['transactionHash'].lower() == pending['hash'].lower(), 'Receipt hash mismatch')
        require(receipt['from'].lower() == sender.lower(), 'Receipt sender mismatch')
        used, price = int(receipt['gasUsed'], 16), int(receipt['effectiveGasPrice'], 16)
        row = {'name': pending['name'], 'hash': pending['hash'], 'nonce': pending['nonce'],
               'status': int(receipt['status'], 16), 'address': receipt.get('contractAddress'),
               'block': int(receipt['blockNumber'], 16), 'gas_used': used, 'effective_gas_price_wei': price,
               'fee_wei': used * price, 'modeled_gas': job_map[pending['name']]['modeled_gas'], 'runtime_verified': False}
        if row['status'] == 1:
            actual = bytes.fromhex(rpc('eth_getCode', [row['address'], 'latest'])[2:])
            row['runtime_verified'] = actual == job_map[pending['name']]['runtime']
            row['runtime_keccak256'] = '0x' + keccak(actual).hex()
        state['receipts'].append(row)
        state['pending'] = None
        write_json(args.state, state)
        require(row['status'] == 1 and row['runtime_verified'], 'Failed deployment saved; inspect receipt before continuing')
        print(json.dumps({'verified_receipt': row}), flush=True)

    # Resolve ambiguous broadcasts before reading a key or assigning another nonce.
    if state['pending']:
        pending = state['pending']
        require(pending['name'] in job_map and pending['runtime_keccak256'] == '0x' + keccak(job_map[pending['name']]['runtime']).hex(), 'Pending state mismatch')
        receipt = rpc('eth_getTransactionReceipt', [pending['hash']])
        require(receipt is not None, 'Unresolved transaction ' + pending['hash'] + '; no further transaction signed')
        verify(receipt, pending)
    for receipt in state['receipts']:
        require(receipt['status'] == 1 and receipt.get('runtime_verified'), 'Previous failed deployment needs review')
        require(receipt['name'] in job_map, 'Unknown receipt in state')
        require(bytes.fromhex(rpc('eth_getCode', [receipt['address'], 'latest'])[2:]) == job_map[receipt['name']]['runtime'], 'Previously deployed code unavailable or changed')
        on_chain = rpc('eth_getTransactionReceipt', [receipt['hash']])
        require(on_chain is not None and int(on_chain['status'], 16) == 1 and on_chain.get('contractAddress', '').lower() == receipt['address'].lower(), 'Previously saved receipt unavailable or changed')
    reserve = int(args.reserve_eth * 10**18)
    before = snapshot(rpc, sender, all_jobs, state, args.count, reserve)
    report = {'started_at_utc': now(), 'chain_id': chain, 'sender': sender, 'status': 'unsigned_quote',
              'batch_limit': args.count, 'before': before, 'batch_contracts': 0, 'batch_gas_used': 0, 'batch_fee_eth': eth(0)}
    report_path = args.report or args.state.parent / ('batch-' + str(time.time_ns()) + '.json')
    protected = [args.state, args.weights, args.key_file, args.password_file]
    for path in protected:
        if path:
            require(path.resolve() not in (report_path.resolve(), report_path.with_suffix('.md').resolve()), 'Report path overlaps deployment state or input material')
    start = len(state['receipts'])
    try:
        if args.broadcast and before['remaining_contracts']:
            require(args.key_file and args.max_batch_fee_eth is not None and args.max_batch_fee_eth > 0, 'Signing file and positive batch fee cap required')
            cap = int(args.max_batch_fee_eth * 10**18)
            total_cap = int(args.max_total_fee_eth * 10**18) if args.max_total_fee_eth is not None else None
            report['max_batch_fee_eth'] = eth(cap)
            require(before['next_batch_maximum_fee_wei'] <= cap, 'Quoted batch exceeds batch fee cap; nothing signed')
            require(before['suggested_next_batch_top_up_wei'] == 0, 'Fund deployer by suggested top-up before starting; nothing signed')
            if total_cap is not None:
                require(before['cumulative_fee_wei'] + before['next_batch_maximum_fee_wei'] <= total_cap, 'Quoted batch exceeds cumulative cap; nothing signed')
            for secret_path in (args.key_file, args.password_file):
                if secret_path:
                    require(not secret_path.resolve().is_relative_to(REPO), 'Signing material must stay outside the repository')
            secret = args.key_file.read_text().strip()
            if secret.startswith('{'):
                require(args.password_file, 'Keystore password file required')
                key = Account.decrypt(json.loads(secret), args.password_file.read_text().rstrip('\r\n'))
            else:
                key = secret
            account = Account.from_key(key)
            del key, secret
            require(account.address == sender, 'Signing key does not match deployer')
            latest_nonce = int(rpc('eth_getTransactionCount', [sender, 'latest']), 16)
            require(int(rpc('eth_getTransactionCount', [sender, 'pending']), 16) == latest_nonce, 'Deployer already has pending transactions; wait before starting')
            report['status'] = 'broadcasting'
            for planned in before['next_batch']:
                job = job_map[planned['name']]
                require(int(rpc('eth_chainId'), 16) == chain, 'RPC chain changed')
                quote = quote_job(rpc, sender, job, int(rpc('eth_gasPrice'), 16))
                spent = sum(r['fee_wei'] for r in state['receipts'][start:])
                require(spent + quote['maximum_fee_wei'] <= cap, 'Fee rise would exceed batch cap; stopped before next signature')
                if total_cap is not None:
                    require(sum(r['fee_wei'] for r in state['receipts']) + quote['maximum_fee_wei'] <= total_cap, 'Cumulative cap reached; stopped before next signature')
                require(int(rpc('eth_getBalance', [sender, 'pending']), 16) >= quote['maximum_fee_wei'] + reserve, 'Wallet reserve would be breached; stopped before next signature')
                require(int(rpc('eth_getTransactionCount', [sender, 'pending']), 16) == latest_nonce, 'Deployer nonce changed; stopped before next signature')
                signed = account.sign_transaction({'chainId': chain, 'nonce': latest_nonce, 'value': 0,
                                                   'gas': quote['gas_limit'], 'gasPrice': quote['gas_price_wei'], 'data': job['init']})
                tx_hash = '0x' + keccak(signed.raw_transaction).hex()
                state['pending'] = {'name': job['name'], 'hash': tx_hash, 'nonce': latest_nonce,
                                    'runtime_keccak256': quote['runtime_keccak256'], 'maximum_fee_wei': quote['maximum_fee_wei']}
                write_json(args.state, state)
                returned = rpc('eth_sendRawTransaction', ['0x' + signed.raw_transaction.hex()])
                require(returned.lower() == tx_hash.lower(), 'RPC transaction hash mismatch')
                print(json.dumps({'submitted': job['name'], 'transaction_hash': tx_hash}), flush=True)
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    receipt = rpc('eth_getTransactionReceipt', [tx_hash])
                    if receipt is not None:
                        break
                    time.sleep(1)
                else:
                    raise RuntimeError('Receipt still pending; do not resend or reuse nonce')
                verify(receipt, state['pending'])
                latest_nonce += 1
            report['status'] = 'batch_complete_paused'
        elif args.broadcast:
            report['status'] = 'all_components_deployed'
    except Exception as error:
        report['status'] = 'stopped'
        report['stop_reason'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:
        rows = state['receipts'][start:]
        report.update({'finished_at_utc': now(), 'batch_contracts': sum(r['status'] == 1 and r.get('runtime_verified', False) for r in rows),
                       'batch_gas_used': sum(r['gas_used'] for r in rows), 'batch_fee_eth': eth(sum(r['fee_wei'] for r in rows)),
                       'batch_receipts': rows, 'pending': state['pending']})
        if args.broadcast:
            try:
                report['after'] = snapshot(rpc, sender, all_jobs, state, args.count, reserve)
            except Exception:
                report['after_snapshot_unavailable'] = True
            state['batches'].append({k: report[k] for k in ['started_at_utc', 'finished_at_utc', 'status', 'batch_contracts', 'batch_gas_used', 'batch_fee_eth']})
            write_json(args.state, state)
        write_json(report_path, report)
        report_path.with_suffix('.md').write_text(render_report(report))
        print(json.dumps(report), flush=True)
    return 2 if report['status'] == 'stopped' else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'status': 'stopped', 'reason': str(error) if isinstance(error, RuntimeError) else type(error).__name__}), flush=True)
        sys.exit(2)
