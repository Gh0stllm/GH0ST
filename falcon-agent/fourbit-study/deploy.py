"""One bounded four-bit deployment batch. Quotes by default; never auto-continues.

HTTP bundles contain independent EOA transactions, not an atomic EVM transaction.
All hashes/nonces/fee bounds are durably journaled before any broadcast. Recovery
resends identical signed transactions. Explicit rejected-encoding migration requires
all old hashes absent and a clean nonce before archiving the rejected journal.
"""
import argparse
import fcntl
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal, ROUND_CEILING
from pathlib import Path
from urllib.parse import urlparse

import requests
import rlp
from eth_abi import encode, decode
from eth_account import Account
from eth_utils import keccak, to_checksum_address
from local import initcode, creation_gas, index_blob

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
PIN = '9cc5e90880d96ff15bf4110f7970a7ea473c9b86576298691ade1e745672e7a9'
KERNEL_PIN = '0x4712cc155846d065fa53ed92ead537e9912e53a44ecaf53cb9bc36aeadcf7e4b'
TOTAL = 497
RPC_GROUP = 4  # 4 full shards stay below the observed HTTP request-body limit.
MAX_SIGNED_TX_BYTES = 95000  # Conservative Nitro default; 98 KB rejected by both RH endpoints.


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def now():
    return datetime.now(timezone.utc).isoformat()


def eth(wei):
    return format(Decimal(wei) / 10**18, '.18f')


def bump(value, bps=2000):
    return (value * (10000 + bps) + 9999) // 10000


def digest(data):
    return '0x' + keccak(data).hex()


def maximum_transaction_size(chain, nonce, gas, price, init):
    # Upper bound for a signed legacy creation transaction, including both signatures.
    return len(rlp.encode([nonce, price, gas, b'', 0, init, chain * 2 + 36,
                           (1 << 256) - 1, (1 << 256) - 1]))


def check_submission_sizes(chain, entries, job_map):
    if chain != 4663:
        return
    for e in entries:
        size = maximum_transaction_size(chain, e['nonce'], e['gas_limit'],
                                        e['gas_price_wei'], job_map[e['name']]['init'])
        require(size <= MAX_SIGNED_TX_BYTES,
                e['name'] + ': signed transaction size ' + str(size) +
                ' exceeds conservative 95000-byte submission limit; deployment encoding must be revised')


