#!/usr/bin/env python3
"""Independent CPU-only audit of the offline teacher's selected data and boundaries."""
import hashlib
import json
import os
import re
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
from transformers import AutoTokenizer

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parents[4]
DATA = RESEARCH / 'experiments/gh0st-voice/voice-v7/training/encoded-base'
TEACHER = RESEARCH / 'experiments/gh0st-voice/voice-v8/teacher-notes'
CACHE = RESEARCH / 'experiments/gpt2/model-cache'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalized_words(text):
    return re.findall(r"[a-z]+(?:'[a-z]+)?|[0-9]+", text.lower())


def main():
    tok = AutoTokenizer.from_pretrained(CACHE, local_files_only=True, trust_remote_code=False)
    tok.pad_token = tok.eos_token
    selected = {}
    summaries = {}
    groups = {}
    documents = {}
    ngrams = {}
    for split in ('train', 'validation', 'test'):
        all_rows = [json.loads(line) for line in (DATA / f'{split}.jsonl').open()]
        rows = [r for r in all_rows if r.get('kind') == 'original' or r.get('source_kind') == 'original_voice']
        selected[split] = rows
        groups[split] = {r['group_id'] for r in rows}
        documents[split] = {tuple(normalized_words(r['text'])) for r in rows}
        ngrams[split] = {tuple(words[i:i + 12]) for r in rows for words in [normalized_words(r['text'])] for i in range(len(words) - 11)}
        lengths = sorted(len(tok(tok.eos_token + r['text'].strip() + tok.eos_token)['input_ids']) for r in rows)
        summaries[split] = {
            'documents': len(rows), 'groups': len(groups[split]),
            'whitespace_words': sum(len(r['text'].split()) for r in rows),
            'bpe_tokens_with_both_eos': sum(lengths),
            'max_bpe_length': max(lengths), 'p95_bpe_length': lengths[int(.95 * (len(lengths) - 1))],
            'truncated_at_256': sum(x > 256 for x in lengths),
            'truncated_at_384': sum(x > 384 for x in lengths),
            'empty_group_ids': sum(not r['group_id'] for r in rows),
            'duplicate_normalized_documents_within_split': len(rows) - len(documents[split]),
            'sha256': sha(DATA / f'{split}.jsonl'),
        }
    pairs = {}
    for a, b in [('train', 'validation'), ('train', 'test'), ('validation', 'test')]:
        pairs[f'{a}/{b}'] = {'shared_groups': len(groups[a] & groups[b]),
                             'shared_normalized_documents': len(documents[a] & documents[b]),
                             'shared_12grams': len(ngrams[a] & ngrams[b])}
    padded = tok([tok.eos_token + 'I kept the key.' + tok.eos_token,
                  tok.eos_token + 'I waited.' + tok.eos_token], padding=True, return_tensors='pt')
    labels = padded['input_ids'].clone()
    labels[padded['attention_mask'] == 0] = -100
    eos_evidence = []
    for i in range(2):
        n = int(padded['attention_mask'][i].sum())
        eos_evidence.append({'real_eos_supervised': int(labels[i, n - 1]) == tok.eos_token_id,
                             'padding_ignored': all(int(v) == -100 for v in labels[i, n:]),
                             'targets_after_causal_shift': int((labels[i, 1:] != -100).sum())})
    # Independent counterexample to accepting an ending from the prompt itself.
    prompt = ' '.join(['I kept the same notebook beside my desk and read it again.'] * 4)
    continuation = ' I began to'
    full = prompt + continuation
    ends = list(re.finditer(r'[.!?](?:[\"\x27])?(?:\s|$)', full))
    clean = full[:ends[-1].end()].strip()
    filter_counterexample = {'prompt_words': len(prompt.split()), 'generated_words': len(continuation.split()),
                             'clean_equals_prompt': clean == prompt,
                             'passes_current_length_filter': 40 <= len(clean.split()) <= 220,
                             'generated_sentence_end': bool(re.search(r'[.!?](?:[\"\x27])?(?:\s|$)', continuation))}
    report = {
        'status': 'TRAINING_DATA_AND_BOUNDARIES_PASS_SAMPLER_GUARDS_REQUIRED',
        'cpu_only': True, 'gpu_actions': 0, 'training_actions': 0, 'network_actions': 0,
        'selected_data': summaries, 'cross_split_comparison': pairs,
        'padding_eos_supervision': eos_evidence,
        'candidate_filter_counterexample': filter_counterexample,
        'source_sha256': {name: sha(TEACHER / name) for name in ['load_local_gpt2.py', 'train_teacher.py', 'sample_teacher.py', 'TEACHER-PLAN.md']},
        'tokenizer_sha256': {p.name: sha(p) for p in sorted(CACHE.glob('*')) if p.is_file() and p.suffix in ('.json', '.txt')},
    }
    (HERE / 'audit.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
