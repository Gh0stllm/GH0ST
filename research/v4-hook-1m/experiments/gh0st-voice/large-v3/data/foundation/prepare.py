"""Clean public-domain prose and create nonoverlapping grouped samples."""
from pathlib import Path
import hashlib,json,re,random,unicodedata,collections
from transformers import AutoTokenizer
ROOT=Path(__file__).resolve().parent
BASE=ROOT.parents[3]/'simplestories-v2'
tok=AutoTokenizer.from_pretrained(BASE/'model-cache',local_files_only=True,trust_remote_code=False)
manifest=json.loads((ROOT/'source-manifest.json').read_text());rows=[];summary=[];seen=set()
def norm(s):
 s=s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"').replace('—',' - ').replace('–',' - ').replace('_','')
 return ' '.join(unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower().split())
# Old books can contain slurs or demeaning historical racial labels. Exclude those paragraphs.
excluded=re.compile(r'\b(?:nigger\w*|negro\w*|mulatto\w*|hottentot\w*|savage\w*|heathen\w*|chink\w*|kike\w*|coon\w*)\b',re.I)
for book in manifest['books']:
 raw=(ROOT/'raw'/f"pg{book['id']}.txt").read_text(encoding='utf-8-sig')
 a=re.search(r'\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*',raw,re.I|re.S)
 z=re.search(r'\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK',raw,re.I)
 assert a and z and a.end()<z.start(),book['id']
 body=raw[a.end():z.start()];paras=re.split(r'\n\s*\n',body);kept=[];reasons=collections.Counter()
 for para_idx,p in enumerate(paras):
  p=norm(p)
  if not p or len(p.split())<25:reasons['too_short_or_heading']+=1;continue
  if excluded.search(p):reasons['excluded_historical_language']+=1;continue
  if 'project gutenberg' in p or 'http' in p or '[footnote' in p:reasons['metadata_or_footnote']+=1;continue
  sent=re.split(r'(?<=[.!?])\s+',p);chunks=[];buf=[]
  for s in sent:
   if len((' '.join(buf+[s])).split())>160 and buf:chunks.append(' '.join(buf));buf=[]
   if len(s.split())>200:reasons['very_long_sentence']+=1;continue
   buf.append(s)
  if buf:chunks.append(' '.join(buf))
  for j,c in enumerate(chunks):
   if len(c.split())<25:continue
   key=hashlib.sha256(c.encode()).hexdigest()
   if key in seen:reasons['duplicate']+=1;continue
   ids=tok.encode(c,add_special_tokens=False)
   if 0 in ids:reasons['unknown_token']+=1;continue
   seen.add(key);kept.append({'id':f"pd-{book['id']}-{para_idx}-{j}",'family_id':f"pd-{book['id']}-group-{para_idx//15}",'source_kind':'public_domain','text':c,'source_file':f"foundation/raw/pg{book['id']}.txt",'book_id':book['id'],'book_title':book['title'],'author':book['author'],'paragraph_index':para_idx,'text_sha256':key,'tokens':len(ids),'words':len(c.split())})
 groups=sorted({r['family_id'] for r in kept});random.Random(20261026+book['id']).shuffle(groups);n=max(1,round(.1*len(groups)))
 assign={x:'test' if i<n else 'validation' if i<2*n else 'train' for i,x in enumerate(groups)}
 for r in kept:r['split']=assign[r['family_id']]
 rows.extend(kept);summary.append({'book_id':book['id'],'kept_samples':len(kept),'kept_tokens':sum(r['tokens'] for r in kept),'kept_words':sum(r['words'] for r in kept),'groups':len(groups),'excluded':dict(reasons)})
(ROOT/'samples.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
report={'books':summary,'total_samples':len(rows),'total_tokens':sum(r['tokens'] for r in rows),'total_words':sum(r['words'] for r in rows),'sampling_role':'10 percent foundation prose, separate from authored GH0ST voice and offline compositions.','splits':dict(collections.Counter(r['split'] for r in rows)),'source_manifest_sha256':hashlib.sha256((ROOT/'source-manifest.json').read_bytes()).hexdigest()}
(ROOT/'cleaning-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
