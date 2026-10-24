"""Regroup verified per-token inference into the final gas-bounded turn policy."""
from pathlib import Path
import hashlib
import json
import sys

OUT=Path(__file__).resolve().parent
sys.path.insert(0,str(OUT.parent))
from continuity_screen import tokenizer

source_path=OUT/'relative64-2060turn-reference.json'
source=json.loads(source_path.read_text())
tokens=source['generated_tokens'];processed=source['processed_tokens'];hashes=source['every_step_logit_hash']
assert processed==source['initial_prompt_ids']+tokens[:-1]
turns=[];position=0
while len(turns)<2060:
    before=position;maximum=2 if before<=26 else 1;output=[]
    for _ in range(maximum):
        token=tokens[position];position+=1;output.append(token)
        if token in {1,2,15,30}:break
    turns.append({'turn':len(turns)+1,'seed':source['seed'],'max_new_tokens_requested':maximum,
        'processed_before':before,'processed_after':position,'attention_start_after':max(0,position-64),
        'total_generated_before':before,'total_generated_after':position,'tokens':output,
        'text':tokenizer.decode(output,skip_special_tokens=True),'pending_after':output[-1],
        'ended_eos':output[-1]==1,'ended_sentence':output[-1] in {2,15,30},'last_logit_hash':hashes[position-1]})
assert all(x['max_new_tokens_requested']==(2 if x['processed_before']<=26 else 1) for x in turns)
assert [t for row in turns for t in row['tokens']]==tokens[:position]
result=dict(source)
result.update(token_policy='Request 2 iff processed <= 26, then 1; native EOS or .!? ends current chunk; retain pending terminal.',
    turns=turns,processed_tokens=processed[:position],generated_tokens=tokens[:position],every_step_logit_hash=hashes[:position],
    full_text=tokenizer.decode([3]+tokens[:position],skip_special_tokens=True),
    ended_eos_positions=[i for i,t in enumerate(tokens[:position]) if t==1],
    grouping_source={'file':source_path.name,'sha256':hashlib.sha256(source_path.read_bytes()).hexdigest(),
        'new_inference_required':False,'reason':'Per-token seed step is global. Turn grouping cannot alter input history, selected tokens, or logits.'})
path=OUT/'relative64-policy26-2060turn-reference.json'
path.write_text(json.dumps(result,indent=2)+'\n')
early=dict(result);end=turns[139]['processed_after']
early.update(turns=turns[:140],processed_tokens=processed[:end],generated_tokens=tokens[:end],every_step_logit_hash=hashes[:end],
    full_text=tokenizer.decode([3]+tokens[:end],skip_special_tokens=True),ended_eos_positions=[i for i,t in enumerate(tokens[:end]) if t==1])
(OUT/'relative64-policy26-140turn-reference.json').write_text(json.dumps(early,indent=2)+'\n')
print(json.dumps({'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'turns':len(turns),'processed':position,'early140_processed':end},indent=2))
