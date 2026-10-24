#!/usr/bin/env python3
"""Finite, exact-Q10 free-running language audit. No network or chain access."""
import argparse
import collections
import hashlib
import importlib.util
import json
import re
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
VOICE = HERE.parents[1]
REFERENCE = VOICE / 'voice-v8/evm/reference.py'
PUNCT = ['', ',', '.', '!', '?']
RUBRIC = {
    'grammar': '3: complete readable clauses with at most one minor error; 4: consistently natural; 0: broken syntax throughout.',
    'continuity': '3: a stable narrator, objects and causal progression; 4: sustained development; 0: unrelated fragments or contradictions.',
    'voice': '3: concrete first-person reflection with wit or distinctive perspective; 4: sustained individual voice; 0: generic fragments.',
    'repetition': '3: no repeated sentence or semantic loop; 4: purposeful development throughout; 0: degenerate cycling.',
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def array_hash(values):
    return hashlib.sha256(np.asarray(values, dtype='>i8').tobytes()).hexdigest()


def features_for(mode, word_index):
    """Three words share swap features; feature ranges match runtime inputs."""
    swap = word_index // 3
    if mode == 'flat':
        return [0, 0, 0, 3, 1024, 1024]
    amounts = [8, 36, 136, 8]
    return [amounts[swap % 4], (swap * 4) % 256,
            amounts[swap % 4] if swap % 2 == 0 else 0,
            3, 1024 if swap % 2 == 0 else -1024, 1024]


def metrics(words):
    """Transparent counters only: none of these establish good language."""
    tokens = [x['text'].rstrip(',.!?') for x in words]
    sentences, start = [], 0
    for i, word in enumerate(words):
        if word['terminal']:
            sentences.append({'first_word': start + 1, 'last_word': i + 1,
                              'text': ' '.join(x['text'] for x in words[start:i+1]),
                              'length': i + 1 - start,
                              'first_person': any(x in {'i', 'me', 'my', 'mine', 'myself'} for x in tokens[start:i+1])})
            start = i + 1
    counts = collections.Counter(x['text'] for x in sentences)
    grams = collections.Counter(tuple(tokens[i:i+4]) for i in range(max(0, len(tokens)-3)))
    full = ' '.join(x['text'] for x in words)
    # Deliberately narrow surface diagnostics. Absence is not a grammar pass.
    patterns = {
        'first_person_agreement': r'\bi (?:is|are|has|were)\b',
        'article_before_pronoun': r'\b(?:a|an|the) (?:i|me|my|myself|we|our)\b',
        'modal_inflection': r'\b(?:can|could|will|would|must|should|may|might) (?:looked|looks|went|was|were|has|had|did|said|kept|found|made)\b',
        'adjacent_identical_word': r'\b([a-z]+) \1\b',
    }
    flags = [{'rule': rule, 'span': m.group(0), 'start': m.start()}
             for rule, pattern in patterns.items() for m in re.finditer(pattern, full)]
    return {
        'words': len(words), 'distinct_words': len(set(tokens)),
        'completed_sentences': len(sentences), 'sentences': sentences,
        'unfinished_tail': ' '.join(x['text'] for x in words[start:]),
        'first_person_tokens': sum(x in {'i', 'me', 'my', 'mine', 'myself'} for x in tokens),
        'first_person_sentence_fraction': sum(x['first_person'] for x in sentences) / max(1, len(sentences)),
        'exact_repeated_sentence_occurrences': sum(v-1 for v in counts.values()),
        'repeated_fourgram_occurrences': sum(v-1 for v in grams.values()),
        'repeated_fourgrams': [{'words': list(k), 'count': v} for k, v in grams.items() if v > 1],
        'sentences_over_40_words': sum(x['length'] > 40 for x in sentences),
        'narrow_grammar_flags': flags,
        'automatic_metrics_are_not_a_language_pass': True,
    }


def generate(ref, seed_number, mode, word_count, temperature, scalar_every):
    seed = '0x' + format(seed_number, '064x')
    hidden, previous, previous_punct = [0] * (2 * ref.H), 8192, 0
    words, scalar_indices = [], []
    for i in range(word_count):
        features = features_for(mode, i)
        before_hash = array_hash(hidden)
        scalar = scalar_every > 0 and i % scalar_every == 0
        result = ref.step(previous, previous_punct, hidden, features, seed, i,
                          temperature, scalar=scalar)
        if scalar:
            scalar_indices.append(i)
        hidden = result['hidden']
        assert len(hidden) == 2 * ref.H and all(-1024 <= x <= 1024 for x in hidden)
        words.append({
            'index': i, 'token': result['token'], 'punct': result['punct'],
            'text': result['text'], 'terminal': result['terminal'],
            'features': features, 'before_state_sha256': before_hash,
            'after_state_sha256': array_hash(hidden),
            'scores_sha256': array_hash(result['scores']),
            'saturated_hidden_values': sum(abs(x) == 1024 for x in hidden),
        })
        previous, previous_punct = result['token'], result['punct']
    for i in range(1, len(words)):
        assert words[i]['before_state_sha256'] == words[i-1]['after_state_sha256']
    return {
        'id': f'{mode}-seed-{seed_number}', 'seed': seed, 'feature_mode': mode,
        'initial_token': 8192, 'initial_punctuation': 0,
        'temperature_q10': temperature,
        'state_resets': 0, 'forced_words': 0, 'forced_punctuation': 0,
        'grammar_postprocessing': False,
        'scalar_checked_indices': scalar_indices,
        'words': words, 'text': ' '.join(x['text'] for x in words),
        'final_hidden': hidden, 'metrics': metrics(words),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model-dir', required=True, type=Path)
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--words', type=int, default=128)
    p.add_argument('--seeds', type=int, nargs='+', default=[0, 42, 1337, 2026])
    p.add_argument('--modes', nargs='+', choices=['flat', 'alternating'], default=['flat', 'alternating'])
    p.add_argument('--temperature-q10', type=int, default=512)
    p.add_argument('--scalar-every', type=int, default=64)
    args = p.parse_args()
    assert 1 <= args.words <= 1024 and 1 <= args.temperature_q10 <= 4096
    assert len(args.seeds) <= 32 and all(0 <= s < 2**256 for s in args.seeds)
    assert not args.out.exists(), 'Use a new output directory; frozen results are never overwritten.'
    assert len(set(args.seeds)) == len(args.seeds) and len(set(args.modes)) == len(args.modes)
    manifest = json.loads((args.model_dir / 'manifest.json').read_text())
    assert manifest['reference_sha256'] == sha(args.model_dir / 'reference.npz')
    for name in ('vocabulary.json', 'sigmoid-delta.bin', 'exp-q32.bin'):
        assert manifest['artifacts'][name]['sha256'] == sha(args.model_dir / name), name
    spec = importlib.util.spec_from_file_location('nova_exact_reference', REFERENCE)
    reference = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reference)
    ref = reference.Reference(args.model_dir)
    assert ref.H == 384, 'This frozen protocol targets the unchanged N0VA-8M architecture.'
    args.out.mkdir(parents=True)
    start = time.monotonic()
    outputs = []
    for mode in args.modes:
        for seed in args.seeds:
            stream = generate(ref, seed, mode, args.words, args.temperature_q10, args.scalar_every)
            outputs.append(stream)
            print(json.dumps({'stream': stream['id'], 'words': args.words,
                              'sentences': stream['metrics']['completed_sentences'],
                              'elapsed_seconds': round(time.monotonic()-start, 2)}), flush=True)
    report = {
        'status': 'EXACT_Q10_GENERATED_REQUIRES_HUMAN_LANGUAGE_REVIEW',
        'scope': 'Local CPU exact integer generation. No EVM gas claim, no network, no deployment.',
        'model_dir': str(args.model_dir.resolve()),
        'checkpoint_sha256': manifest.get('checkpoint_sha256'),
        'reference_npz_sha256': sha(args.model_dir / 'reference.npz'),
        'manifest_sha256': sha(args.model_dir / 'manifest.json'),
        'vocabulary_sha256': sha(args.model_dir / 'vocabulary.json'),
        'reference_script_sha256': sha(REFERENCE), 'audit_script_sha256': sha(__file__),
        'configuration': {'seeds': args.seeds, 'feature_modes': args.modes,
                          'words_per_stream': args.words, 'temperature_q10': args.temperature_q10,
                          'scalar_check_interval': args.scalar_every, 'initial_state': 'all zero, BOS',
                          'stop_at_sentence_end': False, 'state_reset_after_sentence': False},
        'neural_words': sum(len(x['words']) for x in outputs), 'outputs': outputs,
        'elapsed_seconds': time.monotonic()-start,
        'network_actions': 0, 'chain_actions': 0,
        'matched_feature_mode_texts': [
            {'seed': seed, 'identical': len({x['text'] for x in outputs if x['seed'] == '0x'+format(seed, '064x')}) == 1}
            for seed in args.seeds
        ] if len(args.modes) > 1 else [],
        'limitations': [
            'A finite development audit does not establish general reliability or novelty.',
            'All sentences and the unfinished final fragment are retained without selection or repair.',
            'Narrow grammar flags can miss incorrect syntax and can flag legitimate constructions.',
            'First-person token counts and absence of repeated fourgrams do not establish voice or continuity.',
            'The same arithmetic is exact Q10; full local EVM parity and gas tests are required separately.',
            'These fixed streams are development evaluation and must not be trained on.',
        ],
    }
    (args.out / 'raw-outputs.json').write_text(json.dumps(report, indent=2)+'\n')
    (args.out / 'raw-outputs.txt').write_text('\n\n'.join(x['id']+'\n'+x['text'] for x in outputs)+'\n')
    review = {'status': 'PENDING_HUMAN_REVIEW', 'raw_outputs_sha256': sha(args.out / 'raw-outputs.json'),
              'rubric_0_to_4': RUBRIC,
              'gate': {'minimum_fraction_at_least_3_in_all_categories': 0.75,
                       'severe_contradiction_or_semantic_loop_allowed': False,
                       'passing_does_not_establish_mainnet_readiness': True},
              'outputs': [{'id': x['id'], 'grammar': None, 'continuity': None, 'voice': None,
                           'repetition': None, 'severe_contradiction_or_loop': None,
                           'evidence': [], 'review': ''} for x in outputs]}
    (args.out / 'review-template.json').write_text(json.dumps(review, indent=2)+'\n')
    print(json.dumps({'output': str(args.out), 'streams': len(outputs),
                      'words': report['neural_words'], 'status': report['status']}))


if __name__ == '__main__':
    main()
