#!/usr/bin/env python3
"""Audit raw neural output overlap with one frozen, encoded training corpus."""
import argparse
import collections
import hashlib
import json
from pathlib import Path


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_training(path):
    documents, positions, grams, sentences = [], collections.defaultdict(list), {}, {}
    ids = set()
    with path.open() as f:
        for line in f:
            row = json.loads(line)
            ident, tokens, punctuation = row['id'], row['token_ids'], row['punctuation']
            assert ident not in ids and len(tokens) == len(punctuation) and tokens
            assert all(isinstance(t, int) and 0 <= t <= 8193 for t in tokens)
            assert all(isinstance(p, int) and 0 <= p <= 4 for p in punctuation)
            ids.add(ident)
            doc = {'id': ident, 'tokens': tokens, 'punctuation': punctuation}
            d = len(documents)
            documents.append(doc)
            for i, token in enumerate(tokens):
                positions[token].append((d, i))
                if i + 8 <= len(tokens):
                    grams.setdefault(tuple(tokens[i:i+8]), (d, i))
            start = 0
            for i, punct in enumerate(punctuation):
                if punct >= 2:
                    key = tuple(zip(tokens[start:i+1], punctuation[start:i+1]))
                    sentences.setdefault(key, []).append((d, start))
                    start = i + 1
    return documents, positions, grams, sentences


