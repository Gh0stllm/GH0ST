"""Encode the short causal training curriculum without inference-time rules."""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('parser',HERE.parent/'voice-v8/training/prepare.py')
parser=importlib.util.module_from_spec(spec);spec.loader.exec_module(parser)
sha=lambda b:hashlib.sha256(b).hexdigest()


def main():
    out=HERE/'encoded-stage2';assert not out.exists();out.mkdir()
    vb=(HERE/'encoded/vocabulary.json').read_bytes();vocab=json.loads(vb);index={w:i for i,w in enumerate(vocab)}
    (out/'vocabulary.json').write_bytes(vb)
    (out/'vocabulary.bin').write_bytes(b''.join(w.encode().ljust(32,b'\0')for w in vocab))
    counts=[0]*8192;report={};hashes={}
    for split in ('train','validation','test'):
        rows=[];original=[];sums=collections.Counter();unk=collections.Counter()
        for source in ('data','data-short','curriculum'):
            data=(HERE/source/(split+'.jsonl')).read_bytes();hashes[source+'/'+split+'.jsonl']=sha(data)
            for line in data.decode().splitlines():
                r=json.loads(line);words,punct=parser.parse(r['text']);tokens=[index.get(w,8193)for w in words]
                row={'id':source+':'+r['id'],'group_id':source+':'+r['family'],'text':r['text'],
                     'token_ids':tokens,'punctuation':punct,'domain':0,
                     'kind':'curriculum'if source=='curriculum'else'original'}
                # The hard evaluation contains authored holdouts only. Shared
                # curriculum clauses are not a semantic generalization test.
                if source=='curriculum' and split!='train':continue
                if source!='curriculum':original.append(row)
                rows.append(row)
                sums[source]+=len(tokens)
                unk.update(w for w,t in zip(words,tokens)if t==8193)
        if split=='train':
            # Explicit sampling weights: each of140 authored training episodes
            # occurs40 times alongside28,800 compositional training examples.
            for copy in range(1,40):
                rows.extend(dict(r,id=r['id']+f':oversample{copy}')for r in original)
            # Continue beyond a six-sentence endpoint without zeroing state.
            by_family=collections.defaultdict(list)
            for row in rows:
                if row['kind']=='curriculum':by_family[row['group_id']].append(row)
            for family,items in by_family.items():
                for i in range(0,len(items),4):
                    a,b=items[i],items[(i+1)%len(items)]
                    rows.append({'id':'chain:'+a['id']+':'+b['id'],'group_id':family,'text':a['text']+' '+b['text'],
                                 'token_ids':a['token_ids']+b['token_ids'],
                                 'punctuation':a['punctuation']+b['punctuation'],'domain':0,'kind':'curriculum'})
            for r in rows:
                for t in r['token_ids']:
                    if t<8192:counts[t]+=1
        raw=''.join(json.dumps(r)+'\n'for r in rows).encode();(out/(split+'.jsonl')).write_bytes(raw)
        report[split]={'rows':len(rows),'effective_words':sum(len(r['token_ids'])for r in rows),
                       'unique_source_words':dict(sums),'oov_source_occurrences':sum(unk.values()),
                       'oov_terms':dict(unk),'sha256':sha(raw)}
    (out/'counts.json').write_text(json.dumps({'all':counts})+'\n')
    manifest={'scope':'LOCAL_NEURAL_TRAINING_ONLY','statistics':report,'vocabulary_sha256':sha(vb),
              'source_sha256':hashes,'curriculum_distinct_clauses':288,
              'combinations_are_not_independently_authored_stories':True,
              'authored_oversampling_factor':40,'validation_and_test_authored_only':True,
              'runtime_templates_or_repair':False,'mainnet_actions':0}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({s:{k:v for k,v in d.items()if k not in('oov_terms',)}for s,d in report.items()}))


if __name__=='__main__':main()
