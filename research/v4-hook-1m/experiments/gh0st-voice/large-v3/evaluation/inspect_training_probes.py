#!/usr/bin/env python3
"""Summarize completed FP32 probe snapshots without touching checkpoints."""
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
V3 = HERE.parent


def words(text):
    return re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower())


def grams(text, n=12):
    ws = words(text)
    return {tuple(ws[i:i+n]) for i in range(max(0, len(ws)-n+1))}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    training = defaultdict(set)
    train_file = V3 / 'data/corpus/train.jsonl'
    for line in train_file.read_text().splitlines():
        row = json.loads(line)
        training[row['source_kind']].update(grams(row['text']))
    out = {'scope': 'Read-only snapshot probe inspection; FP32, not Q12/EVM verification or a semantic score',
           'training_file_sha256': sha(train_file), 'snapshots': []}
    for folder in sorted((V3 / 'runs/initial-8m').glob('checkpoint-*')):
        metadata_file, probe_file = folder / 'training-metadata.json', folder / 'probe.json'
        if not metadata_file.exists() or not probe_file.exists():
            continue
        metadata = json.loads(metadata_file.read_text())
        probe = json.loads(probe_file.read_text())
        summary = {'step': metadata['step'], 'trained_target_tokens': metadata['trained_target_tokens'],
                   'checkpoint': str(folder.relative_to(V3)), 'probe_sha256': sha(probe_file),
                   'weights_sha256': metadata['weight_file_sha256'], 'streams': []}
        for stream in probe['streams']:
            observed = grams(stream['text'])
            matches = {kind: sorted(observed & known) for kind, known in training.items()}
            summary['streams'].append({
                'seed': stream['seed'], 'words': len(words(stream['text'])),
                'generated_tokens': len(stream['tokens']),
                'repeated_token_4gram_fraction': stream['repeated4_fraction'],
                'passes_basic_guards': stream['passes_basic_guards'],
                'eos_count': len(stream['eos_positions']),
                'literal_training_12gram_matches': {kind: len(values) for kind, values in matches.items()},
                'literal_training_12gram_examples': {kind: [' '.join(v) for v in values[:10]] for kind, values in matches.items()},
                'full_text': stream['text'],
            })
        out['snapshots'].append(summary)
    (HERE / 'training-probe-inspection.json').write_text(json.dumps(out, indent=2) + '\n')
    for snap in out['snapshots']:
        print(json.dumps({**{k:v for k,v in snap.items() if k!='streams'},
                          'streams': [{k:v for k,v in s.items() if k!='full_text'} for s in snap['streams']]}))


if __name__ == '__main__':
    main()
