#!/usr/bin/env python3
"""Add frozen licensed grammar replay and authored continuity to a new corpus.

This is a distinct static-replay comparison, not GPT-2/Qwen distillation.
Original encoded base bytes and the fixed output vocabulary are preserved.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import shutil
import hashlib

from prepare import parse,V,UNK
from prepare_distillation import PINNED_VOCABULARY_SHA256,sha,rows,write

SPLITS=('train','validation','test')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base',type=Path,required=True)
    p.add_argument('--replay',type=Path,required=True)
    p.add_argument('--authored',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args()
    if a.out.exists():raise FileExistsError('Output must be new')
    if any(a.out.resolve().is_relative_to(folder.resolve())for folder in (a.base,a.replay,a.authored)):
        raise ValueError('Output cannot be inside a source corpus')
    vocabulary=json.loads((a.base/'vocabulary.json').read_text())
    vocabulary_hash=sha(a.base/'vocabulary.json')
    if vocabulary_hash!=PINNED_VOCABULARY_SHA256 or len(set(vocabulary))!=V:
        raise ValueError('Expected unchanged940734 V7 curriculum vocabulary')
    index={word:i for i,word in enumerate(vocabulary)}
    if (a.base/'vocabulary.bin').read_bytes()!=b''.join(word.encode().ljust(32,b'\0')for word in vocabulary):
        raise ValueError('Vocabulary JSON/bin mismatch')
    base_meta=json.loads((a.base/'manifest.json').read_text())
    replay_meta=json.loads((a.replay/'manifest.json').read_text())
    authored_meta=json.loads((a.authored/'manifest.json').read_text())
    counts=json.loads((a.base/'counts.json').read_text())
    if 'teacher'in counts:raise ValueError('Start from the original encoded curriculum without a teacher source')
    counts['teacher']=[0]*V
    source_files=[folder/f'{split}.jsonl'for folder in (a.base,a.replay,a.authored)for split in SPLITS]
    source_files += [a.base/'manifest.json',a.base/'counts.json',a.base/'vocabulary.json',a.base/'vocabulary.bin',
                     a.replay/'manifest.json',a.replay/'source-license.json',a.authored/'manifest.json']
    source_hashes={str(file.resolve()):sha(file)for file in source_files}
    for split in SPLITS:
        if sha(a.base/f'{split}.jsonl')!=base_meta['artifacts'][f'{split}.jsonl']['sha256']:
            raise ValueError('Base hash mismatch')
        if sha(a.replay/f'{split}.jsonl')!=replay_meta['outputs'][split]['sha256']:
            raise ValueError('Replay hash mismatch')
        if sha(a.authored/f'{split}.jsonl')!=authored_meta['splits'][split]['sha256']:
            raise ValueError('Authored hash mismatch')

    groups={};identities=set();texts={};duplicates=Counter();additions={s:[]for s in SPLITS};stats={}
    def record_identity(row,split):
        if row['id']in identities:raise ValueError('Duplicate document ID: '+row['id'])
        identities.add(row['id']);group=row['group_id']
        if group in groups and groups[group]!=split:raise ValueError('Cross-split source family')
        groups[group]=split
        key=hashlib.sha256(' '.join(parse(row['text'])[0]).encode()).hexdigest()
        if key in texts:
            if texts[key]!=split:raise ValueError('Cross-split exact normalized text')
            duplicates[split]+=1
        texts[key]=split
    for split in SPLITS:
        for row in rows(a.base/f'{split}.jsonl'):record_identity(row,split)

    for label,folder,kind,namespace in (
            ('licensed_static_replay',a.replay,'teacher','replay-v8:'),
            ('assistant_authored_continuity',a.authored,'original','authored-continuity-v8:')):
        stats[label]={}
        for split in SPLITS:
            s={'documents':0,'words':0,'unknown_words':0,'documents_with_unknown_words':0,
               'terminal_targets':0,'punctuation_targets':0}
            for original in rows(folder/f'{split}.jsonl'):
                if original.get('split')!=split:raise ValueError('Source split does not match filename')
                if label=='assistant_authored_continuity'and original.get('source_kind')!='assistant_authored_continuity':
                    raise ValueError('Authored provenance mismatch')
                words,punct=parse(original['text']);ids=[index.get(word,UNK)for word in words]
                if len(ids)<2:raise ValueError('Unexpected empty/short replay document')
                row=dict(original)|{'id':namespace+original['id'],'group_id':namespace+original['group_id'],
                    'kind':kind,'domain':0,'token_ids':ids,'punctuation':punct,
                    'replay_collection':label,'original_source_id':original['id'],'original_source_group_id':original['group_id']}
                record_identity(row,split);additions[split].append(row)
                missing=sum(token==UNK for token in ids)
                s['documents']+=1;s['words']+=len(ids);s['unknown_words']+=missing
                s['documents_with_unknown_words']+=int(missing>0)
                s['terminal_targets']+=sum(value>=2 for value in punct);s['punctuation_targets']+=len(punct)
                if split=='train':
                    for token in ids:
                        if token<V:counts[kind][token]+=1
            s['unknown_fraction']=s['unknown_words']/max(1,s['words']);stats[label][split]=s
            expected=(replay_meta['counts'][split]if label=='licensed_static_replay'else authored_meta['splits'][split]['episodes'])
            if s['documents']!=expected:raise ValueError('Source document count changed')
    if {str(file.resolve()):sha(file)for file in source_files}!=source_hashes:
        raise RuntimeError('Source changed while preparing replay')

    a.out.mkdir(parents=True);artifacts={};prefixes={};statistics=json.loads(json.dumps(base_meta['statistics']))
    for split in SPLITS:
        name=f'{split}.jsonl';source=a.base/name;target=a.out/name
        with source.open('rb')as check:
            check.seek(-1,2)
            if check.read(1)!=b'\n':raise ValueError('Base must end in newline')
        shutil.copyfile(source,target)
        with target.open('ab')as out:
            for row in additions[split]:out.write((json.dumps(row,ensure_ascii=True)+'\n').encode())
        with target.open('rb')as check:prefix_hash=hashlib.sha256(check.read(source.stat().st_size)).hexdigest()
        if prefix_hash!=sha(source):raise AssertionError('Base byte prefix changed')
        prefixes[name]={'sha256':prefix_hash,'bytes':source.stat().st_size,'unchanged':True}
        artifacts[name]={'sha256':sha(target),'bytes':target.stat().st_size}
        teacher=stats['licensed_static_replay'][split]
        statistics[split]['teacher']={key:teacher[key]for key in ('documents','words','unknown_words','terminal_targets','punctuation_targets')}
        own=stats['assistant_authored_continuity'][split]
        for key in ('documents','words','unknown_words','terminal_targets','punctuation_targets'):
            statistics[split]['original'][key]+=own[key]
    for name in ('vocabulary.json','vocabulary.bin'):shutil.copyfile(a.base/name,a.out/name)
    write(a.out/'counts.json',counts)
    provenance=a.out/'provenance';provenance.mkdir()
    for source,name in [(a.replay/'manifest.json','replay-source-manifest.json'),
                        (a.replay/'source-license.json','replay-source-license.json'),
                        (a.authored/'manifest.json','authored-source-manifest.json')]:shutil.copyfile(source,provenance/name)
    manifest=dict(base_meta)|{'status':'FROZEN_STATIC_REPLAY_COMPARISON','artifacts':artifacts,
        'statistics':statistics,'source_sha256':source_hashes,'base_corpus_byte_prefixes':prefixes,
        'reused_vocabulary_sha256':vocabulary_hash,'appended_source_statistics':stats,
        'cross_split_group_overlap':0,'cross_split_lexical_duplicates':0,'within_split_normalized_duplicates_preserved':dict(duplicates),
        'all_source_documents_retained':True,'oov_policy':'Retain every document and every word position. Unknown lexical targets masked; unknown inputs and all punctuation remain.',
        'replay_kind_domain':{'kind':'teacher','domain':0},'authored_kind_domain':{'kind':'original','domain':0},
        'teacher_name_note':'The generic trainer kind teacher denotes frozen licensed grammar replay here, not newly generated GPT2/Qwen labels.',
        'comparison_note':'This source was used in earlier one-layer experiments. This dataset supports a distinct two-layer H384 replay comparison; no new model-quality claim follows from preparation.',
        'preparer_sha256':sha(Path(__file__)),'parser_sha256':sha(Path(__file__).with_name('prepare.py')),
        'gpu_calls':0,'network_calls':0,'training_started':False}
    if {str(file.resolve()):sha(file)for file in source_files}!=source_hashes:
        raise RuntimeError('Source changed during output construction')
    write(a.out/'manifest.json',manifest)
    report={'status':manifest['status'],'output':str(a.out.resolve()),'appended_source_statistics':stats,
            'base_bytes_unchanged':True,'vocabulary_sha256':vocabulary_hash,'manifest_sha256':sha(a.out/'manifest.json'),
            'all_source_documents_retained':True,'cross_split_groups':0,'cross_split_exact_text':0}
    write(a.out/'preparation-report.json',report);print(json.dumps(report,indent=2))


if __name__=='__main__':main()
