#!/usr/bin/env python3
"""Frozen-rubric manual judgments and exact-copy checks for all teacher gate raws."""
import collections
import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parents[4]
EVAL = RESEARCH / 'experiments/gh0st-voice/voice-v8/teacher-notes/evaluation'
TRAIN = RESEARCH / 'experiments/gh0st-voice/voice-v7/training/encoded-base/train.jsonl'

# Scores apply to the entire unedited continuation, not its best extracted sentence.
# Order: grammar, continuity, first-person voice, repetition. Prompt order is frozen.
JUDGMENTS = {
    ('base', 0): [
        ([2, 1, 1, 3], 'Boss/work opening turns into a forum request and posted metadata; several tangled clauses.'),
        ([3, 1, 1, 3], 'Readable marketing clauses drift into an invented CEO signature, ticker and URL.'),
        ([2, 0, 1, 3], 'Object permission changes to plastic bags, a toy, cats and an interview; broken references.'),
        ([2, 1, 1, 3], 'Dream changes into dialogue with Alice; body/object references and clause structure are confused.'),
        ([1, 0, 1, 3], 'Bird/block switches to a TV mother, chick, parents and advice; agreement and reference failures.'),
        ([2, 1, 1, 2], 'Maps become gameplay commentary; vague circular reasoning, little event progression.'),
        ([2, 0, 1, 3], 'Cracked blue mug becomes a picture and red/black metal shipment; identity is lost.'),
        ([2, 1, 1, 3], 'Promise to Mara becomes an email essay with invented names; notebook/deadline abandoned.'),
    ],
    ('base', 42): [
        ([2, 1, 1, 3], 'Boss screen becomes phone app and forum reply with ads; no stable narrative.'),
        ([2, 1, 1, 3], 'Crowd/future shifts into motivational questions and unrelated plaza scene.'),
        ([2, 0, 1, 3], 'Purchased object becomes a dog review and contradictory pet advice.'),
        ([2, 2, 2, 3], 'Maintains amphibian theme longer, but pond trading premise dissolves into civilization speculation.'),
        ([3, 2, 2, 3], 'Mostly grammatical bird/tree speculation, but no continuing block-explanation event.'),
        ([3, 0, 0, 3], 'Abandons maps for a YouTube invitation, credit and long URL.'),
        ([2, 0, 1, 3], 'Mug/shop/repair/Christmas/family references conflict; no tracked object.'),
        ([2, 1, 1, 3], 'Notebook promise becomes generic praise and invented anniversary book attribution.'),
    ],
    ('adapted', 0): [
        ([2, 1, 2, 3], 'Work voice lasts longer, but school/home/office shift and forum metadata break narrative.'),
        ([2, 1, 2, 3], 'First-person technological reflection, but clauses become tangled and crowd scene disappears.'),
        ([2, 1, 2, 3], 'Permission topic persists briefly; references to work, paper, furniture and features lack a causal thread.'),
        ([2, 1, 2, 3], 'Pond/frog turns into generic unsolved problems and account/technical difficulties.'),
        ([2, 1, 2, 3], 'Bird exits, then inspector/windows/boxes/questions; run-on vague reflection replaces the event.'),
        ([3, 1, 2, 3], 'Mostly grammatical, but maps abruptly become death, sanctuary and apocalypse plus an advertisement marker.'),
        ([2, 1, 2, 3], 'Starts with coffee, then window repairs and an old man; mug identity and first-person scene lost.'),
        ([3, 0, 1, 3], 'Sentence forms mostly parse, but notebook pages become night, mirrors, eyes and strangers; no deadline continuity.'),
    ],
    ('adapted', 42): [
        ([2, 1, 2, 3], 'Work scene persists loosely but hands, desk, homework and forum address are disconnected.'),
        ([2, 1, 2, 3], 'Past/future conceit initially fits voice; becomes a meta explanation with unclear propositions.'),
        ([2, 0, 1, 3], 'Object becomes a building/box; narrator changes to a man in a doorway.'),
        ([1, 1, 2, 2], 'Frog premise becomes long contradictory advice and pronoun chains; weak sentence boundaries.'),
        ([2, 1, 2, 2], 'Bird/block references merge into trees and generic helpers; repeated abstractions replace events.'),
        ([3, 1, 2, 3], 'Grammatical earthquake/building commentary largely ignores nested maps and action.'),
        ([3, 0, 1, 3], 'Grammatical clauses cannot maintain blue mug: another bottle, glass and a child replace it.'),
        ([2, 0, 1, 3], 'Notebook page becomes four pages, repeated mornings and a male worker; Mara/deadline lost.'),
    ],
}


