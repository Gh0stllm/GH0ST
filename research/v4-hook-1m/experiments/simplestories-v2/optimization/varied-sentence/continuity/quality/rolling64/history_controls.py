"""Same-seed controls; no sampling, training, or on-chain state is modified."""
from pathlib import Path
import hashlib
import json
import numpy as np
from build_reference import scope, hashes, tokenizer, sampled_token

HERE=Path(__file__).resolve().parent
fixture=json.loads((HERE/'rolling64-140turn-reference.json').read_text())
s=scope()
seed=fixture['seed']
draws=json.loads((HERE.parent/'stream-draws-256.json').read_text())[seed]
alternate=tokenizer.encode('snow',add_special_tokens=False)
assert len(alternate)==1
rows=[];logits_rows=[]
for position in [31,63,64,95,127,128,149]:
    tokens=fixture['processed_tokens'][:position+1]
    baseline=np.asarray(s['forward'](tokens)['logits'],dtype=np.int64)
    changed=tokens.copy();changed[-1]=alternate[0]
    controlled=np.asarray(s['forward'](changed)['logits'],dtype=np.int64)
    sampled=[]
    for logits in [baseline,controlled]:
        ids=np.argsort(-logits,kind='stable');ids=ids[ids!=0][:64]
        sampled.append(sampled_token((ids.astype(np.uint16),logits[ids]),int(draws[position],16),8,800))
    rows.append({'absolute_position':position,'change':'Replace only most recent processed input with snow; preserve all earlier input IDs and the sampling draw.',
        'original_token_id':tokens[-1],'replacement_token_id':alternate[0],
        'original_token':tokenizer.decode([tokens[-1]]),'replacement_token':'snow',
        'full_logits_differ':not np.array_equal(baseline,controlled),
        'baseline_next_token':sampled[0],'controlled_next_token':sampled[1],
        'baseline_next_text':tokenizer.decode([sampled[0]]),'controlled_next_text':tokenizer.decode([sampled[1]]),
        'sampled_token_differs':sampled[0]!=sampled[1]})
    logits_rows.extend([baseline,controlled])
all_hashes=hashes(logits_rows)
for i,row in enumerate(rows):
    row['baseline_logit_hash']=all_hashes[2*i];row['controlled_logit_hash']=all_hashes[2*i+1]
result={'scope':'Offline exact Q12 rolling64 same-seed, same-draw history controls. These controlled contexts are diagnostic, not generated story continuations.',
    'reference_sha256':hashlib.sha256((HERE/'rolling64-140turn-reference.json').read_bytes()).hexdigest(),
    'rows':rows,'full_logits_differ_count':sum(x['full_logits_differ'] for x in rows),
    'sampled_token_differs_count':sum(x['sampled_token_differs'] for x in rows)}
(HERE/'history-controls.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='rows'},indent=2))
