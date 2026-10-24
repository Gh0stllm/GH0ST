#!/usr/bin/env python3
"""Independent whole-output Qwen teacher gate review; no generation or owner-file edits."""
import collections
import hashlib
import json
from pathlib import Path
from review_outputs import words, extend

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parents[4]
EVAL = RESEARCH / 'experiments/gh0st-voice/voice-v8/teacher-notes/evaluation'
TRAIN = RESEARCH / 'experiments/gh0st-voice/voice-v7/training/encoded-base/train.jsonl'

# Entire actual continuation is judged. Only the source sampler's recorded exact
# full-prefix removal and disclosed space separator are accepted; no fuzzy repair.
JUDGMENTS = {
    0: [
        ([3, 3, 3, 3], 'Readable first-person boss/screen satire, with a clear task-versus-measurement point.'),
        ([3, 2, 2, 2], 'Grammatical but circular better/best/future reflection; little concrete scene development.'),
        ([3, 2, 2, 3], 'Readable clauses, but key/door/object already-there action is confused and surprise is repeatedly asserted.'),
        ([1, 2, 1, 3], 'Starts with incomplete because-a-frog clause, then generic poetic paradox instead of continuing the event.'),
        ([1, 1, 2, 2], 'Capitalizes and repeats the supplied prefix, so actual join is this may I tried; remaining reflection stays vague.'),
        ([3, 3, 3, 3], 'Maintains map/puzzle object, discovers Adventure label, and reaches a modest reflective surprise.'),
        ([3, 3, 2, 3], 'Keeps mug and trade, but becomes sentimental value/time abstraction rather than a distinctive concrete comic reflection.'),
        ([3, 2, 1, 1], 'Repeats I had to/read/glad-I-had-it cycle and never progresses toward returning the notebook.'),
    ],
    42: [
        ([3, 3, 2, 2], 'Consistent boss/screen theme, but repeats tasks-versus-tools observations rather than moving the scene.'),
        ([3, 1, 1, 3], 'Only the word future and period remain after exact prefix removal; not a developed passage.'),
        ([3, 3, 3, 3], 'Keeps purchased object as a metal box and develops the permission-versus-ownership irony.'),
        ([1, 1, 2, 2], 'Changes capitalization and repeats prefix, breaking the actual frog I dreamed join; later dream is generic.'),
        ([3, 2, 2, 3], 'Bird was gone but appears on the block without a returning event; bigger-picture/eyes ending is generic.'),
        ([4, 4, 3, 3], 'Coherent nested-map puzzle, two routes, hidden path and a concrete resolution.'),
        ([3, 3, 3, 3], 'Coherent mug/grandmother memory develops a modest reflective turn; voice is gentle rather than irreverent.'),
        ([3, 2, 2, 3], 'Readable but blank page then ink-still-there is unexplained; sunset promise has no resolution.'),
    ],
}


