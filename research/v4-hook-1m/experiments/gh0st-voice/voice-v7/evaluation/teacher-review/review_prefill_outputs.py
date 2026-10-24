#!/usr/bin/env python3
"""Review the separate Qwen assistant-prefill gate without changing prior results."""
import collections
import hashlib
import json
from pathlib import Path
from review_outputs import words, extend

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parents[4]
EVAL = RESEARCH / 'experiments/gh0st-voice/voice-v8/teacher-notes/evaluation'
TRAIN = RESEARCH / 'experiments/gh0st-voice/voice-v7/training/encoded-base/train.jsonl'
JUDGMENTS = {
    0: [
        ([3, 2, 2, 1], 'Boss/screen remains, but mirror claims and listen-to-boss dialogue repeat without a clear development.'),
        ([3, 2, 1, 0], 'Repeated we-need-to-be-more slogans dominate; crowd action provides little actual progress.'),
        ([3, 3, 2, 3], 'Readable permission/ownership reflection, but generic surprise and unease rather than distinctive concrete voice.'),
        ([3, 1, 1, 1], 'Frog trading problem becomes an unrelated boy and repeated laughter; too little causal connection.'),
        ([3, 1, 2, 2], 'Bird already left but now speaks without returning; brief machine/bird reflection does not resolve the event.'),
        ([3, 1, 1, 1], 'Map premise becomes short repeated path/feeling affirmations, no connected scene.'),
        ([3, 2, 2, 3], 'Mug is retained, but a new sign and strongest gratitude have no clear relation to the trade or repair.'),
        ([3, 1, 2, 3], 'Mara\'s notebook changes to her favorite mystery book; return deadline disappears.'),
    ],
    42: [
        ([3, 2, 2, 3], 'Readable screen/machine metaphor, but generic reflection replaces boss/work event.'),
        ([4, 3, 1, 3], 'Coherent generic crowd optimism; little wry or concrete personal voice.'),
        ([4, 3, 3, 3], 'Consistent bought object becomes a surprisingly functional small machine; modest dry observation.'),
        ([2, 1, 1, 2], 'Frog always there/never seen and way of being produce vague, weakly formed explanation.'),
        ([3, 2, 1, 3], 'Only a short generic regret after the bird leaves; no developed monologue.'),
        ([3, 2, 1, 1], 'Map journey is grammatical but repeated have-to-go/path/ready phrases replace development.'),
        ([3, 2, 2, 3], 'Mug stays present, but trade/temperature/wear/return/clean chain has unclear causality.'),
        ([3, 2, 2, 3], 'Guilt about missing sunset could fit, but blank page/date/time and deciding to reread do not sustain the promised return action.'),
    ],
}


