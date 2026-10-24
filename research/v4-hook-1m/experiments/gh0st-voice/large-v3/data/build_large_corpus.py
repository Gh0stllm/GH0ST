#!/usr/bin/env python3
"""Build a much larger, provenance-labelled ORIGINAL synthetic voice corpus.

Authored monologues and compositional families are counted separately. Whole
composition families stay in one split. No website text is copied, downloaded,
or used as a training record. Generated combinations are not claimed to be
independently authored essays. This is offline training data, not a runtime bank.
"""
from __future__ import annotations
import argparse,collections,hashlib,itertools,json,random,re,time
from pathlib import Path
from transformers import AutoTokenizer

HERE=Path(__file__).resolve().parent
VOICE=HERE.parents[1]
BASE=VOICE.parent/'simplestories-v2'

def digest(b):return hashlib.sha256(b).hexdigest()
def normalized(s):return ' '.join(s.lower().replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"').split())
def words(s):return re.findall(r"[a-z]+(?:'[a-z]+)?",s.lower())
def grams(s,n=12):
 w=words(s);return {tuple(w[i:i+n]) for i in range(max(0,len(w)-n+1))}
def load_jsonl(p):return [json.loads(s) for s in p.read_text().splitlines() if s.strip()]
def source_slots(f):
 if 'sentences' in f:return f['sentences']
 return [f['sentence'+str(i)] for i in range(1,10) if 'sentence'+str(i) in f]
def assign(items, seed, minimum=1):
 items=list(items);random.Random(seed).shuffle(items);n=max(minimum,round(.1*len(items)))
 return {x:'test' if i<n else 'validation' if i<2*n else 'train' for i,x in enumerate(items)}

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=HERE/'corpus');p.add_argument('--seed',type=int,default=20261025);p.add_argument('--max-combinations',type=int,default=1024);a=p.parse_args()
 a.output.mkdir(parents=True,exist_ok=True)
 if (a.output/'manifest.json').exists():raise ValueError('Never overwrite a completed corpus; choose a new output')
 tok=AutoTokenizer.from_pretrained(BASE/'model-cache',local_files_only=True,trust_remote_code=False)
 tok.model_max_length=1000000
 sources={};authored=[];families=[];seen=set();rejected=[]
 for pth in sorted(HERE.glob('voice-seeds-*.jsonl')):
  sources[pth.name]={'sha256':digest(pth.read_bytes()),'bytes':pth.stat().st_size}
  for row in load_jsonl(pth):
   text=normalized(row['text']).strip('"').strip();ident='new-'+pth.stem+'-'+str(row['id'])
   if text in seen:rejected.append({'id':ident,'reason':'exact duplicate authored text'});continue
   seen.add(text);authored.append({'id':ident,'family_id':ident,'text':text,'source_kind':'authored','source_file':pth.name})
 previous=VOICE/'data/expanded-v2'
 for split in ['train','validation','test']:
  pth=previous/(split+'.jsonl');sources[str(pth.relative_to(VOICE))]={'sha256':digest(pth.read_bytes()),'bytes':pth.stat().st_size}
  for row in load_jsonl(pth):
   text=normalized(row['text']).strip('"').strip();ident='prior-'+str(row['id'])
   if text in seen:rejected.append({'id':ident,'reason':'exact duplicate authored text'});continue
   seen.add(text);authored.append({'id':ident,'family_id':ident,'text':text,'source_kind':'authored','source_file':str(pth.relative_to(VOICE)),'split':split})
 for pth in sorted(HERE.glob('composition-families-*.json')):
  sources[pth.name]={'sha256':digest(pth.read_bytes()),'bytes':pth.stat().st_size};data=json.loads(pth.read_text());rows=data.get('families',[]) if isinstance(data,dict) else data
  for f in rows:
   ident=pth.stem+'-'+str(f['id']);slots=[[normalized(v) for v in slot] for slot in source_slots(f)]
   assert 3<=len(slots)<=6,(ident,'sentence slots')
   assert all(len(slot)>=3 and len(slot)==len(set(slot)) for slot in slots),(ident,'unique alternatives')
   assert all(v and v[-1] in '.?!' for slot in slots for v in slot),(ident,'sentence punctuation')
   families.append({'id':ident,'theme':f.get('theme',''),'anchor':f.get('anchor',''),'slots':slots,'source_file':pth.name})
 assert len(families)>=50,'Need the complete two independently authored family packs'
 assert len({f['id'] for f in families})==len(families)
 author_assignment=assign([r['id'] for r in authored if 'split' not in r],a.seed)
 family_assignment=assign([r['id'] for r in families],a.seed+1)
 stats={s:{'documents':0,'tokens':0,'words':0,'authored_documents':0,'compositional_documents':0,'authored_tokens':0,'compositional_tokens':0,'public_domain_documents':0,'public_domain_tokens':0} for s in ['train','validation','test']}
 buffers={s:[] for s in stats};hashes={s:set() for s in stats};family_stats=[];seen_by_split={};begin=time.monotonic()
 def add(row):
  text=row['text'];key=digest(text.encode())
  if key in seen_by_split:
   rejected.append({'id':row['id'],'reason':'exact duplicate generated text','existing_split':seen_by_split[key]});return
  ids=tok.encode(text,add_special_tokens=False)
  assert ids and 0 not in ids,(row['id'],'UNK')
  assert 15<=len(words(text))<=(350 if row['source_kind']=='public_domain' else 170),(row['id'],len(words(text)))
  s=row['split'];kind=row['source_kind'];row.update({'text_sha256':key,'tokens':len(ids),'words':len(words(text))});seen_by_split[key]=s;hashes[s].add(key)
  buffers[s].append(json.dumps(row,ensure_ascii=False));stats[s]['documents']+=1;stats[s]['tokens']+=len(ids);stats[s]['words']+=row['words'];stats[s][kind+'_documents']+=1;stats[s][kind+'_tokens']+=len(ids)
 for row in authored:
  row['split']=row.get('split',author_assignment.get(row['id']));add(row)
 for f in families:
  split=family_assignment[f['id']];sizes=[len(x) for x in f['slots']];total=1
  for n in sizes:total*=n
  indices=list(itertools.product(*(range(n) for n in sizes)))
  random.Random(str(a.seed)+f['id']).shuffle(indices);selected=indices[:a.max_combinations]
  family_stats.append({'id':f['id'],'split':split,'slot_sizes':sizes,'possible_combinations':total,'requested_combinations':len(selected),'source_file':f['source_file'],'theme':f['theme']})
  for ix,combo in enumerate(selected):
   text=' '.join(slot[i] for slot,i in zip(f['slots'],combo))
   add({'id':f['id']+'-'+str(ix).zfill(4),'family_id':f['id'],'split':split,'source_kind':'compositional','source_file':f['source_file'],'choices':list(combo),'text':text})
 foundation=HERE/'foundation/samples.jsonl'
 if foundation.exists():
  sources['foundation/samples.jsonl']={'sha256':digest(foundation.read_bytes()),'bytes':foundation.stat().st_size}
  for row in load_jsonl(foundation):add(row)
 for s in stats:
  out=a.output/(s+'.jsonl');out.write_text('\n'.join(buffers[s])+'\n');sources[out.name]={'sha256':digest(out.read_bytes()),'bytes':out.stat().st_size}
 assert all(not(hashes[a]&hashes[b]) for a,b in [('train','validation'),('train','test'),('validation','test')])
 # Evaluate near-overlap on independent authored documents. Reused sentences within
 # a single composition family are expected and disclosed, never spread across splits.
 authored_grams={s:set() for s in stats}
 for row in authored:authored_grams[row['split']]|=grams(row['text'])
 overlaps={a+'_'+b:len(authored_grams[a]&authored_grams[b]) for a,b in [('train','validation'),('train','test'),('validation','test')]}
 manifest={'schema_version':1,'purpose':'Offline synthetic GH0ST voice training only; not a runtime phrase bank.','public_domain_foundation':'Public-domain historical prose is attributed per sample and keeps original source files and licenses. Used as a small separate mixture, not represented as original GH0ST writing.', 'originality_scope':'Authored seed documents are original synthetic writing. Compositional documents are combinations of independently authored sentence alternatives. Do not describe every combination as independently authored. No Truth Terminal website passages were copied.','seed':a.seed,'tokenizer_sha256':digest((BASE/'model-cache/tokenizer.json').read_bytes()),'vocab_size':4019,'total_documents':sum(x['documents'] for x in stats.values()),'total_tokens':sum(x['tokens'] for x in stats.values()),'stats':stats,'authored_seed_documents':len(authored),'composition_family_count':len(families),'families':family_stats,'family_disjoint':True,'exact_text_split_overlap':0,'authored_12gram_split_overlap':overlaps,'sources':sources,'rejected':rejected,'elapsed_seconds':time.monotonic()-begin,'limitations':['Compositional examples share sentence structures inside each family.','Corpus size is not equivalent to semantic diversity or proof of output quality.','Heldout families test extrapolation beyond known sentence banks.']}
 (a.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print(json.dumps({k:manifest[k] for k in ['total_documents','total_tokens','stats','authored_seed_documents','composition_family_count','authored_12gram_split_overlap','elapsed_seconds']}))
if __name__=='__main__':main()
