#!/usr/bin/env python3
"""Package manually authored monologues and audit overlap. No text generation."""
from pathlib import Path
from collections import Counter,defaultdict
import hashlib,importlib.util,json,re,statistics
HERE=Path(__file__).resolve().parent;V6=HERE.parents[1]
spec=importlib.util.spec_from_file_location('v6_prepare',V6/'training/prepare.py');prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(prepare)
def sha(b):return hashlib.sha256(b).hexdigest()
def lex(text):return [w.rstrip('.!?')for w in prepare.tokens(text)]
def grams(ws,n):return (tuple(ws[i:i+n])for i in range(max(0,len(ws)-n+1)))
def main():
 raw=(HERE/'authored-passages.tsv').read_text();rows=[];word_lists=[]
 for line in raw.splitlines():
  number,text=line.split('\t',1);identity=f'expansion-v1-{int(number):03d}'
  rows.append({'id':identity,'group_id':identity,'split':'train','source_kind':'original_voice','text':text})
  word_lists.append(lex(text))
 assert len(rows)==120 and len({r['id']for r in rows})==120
 lengths=[len(prepare.tokens(r['text']))for r in rows]
 bad_lengths=[{'id':r['id'],'words':n}for r,n in zip(rows,lengths)if not 80<=n<=130]
 assert not bad_lengths,bad_lengths
 exact={};duplicate=[];window12=defaultdict(set);internal4=Counter();internal8=defaultdict(set)
 for row,ws in zip(rows,word_lists):
  key=' '.join(ws)
  if key in exact:duplicate.append([exact[key],row['id']])
  exact[key]=row['id']
  for g in grams(ws,12):window12[g].add(row['id'])
  internal4.update(set(grams(ws,4)))
  for g in grams(ws,8):internal8[g].add(row['id'])
 overlaps=[];exact_existing=[];corpus_hashes={};source_rows=0;source_words=0
 for split in ['train','validation','test']:
  path=V6/'data'/f'{split}.jsonl';corpus_hashes[split]=sha(path.read_bytes())
  for line in path.read_text().splitlines():
   old=json.loads(line);ws=lex(old['text']);source_rows+=1;source_words+=len(ws);key=' '.join(ws)
   if key in exact:exact_existing.append({'new':exact[key],'source':old['id'],'split':split})
   found=set(g for g in grams(ws,12)if g in window12)
   for g in sorted(found):overlaps.append({'new':sorted(window12[g]),'source':old['id'],'split':split,'words':' '.join(g)})
 internal_repeated=[{'words':' '.join(g),'documents':sorted(ids)}for g,ids in internal8.items()if len(ids)>1]
 missing_first=[r['id']for r in rows if not re.search(r'\b(?:I|my|me|mine|myself)\b',r['text'],re.I)]
 forbidden=[]
 patterns=[r'https?://',r'\b(?:nfp_|ghp_|github_pat_|sk-[A-Za-z0-9]{24,})',r'0x[a-fA-F0-9]{64}',r'\bTruth Terminal\b',r'\bGOAT\b']
 for row in rows:
  for pattern in patterns:
   if re.search(pattern,row['text'],re.I):forbidden.append({'id':row['id'],'pattern':pattern})
 out=''.join(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n'for r in rows);(HERE/'train.jsonl').write_text(out)
 frozen=json.loads((V6/'training/encoded/manifest.json').read_text())['source_sha256'];assert corpus_hashes==frozen
 report={'status':'PASS'if not(duplicate or exact_existing or overlaps or internal_repeated or missing_first or forbidden)else'REVIEW','authorship':'120 manually written independent passages. Script assigns identifiers and checks text; no templates or combinatorial assembly.','purpose':'Separate training-only original voice adaptation candidate; no model quality result.','records':len(rows),'unique_groups':len({r['group_id']for r in rows}),'split':'train','source_kind':'original_voice','canonical_words':sum(lengths),'word_length':{'min':min(lengths),'max':max(lengths),'mean':statistics.mean(lengths),'outside_80_130':bad_lengths},'duplicate_new_paragraphs':duplicate,'exact_original_corpus_matches':exact_existing,'twelve_word_original_corpus_overlap':overlaps,'cross_paragraph_repeated_eightgrams':internal_repeated,'top_repeated_fourgrams_by_document_count':[{'words':' '.join(g),'documents':n}for g,n in internal4.most_common(20)],'missing_first_person':missing_first,'forbidden_marker_matches':forbidden,'compared_original_corpus':{'records':source_rows,'words':source_words,'source_sha256':corpus_hashes},'frozen_original_corpus_unchanged':True,'evaluation_prompts_read':False,'normalizer_sha256':sha((V6/'training/prepare.py').read_bytes()),'files':{'authored-passages.tsv':{'sha256':sha((HERE/'authored-passages.tsv').read_bytes()),'bytes':(HERE/'authored-passages.tsv').stat().st_size},'train.jsonl':{'sha256':sha((HERE/'train.jsonl').read_bytes()),'bytes':(HERE/'train.jsonl').stat().st_size}}}
 vocabulary=set(json.loads((V6/'training/encoded/vocabulary.json').read_text()));unknown=sum(w not in vocabulary for r in rows for w in prepare.tokens(r['text']))
 report['current_frozen_vocabulary_coverage']={'words':sum(lengths),'unknown_targets':unknown,'known_fraction':1-unknown/sum(lengths),'note':'Measured against existing vocabulary only; no vocabulary was changed.'}
 (HERE/'audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
