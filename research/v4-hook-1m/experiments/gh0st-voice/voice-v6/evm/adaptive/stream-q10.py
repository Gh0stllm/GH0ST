#!/usr/bin/env python3
"""Generate uninterrupted exact Q10/Keccak streams from a frozen export."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
from reference import Reference


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model-dir', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--seeds', default='0,42')
    p.add_argument('--words', type=int, default=256)
    p.add_argument('--temperature', type=int, default=768)
    p.add_argument('--features', default='128,256,128,512,-1024,-1024')
    p.add_argument('--scalar-audit', action='store_true')
    a = p.parse_args()
    assert 0 < a.words <= 10000 and 64 <= a.temperature <= 4096
    seeds = [int(s) for s in a.seeds.split(',')]
    assert all(0 <= s < 2**256 for s in seeds)
    features = [int(n) for n in a.features.split(',')]
    assert len(features) == 6 and all(-4096 <= x <= 4096 for x in features)
    model = Reference(a.model_dir)
    manifest = json.loads((a.model_dir/'manifest.json').read_text())
    for collection in ('artifacts', 'reference_only_sources'):
        for name, metadata in manifest[collection].items():
            raw = (a.model_dir/name).read_bytes()
            assert hashlib.sha256(raw).hexdigest() == metadata['sha256'], name
    rows = []
    for seed in seeds:
        hidden, previous, generated = [0]*224, 8192, []
        encoded_seed = '0x'+seed.to_bytes(32, 'big').hex()
        for index in range(a.words):
            output = model.step(previous, hidden, features, encoded_seed, index, a.temperature, a.scalar_audit)
            generated.append(output)
            hidden, previous = output['hidden'], output['token']
        tokens = [r['token'] for r in generated]
        grams = collections.Counter(tuple(tokens[i:i+4]) for i in range(max(0, len(tokens)-3)))
        rows.append({'seed': seed, 'seed_bytes32': encoded_seed, 'tokens': tokens,
                     'text': ' '.join(r['text'] for r in generated),
                     'natural_terminals': sum(r['terminal'] for r in generated),
                     'repeated_4gram_fraction': sum(max(0, n-1) for n in grams.values())/max(1, len(tokens)-3),
                     'final_hidden': hidden,
                     'step_logit_sha256': [hashlib.sha256(json.dumps(r['scores'], separators=(',', ':')).encode()).hexdigest() for r in generated]})
    result = {'status': 'COMPLETE', 'mode': 'REFERENCE_ONLY_NO_EVM', 'quality_approval': False,
              'checkpoint_sha256': manifest.get('checkpoint_sha256'), 'temperatureQ10': a.temperature,
              'words_per_seed': a.words, 'featuresQ10': features, 'bos': 8192,
              'runtime_domain': 0, 'state_resets': 0, 'forced_punctuation': False,
              'sampling': 'Exact Q10 LUT weights; separate ABI-encoded Keccak stage draws; identical to Solidity',
              'scalar_audit': a.scalar_audit, 'streams': rows}
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'streams'}, indent=2))
    for row in rows:
        print(f"seed {row['seed']}: {row['text']}")


if __name__ == '__main__':
    main()
