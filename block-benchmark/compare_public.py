"""Read-only public-node validation of captured full-block execution states.

No signing, keys, deployments or public transaction broadcasts. The complete
block was run locally; these public calls sample representative steps only.
"""
import gzip
import hashlib
import json
import math
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from eth_abi import decode

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'contract-benchmark'))
from compare_chains import calldata, unsigned_eip1559, READ_METHODS, GPO

NETWORKS = {
    'base': (8453, 'https://mainnet.base.org', 'ETH'),
    'robinhood': (4663, 'https://rpc.mainnet.chain.robinhood.com', 'ETH'),
    'bsc': (56, 'https://bsc-dataseed.bnbchain.org', 'BNB'),
}


def now():
    return datetime.now(timezone.utc).isoformat()


def run(name):
    chain_id, endpoint, unit = NETWORKS[name]
    path = ROOT.parent / 'results' / f'block-public-{name}.json'
    source = ROOT / 'simulation-cases-swar.json.gz'
    cases = json.loads(gzip.decompress(source.read_bytes()))
    local = json.loads((ROOT.parent / 'results/block-swar-local.json').read_text())
    report = {'network': name, 'endpoint': endpoint, 'native_currency': unit,
        'started_at': now(), 'status': 'running', 'public_transactions_broadcast': 0,
        'native_currency_spent': 0, 'fixture_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'cases': [], 'rpc_observations': [], 'limitations': [
            'Only representative steps are simulated on public nodes using temporary state overrides.',
            'Full-block gas is from local Cancun EVM receipts, not a public-chain block execution.',
            'Planning fees use a snapshot price and a calibration cushion, not guaranteed bounds.',
            'This is one convolution block for one token position, not a full model token or reply.',
            'Deployment, future state growth, inclusion latency and full-model attention costs are separate.']}

    def save():
        path.write_text(json.dumps(report, indent=2) + '\n')

    def rpc(method, params):
        assert method in READ_METHODS
        start = time.monotonic()
        observed = {'method': method, 'at': now()}
        try:
            body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
            req = urllib.request.Request(endpoint, body, {'Content-Type': 'application/json',
                'User-Agent': 'OnchainLFM-block-benchmark/0.2'})
            with urllib.request.urlopen(req, timeout=30) as response:
                answer = json.load(response)
            if 'error' in answer:
                raise RuntimeError(str(answer['error']))
            observed['ok'] = True
            return answer['result']
        except Exception as exc:
            observed.update(ok=False, error=str(exc))
            raise
        finally:
            observed['seconds'] = round(time.monotonic()-start, 3)
            report['rpc_observations'].append(observed)
            save()

    try:
        assert int(rpc('eth_chainId', []), 16) == chain_id
        block = rpc('eth_getBlockByNumber', ['latest', False])
        tag = block['number']
        quote = int(rpc('eth_gasPrice', []), 16)
        base = int(block.get('baseFeePerGas', '0x0'), 16)
        price = max(quote, base)
        report.update(chain_id=chain_id, block_number=int(tag, 16), block_hash=block['hash'],
            block_timestamp_utc=datetime.fromtimestamp(int(block['timestamp'], 16), timezone.utc).isoformat(),
            quoted_gas_price_wei=quote, modeled_gas_price_wei=price, block_base_fee_wei=base,
            header_gas_limit=int(block['gasLimit'], 16))
        print(json.dumps({'network': name, 'block': int(tag, 16), 'price': price}), flush=True)
        if name == 'bsc':
            report['block_pinning'] = 'Each case pins a fresh block because the public BSC endpoint prunes older state; fee quote is from initial snapshot.'
        for case in cases:
            item = {'label': case['label'], 'local_gas_used': case['local_gas_used']}
            tx = dict(case['tx'], gasPrice=hex(price))
            try:
                if name == 'bsc':
                    fresh = rpc('eth_getBlockByNumber', ['latest', False])
                    tag = fresh['number']
                    item['block_number'] = int(tag, 16)
                    item['block_hash'] = fresh['hash']
                    item['block_timestamp_utc'] = datetime.fromtimestamp(int(fresh['timestamp'], 16), timezone.utc).isoformat()
                raw = rpc('eth_call', [dict(tx, gas=hex(15_700_000)), tag, case['override']])
                item['matches_reference'] = raw.lower() == case['expected_return'].lower()
                if not item['matches_reference']:
                    raise AssertionError('Public return differs from integer reference')
                item['rpc_gas_estimate'] = int(rpc('eth_estimateGas', [tx, tag, case['override']]), 16)
                item['rpc_estimate_over_local_receipt'] = item['rpc_gas_estimate']/item['local_gas_used']
            except Exception as exc:
                item['error'] = str(exc)
            report['cases'].append(item)
            save()
            print(json.dumps({'network': name, **item}), flush=True)

        if all(c.get('matches_reference') and 'rpc_gas_estimate' in c for c in report['cases']):
            factor = max(1.05, max(c['rpc_estimate_over_local_receipt'] for c in report['cases']))
            report['planning_gas_factor'] = factor
            # On Robinhood estimateGas includes L1 data. Do not add it again.
            report['planning_method'] = 'sum(local receipts) * max(1.05, largest sampled RPC/local ratio) * snapshot gas price'
            data_fee = 0
            operator_per_block = 0
            if name == 'base':
                def oracle(signature, types=(), values=(), result_type='uint256'):
                    raw = rpc('eth_call', [{'to': GPO, 'data': calldata(signature, types, values)}, tag])
                    return decode([result_type], bytes.fromhex(raw[2:]))[0]
                fees = {'address': GPO, 'version': oracle('version()', result_type='string'), 'types': {}}
                for label, case in [('begin', cases[0]), ('step', cases[1])]:
                    unsigned = unsigned_eip1559(chain_id, 1000, price-base, price,
                        math.ceil(case['local_gas_used']*factor), case['tx'])
                    fees['types'][label] = {'unsigned_bytes': len(unsigned),
                        'l1_fee_estimate_wei': oracle('getL1Fee(bytes)', ['bytes'], [unsigned]),
                        'l1_fee_upper_estimate_wei': oracle('getL1FeeUpperBound(uint256)', ['uint256'], [len(unsigned)])}
                fees['operator_fee_probes'] = {str(g): oracle('getOperatorFee(uint256)', ['uint256'], [g])
                    for g in [0, 1_000_000, 15_700_000]}
                if any(fees['operator_fee_probes'].values()):
                    raise RuntimeError('Nonzero Base operator fee: per-transaction pricing needs extension')
                data_fee = fees['types']['begin']['l1_fee_upper_estimate_wei'] + 383*fees['types']['step']['l1_fee_upper_estimate_wei']
                report['base_fee_oracle'] = fees
                report['planning_method'] += ' + Base L1 upper estimate for 1 begin and 383 step transactions; observed operator fee zero'
            report['planning_per_block_position'] = []
            for token in local['tokens']:
                gas = token['total_local_gas_used']
                budget_gas = math.ceil(gas*factor)
                total = budget_gas*price + data_fee + operator_per_block
                report['planning_per_block_position'].append({'token_index': token['token_index'],
                    'local_receipt_gas': gas, 'planning_gas': budget_gas, 'transaction_count': 384,
                    'base_l1_data_upper_estimate_wei': data_fee, 'total_fee_wei': total,
                    'total_fee_native': str(total/10**18)})
            report['status'] = 'complete_read_only_sample_validation'
        else:
            report['status'] = 'incomplete'
    except Exception as exc:
        report.update(status='failed', error=str(exc))
    finally:
        report['finished_at'] = now()
        save()
    print(json.dumps({'network': name, 'status': report['status']}), flush=True)
    return report


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--network', choices=list(NETWORKS))
    args = parser.parse_args()
    names = [args.network] if args.network else list(NETWORKS)
    with ThreadPoolExecutor(max_workers=len(names)) as pool:
        reports = list(pool.map(run, names))
    if not all(r['status'] == 'complete_read_only_sample_validation' for r in reports):
        raise SystemExit(1)
