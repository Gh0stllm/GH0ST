#!/usr/bin/env python3
"""Bounded exact-copy and within-stream repetition audit, not a novelty proof."""
import argparse
import collections
import hashlib
import importlib.util
import json
from pathlib import Path


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def words(text, tokenize):
    return [w.rstrip('.!?') for w in tokenize(text)]


def extend(a, ai, b, bi, length=4):
    left = 0
    while ai-left > 0 and bi-left > 0 and a[ai-left-1] == b[bi-left-1]:
        left += 1
    end = length
    while ai+end < len(a) and bi+end < len(b) and a[ai+end] == b[bi+end]:
        end += 1
    return ai-left, bi-left, end+left


def repetition(seq):
    seen = collections.defaultdict(list)
    best = {'words': 0}
    for pos in range(len(seq)-3):
        key = tuple(seq[pos:pos+4])
        for previous in seen[key]:
            a, b, n = extend(seq, previous, seq, pos)
            if n > best['words']:
                best = {'words': n, 'first_position': a, 'second_position': b,
                        'overlapping': a+n > b, 'text': ' '.join(seq[a:a+n])}
        seen[key].append(pos)
    return best


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, required=True)
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--temperature-q10', type=int, default=None)
    args = parser.parse_args()
    assert not args.output.exists()
    normalizer = Path(__file__).resolve().parents[1]/'training/prepare.py'
    spec = importlib.util.spec_from_file_location('v6_copy_normalizer', normalizer)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    raw = json.loads(args.raw.read_text())
    raw_outputs = raw if isinstance(raw, list) else raw['outputs']
    outputs = [r for r in raw_outputs if r.get('status', 'GENERATED') == 'GENERATED']
    sequences = [words(r['text'], module.tokens) for r in outputs]
    candidates = collections.defaultdict(list)
    for ri, seq in enumerate(sequences):
        for pos in range(len(seq)-3):
            candidates[tuple(seq[pos:pos+4])].append((ri, pos))
    results = [{'case': r.get('case', 'unprompted'), 'seed': r['seed'],
                'temperature_q10': r.get('temperature_q10', r.get('word_temperature_q10', args.temperature_q10)),
                'generated_words': len(s), 'longest_train_match': {'words': 0},
                'longest_repeated_span': repetition(s)} for r, s in zip(outputs, sequences)]
    training_documents = training_words = 0
    for line in (args.data/'train.jsonl').open():
        record = json.loads(line)
        seq = words(record['text'], module.tokens)
        training_documents += 1
        training_words += len(seq)
        for pos in range(len(seq)-3):
            for ri, oi in candidates.get(tuple(seq[pos:pos+4]), ()):
                start, source_start, n = extend(sequences[ri], oi, seq, pos)
                if n > results[ri]['longest_train_match']['words']:
                    results[ri]['longest_train_match'] = {
                        'words': n, 'output_position': start, 'source_position': source_start,
                        'source_id': record['id'], 'source_kind': record['source_kind'],
                        'text': ' '.join(seq[source_start:source_start+n])}
    exact_groups = collections.defaultdict(list)
    for ri, seq in enumerate(sequences):
        exact_groups[tuple(seq)].append(ri)
    report = {'status': 'COMPLETE_NOT_NOVELTY_PROOF', 'raw_sha256': sha(args.raw),
              'train_sha256': sha(args.data/'train.jsonl'),
              'normalizer_sha256': sha(normalizer), 'script_sha256': sha(Path(__file__)),
              'training_documents': training_documents, 'training_words': training_words,
              'method': 'Exact normalized word runs of at least4words, punctuation/case stripped; every retained training document searched. Repeated spans may overlap.',
              'limitations': 'No semantic paraphrase or unknown pretraining-source check. A zero value means no4-word match, not literally zero common words. Common grammar phrases do not establish copying.',
              'identical_output_groups': [ids for ids in exact_groups.values() if len(ids)>1],
              'outputs': results}
    args.output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'output': str(args.output), 'outputs': len(results),
                      'max_exact_train_words': max((r['longest_train_match']['words'] for r in results), default=0),
                      'identical_stream_groups': report['identical_output_groups']}))


if __name__ == '__main__':
    main()
