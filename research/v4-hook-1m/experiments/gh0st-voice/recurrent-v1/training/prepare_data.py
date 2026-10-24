#!/usr/bin/env python3
"""Build a frozen, train-vocabulary-only word corpus for the existing Q10 RNN."""
import argparse
import collections
import hashlib
import json
import re
import unicodedata
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
V3 = HERE.parents[1] / 'large-v3'
WORD = re.compile(r"[a-z]+(?:'[a-z]+)*(?:[.!?])?")
VALID = re.compile(r"[a-z]+(?:'[a-z]+)*(?:[.!?])?\Z")
SPLITS = ('train', 'validation', 'test')
KINDS = ('authored', 'grammar', 'teacher')
V = 8192

def sha(data):
    return hashlib.sha256(data).hexdigest()

def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')

def words(text):
    text = unicodedata.normalize('NFKD', text).lower().replace('’', "'").replace('‘', "'")
    text = text.encode('ascii', 'ignore').decode()
    return WORD.findall(text)

def reversed_bits(value):
    return int(f'{value:013b}'[::-1], 2)

def sentences(tokens):
    current=[]
    for token in tokens:
        current.append(token)
        if token.endswith(('.', '!', '?')):
            yield current
            current=[]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--long-voice', type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Output must be new')
    args.output.mkdir(parents=True)
    records, sources, rejected = [], [], collections.Counter()
    input_counts, input_words = collections.Counter(), collections.Counter()
    for split in SPLITS:
        paths = [(V3/'recovery-v5/data'/f'{split}.jsonl', 'authored'),
                 (V3/'recovery-v5/grammar-replay'/f'{split}.jsonl', 'grammar'),
                 (V3/'data/mixed-teacher-v4-final'/f'{split}.jsonl', 'mixed')]
        if args.long_voice:
            paths.append((args.long_voice,'authored'))
        for path, kind in paths:
            raw = path.read_bytes()
            sources.append({'path': str(path), 'sha256': sha(raw), 'bytes': len(raw)})
            for line in raw.splitlines():
                row = json.loads(line)
                if row['split'] != split:
                    continue
                if kind == 'mixed':
                    if row['source_kind'] == 'authored':
                        current = 'authored'
                    elif row['source_kind'] == 'licensed_teacher':
                        current = 'teacher'
                    else:
                        continue
                else:
                    current = kind
                key = split + ':' + current
                input_counts[key] += 1
                text = row['text']
                if current == 'teacher' and (any(t in text for t in ['```', 'http:', 'https:', '{', '}', '<', '>']) or text.count('\n') > 3):
                    rejected[key + ':markup_or_code'] += 1
                    continue
                tokens = words(text)
                input_words[key] += len(tokens)
                if not 5 <= len(tokens) <= 400 or not tokens[-1].endswith(('.', '!', '?')):
                    rejected[key + ':length_or_missing_natural_end'] += 1
                    continue
                if any(not VALID.fullmatch(token) or len(token.encode()) > 32 for token in tokens):
                    rejected[key + ':word_format'] += 1
                    continue
                group = row.get('group_id', row.get('family_id', row.get('conversation_id', row['id'])))
                records.append({'id': row['id'], 'split': split, 'source_kind': current,
                                'group_id': current + ':' + str(group), 'tokens': tokens,
                                'new_original': kind == 'authored'})
    # Fit on train only. Prioritize every new authored word, then other authored
    # words, then actual training frequency. No invented or padding entries.
    total, authored, newest = collections.Counter(), collections.Counter(), collections.Counter()
    for row in records:
        if row['split'] == 'train':
            total.update(row['tokens'])
            if row['source_kind'] == 'authored':
                authored.update(row['tokens'])
            if row['new_original']:
                newest.update(row['tokens'])
    selected = []
    seen_words = set()
    for counter in [newest, total]:
        for token, _ in sorted(counter.items(), key=lambda x: (-x[1], x[0])):
            if token not in seen_words:
                selected.append(token); seen_words.add(token)
                if len(selected) == V:
                    break
        if len(selected) == V:
            break
    assert len(selected) == V, 'Need 8192 actual training words; no padding allowed'
    # Keep only entries with at least one complete covered training sentence.
    # Replace any unusable rare entries with words completing actual sentences,
    # rather than creating word-list fillers or leaving random output leaves.
    train_sentences=[sentence for row in records if row['split']=='train' for sentence in sentences(row['tokens']) if len(sentence)>=5]
    active=set()
    for sentence in train_sentences:
        if set(sentence)<=seen_words:
            active.update(sentence)
    removed=seen_words-active
    selected=[token for token in selected if token in active]
    seen_words=set(selected)
    candidates=set()
    for sentence in train_sentences:
        missing=set(sentence)-seen_words
        if len(missing)==1:
            candidates.update(missing)
    for token in sorted(candidates,key=lambda t:(-total[t],t)):
        selected.append(token);seen_words.add(token)
        if len(selected)==V:break
    assert len(selected)==V, 'Cannot fill vocabulary from complete real training sentences'
    # Scatter frequency ranks across the full binary tree rather than placing
    # all frequent words under one branch. This is a fixed bijection.
    vocabulary = [''] * V
    for rank, token in enumerate(selected):
        vocabulary[reversed_bits(rank)] = token
    index = {token: i for i, token in enumerate(vocabulary)}
    assert len(index) == V and all(total[token] > 0 for token in vocabulary)
    write(args.output/'vocabulary.json', vocabulary)
    (args.output/'vocabulary.bin').write_bytes(b''.join(token.encode().ljust(32, b'\0') for token in vocabulary))
    vocab_counts = {kind: np.zeros(V, dtype=np.int64) for kind in KINDS}
    accepted, accepted_words, unknown_words, unknown_docs = collections.Counter(), collections.Counter(), collections.Counter(), collections.Counter()
    output, groups, exact = {split: [] for split in SPLITS}, {}, {}
    for row in records:
        split, kind = row['split'], row['source_kind']; key = split + ':' + kind
        unknown = [token for token in row['tokens'] if token not in index]
        unknown_words[key] += len(unknown)
        if unknown:unknown_docs[key] += 1
        segments=[];current=[]
        for sentence in sentences(row['tokens']):
            if all(token in index for token in sentence):
                current.extend(sentence)
            elif current:
                segments.append(current);current=[]
        if current:segments.append(current)
        for segment_number,tokens in enumerate(segments):
            if len(tokens)<5:
                rejected[key+':short_retained_segment']+=1;continue
            text = ' '.join(tokens)
            fingerprint = sha(text.encode())
            if fingerprint in exact:
                rejected[key + ':duplicate_same_split' if exact[fingerprint] == split else key + ':duplicate_cross_split'] += 1
                continue
            exact[fingerprint] = split
            group = row['group_id']
            assert group not in groups or groups[group] == split, 'Source group split leakage'
            groups[group] = split
            ids = [index[token] for token in tokens]
            output[split].append({k: v for k, v in row.items() if k != 'tokens'} | {'id':row['id']+f':span-{segment_number}', 'text': text, 'token_ids': ids, 'retained_complete_sentence_span':bool(unknown)})
            accepted[key] += 1; accepted_words[key] += len(ids)
            if split == 'train':np.add.at(vocab_counts[kind], ids, 1)
    # Every vocabulary entry must also survive actual output filtering.
    surviving_counts = sum(vocab_counts.values())
    assert np.all(surviving_counts>0), 'Every output leaf must have real training targets'
    artifacts={}
    for split in SPLITS:
        data=b''.join((json.dumps(row,ensure_ascii=True)+'\n').encode() for row in output[split])
        (args.output/f'{split}.jsonl').write_bytes(data)
        artifacts[f'{split}.jsonl']={'bytes':len(data),'sha256':sha(data)}
    write(args.output/'counts.json',{k:v.tolist() for k,v in vocab_counts.items()})
    report={'status':'COMPLETE','vocabulary_size':V,'start_token':V,'output_special_tokens':[],
            'vocabulary_fit':'Training rows only: new authored words then frequency; exclude entries without complete covered sentences; bit-reversed rank placement.',
            'word_constraints':'1..32 ASCII bytes, lowercase letters/interior apostrophe/optional naturally present final .!?',
            'normalization':'NFKD lowercase ASCII, remove unsupported formatting and commas/quotes; retain naturally present .!?; no punctuation appended.',
            'source_kind_meaning':{'authored':'Distinct authored text only, no old compositional bulk','grammar':'Pinned SimpleStories grammar replay','teacher':'Filtered licensed teacher prose'},
            'input_documents':dict(input_counts),'input_normalized_words':dict(input_words),
            'accepted_documents':dict(accepted),'accepted_words':dict(accepted_words),
            'oov_words_before_document_filter':dict(unknown_words),'documents_filtered_for_oov':dict(unknown_docs),
            'other_rejected':dict(rejected),'retained_training_vocabulary_seen':int(np.count_nonzero(surviving_counts)),
            'initial_unusable_vocabulary_entries_replaced':len(removed),
            'retained_training_vocabulary_unseen':int(np.count_nonzero(surviving_counts==0)),
            'unused_entries_are_actual_train_words_not_padding':True,'max_word_bytes':max(len(t.encode()) for t in vocabulary),
            'group_overlap':0,'cross_split_exact_duplicates_retained':0,'sources':sources,'artifacts':artifacts,
            'limitations':['Held-out metrics cover retained contiguous complete-sentence spans; unknown sentences are dropped, never joined across a dropped sentence.',
                           'Replay is from the same dataset family used in the older pretrained transformer; this new RNN is randomly initialized.',
                           'Teacher prose is model-generated and not independently fact-checked.']}
    write(args.output/'manifest.json',report)
    print(json.dumps({k:report[k] for k in ['status','accepted_documents','accepted_words','retained_training_vocabulary_seen','retained_training_vocabulary_unseen','max_word_bytes']},indent=2))

if __name__=='__main__':main()
