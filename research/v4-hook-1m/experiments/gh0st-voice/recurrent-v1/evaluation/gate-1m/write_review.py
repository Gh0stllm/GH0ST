import hashlib,json
from pathlib import Path
p=Path(__file__).resolve().parent
raw=p/'raw-outputs.json';d=json.loads(raw.read_text())
reasons=[
 ('Incomplete clauses and noun substitutions','a tiny named / a crumpled breath','No sustained actors or objective'),
 ('Malformed attachment and category substitutions','she was a little waterfall','Starts grammatical then loses reference'),
 ('Agreement and finite-verb errors','an girl / he see the world','Jumps between girl, world, price, pool'),
 ('Missing predicate and agreement errors','they were dreams / the cave were','No interpretable continuing episode'),
 ('Malformed transition and noun phrases','determination an day','Short clauses interleaved with disconnected fragments'),
 ('Agreement, duplication and missing predicate','she had was crystals','Girl, ship and truth introduced without causal relation'),
 ('Agreement and attachment errors','an people / a old old place','Scattered small clauses without paragraph continuity'),
 ('Repeated incomplete clauses','the most to find it','Random topic changes between room, garden, map'),
 ('Sporadic correct fragments amid severe syntax errors','the market you had you','Market phrase does not create consistent first-person voice'),
 ('Broken clause formation','her does. moment it had','No stable speaker or scene'),
 ('Article/agreement and missing verb errors','an people / the heard were boy','Unrelated concepts stitched without continuity'),
 ('Malformed predicate and pronoun use','the should find / sky were a weeds','No stable first-person identity or causal paragraph'),
]
rows=[]
for r,reason in zip(d['outputs'],reasons):
 rows.append({'seed':r['seed'],'temperature_q10':r['temperature_q10'],'release_quality':False,'grammar':reason[0],'example':reason[1],'continuity_and_voice':reason[2]})
report={'status':'NOT_RELEASE_QUALITY_CONTINUE_HEALTHY_EARLY_TRAINING','raw_sha256':hashlib.sha256(raw.read_bytes()).hexdigest(),'weights_sha256':d['source']['weights_sha256'],
 'review_scope':'All 12 unmodified 128-word FP32 streams reviewed. Separate parent-run samples use Torch random draws; these use contract-style Keccak draws. Both expose poor early grammar.',
 'quality_passes':0,'reviewed_outputs':len(rows),'outputs':rows,
 'training_signal':'Independent output remains weak, but all three heldout source losses improve monotonically through 1M; no hidden saturation; all 8191 tree nodes trained. Recommend continuing authorized 4M before judging learnability.',
 'metrics_caveat':'All 12 have zero repeated 4grams and zero 12-word or complete 5-plus-word training matches. This does not establish coherent meaning or novelty; even a random word stream can score zero.',
 'decode_recommendation':'No production decoder selected at 1M. T512 has somewhat longer local chunks but still wrong grammar; T768/1024 add syntactic noise. Reassess same fixed seeds after 4M.'}
(p/'human-review.json').write_text(json.dumps(report,indent=2)+'\n')
