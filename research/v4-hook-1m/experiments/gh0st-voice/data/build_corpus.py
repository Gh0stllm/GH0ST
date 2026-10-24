"""Prepare original GH0ST monologues. No web page text is training data."""
import hashlib,json,random
from pathlib import Path
from transformers import AutoTokenizer
ROOT=Path(__file__).resolve().parent
texts=[p.strip() for p in (ROOT/'original-passages.txt').read_text().split('\n\n') if p.strip()]
assert len(texts)==len(set(texts))
order=list(range(len(texts)));random.Random(20261024).shuffle(order)
assign={i:('test' if n<12 else 'validation' if n<24 else 'train') for n,i in enumerate(order)}
t=AutoTokenizer.from_pretrained(ROOT.parents[1]/'simplestories-v2/model-cache',local_files_only=True)
rows=[]
for i,p in enumerate(texts):
 text='"'+p+'"'
 ids=t.encode(text,add_special_tokens=False)
 assert 0 not in ids
 rows.append({'id':f'gh0st-original-{i+1:03}','split':assign[i],'text':text,'tokens':len(ids),'sha256':hashlib.sha256(text.encode()).hexdigest()})
for split in ['train','validation','test']:
 (ROOT/(split+'.jsonl')).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows if r['split']==split))
(ROOT/'corpus.json').write_text(json.dumps({'schema':1,'provenance':'Original synthetic monologues authored for GH0ST voice experiment on 2026-10-24. Website used only for high-level style analysis; no site passages copied into training.','not_instruction_data':True,'exact_duplicates':len(texts)-len(set(texts)),'split_seed':20261024,'tokenizer':'Unmodified pinned SimpleStories V2 WordPiece4019','splits':{s:{'documents':sum(r['split']==s for r in rows),'tokens':sum(r['tokens'] for r in rows if r['split']==s)} for s in ['train','validation','test']},'source_sha256':hashlib.sha256((ROOT/'original-passages.txt').read_bytes()).hexdigest(),'rows':rows},indent=2)+'\n')
print(json.dumps({'documents':len(rows),'splits':{s:sum(r['split']==s for r in rows) for s in ['train','validation','test']},'tokens':sum(r['tokens'] for r in rows),'longest':max(r['tokens'] for r in rows)}))
