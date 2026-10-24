#!/usr/bin/env python3
"""Descriptive diagnostics for ORIGINAL GH0ST voice continuations.

Not an automatic judge of truth, fluency, style, or meaning. Never train on
prompts.json or tune an exact response to satisfy these lexical diagnostics.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import statistics


WORDS = re.compile(r"[a-z]+(?:'[a-z]+)?", re.I)
SENTENCES = re.compile(r"[^.!?]+[.!?]+", re.S)


def words(text):
    return WORDS.findall(text.lower())


def ngrams(items, n):
    return [tuple(items[i : i + n]) for i in range(max(0, len(items) - n + 1))]


def read_records(path):
    raw = path.read_text()
    if path.suffix == '.jsonl':
        result = [json.loads(line) for line in raw.splitlines() if line.strip()]
    else:
        result = json.loads(raw)
        if isinstance(result, dict):
            result = result['records']
    if not isinstance(result, list):
        raise ValueError('Generations must be a list or an object containing records.')
    return result


def evaluate(records, prompts, training_text=None):
    prompt_index = {p['id']: p for p in prompts['prompts']}
    train_12 = set(ngrams(words(training_text), 12)) if training_text is not None else None
    all_sentences = []
    rows = []
    for idx, item in enumerate(records):
        if not isinstance(item, dict):
            raise ValueError(f'Record {idx} must be an object.')
        text = item.get('continuation', item.get('text'))
        if not isinstance(text, str):
            raise ValueError(f'Record {idx} needs string continuation or text.')
        ident = item.get('id', '')
        prompt = prompt_index.get(ident, {})
        ws = words(text)
        gs = ngrams(ws, 4)
        counts = Counter(gs)
        duplicate_4gram_occurrences = sum(n - 1 for n in counts.values())
        ss = [' '.join(words(s)) for s in SENTENCES.findall(text)]
        ss = [s for s in ss if s]
        all_sentences.extend(ss)
        matches = [] if train_12 is None else sorted(set(ngrams(ws, 12)) & train_12)
        anchors = prompt.get('anchors', [])
        anchor_hits = [a for a in anchors if a.lower() in set(ws)]
        rows.append({
            'id': ident,
            'seed': item.get('seed'),
            'known_prompt': ident in prompt_index,
            'category': prompt.get('category', 'unknown'),
            'words': len(ws),
            'completed_sentence_count': len(ss),
            'empty': not ws,
            'unique_word_ratio': round(len(set(ws)) / len(ws), 6) if ws else None,
            'repeated_4gram_fraction': round(duplicate_4gram_occurrences / len(gs), 6) if gs else None,
            'longest_word_chars': max(map(len, ws), default=0),
            'unknown_token_marker': '[UNK]' in text,
            'has_replacement_character': '\ufffd' in text,
            'lexical_anchor_hits': anchor_hits,
            'lexical_anchor_count': len(anchors),
            'training_12gram_overlap_count': len(matches) if train_12 is not None else None,
            'training_12gram_overlap_examples': [' '.join(g) for g in matches[:20]],
        })
    sentence_counts = Counter(all_sentences)
    duplicate_count = sum(n - 1 for n in sentence_counts.values())
    repeated = [r['repeated_4gram_fraction'] for r in rows if r['repeated_4gram_fraction'] is not None]
    return {
        'schema_version': 1,
        'interpretation': 'Text diagnostics only. Human review and local quantized EVM/gas tests remain required.',
        'record_count': len(rows),
        'empty_records': sum(r['empty'] for r in rows),
        'unknown_prompt_records': sum(not r['known_prompt'] for r in rows),
        'completed_sentences': len(all_sentences),
        'unique_normalized_completed_sentences': len(sentence_counts),
        'duplicate_normalized_completed_sentence_occurrences': duplicate_count,
        'duplicate_completed_sentence_fraction': round(duplicate_count / len(all_sentences), 6) if all_sentences else None,
        'mean_words': statistics.mean(r['words'] for r in rows) if rows else None,
        'mean_repeated_4gram_fraction': statistics.mean(repeated) if repeated else None,
        'training_12gram_comparison_performed': train_12 is not None,
        'records_with_training_12gram_overlap': sum(r['training_12gram_overlap_count'] > 0 for r in rows) if train_12 is not None else None,
        'rows': rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generations', type=Path, required=True)
    parser.add_argument('--prompts', type=Path, default=Path(__file__).with_name('prompts.json'))
    parser.add_argument('--training-text', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    records = read_records(args.generations)
    prompts = json.loads(args.prompts.read_text())
    train = args.training_text.read_text() if args.training_text else None
    result = evaluate(records, prompts, train)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'rows'}, indent=2))


if __name__ == '__main__':
    main()
