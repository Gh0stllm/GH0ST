#!/usr/bin/env python3
"""Tokenize a supplied split corpus once; no training or network access."""
from __future__ import annotations
import argparse,collections,hashlib,json,random,shutil
from pathlib import Path
import numpy as np
from transformers import AutoTokenizer

HERE=Path(__file__).resolve().parent
RESEARCH=HERE.parents[3]
KINDS=('authored','compositional','public_domain')
SPLITS=('train','validation','test')
ALIASES={'authored':'authored','original':'authored','original_authored':'authored','human_authored':'authored',
         'compositional':'compositional','composition':'compositional','synthetic':'compositional','generated':'compositional',
         'public_domain':'public_domain','public-domain':'public_domain','foundation':'public_domain'}
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write_json(path,obj):Path(path).write_text(json.dumps(obj,indent=2)+'\n')
def strip_quote(text):
    text=text.strip()
    return text[1:-1].strip() if len(text)>1 and text[0]=='"' and text[-1]=='"' else text

def prepare(data,out,tokenizer_path,seed=20261024,max_unknown_fraction=0.):
    data,out,tokenizer_path=map(Path,(data,out,tokenizer_path))
    files=sorted(data.glob('*.jsonl')) if data.is_dir() else [data]
    if not files:raise ValueError('No corpus JSONL files')
    identity={'files':[{'path':str(p.resolve()),'sha256':sha(p),'bytes':p.stat().st_size} for p in files],
              'tokenizer_sha256':sha(tokenizer_path/'tokenizer.json'),'shuffle_seed':seed,
              'format':'uint16-little-endian-continuous-v2','strip_one_outer_quote_pair':True,'insert_eos':False,
              'max_unknown_fraction':max_unknown_fraction,'preparer_sha256':sha(Path(__file__))}
    fingerprint=hashlib.sha256(json.dumps(identity,sort_keys=True).encode()).hexdigest()
    manifest_path=out/'manifest.json'
    if manifest_path.exists():
        existing=json.loads(manifest_path.read_text())
        if existing.get('fingerprint')!=fingerprint:raise ValueError('Existing cache belongs to different data/configuration')
        for row in existing['streams'].values():
            for kind in row.values():
                if sha(out/kind['tokens_file'])!=kind['tokens_sha256'] or sha(out/kind['documents_file'])!=kind['documents_sha256']:raise ValueError('Existing cache checksum mismatch')
        return existing
    if out.exists() and any(out.iterdir()):raise ValueError('Cache output must be new/empty')
    out.mkdir(parents=True,exist_ok=True);temporary=out/'building';temporary.mkdir()
    tok=AutoTokenizer.from_pretrained(tokenizer_path,local_files_only=True,trust_remote_code=False)
    if len(tok)!=4019 or tok.convert_tokens_to_ids('[EOS]')!=1 or tok.convert_tokens_to_ids('"')!=3:raise ValueError('Tokenizer contract mismatch')
    handles={};docs=collections.defaultdict(list);counts=collections.Counter();unknowns=collections.Counter();offsets=collections.Counter();seen_text={};seen_ids=set();family_splits={};public_groups={};batch=[];dedup=collections.Counter()
    for split in SPLITS:
        for kind in KINDS:handles[(split,kind)]=(temporary/f'{split}-{kind}.u16').open('wb')
    def flush():
        if not batch:return
        encoded=tok.backend_tokenizer.encode_batch([x['text'] for x in batch],add_special_tokens=False)
        for row,enc in zip(batch,encoded):
            ids=enc.ids;key=(row['split'],row['kind'])
            if not ids:raise ValueError('Empty tokenized document '+row['id'])
            if 1 in ids:raise ValueError('Corpus contains special EOS token: '+row['id'])
            if max(ids)>=4019:raise ValueError('Vocabulary expansion is prohibited')
            unknowns[key]+=ids.count(0);counts[key]+=len(ids)
            docs[key].append((offsets[key],len(ids),row['id'],row['family']))
            np.asarray(ids,dtype='<u2').tofile(handles[key]);offsets[key]+=len(ids)
        batch.clear()
    try:
        for path in files:
            default=path.stem.lower();default={'val':'validation','valid':'validation','dev':'validation'}.get(default,default)
            with path.open() as source:
                for line_no,line in enumerate(source,1):
                    if not line.strip():continue
                    row=json.loads(line);split=str(row.get('split',default)).lower();split={'val':'validation','valid':'validation','dev':'validation'}.get(split,split)
                    kind=ALIASES.get(str(row.get('source_kind','')).lower())
                    if split not in SPLITS or kind is None:raise ValueError(f'{path.name}:{line_no}: split/source_kind required')
                    rid=str(row.get('id',f'{path.name}:{line_no}'))
                    if rid in seen_ids:raise ValueError('Duplicate row id: '+rid)
                    seen_ids.add(rid);text=strip_quote(str(row.get('text','')))
                    if not text:raise ValueError('Empty text: '+rid)
                    family=str(row.get('family_id',row.get('template_family',row.get('family','')))) if kind=='compositional' else ''
                    if kind=='public_domain':
                        group=str(row.get('group_id',row.get('source_group',row.get('chapter_id',row.get('family_id','')))))
                        if group:
                            if group in public_groups and public_groups[group]!=split:raise ValueError('Public-domain group crosses splits: '+group)
                            public_groups[group]=split
                    if family:
                        if family in family_splits and family_splits[family]!=split:raise ValueError('Compositional family crosses splits: '+family)
                        family_splits[family]=split
                    key=hashlib.sha256(' '.join(text.casefold().split()).encode()).hexdigest()
                    if key in seen_text:
                        prior_split=seen_text[key]
                        if prior_split!=split:raise ValueError('Normalized text leaks across splits: '+rid)
                        dedup[(split,kind)]+=1;continue
                    seen_text[key]=split
                    batch.append({'id':rid,'text':text,'split':split,'kind':kind,'family':family})
                    if len(batch)>=256:flush()
        flush()
    finally:
        for handle in handles.values():handle.close()
    result={'status':'COMPLETE','fingerprint':fingerprint,'identity':identity,'vocabulary':4019,'eos_inserted':False,
            'quote_seed_token':3,'streams':{},'composition_family_splits':dict(collections.Counter(family_splits.values())),
            'public_domain_group_splits':dict(collections.Counter(public_groups.values())),
            'token_definition':'Token counts are corpus positions; compositional documents are generated combinations, not independently authored examples.'}
    active_kinds=[kind for kind in KINDS if any(docs[split,kind] for split in SPLITS)]
    if not {'authored','compositional'}.issubset(active_kinds):raise ValueError('Authored and compositional sources required')
    rng=random.Random(seed)
    for split in SPLITS:
        result['streams'][split]={}
        for kind in active_kinds:
            key=(split,kind);rows=docs[key]
            if not rows:raise ValueError('Missing required source/split '+str(key))
            fraction=unknowns[key]/max(counts[key],1)
            if fraction>max_unknown_fraction:raise ValueError(f'{key}: unknown-token rate {fraction:.6f} exceeds bound')
            order=list(range(len(rows)));rng.shuffle(order)
            raw=np.memmap(temporary/f'{split}-{kind}.u16',dtype='<u2',mode='r')
            token_name=f'{split}-{kind}.u16';doc_name=f'{split}-{kind}.documents.npy';id_name=f'{split}-{kind}.documents.jsonl'
            indices=[];position=0
            with (out/token_name).open('wb') as destination,(out/id_name).open('w') as index_file:
                for i in order:
                    start,n,rid,family=rows[i];raw[start:start+n].tofile(destination)
                    indices.append((position,n));index_file.write(json.dumps({'id':rid,'family':family,'start':position,'tokens':n})+'\n');position+=n
            del raw;np.save(out/doc_name,np.asarray(indices,dtype='<u8'))
            result['streams'][split][kind]={'tokens_file':token_name,'tokens_sha256':sha(out/token_name),'documents_file':doc_name,
                'documents_sha256':sha(out/doc_name),'document_index_file':id_name,'documents':len(rows),'unique_corpus_tokens':position,
                'unknown_tokens':unknowns[key],'unknown_fraction':fraction,'same_split_duplicates_skipped':dedup[key]}
    shutil.rmtree(temporary);write_json(manifest_path,result);return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--tokenizer',type=Path,default=RESEARCH/'experiments/simplestories-v2/model-cache');p.add_argument('--seed',type=int,default=20261024);p.add_argument('--max-unknown-fraction',type=float,default=0.)
    a=p.parse_args();r=prepare(a.data,a.output,a.tokenizer,a.seed,a.max_unknown_fraction)
    print(json.dumps({'status':r['status'],'fingerprint':r['fingerprint'],'streams':r['streams']},indent=2))
