"""Build and locally execute every creation payload before any mainnet signing."""
import argparse
import hashlib
import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from eth_utils import keccak
from creation_codec import choose
from local import EVM
from deploy import PIN, maximum_transaction_size, save, now

ROOT = Path(__file__).resolve().parent


def worker(task):
    worker_id, args = task
    data = args.weights.read_bytes()
    manifest = json.loads((ROOT / 'selected-manifest.json').read_text())
    evm = EVM(args.anvil, port=18620 + worker_id)
    rows = []
    try:
        for i in range(worker_id, 495, args.workers):
            start = i * 98303
            payload = data[start:start + 98303]
            variant, code = choose(payload, manifest, start)
            bound = maximum_transaction_size(4663, 65535, 32000000, 10**9, code)
            assert bound <= 95000, (i, bound)
            address, gas = evm.deploy(code)
            actual = bytes.fromhex(evm.rpc('eth_getCode', [address, 'latest'])[2:])
            assert actual == b'\0' + payload, i
            row = {'index': i, 'name': f'fourbit-weights-{i:04d}', 'encoding': variant,
                   'init_bytes': len(code), 'maximum_signed_tx_bytes': bound,
                   'init_sha256': hashlib.sha256(code).hexdigest(),
                   'runtime_keccak256': '0x' + keccak(actual).hex(),
                   'local_cancun_gas': gas, 'exact_runtime_verified': True}
            (args.cache / (row['name'] + '.bin')).write_bytes(code)
            rows.append(row)
            if i % 40 < args.workers:
                print(json.dumps({'worker': worker_id, 'verified_shard': i, 'tx_bytes': bound, 'gas': gas}), flush=True)
    finally:
        evm.close()
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--anvil', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    assert hashlib.sha256(args.weights.read_bytes()).hexdigest() == PIN
    args.cache.mkdir(parents=True, exist_ok=True)
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        groups = list(pool.map(worker, [(i, args) for i in range(args.workers)]))
    rows = sorted(sum(groups, []), key=lambda r: r['index'])
    assert len(rows) == 495
    result = {'status': 'all_shards_verified', 'verified_at_utc': now(), 'weights_sha256': PIN,
              'decoder_sha256': hashlib.sha256(bytes.fromhex(json.loads((ROOT/'creation/decoder.json').read_text())['bytecode'])).hexdigest(),
              'all_runtime_bytes_unchanged': True, 'weight_shards': 495,
              'maximum_signed_transaction_bytes': max(r['maximum_signed_tx_bytes'] for r in rows),
              'maximum_local_cancun_gas': max(r['local_cancun_gas'] for r in rows),
              'weight_deployment_gas_local': sum(r['local_cancun_gas'] for r in rows),
              'first_24_weight_gas_local': sum(r['local_cancun_gas'] for r in rows[:24]),
              'shards': rows}
    save(ROOT/'creation-validation.json', result)
    print(json.dumps({k:v for k,v in result.items() if k != 'shards'}), flush=True)


if __name__ == '__main__':
    main()
