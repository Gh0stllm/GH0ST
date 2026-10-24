"""Check exact12-token spans against every supplied training source, within documents."""
from pathlib import Path
import collections,hashlib,json
import numpy as np
P=Path(__file__).resolve().parent;CACHE=P.parents[1]/'cache/grammar-bpe'
results=json.loads((P/'results.json').read_text());manifest=json.loads((CACHE/'manifest.json').read_text())
lookup=collections.defaultdict(list);coverage={};matches=collections.Counter();N=12;B=1000003;MASK=(1<<64)-1
for m in results['models']:
    for o in m['outputs']:
        key=m['name']+'/'+o['setting']+'/'+str(o['seed']);coverage[key]=set();ids=o['tokens']
        for i in range(len(ids)-N+1):
            value=0
            for t in ids[i:i+N]:value=(value*B+t)&MASK
            lookup[value].append((key,i,tuple(ids[i:i+N])))
wanted=np.asarray(list(lookup),dtype=np.uint64);sources={}
for kind,row in manifest['streams']['train'].items():
    path=CACHE/row['tokens_file'];actual=hashlib.sha256(path.read_bytes()).hexdigest();assert actual==row['tokens_sha256']
    a=np.memmap(path,dtype='<u2',mode='r');docs=np.load(CACHE/row['documents_file'],mmap_mode='r');length=len(a)-N+1
    h=np.zeros(length,dtype=np.uint64)
    for j in range(N):h=h*np.uint64(B)+a[j:j+length].astype(np.uint64)
    for start in np.flatnonzero(np.isin(h,wanted)):
        doc=int(np.searchsorted(docs[:,0],start,side='right'))-1
        if start+N>int(docs[doc,0]+docs[doc,1]):continue
        span=tuple(map(int,a[start:start+N]))
        for key,pos,target in lookup[int(h[start])]:
            if span==target:coverage[key].update(range(pos,pos+N));matches[key,kind]+=1
    sources[kind]={'tokens':len(a),'sha256':actual,'documents':len(docs)}
out={'scope':'Exact12-token overlap with all supplied training streams, including authored/composition/public-domain/replay. Matches cannot cross source-document boundaries. Does not cover undisclosed original pretraining data.',
     'cache_fingerprint':manifest['fingerprint'],'sources':sources,'outputs':[{'id':key,'matched_token_count':len(v),'coverage_fraction':len(v)/128,'matches_by_source':{s:n for (k,s),n in matches.items() if k==key}} for key,v in coverage.items()]}
(P/'copy-overlap.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out['outputs'],indent=2))