def audit_stream(stream, documents, positions, grams, sentences, long_threshold, vocabulary):
    words = stream['words']
    tokens = [word['token'] for word in words]
    punctuation = [word['punct'] for word in words]
    assert len(tokens) == len(punctuation) and tokens
    assert all(0 <= t < 8192 and 0 <= p <= 4 for t, p in zip(tokens, punctuation))
    for word in words:
        assert word['text'].rstrip(',.!?') == vocabulary[word['token']]
    longest = {'words': 0}
    long_spans = []
    for i, token in enumerate(tokens):
        best = (0, None, None)
        for d, at in positions.get(token, []):
            reference = documents[d]['tokens']
            n, limit = 1, min(len(tokens)-i, len(reference)-at)
            while n < limit and tokens[i+n] == reference[at+n]:
                n += 1
            if n > best[0]:
                best = n, d, at
        n, d, at = best
        if d is None:
            continue
        evidence = {'words': n, 'output_start_word': i+1, 'output_end_word': i+n,
                    'training_document_id': documents[d]['id'],
                    'training_start_word': at+1, 'training_end_word': at+n,
                    'normalized_text': ' '.join(vocabulary[t] for t in tokens[i:i+n])}
        if n > longest['words']:
            longest = evidence
        if n >= long_threshold and not any(
                old['output_start_word'] <= i+1 and old['output_end_word'] >= i+n
                for old in long_spans):
            long_spans.append(evidence)
    covered = set()
    gram_matches = []
    for i in range(max(0, len(tokens)-7)):
        matched = grams.get(tuple(tokens[i:i+8]))
        if matched is not None:
            d, at = matched
            covered.update(range(i, i+8))
            gram_matches.append({'output_start_word': i+1, 'training_document_id': documents[d]['id'],
                                 'training_start_word': at+1})
    exact_sentences, total_sentences, start = [], 0, 0
    for i, punct in enumerate(punctuation):
        if punct >= 2:
            total_sentences += 1
            key = tuple(zip(tokens[start:i+1], punctuation[start:i+1]))
            if key in sentences:
                matches = sentences[key]
                exact_sentences.append({'output_start_word': start+1, 'output_end_word': i+1,
                                        'text': ' '.join(w['text'] for w in words[start:i+1]),
                                        'training_matches': [
                                            {'document_id': documents[d]['id'], 'start_word': at+1}
                                            for d, at in matches]})
            start = i+1
    return {
        'id': stream['id'], 'output_words': len(words),
        'longest_contiguous_word_match': longest,
        'long_copy_threshold_words': long_threshold,
        'has_match_at_or_above_long_threshold': bool(long_spans),
        'maximal_long_output_spans': long_spans,
        'matching_8gram_occurrences': len(gram_matches),
        'total_output_8gram_occurrences': max(0, len(tokens)-7),
        'matching_8gram_fraction': len(gram_matches)/max(1, len(tokens)-7),
        'words_covered_by_matching_8grams': len(covered),
        'word_coverage_by_matching_8grams': len(covered)/len(words),
        'matching_8gram_positions': gram_matches,
        'completed_sentences': total_sentences,
        'exact_sentence_overlap_count': len(exact_sentences),
        'exact_sentence_overlaps': exact_sentences,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--train', type=Path, required=True)
    parser.add_argument('--raw-output', type=Path, required=True)
    parser.add_argument('--vocabulary', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--long-threshold', type=int, default=20)
    args = parser.parse_args()
    assert args.long_threshold >= 8 and not args.out.exists()
    vocabulary = json.loads(args.vocabulary.read_text())
    assert len(vocabulary) == len(set(vocabulary)) == 8192
    raw = json.loads(args.raw_output.read_text())
    assert raw['vocabulary_sha256'] == sha(args.vocabulary)
    metadata = args.train.with_name('manifest.json')
    if metadata.exists():
        meta = json.loads(metadata.read_text())
        assert meta['vocabulary_sha256'] == sha(args.vocabulary)
        if args.train.name in meta.get('artifacts', {}):
            assert meta['artifacts'][args.train.name]['sha256'] == sha(args.train)
    documents, positions, grams, sentences = load_training(args.train)
    outputs = [audit_stream(stream, documents, positions, grams, sentences,
                            args.long_threshold, vocabulary) for stream in raw['outputs']]
    result = {
        'status': 'OVERLAP_MEASURED_REQUIRES_INTERPRETATION',
        'train_sha256': sha(args.train), 'raw_output_sha256': sha(args.raw_output),
        'train_manifest_sha256': sha(metadata) if metadata.exists() else None,
        'train_hash_declared_in_manifest': metadata.exists() and args.train.name in meta.get('artifacts', {}),
        'vocabulary_sha256': sha(args.vocabulary), 'script_sha256': sha(__file__),
        'training_documents': len(documents), 'training_word_positions': sum(len(d['tokens']) for d in documents),
        'streams': len(outputs), 'streams_with_long_matches': sum(o['has_match_at_or_above_long_threshold'] for o in outputs),
        'maximum_contiguous_word_match': max(o['longest_contiguous_word_match']['words'] for o in outputs),
        'total_exact_sentence_overlaps': sum(o['exact_sentence_overlap_count'] for o in outputs),
        'outputs': outputs,
        'definitions': {
            'word_match': 'Contiguous identical vocabulary token IDs; case-normalized by existing tokenizer; punctuation ignored.',
            'sentence_match': 'Whole naturally completed sentence with identical token IDs and punctuation labels, including commas.',
            '8gram_fraction': 'Count of output 8-word windows found in any one training document divided by all output 8-word windows.',
            'long_copy_flag': 'A descriptive overlap flag at the requested length threshold, not a finding of plagiarism or proof of memorization.',
        },
        'limitations': [
            'Common wording can match without memorization. Short overlap is not evidence of plagiarism.',
            'A long match is evidence of reproduced training wording; interpreting its cause requires context.',
            'No match does not establish novelty: this scans only the supplied training file and exact contiguous wording.',
            'Corpus duplicates and paired training rows are retained, but a window counts once regardless of training frequency.',
            'Unknown training tokens retain their ID and cannot falsely match the model vocabulary.',
            'This audit does not change or filter generated text.',
        ],
        'network_actions': 0, 'chain_actions': 0,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k: result[k] for k in ('streams', 'streams_with_long_matches',
                                           'maximum_contiguous_word_match', 'total_exact_sentence_overlaps')}))


if __name__ == '__main__':
    main()
