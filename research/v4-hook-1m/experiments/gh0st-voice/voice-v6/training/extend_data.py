#!/usr/bin/env python3
"""Append reviewed training-only originals without refitting vocabulary or tests."""
import argparse,collections,hashlib,json,shutil
from pathlib import Path
from prepare import tokens,V,UNK

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,x):p.write_text(json.dumps(x,indent=2)+'\n')

def main():
    p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True)
    p.add_argument('--extra',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();assert not a.out.exists();a.out.mkdir(parents=True)
    meta=json.loads((a.base/'manifest.json').read_text());vocab=json.loads((a.base/'vocabulary.json').read_text())
    index={word:i for i,word in enumerate(vocab)};assert len(index)==V
    for name in ('vocabulary.json','vocabulary.bin','validation.jsonl','test.jsonl'):shutil.copyfile(a.base/name,a.out/name)
    rows=[json.loads(line) for line in (a.base/'train.jsonl').open()]
    hashes=set();groups=set()
    for split in ('train','validation','test'):
        for line in (a.base/f'{split}.jsonl').open():
            row=json.loads(line);hashes.add(' '.join(tokens(row['text'])));groups.add(row['group_id'])
    extras=[]
    for line in a.extra.open():
        row=json.loads(line);seq=tokens(row['text']);normal=' '.join(seq)
        assert row['source_kind']=='original_voice' and row['group_id'] not in groups and normal not in hashes
        assert 75<=len(seq)<=140
        groups.add(row['group_id']);hashes.add(normal)
        ids=[index.get(word,UNK) for word in seq];unknown=sum(t==UNK for t in ids)
        extras.append(row|{'domain':0,'token_ids':ids,'normalized_words':len(ids),'unknown_words':unknown})
    rows+=extras
    (a.out/'train.jsonl').write_text(''.join(json.dumps(row,ensure_ascii=True)+'\n' for row in rows))
    counts={str(d):[0]*V for d in (0,1)}
    for row in rows:
        for token in row['token_ids']:
            if token<V:counts[str(row['domain'])][token]+=1
    write(a.out/'counts.json',counts)
    stats={}
    for split in ('train','validation','test'):
        by_domain={str(d):{'words':0,'unknown':0,'documents':0} for d in (0,1)}
        for line in (a.out/f'{split}.jsonl').open():
            row=json.loads(line);d=by_domain[str(row['domain'])];d['words']+=len(row['token_ids']);d['unknown']+=row['unknown_words'];d['documents']+=1
        n=sum(d['words'] for d in by_domain.values());u=sum(d['unknown'] for d in by_domain.values())
        stats[split]={'documents':sum(d['documents'] for d in by_domain.values()),'words':n,'unknown_words':u,'known_target_fraction':1-u/n,'domains':by_domain}
    meta.update(statistics=stats,groups=len(groups),artifacts={name:{'sha256':sha(a.out/name),'bytes':(a.out/name).stat().st_size} for name in ('train.jsonl','validation.jsonl','test.jsonl')},
                training_expansion={'source_sha256':sha(a.extra),'documents':len(extras),'words':sum(len(r['token_ids'])for r in extras),'unknown_words':sum(r['unknown_words']for r in extras)},
                base_manifest_sha256=sha(a.base/'manifest.json'),validation_and_test_unchanged=True,vocabulary_refitted=False)
    write(a.out/'manifest.json',meta);print(json.dumps(meta['training_expansion']))
if __name__=='__main__':main()