def main():
    gate = json.loads((HERE/'teacher-validation-gate.json').read_text())
    results, raw_hashes, metadata = [], {}, {}
    candidates = collections.defaultdict(list)
    for seed, judgments in JUDGMENTS.items():
        path = EVAL/f'qwen-prefill-seed{seed}/raw.jsonl'
        rows = [json.loads(line) for line in path.open()]
        assert len(rows) == len(judgments) == 8
        assert [(r['prompt_id'], r['prompt']) for r in rows] == [(r['id'], r['prompt']) for r in gate['prompts']]
        raw_hashes[str(path.relative_to(RESEARCH))] = hashlib.sha256(path.read_bytes()).hexdigest()
        source = json.loads(path.with_name('report.json').read_text())
        metadata[str(seed)] = {k: source.get(k) for k in ['checkpoint_content_sha256', 'sampler_source_sha256', 'shared_filter_source_sha256', 'prompt_file_sha256', 'configuration', 'sampling', 'generated_tokens']}
        for row, (scores, reason) in zip(rows, judgments):
            assert row['prefix_mode'] == 'assistant-prefill'
            assert row['continuation'] == row['raw_assistant_text']
            assert row['text'] == row['prompt'] + row['continuation']
            assert not row['exact_repeated_prefix_removed']
            assert not row['display_join_separator_applied']
            assert row['chat_template_text'].endswith(row['prompt'])
            seq = words(row['continuation'])
            seen, repeated = collections.defaultdict(list), {'words': 0}
            for pos in range(len(seq)-3):
                key = tuple(seq[pos:pos+4])
                for prior in seen[key]:
                    start, _, n = extend(seq, prior, seq, pos)
                    if n > repeated['words']:
                        repeated = {'words': n, 'text': ' '.join(seq[start:start+n])}
                seen[key].append(pos)
            r = {'seed': seed, 'prompt_id': row['prompt_id'],
                 'scores': dict(zip(['grammar', 'continuity', 'voice', 'repetition'], scores)),
                 'passes_all_four': all(x >= 3 for x in scores), 'reason': reason,
                 'generated_words': len(seq), 'text': row['text'], 'continuation': row['continuation'],
                 'prefix_echo': row['continuation'].lower().startswith(row['prompt'].lower()),
                 'prefix_protocol_pass': True, 'longest_repeated_span': repeated,
                 'longest_original_training_match': {'words': 0},
                 'longest_any_student_training_match': {'words': 0}, '_tokens': seq}
            r['prefix_protocol_pass'] = not r['prefix_echo']
            index = len(results)
            results.append(r)
            for pos in range(len(seq)-3):
                candidates[tuple(seq[pos:pos+4])].append((index, pos))
    counts = collections.Counter()
    for line in TRAIN.open():
        source = json.loads(line)
        original = source.get('kind') == 'original' or source.get('source_kind') == 'original_voice'
        counts['all'] += 1
        counts['original'] += original
        seq = words(source['text'])
        for pos in range(len(seq)-3):
            for index, oi in candidates.get(tuple(seq[pos:pos+4]), ()):
                start, source_start, n = extend(results[index]['_tokens'], oi, seq, pos)
                evidence = {'words': n, 'text': ' '.join(seq[source_start:source_start+n]),
                            'source_id': source['id'], 'source_kind': source.get('source_kind'),
                            'source_position': source_start, 'continuation_position': start}
                for key in ['longest_any_student_training_match'] + (['longest_original_training_match'] if original else []):
                    if n > results[index][key]['words']:
                        results[index][key] = evidence
    for r in results:
        del r['_tokens']
    summary = {'streams': len(results), 'passes_all_four': sum(r['passes_all_four'] for r in results), 'required_passes': 12,
               'scores_at_least_3': {k: sum(r['scores'][k] >= 3 for r in results) for k in ['grammar', 'continuity', 'voice', 'repetition']},
               'prefix_protocol_passes': sum(r['prefix_protocol_pass'] for r in results),
               'outputs_below_40_generated_words': sum(r['generated_words'] < 40 for r in results),
               'max_original_training_span': max(r['longest_original_training_match']['words'] for r in results),
               'max_any_student_training_span': max(r['longest_any_student_training_match']['words'] for r in results),
               'max_repeated_span': max(r['longest_repeated_span']['words'] for r in results)}
    report = {'status': 'FAIL_FROZEN_PROSE_GATE_PREFIX_MECHANICS_PASS', 'quality_approval': False,
              'parent_gate_sha256': hashlib.sha256((HERE/'teacher-validation-gate.json').read_bytes()).hexdigest(),
              'raw_sha256': raw_hashes, 'run_metadata': metadata,
              'training_file_sha256': hashlib.sha256(TRAIN.read_bytes()).hexdigest(),
              'training_documents_searched': dict(counts), 'summary': summary, 'outputs': results,
              'scope': 'All16 raw prefilled continuations; no output edits or selected subsets. Normalized exact copying checked against every known training document, not unknown Qwen pretraining data.',
              'decision': 'Prefix conditioning works, but this run does not justify unattended bulk student targets. Sentence readability alone is insufficient for the promised coherent voice and story continuity.',
              'comparison': 'Quoted-user run had5/16 prose passes with0/16 prefix protocol passes; assistant-prefill has1/16 prose passes with16/16 prefix protocol passes. Different continuations, all retained.'}
    (HERE/'qwen-prefill-output-review.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