def main():
    gate = json.loads((HERE/'teacher-validation-gate.json').read_text())
    results = []
    raw_hashes = {}
    report_metadata = {}
    candidates = collections.defaultdict(list)
    for seed, judgments in JUDGMENTS.items():
        path = EVAL/f'qwen-seed{seed}/raw.jsonl'
        rows = [json.loads(line) for line in path.open()]
        assert len(rows) == len(judgments) == 8
        assert [(r['prompt_id'], r['prompt']) for r in rows] == [(r['id'], r['prompt']) for r in gate['prompts']]
        raw_hashes[str(path.relative_to(RESEARCH))] = hashlib.sha256(path.read_bytes()).hexdigest()
        report = json.loads(path.with_name('report.json').read_text())
        report_metadata[str(seed)] = {key: report.get(key) for key in [
            'checkpoint_content_sha256', 'checkpoint_sha256', 'prompt_file_sha256',
            'sampler_source_sha256', 'shared_filter_source_sha256', 'sampling',
            'enable_thinking', 'dtype', 'configuration', 'generated_tokens', 'counts']}
        for row, (scores, reason) in zip(rows, judgments):
            seq = words(row['continuation'])
            repeated = {'words': 0}
            seen = collections.defaultdict(list)
            for pos in range(len(seq)-3):
                key = tuple(seq[pos:pos+4])
                for prior in seen[key]:
                    start, _, n = extend(seq, prior, seq, pos)
                    if n > repeated['words']:
                        repeated = {'words': n, 'text': ' '.join(seq[start:start+n])}
                seen[key].append(pos)
            raw = row['raw_assistant_text']
            # A case-insensitive full-prefix check detects the two rewrites without
            # silently removing them from the scored text.
            exact = raw.startswith(row['prompt'])
            case_rewrite = not exact and raw.lower().startswith(row['prompt'].lower())
            result = {'seed': seed, 'prompt_id': row['prompt_id'],
                      'scores': dict(zip(['grammar', 'continuity', 'voice', 'repetition'], scores)),
                      'passes_all_four': all(v >= 3 for v in scores), 'reason': reason,
                      'exact_prefix_echo': exact, 'case_changed_prefix_echo': case_rewrite,
                      'exact_prefix_removal_recorded': row['exact_repeated_prefix_removed'],
                      'passes_prefix_protocol': not (exact or case_rewrite),
                      'display_join_separator': row.get('display_join_separator'),
                      'display_join_separator_applied': row.get('display_join_separator_applied'),
                      'generated_words_after_recorded_removal': len(seq),
                      'raw_assistant_text': raw, 'continuation': row['continuation'],
                      'actual_joined_text': row['text'],
                      'longest_repeated_span': repeated,
                      'longest_original_training_match': {'words': 0},
                      'longest_any_student_training_match': {'words': 0}, '_tokens': seq}
            index = len(results)
            results.append(result)
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
    for row in results:
        del row['_tokens']
    summary = {
        'streams': len(results), 'passes_all_four': sum(r['passes_all_four'] for r in results),
        'required_passes': 12,
        'scores_at_least_3': {k: sum(r['scores'][k] >= 3 for r in results) for k in ['grammar', 'continuity', 'voice', 'repetition']},
        'mean_scores': {k: sum(r['scores'][k] for r in results)/len(results) for k in ['grammar', 'continuity', 'voice', 'repetition']},
        'exact_prefix_echoes': sum(r['exact_prefix_echo'] for r in results),
        'case_changed_prefix_echoes': sum(r['case_changed_prefix_echo'] for r in results),
        'prefix_protocol_passes': sum(r['passes_prefix_protocol'] for r in results),
        'max_original_training_span': max(r['longest_original_training_match']['words'] for r in results),
        'max_any_student_training_span': max(r['longest_any_student_training_match']['words'] for r in results),
        'max_repeated_span': max(r['longest_repeated_span']['words'] for r in results),
    }
    report = {'status': 'FAIL_FROZEN_TEACHER_GATE_SUBSTANTIAL_GRAMMAR_IMPROVEMENT',
              'quality_approval': False, 'gate_sha256': hashlib.sha256((HERE/'qwen-validation-gate.json').read_bytes()).hexdigest(),
              'raw_sha256': raw_hashes, 'run_metadata': report_metadata,
              'training_file_sha256': hashlib.sha256(TRAIN.read_bytes()).hexdigest(),
              'training_documents_searched': dict(counts), 'all_outputs_reviewed': True,
              'copy_method': 'Exact normalized runs of at least four words; case and punctuation ignored. Continuations after only the source sampler recorded exact-prefix removal are searched. All original SFT and all other student train documents included.',
              'limitations': 'One independent reviewer, not a blinded panel. Originality beyond these known training files is not established. Prefix casing rewrites were detected but not repaired.',
              'summary': summary, 'outputs': results,
              'decision': 'Do not ingest unreviewed bulk output. Qwen is a much better candidate for a bounded manually reviewed grammar/continuity pilot, but current 5/16 whole-prose pass rate and prefix protocol failures do not meet the predeclared 12/16 gate.',
              'possible_next_conditioning_test': 'A separately recorded exact assistant-prefix prefill can test continuation behavior without fuzzy output edits. Preserve this failed gate and rerun the same prompts before bulk generation.'}
    (HERE/'qwen-output-review.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
