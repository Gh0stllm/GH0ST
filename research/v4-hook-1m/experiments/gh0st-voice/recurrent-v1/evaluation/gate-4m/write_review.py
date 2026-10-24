import json,hashlib
from pathlib import Path
p=Path(__file__).resolve().parent
raw=p/'raw-outputs.json';d=json.loads(raw.read_text())
reasons=[
('Predicate/category failures and repeated semantic forms','each pirate was spark / their stories of their stories','No coherent continuing actor; first-person fragments conflict with third-person scene'),
('Auxiliary/agreement failures','they could back their courage / creativity are not fall','Some complete phrases but no intelligible episode'),
('Agreement and modal failures','the others was bright / he would not the garden','Shifts actors and objects without purpose'),
('Malformed noun phrases and conjunctions','a boy named a girl named his sister','Several recognizable sentence starts without completion or stable referents'),
('Frequent local syntactic failures','each balloons / for do happy','Short clauses fail to build a consistent event'),
('Missing predicates and malformed attachments','above the most key / they all him uncovered him','No sustained speaker or context'),
('Agreement and nested-clause failures','you has have / a useful about that magical world','Scattered plausible fragments, no stable causal paragraph'),
('Agreement and conjunction failures','a opinion / every plant do revenge','Repeated vocabulary does not form coherent goals'),
('Tense and agreement failures','i had always save adventure / ground treasure were','First-person phrase does not establish an ongoing voice'),
('Broken finite clauses','some going sleep is not go / the knight named their dreams','Semantic scene changes too quickly to follow'),
('Article and tense failures','an word / a perfect treasure were','No intelligible continuous narrative'),
('Category and modal failures','leo closed closer / it is not see','Locally recognizable words but no coherent original persona')]
rows=[]
for r,(grammar,example,continuity) in zip(d['outputs'],reasons):
 rows.append({'seed':r['seed'],'temperature_q10':r['temperature_q10'],'release_quality':False,'grammar':grammar,'example':example,'continuity_and_voice':continuity})
h=Path(__file__).resolve().parents[1]/'heldout-4m/raw-outputs.json';held=json.loads(h.read_text())
controls=[]
for t in [512,768]:
 for seed in [0,42]:
  rr=[r for r in held['outputs'] if r['temperature_q10']==t and r['seed']==seed];a,b=[r['token_ids'] for r in rr];n=0
  for x,y in zip(a[::-1],b[::-1]):
   if x!=y:break
   n+=1
  controls.append({'temperature_q10':t,'seed':seed,'length':len(a),'same_position_tokens':sum(x==y for x,y in zip(a,b)),'identical_suffix_words':n})
report={'status':'NOT_RELEASE_QUALITY','raw_sha256':hashlib.sha256(raw.read_bytes()).hexdigest(),'weights_sha256':d['source']['weights_sha256'],
 'review_scope':'All 12 raw 128-word streams and all 8 held-out-prefix 64-word continuations reviewed. No outputs rewritten or filtered.',
 'quality_passes':0,'reviewed_free_outputs':12,'reviewed_heldout_outputs':8,'outputs':rows,
 'learning_assessment':'All source losses continued down through 4M. Local word order improved versus 1M; free-run hidden saturation remained zero. This is not evidence of a completed voice or a stalled optimizer. Additional controlled training can test underfitting; recurrence or decoding improvements remain separate hypotheses.',
 'heldout_assessment':'All 8 continuations lose the supplied first-person/attention-or-joke setup and drift into malformed generic stories. At seed42/T768 two different prefixes produce identical last61 of64 generated words. This demonstrates weak output-level context retention for that control, not proof that hidden states are identical or that context is disconnected.',
 'prefix_controls':controls,
 'copy_assessment':'No normalized 12-word training matches among these 20 outputs. No complete 5-plus-word sentence matches. This is not a semantic novelty proof.',
 'next_gate':'No production decoder selected. Keep the same fixed probes for any extension or gated-recurrence comparison. Quantization and actual hook gas remain independent checks.'}
(p/'human-review.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'quality_passes':0,'prefix_controls':controls}))
