"""Versioned expansion. Preserves initial splits; never changes pilot data."""
import hashlib,json,random
from pathlib import Path
from transformers import AutoTokenizer
R=Path(__file__).resolve().parent
out=R/'expanded-v2';out.mkdir(exist_ok=True)
rows=[json.loads(l) for s in ['train','validation','test'] for l in (R/(s+'.jsonl')).read_text().splitlines()]
for r in rows:r['source']='original-passages.txt'
t=AutoTokenizer.from_pretrained(R.parents[1]/'simplestories-v2/model-cache',local_files_only=True)
for name in ['root-expansion-passages.txt','expansion-original-passages.txt']:
 texts=[p.strip() for p in (R/name).read_text().split('\n\n') if p.strip()]
 order=list(range(len(texts)));random.Random('20261024:'+name).shuffle(order)
 heldout=max(1,len(texts)//10)
 split={i:'test' if n<heldout else 'validation' if n<2*heldout else 'train' for n,i in enumerate(order)}
 for i,p in enumerate(texts):
  text='"'+p+'"';ids=t.encode(text,add_special_tokens=False)
  assert 0 not in ids
  rows.append({'id':name.split('.')[0]+f'-{i+1:03}','split':split[i],'text':text,'tokens':len(ids),'source':name,'sha256':hashlib.sha256(text.encode()).hexdigest()})
assert len(rows)==len({r['text'] for r in rows})
for s in ['train','validation','test']:
 (out/(s+'.jsonl')).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows if r['split']==s))
manifest={'provenance':'Original synthetic GH0ST writing. No website text copied. Preserves original112 document splits and stratifies each additional source independently.','documents':len(rows),'splits':{s:{'documents':sum(r['split']==s for r in rows),'tokens':sum(r['tokens'] for r in rows if r['split']==s)} for s in ['train','validation','test']},'files':{n:hashlib.sha256((R/n).read_bytes()).hexdigest() for n in ['original-passages.txt','root-expansion-passages.txt','expansion-original-passages.txt']},'rows':rows}
(out/'corpus.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({k:v for k,v in manifest.items() if k not in ['rows','files']}))
