#!/usr/bin/env python3
"""Append explicitly approved offline teacher paragraphs to a NEW corpus.

This performs format/provenance checks, not semantic approval. The external
teacher-quality review must pass before the caller supplies approved IDs.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil

from prepare import parse,V,UNK

PINNED_VOCABULARY_SHA256='940734e6971ecba0960a5b11b4dc5f8604c0a00e4078340c7f002abbec886e9a'
SPLITS=('train','validation','test')


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb')as source:
        for block in iter(lambda:source.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


def rows(path):
    with Path(path).open()as source:
        for line in source:
            if line.strip():yield json.loads(line)


def write(path,value):path.write_text(json.dumps(value,indent=2)+'\n')


def prepare(base,candidates,prompts,approved,output):
    base,candidates,prompts,approved,output=map(Path,(base,candidates,prompts,approved,output))
    if output.exists():raise FileExistsError('Output must be a new directory')
    if output.resolve().is_relative_to(base.resolve()):raise ValueError('Output cannot be inside the immutable base corpus')
    vocabulary_file=base/'vocabulary.json';vocab_sha=sha(vocabulary_file)
    if vocab_sha!=PINNED_VOCABULARY_SHA256:raise ValueError('Expected the exact frozen V7 curriculum vocabulary')
    vocabulary=json.loads(vocabulary_file.read_text())
    if len(vocabulary)!=V or len(set(vocabulary))!=V:raise ValueError('Invalid8192-word vocabulary')
    index={word:i for i,word in enumerate(vocabulary)}
    vocabulary_bytes=b''.join(w.encode('ascii').ljust(32,b'\0')for w in vocabulary)
    if (base/'vocabulary.bin').read_bytes()!=vocabulary_bytes:raise ValueError('Vocabulary JSON/bin mismatch')
    base_meta=json.loads((base/'manifest.json').read_text())
    if base_meta['vocabulary_sha256']!=vocab_sha:raise ValueError('Base manifest vocabulary mismatch')
    counts=json.loads((base/'counts.json').read_text())
    if 'teacher'in counts:raise ValueError('Base already contains teacher counts; use original encoded curriculum')
    if not all(isinstance(values,list)and len(values)==V for values in counts.values()):
        raise ValueError('Base counts must preserve all8192 vocabulary positions')
    inputs=[base/name for name in ('manifest.json','counts.json','vocabulary.json','vocabulary.bin')]
    inputs +=[base/f'{split}.jsonl'for split in SPLITS]+[candidates,prompts,approved]
    initial_hashes={str(path.resolve()):sha(path)for path in inputs}
    for split in SPLITS:
        name=f'{split}.jsonl'
        if sha(base/name)!=base_meta['artifacts'][name]['sha256']:
            raise ValueError('Base corpus hash mismatch: '+name)
        with (base/name).open('rb')as source:
            source.seek(0,2)
            if source.tell():
                source.seek(-1,2)
                if source.read(1)!=b'\n':raise ValueError('Base JSONL must end in a newline for byte-preserving append')

    approved_json=json.loads(approved.read_text())
    approved_ids=approved_json.get('approved_ids')if isinstance(approved_json,dict)else approved_json
    if not isinstance(approved_ids,list)or not approved_ids or not all(isinstance(x,str)and x for x in approved_ids):
        raise ValueError('Provide a nonempty explicit list of approved candidate IDs')
    if len(set(approved_ids))!=len(approved_ids):raise ValueError('Duplicate approved IDs')
    approved_set=set(approved_ids)
    ancestry={}
    for row in rows(prompts):
        if row['id']in ancestry:raise ValueError('Duplicate canonical prompt ID')
        if row.get('split')not in SPLITS or not row.get('group_id'):raise ValueError('Prompt needs explicit split and group_id')
        ancestry[row['id']]=row

    group_splits={};base_ids=set();text_splits={};base_documents=Counter();base_existing_duplicates=0
    def claim_group(group,split):
        if group in group_splits and group_splits[group]!=split:raise ValueError('Cross-split group: '+group)
        group_splits[group]=split
    def text_key(text):return hashlib.sha256(' '.join(parse(text)[0]).encode()).hexdigest()
    for split in SPLITS:
        for row in rows(base/f'{split}.jsonl'):
            if row['id']in base_ids:raise ValueError('Duplicate base document ID')
            base_ids.add(row['id']);base_documents[split]+=1;claim_group(row['group_id'],split)
            key=text_key(row['text'])
            if key in text_splits:
                if text_splits[key]!=split:raise ValueError('Base has cross-split normalized text duplicate')
                base_existing_duplicates+=1
            text_splits[key]=split
    # Validate ancestry as a whole, before selecting descendants. A corrupt
    # group assignment must not be hidden by a small approved-ID subset.
    for prompt in ancestry.values():claim_group(prompt['group_id'],prompt['split'])

    selected={split:[]for split in SPLITS};seen_candidates=set();selected_ids=set();stats={}
    teacher_train_counts=[0]*V
    for candidate in rows(candidates):
        candidate_id=candidate['id']
        if candidate_id in seen_candidates:raise ValueError('Duplicate candidate ID')
        seen_candidates.add(candidate_id)
        if candidate_id not in approved_set:continue
        if candidate_id in base_ids:raise ValueError('Approved candidate ID collides with base document')
        prompt_id=candidate.get('prompt_id')
        if prompt_id not in ancestry:raise ValueError('Approved candidate has unknown canonical prompt ancestry')
        prompt=ancestry[prompt_id];split=prompt['split'];group=prompt['group_id']
        for key,expected in (('split',split),('group_id',group)):
            if key in candidate and candidate[key]!=expected:raise ValueError('Candidate '+key+' conflicts with canonical ancestry')
            embedded=candidate.get('prompt_metadata',{})
            if key in embedded and embedded[key]!=expected:raise ValueError('Embedded prompt '+key+' conflicts with canonical ancestry')
        text=candidate.get('text')
        if not isinstance(text,str)or not text.strip():raise ValueError('Approved candidate has no paragraph text')
        words,punctuation=parse(text)
        if len(words)<2:raise ValueError('Approved paragraph is too short after parsing')
        key=text_key(text)
        if key in text_splits:raise ValueError('Approved teacher paragraph duplicates existing normalized text')
        text_splits[key]=split;claim_group(group,split)
        ids=[index.get(word,UNK)for word in words]
        output_row={'id':candidate_id,'group_id':group,'split':split,'kind':'teacher','domain':0,
            'source_kind':'local_gpt2_teacher','prompt_id':prompt_id,'teacher_candidate_id':candidate_id,
            'text':text,'token_ids':ids,'punctuation':punctuation}
        selected[split].append(output_row);selected_ids.add(candidate_id)
        s=stats.setdefault(split,{'documents':0,'words':0,'unknown_words':0,'terminal_targets':0,'punctuation_targets':0})
        s['documents']+=1;s['words']+=len(words);s['unknown_words']+=sum(token==UNK for token in ids)
        s['terminal_targets']+=sum(p>=2 for p in punctuation);s['punctuation_targets']+=len(punctuation)
        if split=='train':
            for token in ids:
                if token<V:teacher_train_counts[token]+=1
    if selected_ids!=approved_set:
        raise ValueError('Approval IDs missing from candidates: '+','.join(sorted(approved_set-selected_ids)))
    if {str(path.resolve()):sha(path)for path in inputs}!=initial_hashes:
        raise RuntimeError('An input changed while preparing the corpus')

    # No output is created before all source, approval, ancestry, and leak
    # checks pass. Existing base JSONL bytes are copied, never reserialized.
    output.mkdir(parents=True,exist_ok=False)
    artifacts={};base_prefixes={}
    for split in SPLITS:
        name=f'{split}.jsonl';source=base/name;destination=output/name
        shutil.copyfile(source,destination)
        with destination.open('ab')as target:
            for row in selected[split]:target.write((json.dumps(row,ensure_ascii=True)+'\n').encode())
        original_size=source.stat().st_size
        with destination.open('rb')as target:prefix_hash=hashlib.sha256(target.read(original_size)).hexdigest()
        if prefix_hash!=sha(source):raise AssertionError('Base corpus bytes changed')
        base_prefixes[name]={'bytes':original_size,'sha256':prefix_hash,'unchanged':True}
        artifacts[name]={'sha256':sha(destination),'bytes':destination.stat().st_size}
    for name in ('vocabulary.json','vocabulary.bin'):shutil.copyfile(base/name,output/name)
    counts['teacher']=teacher_train_counts;write(output/'counts.json',counts)
    statistics=json.loads(json.dumps(base_meta.get('statistics',{})))
    for split in SPLITS:
        teacher_stats=stats.get(split,{'documents':0,'words':0,'unknown_words':0,'terminal_targets':0,'punctuation_targets':0})
        teacher_stats['known_fraction']=(1-teacher_stats['unknown_words']/teacher_stats['words'])if teacher_stats['words']else None
        statistics.setdefault(split,{})['teacher']=teacher_stats
    manifest=dict(base_meta)
    manifest.update({'status':'FROZEN_EXPLICITLY_APPROVED_TEACHER_APPEND','vocabulary_sha256':vocab_sha,
        'reused_vocabulary_sha256':vocab_sha,'artifacts':artifacts,'statistics':statistics,
        'source_sha256':initial_hashes,'base_corpus_byte_prefixes':base_prefixes,
        'teacher_approval':{'approved_candidate_ids':sorted(approved_set),'selected_count':len(selected_ids),
            'unapproved_candidates_omitted':len(seen_candidates-approved_set),
            'quality_scope':'ID list is supplied after an external semantic/copying quality gate; this converter does not grant quality approval'},
        'teacher_ancestry':'Split and group_id inherited exactly from canonical prompt file',
        'cross_split_group_overlap':0,'cross_split_lexical_duplicates':0,
        'base_within_split_duplicates_preserved':base_existing_duplicates,
        'teacher_training_only_kind':'teacher','teacher_runtime_domain':0,
        'parser_sha256':sha(Path(__file__).with_name('prepare.py')),
        'distillation_preparer_sha256':sha(Path(__file__)),
        'word_mask':'Only unknown lexical targets masked; all context and punctuation retained.'})
    if {str(path.resolve()):sha(path)for path in inputs}!=initial_hashes:
        raise RuntimeError('An input changed during final output construction; output is incomplete')
    write(output/'manifest.json',manifest)
    return {'status':manifest['status'],'selected_count':len(selected_ids),'teacher_statistics':stats,
        'vocabulary_sha256':vocab_sha,'base_bytes_unchanged':True,
        'manifest_sha256':sha(output/'manifest.json'),'output':str(output.resolve())}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base',type=Path,required=True,help='Existing immutable encoded-curriculum directory')
    p.add_argument('--candidates',type=Path,required=True)
    p.add_argument('--prompts',type=Path,required=True,help='Canonical prompt ancestry JSONL')
    p.add_argument('--approved',type=Path,required=True,help='JSON list or object with approved_ids')
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();print(json.dumps(prepare(a.base,a.candidates,a.prompts,a.approved,a.out),indent=2))
