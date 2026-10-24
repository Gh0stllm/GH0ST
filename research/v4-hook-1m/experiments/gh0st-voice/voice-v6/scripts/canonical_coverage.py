#!/usr/bin/env python3
"""Measure canonical training tokenizer coverage; never alter corpus split files."""
from pathlib import Path
from collections import Counter,defaultdict
import importlib.util,hashlib,json
BASE=Path(__file__).resolve().parents[1];DATA=BASE/'data'
spec=importlib.util.spec_from_file_location('voice_v6_prepare',BASE/'training/prepare.py')
prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(prepare)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,obj):p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def main():
 rows={s:[json.loads(x)for x in(DATA/f'{s}.jsonl').read_text().splitlines()]for s in ['train','validation','test']}
 sequences={s:[(r,prepare.tokens(r['text']))for r in rs]for s,rs in rows.items()}
 counters={s:Counter(w for _,ws in rs for w in ws)for s,rs in sequences.items()}
 lexical={s:Counter(w.rstrip('.!?')for _,ws in rs for w in ws)for s,rs in sequences.items()}
 def compare(cs,lex=False):
  voice=Counter((w.rstrip('.!?') if lex else w)for r,ws in sequences['train']if r['source_kind']=='original_voice'for w in ws)
  frequency=cs['train'];result={}
  for size in [8192,16384,32768]:
   chosen=[];seen=set()
   for w,n in voice.most_common(2000):
    if n>=2 and len(w.encode('ascii'))<=32:chosen.append(w);seen.add(w)
   for w,n in frequency.most_common():
    if w not in seen and len(w.encode('ascii'))<=32:chosen.append(w);seen.add(w)
    if len(chosen)==size:break
   voc=set(chosen);splits={}
   for s,c in cs.items():
    total=sum(c.values());unknown=sum(n for w,n in c.items()if w not in voc)
    splits[s]={'words':total,'oov_words':unknown,'oov_fraction':unknown/total,'unique_words':len(c),'top_oov':[(w,n)for w,n in c.most_common()if w not in voc][:30]}
   result[str(size)]={'method':'Canonical prepare.tokens; reserve up to2000 repeated training voice types then overall training frequency. Lexical comparison strips final .!? and is hypothetical, not the deployed vocabulary.' if lex else 'Exact prepare.py policy: up to2000 repeated training voice types, then overall training frequency; no held-out fitting.','actual_vocab':len(voc),'splits':splits}
   if not lex and size==8192:actual_set=voc
  return result,actual_set if not lex else None
 coverage,computed=compare(counters);lex_coverage,_=compare(lexical,True)
 vocabulary=json.loads((BASE/'training/encoded/vocabulary.json').read_text());assert set(vocabulary)==computed
 encoded=json.loads((BASE/'training/encoded/manifest.json').read_text());assert encoded['vocabulary_sha256']==sha(BASE/'training/encoded/vocabulary.json')
 statistics={}
 for s,rs in sequences.items():
  assert encoded['source_sha256'][s]==sha(DATA/f'{s}.jsonl')
  domains={k:{'words':0,'unknown':0,'documents':0}for k in ['original_voice','general_adult']}
  for r,ws in rs:
   q=domains[r['source_kind']];q['documents']+=1;q['words']+=len(ws);q['unknown']+=sum(w not in computed for w in ws)
  stat={'documents':len(rs),'words':sum(len(ws)for _,ws in rs),'unknown_words':sum(d['unknown']for d in domains.values()),'domains':domains}
  stat['known_target_fraction']=1-stat['unknown_words']/stat['words'];statistics[s]=stat
  for k in ['documents','words','unknown_words','known_target_fraction']:assert stat[k]==encoded['statistics'][s][k]
 report={'status':'PASS','normalization':encoded['normalization'],'normalizer_sha256':sha(BASE/'training/prepare.py'),'vocabulary_sha256':sha(BASE/'training/encoded/vocabulary.json'),'vocabulary_policy':encoded['vocabulary_fit'],'vocabulary':8192,'source_sha256':encoded['source_sha256'],'statistics':statistics,'runtime_surface_comparisons':coverage,'hypothetical_plain_lexical_comparisons':lex_coverage,'raw_paragraph_files_unchanged':True,'normalization_checks':{s:prepare.tokens(s)for s in ['I know—you do.','new\u202froom','I’m ready.','café table']}}
 write(DATA/'canonical-tokenizer-coverage.json',report)
 write(DATA/'train-runtime-surface-counts.json',counters['train'].most_common());write(DATA/'train-lexical-counts.json',lexical['train'].most_common())
 card=json.loads((DATA/'corpus-report.json').read_text());card['word_count_definition']='Raw source word counts use ASCII word matching; canonical normalized training-token counts are separately reported and authoritative for vocabulary coverage.';card['vocabulary_coverage']=coverage;card['lexical_vocabulary_coverage']=lex_coverage;card['canonical_tokenizer']={k:report[k]for k in ['normalization','normalizer_sha256','vocabulary_sha256','vocabulary_policy','statistics','normalization_checks']};write(DATA/'corpus-report.json',card)
 print(json.dumps({'status':'PASS','statistics':statistics,'normalizer_sha256':report['normalizer_sha256']},indent=2))
if __name__=='__main__':main()
