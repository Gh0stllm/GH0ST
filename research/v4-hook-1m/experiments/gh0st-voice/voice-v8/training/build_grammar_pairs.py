#!/usr/bin/env python3
"""Build hash-bound training grammar labels without editing source corpora."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from grammar_negatives import _records
from prepare import parse, UNK

PREFIX_RULES=('first_person_auxiliary','plural_auxiliary','modal_base_verb')


def sha(path):
    h=hashlib.sha256()
    with path.open('rb')as source:
        for block in iter(lambda:source.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


def build(train,vocabulary,output):
    train,vocabulary,output=map(Path,(train,vocabulary,output))
    if train.name!='train.jsonl':raise ValueError('Only a train.jsonl source is accepted')
    if output.exists():raise FileExistsError(output)
    train_hash,vocab_hash=sha(train),sha(vocabulary)
    vocab=json.loads(vocabulary.read_text());index={word:i for i,word in enumerate(vocab)}
    if len(index)!=8192:raise ValueError('Expected unchanged8192-word output vocabulary')
    documents={};seen=set();rules=Counter();excluded=Counter();kinds=Counter();total_words=0;all_pairs=0
    with train.open()as training_source:
        for line in training_source:
            row=json.loads(line)
            if row.get('split','train')!='train':raise ValueError('Nontraining source row')
            if row['id']in seen:raise ValueError('Duplicate training document id')
            seen.add(row['id']);words,punct=parse(row['text'])
            ids=[index.get(word,UNK)for word in words]
            if ids!=row['token_ids']or punct!=row['punctuation']:
                raise ValueError(f"V8 parser no longer matches frozen encoded source: {row['id']}")
            records=_records(words,punct,index)
            pairs=sorted({(pos,bad)for pos,bad,rule in records if rule in PREFIX_RULES})
            for pos,bad in pairs:
                if not(0<=pos<len(ids)and 0<=ids[pos]<len(vocab)and 0<=bad<len(vocab)and bad!=ids[pos]):
                    raise AssertionError('Invalid grammar pair')
            if pairs:documents[row['id']]=pairs
            for _,_,rule in records:
                (rules if rule in PREFIX_RULES else excluded)[rule]+=1
            kinds[row.get('kind','unknown')]+=len(pairs);all_pairs+=len(pairs);total_words+=len(words)
    if sha(train)!=train_hash or sha(vocabulary)!=vocab_hash:
        raise RuntimeError('Source changed while building labels')
    result={'schema_version':1,'training_only':True,'status':'FROZEN_TRAINING_LABEL_SIDECAR',
        'source_train':str(train.resolve()),'source_train_sha256':train_hash,
        'vocabulary_source':str(vocabulary.resolve()),'vocabulary_sha256':vocab_hash,
        'position_semantics':'Zero-based target word positions in complete original documents, not shifted x positions',
        'alignment_check':'Every raw text reparsed with V8 prepare.parse; all encoded IDs and punctuation exactly matched',
        'allowed_rules':list(PREFIX_RULES),'excluded_rules':['article_sound','perfect_participle'],
        'exclusion_reason':'Article/perfect rules use future-word evidence; only prefix-invalid alternatives are valid for the causal next-token contrastive loss.',
        'generator_sha256':sha(Path(__file__)),'rules_sha256':sha(Path(__file__).with_name('grammar_negatives.py')),
        'parser_sha256':sha(Path(__file__).with_name('prepare.py')),
        'counts':{'source_documents':len(seen),'documents_with_pairs':len(documents),'word_positions':total_words,
                  'negative_pairs':all_pairs,'by_rule':dict(rules),'by_kind':dict(kinds),
                  'excluded_by_rule':dict(excluded)},
        'documents':documents}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,separators=(',',':'))+'\n')
    summary={key:value for key,value in result.items()if key!='documents'}
    summary['sidecar']={'path':str(output.resolve()),'sha256':sha(output),'bytes':output.stat().st_size}
    output.with_suffix('.report.json').write_text(json.dumps(summary,indent=2)+'\n')
    return summary


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--train',type=Path,required=True)
    p.add_argument('--vocabulary',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();print(json.dumps(build(a.train,a.vocabulary,a.out),indent=2))
