#!/usr/bin/env python3
"""Frozen minimal-pair diagnostic of the exact Q10 next-word distribution."""
import argparse
from fractions import Fraction
import hashlib
import importlib.util
import json
import math
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REFERENCE = HERE.parents[1] / 'voice-v8/evm/reference.py'
# Evaluation-only minimal pairs. These are never supplied to a trainer by this script.
CASES = [
    ('first_person_be', 'i', 'am', 'is'),
    ('first_person_have', 'i', 'have', 'has'),
    ('first_person_past_be', 'i', 'was', 'were'),
    ('modal_can', 'i can', 'see', 'sees'),
    ('modal_could', 'i could', 'look', 'looked'),
    ('modal_will', 'i will', 'return', 'returned'),
    ('modal_would', 'i would', 'keep', 'kept'),
    ('modal_must', 'i must', 'check', 'checked'),
    ('modal_should', 'i should', 'leave', 'left'),
    ('modal_might', 'i might', 'find', 'found'),
    ('perfect_seen', 'i have', 'seen', 'saw'),
    ('perfect_taken', 'i had', 'taken', 'took'),
    ('progressive', 'i am', 'thinking', 'think'),
    ('plural_present', 'my friends', 'are', 'is'),
    ('plural_past', 'the notes', 'were', 'was'),
    ('singular_present', 'the screen', 'is', 'are'),
]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def weights(ref, scores, temperature):
    at = np.minimum(256, ((int(scores.max())-scores)*1024//temperature+32)//64)
    return [int(x) for x in ref.exp[at]]


def probability(ref, hidden, token, temperature, trunc):
    h = np.asarray(hidden[ref.H:], dtype=np.int64)
    group, word = divmod(token, 64)
    group_scores = trunc(ref.gw @ h + ref.gb*1024)
    word_scores = trunc(ref.ww[group*64:(group+1)*64] @ h + ref.wb[group*64:(group+1)*64]*1024)
    gw, ww = weights(ref, group_scores, temperature), weights(ref, word_scores, temperature)
    return Fraction(gw[group]*ww[word], sum(gw)*sum(ww))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--temperature-q10', type=int, default=512)
    args = parser.parse_args()
    assert 1 <= args.temperature_q10 <= 4096 and not args.out.exists()
    meta = json.loads((args.model_dir / 'manifest.json').read_text())
    assert meta['reference_sha256'] == sha(args.model_dir / 'reference.npz')
    for name in ('vocabulary.json', 'sigmoid-delta.bin', 'exp-q32.bin'):
        assert meta['artifacts'][name]['sha256'] == sha(args.model_dir / name)
    spec = importlib.util.spec_from_file_location('nova_exact_reference', REFERENCE)
    reference = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reference)
    ref = reference.Reference(args.model_dir)
    assert ref.H == 384
    vocab = {word: i for i, word in enumerate(ref.vocab)}
    cache, rows = {}, []
    for name, prefix, correct, incorrect in CASES:
        assert all(word in vocab for word in prefix.split()+[correct, incorrect])
        if prefix not in cache:
            hidden, previous, pp = [0]*(2*ref.H), 8192, 0
            for i, word in enumerate(prefix.split()):
                state = ref.step(previous, pp, hidden, [0]*6, '0x'+'0'*64, i,
                                 args.temperature_q10, scalar=False)
                hidden, previous = state['hidden'], vocab[word]
            # This state has consumed the complete supplied prefix, so its heads
            # predict the next word. Prefix words are diagnostic inputs only.
            state = ref.step(previous, 0, hidden, [0]*6, '0x'+'0'*64, len(prefix.split()),
                             args.temperature_q10, scalar=True)
            cache[prefix] = state['hidden']
        good = probability(ref, cache[prefix], vocab[correct], args.temperature_q10, reference.trunc)
        bad = probability(ref, cache[prefix], vocab[incorrect], args.temperature_q10, reference.trunc)
        rows.append({'id': name, 'prefix': prefix, 'correct': correct, 'incorrect': incorrect,
                     'correct_probability': float(good), 'incorrect_probability': float(bad),
                     'correct_to_incorrect_ratio': float(good/bad),
                     'log_probability_margin': math.log(float(good/bad)),
                     'correct_outranks_incorrect': good > bad})
    result = {
        'status': 'DIAGNOSTIC_ONLY_NOT_A_LANGUAGE_PASS',
        'correct_outranks_incorrect': sum(row['correct_outranks_incorrect'] for row in rows),
        'cases': len(rows), 'rows': rows,
        'checkpoint_sha256': meta['checkpoint_sha256'],
        'reference_npz_sha256': sha(args.model_dir / 'reference.npz'),
        'script_sha256': sha(__file__), 'reference_script_sha256': sha(REFERENCE),
        'temperature_q10': args.temperature_q10,
        'method': 'Teacher-forced prefix only; exact Q10 hidden transition and lookup weights; hierarchical group-times-word probability; exact rational comparison.',
        'limitations': [
            'Passing a local minimal pair does not establish grammatical free-running text.',
            'Short prefixes do not measure long-range continuity or Truth Terminal-like voice.',
            'Prefixes and candidates are evaluation-only; they are not rewritten model output.',
            'These minimal pairs are deliberately simple surface syntax examples, not a standardized benchmark.',
        ],
        'network_actions': 0, 'chain_actions': 0,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k: result[k] for k in ('correct_outranks_incorrect', 'cases', 'status')}))


if __name__ == '__main__':
    main()
