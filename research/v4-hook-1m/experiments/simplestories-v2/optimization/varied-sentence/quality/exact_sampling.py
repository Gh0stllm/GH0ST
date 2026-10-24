"""Exact Q12/table/Keccak sampler matching the Solidity experimental decoder."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import time
import numpy as np
import pickle
from screen_sampling import reference, tokenizer, OUT, TERMINALS


class ExactPredictor:
    def __init__(self):
        self.cache={}
        self.calls=0
        self.hits=0

    def load_cache(self,path):
        # Only load this local cache created by this research script, never an
        # externally supplied pickle. It contains numerical prefix evaluations.
        if Path(path).exists():
            with Path(path).open('rb') as f:self.cache=pickle.load(f)

    def save_cache(self,path):
        target=Path(path)
        temporary=target.with_suffix(target.suffix+'.tmp')
        with temporary.open('wb') as f:pickle.dump(self.cache,f,protocol=5)
        temporary.replace(target)

    def __call__(self, context):
        key=tuple(context)
        if key in self.cache:
            self.hits+=1
            return self.cache[key]
        x=reference.forward(list(context))
        logits=np.asarray(x['logits'],dtype=np.int64)
        order=np.argsort(-logits,kind='stable')
        order=order[order!=0][:64]
        row=(order.astype(np.uint16),logits[order])
        self.cache[key]=row
        self.calls+=1
        return row


def exp_weight(distance):
    scaled=int(distance)*16
    index,remainder=divmod(scaled,reference.Q)
    if index>=256:
        return 0
    return (int(reference.exp[index])*(reference.Q-remainder)+int(reference.exp[index+1])*remainder)//reference.Q


def sampled_token(row,draw,k,temp_milli):
    ids,scores=row
    weights=[exp_weight((int(scores[0])-int(x))*1000//temp_milli) for x in scores[:k]]
    pick=draw%sum(weights)
    for token,weight in zip(ids[:k],weights):
        if pick<weight:
            return int(token)
        pick-=weight
    raise AssertionError('Impossible draw')


def generate(predictor,prompt,seed_index,draws,k=8,temp_milli=700,cap=4,draw_stride=4):
    generated=[]
    for step in range(cap):
        offset=(seed_index*draw_stride+step)*32
        draw=int.from_bytes(draws[offset:offset+32],'big')
        token=sampled_token(predictor(prompt+generated),draw,k,temp_milli)
        generated.append(token)
        if token in TERMINALS:
            break
    return dict(seed_index=seed_index,seed='0x'+seed_index.to_bytes(32,'big').hex(),
        prompt_ids=prompt,tokens=generated,top_k=k,temperature_milli=temp_milli,
        ended_eos=generated[-1]==1,ended_sentence=generated[-1] in {2,15,30},
        complete=2<=len(generated)<=cap and generated[-1] in TERMINALS,
        text=tokenizer.decode(generated,skip_special_tokens=True),
        combined=tokenizer.decode(prompt+generated,skip_special_tokens=True))


def fixtures():
    draws=(OUT/'seed-draws-65536.bin').read_bytes()
    predictor=ExactPredictor()
    cases=[]
    # Complete and incomplete cases both exercise the same four-token cap.
    for text in ['Because','"',':','We']:
        prompt=tokenizer.encode(text,add_special_tokens=False)
        for k,temp in [(8,700),(32,1000)]:
            accepted={True:0,False:0}
            for seed in range(256):
                row=generate(predictor,prompt,seed,draws,k,temp)
                if accepted[row['complete']]>=2:
                    continue
                accepted[row['complete']]+=1
                last_context=prompt+row['tokens'][:-1]
                row['last_logit_hash']=reference.forward(last_context,include_trace=True)['logit_hash']
                row['prompt']=text
                cases.append(row)
                if accepted[True]==accepted[False]==2:
                    break
    source=OUT.parent/'kernel/SimpleStoriesV2SampledModel.sol'
    result={'schema_version':1,'scope':'Offline exact Q12 reference; all natural sampled tokens, no inserted punctuation.',
        'sampler_source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'weights_sha256':hashlib.sha256(reference.blob).hexdigest(),
        'seed_draws_sha256':hashlib.sha256(draws).hexdigest(),
        'cases':cases,'prefix_evaluations':predictor.calls}
    (OUT/'exact-reference.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'fixtures':len(cases),'complete':sum(c['complete'] for c in cases),'path':str(OUT/'exact-reference.json')}))


if __name__=='__main__':
    fixtures()