def words(text):
    return re.findall(r"[a-z]+(?:'[a-z]+)?|[0-9]+", text.lower())


def extend(a, ai, b, bi, size=4):
    left = 0
    while ai > left and bi > left and a[ai-left-1] == b[bi-left-1]:
        left += 1
    right = size
    while ai+right < len(a) and bi+right < len(b) and a[ai+right] == b[bi+right]:
        right += 1
    return ai-left, bi-left, left+right


def main():
    results = []
    raw_hashes = {}
    candidates = collections.defaultdict(list)
    gate = json.loads((HERE/'teacher-validation-gate.json').read_text())
    for (variant, seed), judgments in JUDGMENTS.items():
        path = EVAL / f'{variant}-seed{seed}/raw.jsonl'
        rows = [json.loads(line) for line in path.open()]
        assert len(rows) == len(judgments) == 8
        assert [(r['prompt_id'], r['prompt']) for r in rows] == [(r['id'], r['prompt']) for r in gate['prompts']]
        raw_hashes[str(path.relative_to(RESEARCH))] = hashlib.sha256(path.read_bytes()).hexdigest()
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
            result = {'variant': variant, 'seed': seed, 'prompt_id': row['prompt_id'],
                      'scores': dict(zip(['grammar', 'continuity', 'voice', 'repetition'], scores)),
                      'passes_all_four': all(v >= 3 for v in scores), 'reason': reason,
                      'generated_words_normalized': len(seq), 'continuation': row['continuation'],
                      'longest_repeated_span': repeated,
                      'longest_original_training_match': {'words': 0},
                      'longest_any_student_training_match': {'words': 0}}
            index = len(results)
            result['_tokens'] = seq
            results.append(result)
            for pos in range(len(seq)-3):
                candidates[tuple(seq[pos:pos+4])].append((index, pos))
    doc_counts = collections.Counter()
    for line in TRAIN.open():
        source = json.loads(line)
        original = source.get('kind') == 'original' or source.get('source_kind') == 'original_voice'
        doc_counts['all'] += 1
        doc_counts['original'] += original
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
    summary = {}
    for variant in ['base', 'adapted']:
        group = [r for r in results if r['variant'] == variant]
        summary[variant] = {
            'streams': len(group), 'passes_all_four': sum(r['passes_all_four'] for r in group),
            'scores_at_least_3': {k: sum(r['scores'][k] >= 3 for r in group) for k in ['grammar', 'continuity', 'voice', 'repetition']},
            'mean_scores': {k: sum(r['scores'][k] for r in group)/len(group) for k in ['grammar', 'continuity', 'voice', 'repetition']},
            'max_original_training_span': max(r['longest_original_training_match']['words'] for r in group),
            'max_any_student_training_span': max(r['longest_any_student_training_match']['words'] for r in group),
            'max_repeated_span': max(r['longest_repeated_span']['words'] for r in group),
        }
    report = {'status': 'BOTH_TEACHERS_FAIL_FROZEN_PROSE_GATE',
              'gate_sha256': hashlib.sha256((HERE/'teacher-validation-gate.json').read_bytes()).hexdigest(),
              'raw_sha256': raw_hashes, 'training_file_sha256': hashlib.sha256(TRAIN.read_bytes()).hexdigest(),
              'training_documents_searched': dict(doc_counts),
              'all_continuations_reviewed': True, 'only_new_continuation_used_for_copy_checks': True,
              'copy_method': 'Case and punctuation normalized; exact runs of at least four words. Full selected original SFT training and all other student training documents searched. No unknown GPT-2 pretraining data available.',
              'limitations': 'Absence of long exact overlap is not proof of originality. Human rubric judgments are one independent reviewer, not a blinded panel.',
              'scoring_note': 'An unfinished final clause at the fixed token cap was not by itself treated as a grammar failure. Completed clauses, continuity and the full visible text were reviewed; semantic repetition is distinct from exact repeated spans.',
              'summary': summary, 'outputs': results,
              'decision': 'Do not use these whole paragraphs as quality-approved student targets. No unfiltered 100k-token pilot is supported by the frozen gate.',
              'secondary_use': 'Some local clauses are more grammatical than prior small-student output. A separately labelled short-sentence selection pilot could test grammar transfer only after manual semantic/copy review. It would not satisfy or lower the whole-paragraph voice/continuity gate.'}
    (HERE/'teacher-output-review.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
