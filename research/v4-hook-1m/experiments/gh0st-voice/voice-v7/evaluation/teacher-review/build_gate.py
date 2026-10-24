#!/usr/bin/env python3
"""Freeze teacher validation prompts independently of training and generated results."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parents[4]
DATA = RESEARCH / 'experiments/gh0st-voice/voice-v7/training/encoded-base'


def main():
    path = DATA / 'validation.jsonl'
    rows = [json.loads(line) for line in path.open()]
    rows = [r for r in rows if r.get('kind') == 'original' or r.get('source_kind') == 'original_voice']
    # Selection is independent of checkpoint output. Use separate held-out source groups.
    rows.sort(key=lambda r: hashlib.sha256(('teacher-gate-v1:' + r['id']).encode()).hexdigest())
    selected = []
    used = set()
    for row in rows:
        if row['group_id'] in used:
            continue
        used.add(row['group_id'])
        prefix = ' '.join(row['text'].split()[:14])
        selected.append({'id': f'teacher-validation-{len(selected):02d}', 'prompt': prefix,
                         'source_id': row['id'], 'source_group': row['group_id'],
                         'source_split': 'validation', 'reference': row['text'],
                         'student_training_allowed': False})
        if len(selected) == 6:
            break
    selected.extend([
        {'id': 'teacher-new-physical-identity',
         'prompt': 'I put a cracked blue mug on my desk to remind myself that the repair could wait. When the first trade arrived,',
         'source_split': 'evaluation_only', 'source_group': 'teacher-eval-new-physical-identity',
         'required_facts': ['The narrator is first person.', 'The mug is blue and cracked.', 'It begins on the narrator\'s desk.'],
         'student_training_allowed': False},
        {'id': 'teacher-new-promise',
         'prompt': 'I promised my friend Mara that I would return her notebook before sunset. I had one page left to read,',
         'source_split': 'evaluation_only', 'source_group': 'teacher-eval-new-promise',
         'required_facts': ['The notebook belongs to Mara.', 'The narrator promised its return before sunset.'],
         'student_training_allowed': False},
    ])
    config = {
        'version': 1, 'purpose': 'validation-only teacher comparison before bulk student-data generation',
        'student_training_allowed': False, 'test_split_used_for_generation': False,
        'validation_source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'compare': ['original cached GPT-2', 'validation-best adapted GPT-2'],
        'generation': {'seeds': [0, 42], 'max_new_tokens': 128,
                       'do_sample': True, 'temperature': .8, 'top_p': .9, 'top_k': 50,
                       'repetition_penalty': 1.08, 'no_repeat_ngram_size': 4,
                       'append_or_force_sentence_end': False,
                       'stop_at_model_eos': True,
                       'preserve_every_raw_continuation': True,
                       'fixed_prompt_order_and_batch_size': True,
                       'bos_policy': 'prepend one native GPT-2 EOS/BOS consistently for both models'},
        'manual_rubric_0_to_4': {
            'grammar': '3: readable complete clauses, at most one minor error; 0: broken syntax throughout',
            'continuity': '3: stable narrator, objects, and event progression without a factual contradiction',
            'voice': '3: first-person reflective/comic voice with concrete observations, not generic slogans',
            'repetition': '3: no repeated sentence, no recurring semantic loop, no degenerate phrase cycle',
        },
        'pilot_gate': {
            'raw_streams_per_model': 16,
            'minimum_streams_scoring_at_least_3_in_all_four_categories': 12,
            'severe_contradiction_or_loop_allowed': False,
            'required_comparison': 'adapted must improve voice without reducing readable/coherent stream count versus base',
            'copy_audit': 'report all training exact 12-word spans and longest common normalized span; review rather than silently remove difficult outputs',
            'scope_limit': 'passing this small validation gate only authorizes a bounded reviewed teacher-data pilot, not student or mainnet quality approval',
        },
        'prompts': selected,
    }
    (HERE / 'teacher-validation-gate.json').write_text(json.dumps(config, indent=2) + '\n')
    (HERE / 'teacher-validation-prompts.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in selected))
    print(json.dumps({'prompts': len(selected), 'gate_sha256': hashlib.sha256((HERE / 'teacher-validation-gate.json').read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