def safe_rpc_reason(message):
    """Keep diagnostic prose while removing endpoint credentials and hex payloads."""
    value = re.sub(r'(?:https?|wss?)://\S+', '[endpoint]', str(message))
    value = re.sub(r'alch_[A-Za-z0-9_-]+', '[credential]', value)
    value = re.sub(r'(?i)(?:0x)?[a-f0-9]{24,}', '[hex omitted]', value)
    return ''.join(c for c in value if c.isprintable())[:250]


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    with temp.open('w') as stream:
        stream.write(json.dumps(value, indent=2) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class RPC:
    def __init__(self, url):
        self.url = url
        self.session = requests.Session()
        self.session.trust_env = urlparse(url).hostname not in ('127.0.0.1', 'localhost', '::1')

    def batch(self, calls):
        require(0 < len(calls) <= RPC_GROUP, 'RPC group must contain 1 to 4 calls')
        body = [{'jsonrpc': '2.0', 'id': i, 'method': m, 'params': list(p)}
                for i, (m, p) in enumerate(calls)]
        try:
            response = self.session.post(self.url, json=body, timeout=30)
            response.raise_for_status()
            rows = response.json()
        except (requests.RequestException, ValueError) as error:
            raise RuntimeError('RPC transport failed (' + type(error).__name__ + '); endpoint omitted') from None
        require(isinstance(rows, list) and len(rows) == len(calls), 'Incomplete RPC batch response')
        require({r.get('id') for r in rows} == set(range(len(calls))), 'Invalid RPC response IDs')
        return [{'result': r['result']} if 'result' in r else {
                    'error_code': r.get('error', {}).get('code'),
                    'error_reason': safe_rpc_reason(r.get('error', {}).get('message', ''))}
                for r in sorted(rows, key=lambda r: r['id'])]

    def __call__(self, method, params=()):
        row = self.batch([(method, params)])[0]
        require('result' in row, 'RPC ' + method + ' failed, code ' + str(row.get('error_code')))
        return row['result']


def jobs(weights, state, creation_cache=None):
    data = weights.read_bytes()
    require(len(data) == 48626528 and hashlib.sha256(data).hexdigest() == PIN, 'Wrong four-bit export')
    plan = json.loads((ROOT / 'deployment-plan.json').read_text())
    require(plan['weights_sha256'] == PIN and plan['weight_shards'] == 495, 'Plan pin mismatch')
    evm = json.loads((ROOT / 'compiled-1000000.json').read_text())['contracts']['FourBitAffine64']['evm']
    kernel = {'name': 'FourBitAffine64', 'init': bytes.fromhex(evm['bytecode']['object']),
              'runtime': bytes.fromhex(evm['deployedBytecode']['object']), 'modeled_gas': 1150404}
    require(digest(kernel['runtime']) == KERNEL_PIN, 'Kernel runtime pin mismatch')
    require(hashlib.sha256(kernel['init']).hexdigest() == plan['kernel']['init_sha256'], 'Kernel init pin mismatch')
    result = [kernel]
    validation = json.loads((ROOT / 'creation-validation.json').read_text())
    require(validation['status'] == 'all_shards_verified' and validation['weights_sha256'] == PIN, 'Creation validation missing')
    from creation_codec import choose
    manifest = json.loads((ROOT / 'selected-manifest.json').read_text())
    decoder = bytes.fromhex(json.loads((ROOT / 'creation/decoder.json').read_text())['bytecode'])
    require(hashlib.sha256(decoder).hexdigest() == validation['decoder_sha256'], 'Decoder changed after validation')
    require(len(plan['shards']) == 495, 'Invalid shard count')
    for i, row in enumerate(plan['shards']):
        require(row['offset'] == i * 98303 and row['name'] == f'fourbit-weights-{i:04d}', 'Invalid shard layout')
        payload = data[row['offset']:row['offset'] + row['payload_bytes']]
        checked = validation['shards'][i]
        code = ((creation_cache / (row['name'] + '.bin')).read_bytes() if creation_cache else choose(payload, manifest, row['offset'])[1])
        require(checked['name'] == row['name'] and checked['exact_runtime_verified'], 'Missing shard validation')
        require(digest(b'\0' + payload) == row['runtime_keccak256'], 'Shard runtime pin mismatch')
        require(hashlib.sha256(code).hexdigest() == checked['init_sha256'], 'Shard creation pin mismatch')
        require(checked['runtime_keccak256'] == row['runtime_keccak256'], 'Lossless runtime pin mismatch')
        result.append({'name': row['name'], 'init': code, 'runtime': b'\0' + payload,
                       'modeled_gas': checked['local_cancun_gas']})
    receipts = {r['name']: r for r in state['receipts'] if r['status'] == 1 and r['runtime_verified']}
    shards = result[1:]
    if all(j['name'] in receipts for j in shards):
        payload = index_blob(data, [receipts[j['name']]['address'] for j in shards], 98303)
        result.append({'name': 'FourBitWeightIndex', 'init': initcode(payload),
                       'runtime': b'\0' + payload, 'modeled_gas': creation_gas(payload)})
    return result


def limits(rpc, local):
    if local:
        return 32000000
    result = rpc('eth_call', [{'to': '0x000000000000000000000000000000000000006c',
                              'data': digest(b'getMaxTxGasLimit()')[:10]}, 'latest'])
    limit = int(result, 16)
    require(limit > 0, 'Missing transaction gas limit')
    return limit


def snapshot(rpc, sender, all_jobs, state, count, reserve, limit, gas_price_ceiling=None, nitro_components=False, l1_gas_reserve=0):
    done = {r['name'] for r in state['receipts'] if r['status'] == 1 and r['runtime_verified']}
    remaining = [j for j in all_jobs if j['name'] not in done]
    price = int(rpc('eth_gasPrice'), 16)
    signed_price = gas_price_ceiling if gas_price_ceiling is not None else bump(price, 200)
    require(signed_price > 0, 'Gas price ceiling must be positive')
    require(l1_gas_reserve >= 0 and (not l1_gas_reserve or nitro_components), 'Parent posting reserve requires Nitro components')
    balance = int(rpc('eth_getBalance', [sender, 'latest']), 16)
    quotes = []
    for start in range(0, min(count, len(remaining)), RPC_GROUP):
        chunk = remaining[start:min(start + RPC_GROUP, count)]
        if nitro_components:
            rows = rpc.batch([('eth_call', [{'from': sender,
                'to': '0x00000000000000000000000000000000000000c8',
                'data': '0x' + (keccak(text='gasEstimateComponents(address,bool,bytes)')[:4] +
                    encode(['address', 'bool', 'bytes'], ['0x0000000000000000000000000000000000000000', True, j['init']])).hex()}, 'latest']) for j in chunk])
        else:
            rows = rpc.batch([('eth_estimateGas', [{'from': sender, 'value': '0x0', 'data': '0x' + j['init'].hex()}]) for j in chunk])
        for j, row in zip(chunk, rows):
            require('result' in row, 'Gas estimate failed for ' + j['name'] + ', code ' + str(row.get('error_code')))
            components = {}
            if nitro_components:
                estimate, l1_gas, base_fee, l1_base_fee = map(int, decode(['uint64', 'uint64', 'uint256', 'uint256'], bytes.fromhex(row['result'][2:])))
                require(0 <= l1_gas < estimate, 'Invalid Nitro gas components')
                execution = estimate - l1_gas
                require(0 < bump(execution, 300) <= limit, 'Buffered execution exceeds live transaction computation limit')
                components = {'estimated_l1_gas': l1_gas, 'estimated_execution_gas': execution,
                              'estimate_base_fee_wei': base_fee, 'estimate_l1_base_fee_wei': l1_base_fee}
            else:
                estimate = int(row['result'], 16)
                require(0 < bump(estimate, 300) <= limit, 'Buffered deployment exceeds live transaction gas limit')
            gas_basis = estimate + max(0, l1_gas_reserve - components.get('estimated_l1_gas', 0))
            gas = bump(gas_basis, 300)
            if nitro_components:
                components['reserved_l1_gas'] = max(l1_gas_reserve, components['estimated_l1_gas'])
            quotes.append({'name': j['name'], 'estimated_gas': estimate, 'gas_limit': gas,
                           'gas_price_wei': signed_price, 'maximum_fee_wei': gas * signed_price,
                           'init_sha256': hashlib.sha256(j['init']).hexdigest(),
                           'modeled_gas': j['modeled_gas'], 'runtime_keccak256': digest(j['runtime']), **components})
    ratio = max([Decimal(1)] + [Decimal(q['estimated_gas']) / q['modeled_gas'] for q in quotes]
                + [Decimal(r['gas_used']) / r['modeled_gas'] for r in state['receipts'][-25:]])
    modeled = sum(j['modeled_gas'] for j in remaining)
    if not any(j['name'] == 'FourBitWeightIndex' for j in all_jobs):
        modeled += 2204272  # Provisional until actual shard addresses are known.
    estimate = int((Decimal(modeled) * ratio).to_integral_value(rounding=ROUND_CEILING))
    maximum = sum(q['maximum_fee_wei'] for q in quotes)
    return {'as_of_utc': now(), 'wallet_balance_wei': balance, 'wallet_balance_eth': eth(balance),
            'current_gas_price_wei': price, 'signed_gas_price_ceiling_wei': signed_price,
            'gas_price_policy': 'Explicit fixed ceiling; no automatic escalation' if gas_price_ceiling is not None else 'Live price with 2% ceiling buffer',
            'transaction_gas_limit': limit, 'limit_scope': 'Nitro execution gas excluding parent posting' if nitro_components else 'total gas',
            'completed_contracts': len(done), 'total_contracts': TOTAL, 'remaining_contracts': TOTAL - len(done),
            'existing_sixbit_contracts': 2, 'cumulative_gas_used': sum(r['gas_used'] for r in state['receipts']),
            'cumulative_fee_wei': sum(r['fee_wei'] for r in state['receipts']),
            'remaining_modeled_gas': modeled, 'remaining_estimated_gas': estimate,
            'remaining_estimated_fee_eth': eth(estimate * price),
            'remaining_buffered_fee_eth': eth(bump(estimate, 300) * signed_price),
            'estimate_basis': 'Local Cancun execution gas calibrated by live total estimates/receipts including parent posting; RH prices may change. Index gas provisional.',
            'reserve_eth': eth(reserve), 'next_batch': quotes,
            'next_batch_estimated_fee_eth': eth(sum(q['estimated_gas'] for q in quotes) * price),
            'next_batch_maximum_fee_wei': maximum, 'next_batch_maximum_fee_eth': eth(maximum),
            'suggested_next_batch_top_up_eth': eth(max(0, maximum + reserve - balance))}


def receipt_row(rpc, sender, entry, job, receipt):
    require(receipt['transactionHash'].lower() == entry['hash'].lower(), 'Receipt hash mismatch')
    require(receipt['from'].lower() == sender.lower(), 'Receipt sender mismatch')
    used, price = int(receipt['gasUsed'], 16), int(receipt['effectiveGasPrice'], 16)
    require(used <= entry['gas_limit'] and price <= entry['gas_price_wei'], 'Receipt exceeds signed limits')
    row = {k: entry[k] for k in ('name', 'hash', 'nonce', 'gas_limit', 'gas_price_wei', 'maximum_fee_wei')}
    row.update({'status': int(receipt['status'], 16), 'address': receipt.get('contractAddress'),
                'block': int(receipt['blockNumber'], 16), 'block_hash': receipt['blockHash'],
                'gas_used': used, 'effective_gas_price_wei': price, 'fee_wei': used * price,
                'modeled_gas': job['modeled_gas'], 'runtime_verified': False})
    if 'estimated_l1_gas' in entry or 'gas_used_for_l1' in entry:
        require('gasUsedForL1' in receipt, 'Nitro receipt lacks parent posting gas accounting')
        l1_used = int(receipt['gasUsedForL1'], 16)
        require(0 <= l1_used <= used, 'Invalid actual Nitro gas components')
        row.update({'gas_used_for_l1': l1_used, 'execution_gas_used': used - l1_used})
    if row['status'] == 1:
        expected = '0x' + keccak(rlp.encode([bytes.fromhex(sender[2:]), entry['nonce']]))[-20:].hex()
        require(row['address'].lower() == expected.lower(), 'Unexpected deployment address')
        actual = bytes.fromhex(rpc('eth_getCode', [row['address'], 'latest'])[2:])
        row['runtime_keccak256'] = digest(actual)
        row['runtime_verified'] = actual == job['runtime']
    return row


def reconcile(rpc, state, job_map, path, entries=None):
    if not state['active_bundle']:
        return
    recorded = {r['hash'] for r in state['receipts']}
    for entry in entries if entries is not None else state['active_bundle']['transactions']:
        require(entry['name'] in job_map and entry['runtime_keccak256'] == digest(job_map[entry['name']]['runtime']), 'Journal pin mismatch')
        if entry['hash'] in recorded:
            continue
        receipt = rpc('eth_getTransactionReceipt', [entry['hash']])
        if receipt is not None:
            row = receipt_row(rpc, state['sender'], entry, job_map[entry['name']], receipt)
            state['receipts'].append(row)
            state['receipts'].sort(key=lambda r: r['nonce'])
            save(path, state)
            print(json.dumps({'verified': row['name'], 'hash': row['hash'], 'gas_used': row['gas_used'],
                              'fee_eth': eth(row['fee_wei']), 'runtime_verified': row['runtime_verified']}), flush=True)
            require(row['status'] == 1 and row['runtime_verified'], 'Failed deployment recorded; batch stopped for review')


def verify_saved(rpc, state, job_map):
    require(len({r['name'] for r in state['receipts']}) == len(state['receipts']), 'Duplicate deployments in state')
    require(len({r['nonce'] for r in state['receipts']}) == len(state['receipts']), 'Duplicate nonces in state')
    for start in range(0, len(state['receipts']), RPC_GROUP):
        chunk = state['receipts'][start:start + RPC_GROUP]
        for row in chunk:
            require(row['status'] == 1 and row['runtime_verified'] and row['name'] in job_map, 'Invalid previous deployment')
        receipts = rpc.batch([('eth_getTransactionReceipt', [row['hash']]) for row in chunk])
        for row, answer in zip(chunk, receipts):
            require('result' in answer and answer['result'] is not None and answer['result']['blockHash'] == row['block_hash'], 'Saved receipt missing or reorganized')
        codes = rpc.batch([('eth_getCode', [row['address'], 'latest']) for row in chunk])
        for row, answer, code in zip(chunk, receipts, codes):
            require('result' in code, 'Saved runtime unavailable')
            def cached_rpc(method, params):
                require(method == 'eth_getCode' and params[0].lower() == row['address'].lower(), 'Unexpected receipt verification lookup')
                return code['result']
            check = receipt_row(cached_rpc, state['sender'], row, job_map[row['name']], answer['result'])
            require(check == row, 'Saved receipt or runtime changed')


def replace_rejected_encoding(rpc, state, path, count, cap):
    """Archive the rejected original batch only after proving its 24 hashes absent."""
    bundle = state['active_bundle']
    require(bundle is not None and count == 24, 'Migration only completes the original 25-contract batch')
    require(len(state['receipts']) == 1 and state['receipts'][0]['name'] == 'FourBitAffine64', 'Unexpected completed batch state')
    entries = bundle['transactions']
    require(len(entries) == 25 and entries[0]['hash'] == state['receipts'][0]['hash'], 'Wrong original journal')
    require([e['name'] for e in entries[1:]] == [f'fourbit-weights-{i:04d}' for i in range(24)], 'Wrong rejected job sequence')
    require([e['nonce'] for e in entries] == list(range(2, 27)), 'Wrong original nonces')
    require(cap is not None and int(cap * 10**18) + state['receipts'][0]['fee_wei'] <= bundle['fee_cap_wei'], 'Replacement exceeds original total fee cap')
    absent = []
    for e in entries[1:]:
        rows = rpc.batch([('eth_getTransactionReceipt', [e['hash']]), ('eth_getTransactionByHash', [e['hash']])])
        require(all('result' in row and row['result'] is None for row in rows), 'Original hash is mined or pending; replacement stopped')
        absent.append(e['hash'])
    require(int(rpc('eth_getTransactionCount', [state['sender'], 'latest']), 16) == 3, 'Nonce already consumed')
    require(int(rpc('eth_getTransactionCount', [state['sender'], 'pending']), 16) == 3, 'Pending transaction prevents replacement')
    state.setdefault('superseded_bundles', []).append(dict(bundle, superseded_at_utc=now(),
        reason='Raw creation payloads rejected as oversized; replace with locally verified lossless encoding',
        absent_transaction_and_receipt_hashes=absent, replacement_first_nonce=3))
    state['active_bundle'] = None
    state['creation_encoding'] = 'canonical-huffman-v1'
    save(path, state)


def signed_bundle(account, chain, entries, job_map):
    result = {}
    for e in entries:
        require(not e.get('init_sha256') or e['init_sha256'] == hashlib.sha256(job_map[e['name']]['init']).hexdigest(), 'Journal creation pin mismatch')
        signed = account.sign_transaction({'chainId': chain, 'nonce': e['nonce'], 'value': 0,
                                           'gas': e['gas_limit'], 'gasPrice': e['gas_price_wei'],
                                           'data': job_map[e['name']]['init']})
        tx_hash = digest(signed.raw_transaction)
        require(not e.get('hash') or e['hash'] == tx_hash, 'Recovery signature/hash mismatch')
        e['hash'] = tx_hash
        result[tx_hash] = '0x' + signed.raw_transaction.hex()
    return result


def broadcast_group(rpc, state, entries, raw, job_map, path, timeout):
    # Every transaction in the full logical batch was already signed and journaled.
    entries = [e for e in entries if e['hash'] not in {r['hash'] for r in state['receipts']}]
    if not entries:
        return
    try:
        answers = rpc.batch([('eth_sendRawTransaction', [raw[e['hash']]]) for e in entries])
        for e, answer in zip(entries, answers):
            if 'result' in answer:
                require(answer['result'].lower() == e['hash'].lower(), 'Broadcast hash mismatch')
            e['submission'] = {'accepted': 'result' in answer, 'error_code': answer.get('error_code'),
                               'error_reason': answer.get('error_reason')}
    except RuntimeError:
        # Transport failure is ambiguous. Hash reconciliation must precede any retry.
        for e in entries:
            e['submission'] = {'ambiguous': True}
    save(path, state)
    deadline = time.monotonic() + timeout
    retried = {}
    retry_interval = 1 if state['active_bundle'].get('fixed_gas_price_ceiling_wei') is not None else 5
    while time.monotonic() < deadline:
        reconcile(rpc, state, job_map, path, entries)
        done = {r['hash'] for r in state['receipts']}
        pending = [e for e in entries if e['hash'] not in done]
        if not pending:
            return
        first = pending[0]
        if time.monotonic() - retried.get(first['hash'], 0) >= retry_interval and rpc('eth_getTransactionByHash', [first['hash']]) is None:
            latest = int(rpc('eth_getTransactionCount', [state['sender'], 'latest']), 16)
            queued = int(rpc('eth_getTransactionCount', [state['sender'], 'pending']), 16)
            require(latest <= first['nonce'], 'Nonce consumed by an unknown transaction; stop')
            if latest == queued == first['nonce']:
                # Re-send identical bytes only, to repair a gap caused by out-of-order
                # provider execution or transient base fee. Fixed low ceilings retry at 1 s; otherwise 5 s.
                # No fee replacement, new nonce or new contract.
                require(int(rpc('eth_chainId'), 16) == state['chain_id'], 'RPC chain changed')
                retried[first['hash']] = time.monotonic()
                try:
                    answer = rpc.batch([('eth_sendRawTransaction', [raw[first['hash']]])])[0]
                    if 'result' in answer:
                        require(answer['result'].lower() == first['hash'].lower(), 'Retry hash mismatch')
                    first['last_retry'] = dict(answer, as_of_utc=now())
                    save(path, state)
                except RuntimeError as error:
                    first['last_retry'] = {'ambiguous': True, 'reason': safe_rpc_reason(error), 'as_of_utc': now()}
                    save(path, state)
        time.sleep(1)
    raise RuntimeError('Bundle still unresolved; hashes retained. Use --resume-bundle, never a fresh state')


def render(report):
    lines = ['# GH0ST four-bit RH deployment batch', '', 'Status: ' + report['status'], '',
             f"This invocation verified {report['batch_contracts']} contracts; {report['batch_gas_used']:,} gas; {report['batch_fee_eth']} ETH.", '',
             'Transactions are independent; HTTP bundling is not atomic and does not itself reduce chain gas.', '']
    snap = report.get('after') or report.get('before')
    if snap:
        lines += ['| Measure | Value |', '|---|---:|',
                  f"| Four-bit contracts complete / planned | {snap['completed_contracts']} / {TOTAL} |",
                  f"| Old six-bit contracts retained | 2 |",
                  f"| Wallet balance | {snap['wallet_balance_eth']} ETH |",
                  f"| Four-bit contracts remaining | {snap['remaining_contracts']} |",
                  f"| Estimated remaining gas | {snap['remaining_estimated_gas']:,} |",
                  f"| Estimated remaining fee at snapshot price | {snap['remaining_estimated_fee_eth']} ETH |",
                  f"| Next batch quoted maximum | {snap['next_batch_maximum_fee_eth']} ETH |",
                  f"| Reserve | {snap['reserve_eth']} ETH |",
                  f"| Suggested top-up for next batch | {snap['suggested_next_batch_top_up_eth']} ETH |", '',
                  'Snapshot (UTC): ' + snap['as_of_utc'], snap['estimate_basis'], '']
    if report.get('stop_reason'):
        lines += ['Stopped: ' + report['stop_reason'], '']
    if report.get('after_snapshot_unavailable'):
        lines += ['Post-batch quote unavailable; any table above uses the pre-batch snapshot.', '']
    lines += ['No automatic next batch. RH receipts are not a claim of Ethereum finality.',
              'Scope: immutable weights, matrix kernel and final index. Full inference is not implemented.', '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--weights', required=True, type=Path)
    parser.add_argument('--sender', required=True)
    parser.add_argument('--creation-cache', type=Path)
    parser.add_argument('--replace-rejected-encoding', action='store_true')
    parser.add_argument('--state', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--count', type=int, default=25)
    parser.add_argument('--rpc-url-env', default='GH0ST_RH_RPC_URL')
    parser.add_argument('--broadcast', action='store_true')
    parser.add_argument('--resume-bundle', action='store_true', help='Only finish the previously journaled bundle; never start another')
    parser.add_argument('--key-file', type=Path)
    parser.add_argument('--max-batch-fee-eth', type=Decimal)
    parser.add_argument('--reserve-eth', type=Decimal, default=Decimal('0'))
    parser.add_argument('--receipt-timeout', type=int, default=90)
    parser.add_argument('--gas-price-ceiling-wei', type=int, help='Fixed legacy gas-price ceiling; wait/retry unchanged hashes rather than raising it')
    parser.add_argument('--l1-gas-reserve', type=int, default=0, help='Minimum parent posting gas budget, charged only if actually used')
    parser.add_argument('--nitro-components', action='store_true', help='Separate parent posting gas from the live Nitro computation limit')
    parser.add_argument('--local-test', action='store_true')
    args = parser.parse_args()
    require(args.gas_price_ceiling_wei is None or args.gas_price_ceiling_wei > 0, 'Gas price ceiling must be positive')
    require(1 <= args.count <= 25 and args.reserve_eth >= 0 and args.receipt_timeout > 0, 'Invalid batch controls')
    paths = [args.weights, args.state, args.report, args.report.with_suffix('.md')]
    if args.key_file:
        paths.append(args.key_file)
    require(len({p.resolve() for p in paths}) == len(paths), 'Input/output paths overlap')
    url = os.environ[args.rpc_url_env]
    require(not args.local_test or urlparse(url).hostname in ('127.0.0.1', 'localhost', '::1'), 'Local test requires loopback')
    chain, sender = (31337 if args.local_test else 4663), to_checksum_address(args.sender)
    rpc = RPC(url)
    require(int(rpc('eth_chainId'), 16) == chain, 'Wrong chain; nothing signed')
    limit = limits(rpc, args.local_test)
    args.state.parent.mkdir(parents=True, exist_ok=True)
    lock = args.state.with_suffix('.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    state = json.loads(args.state.read_text()) if args.state.exists() else {
        'schema': 1, 'chain_id': chain, 'sender': sender, 'weights_sha256': PIN,
        'receipts': [], 'active_bundle': None, 'batches': []}
    require(state['chain_id'] == chain and state['sender'] == sender and state['weights_sha256'] == PIN, 'State mismatch')
    all_jobs = jobs(args.weights, state, args.creation_cache)
    job_map = {j['name']: j for j in all_jobs}
    existing_hashes = {r['hash'] for r in state['receipts']}
    reserve = int(args.reserve_eth * 10**18)
    report = {'started_at_utc': now(), 'chain_id': chain, 'sender': sender, 'status': 'unsigned_quote',
              'weights_sha256': PIN, 'batch_limit': args.count, 'http_group_size': RPC_GROUP,
              'atomic': False, 'batch_contracts': 0, 'batch_gas_used': 0, 'batch_fee_eth': eth(0)}
    try:
        verify_saved(rpc, state, job_map)
        reconcile(rpc, state, job_map, args.state)
        if args.replace_rejected_encoding:
            require(args.broadcast and not args.resume_bundle, 'Migration must be an explicit replacement broadcast')
        require(not state['active_bundle'] or args.resume_bundle or args.replace_rejected_encoding, 'Existing journaled bundle; use --resume-bundle before starting anything new')
        require(not args.resume_bundle or state['active_bundle'], 'No bundle to resume')
        report['before'] = snapshot(rpc, sender, all_jobs, state, args.count, reserve, limit, args.gas_price_ceiling_wei, args.nitro_components, args.l1_gas_reserve)
        if args.broadcast:
            require(args.key_file and args.max_batch_fee_eth is not None and args.max_batch_fee_eth > 0, 'Signing file and positive fee cap required')
            cap = int(args.max_batch_fee_eth * 10**18)
            report['max_batch_fee_eth'] = eth(cap)
            if args.replace_rejected_encoding:
                require(report['before']['next_batch_maximum_fee_wei'] <= cap, 'Quoted batch exceeds original fee cap; original journal retained')
                replace_rejected_encoding(rpc, state, args.state, args.count, args.max_batch_fee_eth)
            if not state['active_bundle']:
                quotes = report['before']['next_batch']
                require(quotes, 'No deployable jobs; index waits for all 495 shards')
                maximum = sum(q['maximum_fee_wei'] for q in quotes)
                require(maximum <= cap, 'Quoted batch exceeds fee cap; nothing signed')
                require(report['before']['wallet_balance_wei'] >= maximum + reserve, 'Wallet reserve requires top-up; nothing signed')
                nonce = int(rpc('eth_getTransactionCount', [sender, 'latest']), 16)
                require(int(rpc('eth_getTransactionCount', [sender, 'pending']), 16) == nonce, 'Deployer has pending transactions')
                entries = [dict(q, nonce=nonce + i) for i, q in enumerate(quotes)]
                bundle = {'created_at_utc': now(), 'maximum_fee_wei': maximum, 'fee_cap_wei': cap,
                          'reserve_wei': reserve, 'transactions': entries,
                          'gas_price_policy': report['before']['gas_price_policy'],
                          'fixed_gas_price_ceiling_wei': args.gas_price_ceiling_wei}
            else:
                bundle = state['active_bundle']
                entries = bundle['transactions']
                require(len(entries) <= args.count and sum(e['maximum_fee_wei'] for e in entries) <= cap, 'Resume exceeds count or fee cap')
                require(args.gas_price_ceiling_wei is None or all(e['gas_price_wei'] == args.gas_price_ceiling_wei for e in entries), 'Resume cannot change signed gas price')
                require(len({e['name'] for e in entries}) == len(entries), 'Duplicate journal jobs')
                require([e['nonce'] for e in entries] == list(range(entries[0]['nonce'], entries[0]['nonce'] + len(entries))), 'Noncontiguous journal nonces')
            check_submission_sizes(chain, entries, job_map)
            require(not args.key_file.resolve().is_relative_to(REPO), 'Key must stay outside repository')
            require(args.key_file.stat().st_mode & 0o077 == 0, 'Key file must have private permissions')
            account = Account.from_key(args.key_file.read_text().strip())
            require(account.address == sender, 'Key does not match sender')
            raw = signed_bundle(account, chain, entries, job_map)
            del account
            require(int(rpc('eth_chainId'), 16) == chain, 'RPC chain changed')
            if not state['active_bundle']:
                require(int(rpc('eth_getTransactionCount', [sender, 'pending']), 16) == entries[0]['nonce'], 'Nonce changed before broadcast')
            state['active_bundle'] = bundle
            save(args.state, state)
            report['status'] = 'broadcasting'
            for offset in range(0, len(entries), RPC_GROUP):
                outstanding = [e for e in entries if e['hash'] not in {r['hash'] for r in state['receipts']}]
                balance = int(rpc('eth_getBalance', [sender, 'latest']), 16)
                require(balance >= sum(e['maximum_fee_wei'] for e in outstanding) + max(reserve, bundle['reserve_wei']), 'Reserve would be breached; journal retained')
                require(int(rpc('eth_chainId'), 16) == chain, 'RPC chain changed')
                broadcast_group(rpc, state, entries[offset:offset + RPC_GROUP], raw, job_map, args.state, args.receipt_timeout)
                print(json.dumps({'bundle_progress': min(offset + RPC_GROUP, len(entries)), 'bundle_contracts': len(entries)}), flush=True)
            del raw
            verify_saved(rpc, state, job_map)
            state['batches'].append(dict(bundle, completed_at_utc=now(), status='batch_complete_paused'))
            state['active_bundle'] = None
            save(args.state, state)
            report['status'] = 'batch_complete_paused'
    except Exception as error:
        report['status'] = 'stopped'
        report['stop_reason'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:
        rows = [r for r in state['receipts'] if r['hash'] not in existing_hashes]
        report.update({'finished_at_utc': now(), 'batch_contracts': sum(r['status'] == 1 and r['runtime_verified'] for r in rows),
                       'batch_gas_used': sum(r['gas_used'] for r in rows), 'batch_fee_eth': eth(sum(r['fee_wei'] for r in rows)),
                       'batch_receipts': rows, 'unresolved_bundle': state['active_bundle']})
        if args.broadcast:
            try:
                report['after'] = snapshot(rpc, sender, jobs(args.weights, state, args.creation_cache), state, 25, reserve, limit, args.gas_price_ceiling_wei, args.nitro_components, args.l1_gas_reserve)
            except Exception:
                report['after_snapshot_unavailable'] = True
        save(args.report, report)
        args.report.with_suffix('.md').write_text(render(report))
        print(json.dumps({k: report[k] for k in ('status', 'batch_contracts', 'batch_gas_used', 'batch_fee_eth')}), flush=True)
    return 2 if report['status'] == 'stopped' else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'status': 'stopped', 'reason': str(error) if isinstance(error, RuntimeError) else type(error).__name__}), flush=True)
        sys.exit(2)
