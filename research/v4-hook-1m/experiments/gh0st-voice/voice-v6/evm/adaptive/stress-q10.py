#!/usr/bin/env python3
"""Frozen offline Q10 suite: 32x256 words plus two 1024-word continuous streams."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import re
from reference import Reference

SEEDS = tuple(range(32))
LONG_SEEDS = (0, 42)
FEATURES = [128, 256, 128, 512, -1024, -1024]


def digest(value):
    return hashlib.sha256(json.dumps(value, separators=(',', ':')).encode()).hexdigest()


def generate(model, seed, words, temperature):
    previous, hidden = 8192, [0]*224
    encoded_seed = '0x'+seed.to_bytes(32, 'big').hex()
    token_ids, terminals, state_hashes, score_hashes = [], [], [], []
    saturated = 0
    for index in range(words):
        result = model.step(previous, hidden, FEATURES, encoded_seed, index, temperature, scalar=False)
        assert 0 <= result['token'] < 8192
        assert re.fullmatch(r"[a-z]+(?:'[a-z]+)*(?:[.!?])?", result['text'])
        assert result['text'] == model.vocab[result['token']]
        assert len(result['hidden']) == 224 and all(-1024 <= x <= 1024 for x in result['hidden'])
        assert len(result['scores']) == 192
        token_ids.append(result['token'])
        terminals.append(result['terminal'])
        state_hashes.append(digest(result['hidden']))
        score_hashes.append(digest(result['scores']))
        saturated += sum(abs(x) == 1024 for x in result['hidden'])
        previous, hidden = result['token'], result['hidden']
    repeats = {}
    for n in (4, 8, 12):
        counts = collections.Counter(tuple(token_ids[i:i+n]) for i in range(max(0, words-n+1)))
        repeats[str(n)] = sum(max(0, count-1) for count in counts.values())/max(1, words-n+1)
    longest = current = 0
    for terminal in terminals:
        current += 1
        longest = max(longest, current)
        if terminal:
            current = 0
    return {'seed': seed, 'words': words, 'tokens': token_ids,
            'text': ' '.join(model.vocab[t] for t in token_ids), 'terminal_flags': terminals,
            'natural_terminals': sum(terminals), 'longest_span_without_terminal': longest,
            'unique_tokens': len(set(token_ids)), 'repeat_ngram_fraction': repeats,
            'saturated_hidden_fraction': saturated/(words*224),
            'state_sha256_each_step': state_hashes, 'logit_sha256_each_step': score_hashes,
            'final_hidden': hidden}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model-dir', type=Path, required=True)
    p.add_argument('--out-dir', type=Path, required=True)
    p.add_argument('--temperature', type=int, default=512)
    a = p.parse_args()
    assert not a.out_dir.exists(), 'Do not overwrite a frozen suite'
    assert 64 <= a.temperature <= 4096
    manifest = json.loads((a.model_dir/'manifest.json').read_text())
    for collection in ('artifacts', 'reference_only_sources'):
        for name, info in manifest[collection].items():
            raw = (a.model_dir/name).read_bytes()
            assert len(raw) == info['bytes'] and hashlib.sha256(raw).hexdigest() == info['sha256'], name
    model = Reference(a.model_dir)
    assert len(model.vocab) == len(set(model.vocab)) == 8192
    a.out_dir.mkdir(parents=True)
    short = []
    for seed in SEEDS:
        row = generate(model, seed, 256, a.temperature)
        short.append(row)
        print(json.dumps({'suite': 'short', 'seed': seed, 'words': row['words'], 'terminals': row['natural_terminals']}), flush=True)
    long = [generate(model, seed, 1024, a.temperature) for seed in LONG_SEEDS]
    assert long[0]['tokens'][:256] == short[0]['tokens']
    assert long[0]['state_sha256_each_step'][:256] == short[0]['state_sha256_each_step']
    for name, rows in (('short-32x256.json', short), ('long-2x1024.json', long)):
        (a.out_dir/name).write_text(json.dumps(rows, indent=2)+'\n')
    metrics = lambda rows: [{'seed': row['seed'], 'words': row['words'], 'natural_terminals': row['natural_terminals'],
                             'unique_tokens': row['unique_tokens'], 'repeat_ngram_fraction': row['repeat_ngram_fraction'],
                             'longest_span_without_terminal': row['longest_span_without_terminal'],
                             'saturated_hidden_fraction': row['saturated_hidden_fraction']} for row in rows]
    report = {'status': 'ARITHMETIC_AND_STREAM_INVARIANTS_PASS', 'quality_approval': False,
              'mode': 'REFERENCE_ONLY_NO_EVM', 'mainnet_actions': 0,
              'checkpoint_sha256': manifest['checkpoint_sha256'], 'temperatureQ10': a.temperature,
              'featuresQ10': FEATURES, 'runtime_domain': 0, 'bos': 8192,
              'short_seeds': list(SEEDS), 'short_words_each': 256, 'long_seeds': list(LONG_SEEDS), 'long_words_each': 1024,
              'total_generated_words': 32*256+2*1024, 'state_resets': 0, 'forced_punctuation': False,
              'natural_terminal_does_not_reset': True, 'prefix_reproduction_pass': True,
              'all_output_tokens_are_real_words': True, 'all_hidden_components_within_signedQ10_bounds': True,
              'sampling': 'Exact Solidity Q10 LUT and ABI-encoded Keccak stage draws',
              'evaluation_warning': 'Numerical invariants and low repeat counts do not establish coherent language quality.',
              'short_metrics': metrics(short), 'long_metrics': metrics(long), 'artifacts': {}}
    for name in ('short-32x256.json', 'long-2x1024.json'):
        raw = (a.out_dir/name).read_bytes()
        report['artifacts'][name] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    report['script_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    (a.out_dir/'summary.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('short_metrics', 'long_metrics')}, indent=2))


if __name__ == '__main__':
    main()
