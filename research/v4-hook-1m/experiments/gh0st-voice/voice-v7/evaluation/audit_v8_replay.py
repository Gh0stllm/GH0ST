#!/usr/bin/env python3
"""Independently inspect the frozen V8 static replay additions and known-target counts."""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAINING = HERE.parents[1]/'voice-v8/training'
DATA = TRAINING/'encoded-replay'
spec = importlib.util.spec_from_file_location('v8_replay_parser', TRAINING/'prepare.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    manifest = json.loads((DATA/'manifest.json').read_text())
    start_hash = sha(DATA/'manifest.json')
    vocab = json.loads((DATA/'vocabulary.json').read_text())
    index = {w:i for i,w in enumerate(vocab)}
    assert len(index) == 8192 and sha(DATA/'vocabulary.json') == '940734e6971ecba0960a5b11b4dc5f8604c0a00e4078340c7f002abbec886e9a'
    for path, expected in manifest['source_sha256'].items():
        assert sha(Path(path)) == expected
    split_groups = {}
    split_texts = {}
    counts = {}
    ids_seen = set()
    teacher_counts = [0]*8192
    reparsed = 0
    for split in ['train','validation','test']:
        path = DATA/f'{split}.jsonl'
        assert sha(path) == manifest['artifacts'][path.name]['sha256']
        prefix = manifest['base_corpus_byte_prefixes'][path.name]
        with path.open('rb') as file:
            assert hashlib.sha256(file.read(prefix['bytes'])).hexdigest() == prefix['sha256']
        split_groups[split], split_texts[split] = set(), set()
        counter = collections.defaultdict(collections.Counter)
        for line in path.open():
            row = json.loads(line)
            assert row['id'] not in ids_seen
            ids_seen.add(row['id'])
            group = row.get('original_source_group_id', row['group_id'])
            split_groups[split].add(group)
            lexical = module.parse(row['text'])[0]
            split_texts[split].add(hashlib.sha256(' '.join(lexical).encode()).hexdigest())
            token_ids = row['token_ids']
            assert len(token_ids) == len(row['punctuation'])
            assert all(0 <= token < 8192 or token == 8193 for token in token_ids)
            assert all(0 <= p < 5 for p in row['punctuation'])
            if 'replay_collection' in row:
                words, punctuation = module.parse(row['text'])
                assert token_ids == [index.get(word,8193)for word in words]
                assert row['punctuation'] == punctuation
                assert row['domain'] == 0
                reparsed += 1
            counter[row['kind']].update(documents=1,words=len(token_ids),unknown_words=token_ids.count(8193),
                                         known_words=sum(t<8192 for t in token_ids),
                                         punctuation_targets=len(token_ids),terminal_targets=sum(p>=2 for p in row['punctuation']))
            if split == 'train' and row['kind'] == 'teacher':
                for token in token_ids:
                    if token < 8192: teacher_counts[token] += 1
        for kind, actual in counter.items():
            expected = manifest['statistics'][split][kind]
            for key in ['documents','words','unknown_words','punctuation_targets','terminal_targets']:
                assert actual[key] == expected[key], (split,kind,key,actual[key],expected[key])
        counts[split] = dict(counter)
    overlap = {}
    for a,b in [('train','validation'),('train','test'),('validation','test')]:
        overlap[f'{a}/{b}'] = {'underlying_source_groups':len(split_groups[a]&split_groups[b]),
                              'lexical_documents':len(split_texts[a]&split_texts[b])}
        assert overlap[f'{a}/{b}'] == {'underlying_source_groups':0,'lexical_documents':0}
    assert teacher_counts == json.loads((DATA/'counts.json').read_text())['teacher']
    assert sha(DATA/'manifest.json') == start_hash
    report = {'status':'PASS_FROZEN_REPLAY_DATA_AUDIT','manifest_sha256':start_hash,
              'vocabulary_sha256':sha(DATA/'vocabulary.json'),'statistics':counts,
              'appended_documents_reparsed':reparsed,'underlying_group_and_text_overlap':overlap,
              'all_source_hashes_match':True,'base_corpus_prefixes_unchanged':True,
              'teacher_unigram_counts_exact':True,
              'unknown_policy':'Every input word position retained;8193 is input-only UNK. Lexical CE masked for it; all punctuation still supervised. No OOV sentence deletion.',
              'provenance':'teacher kind is static licensed SimpleStories replay, not GPT-2/Qwen generated targets.',
              'gpu_actions':0,'network_actions':0,'quality_approval':False}
    (HERE/'v8-replay-data-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'manifest_sha256':start_hash,'appended_documents_reparsed':reparsed,'train':counts['train']}))


if __name__=='__main__':main()
