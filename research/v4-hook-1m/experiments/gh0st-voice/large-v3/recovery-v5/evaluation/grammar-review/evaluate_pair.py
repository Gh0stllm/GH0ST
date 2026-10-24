#!/usr/bin/env python3
"""Blind labels for two fixed checkpoints; raw no-reset local generation only."""
import argparse,hashlib,json,sys,time
from pathlib import Path
import torch
HERE=Path(__file__).resolve().parent;V3=HERE.parents[2];RECOVERY=HERE.parents[1]
sys.path.insert(0,str(V3/'training-teacher'))
from common import load_model,mask_for,save,sha

@torch.no_grad()
def generate(model,tok,prefix,seed,length):
    ids=tok.encode(prefix,add_special_tokens=False);assert ids and 0 not in ids and 1 not in ids
    initial=len(ids);complete=list(ids);generated=[];cache=None;inputs=torch.tensor([ids]);generator=torch.Generator().manual_seed(seed)
    for step in range(length):
        if step==0:result=model(input_ids=inputs,attention_mask=mask_for(initial),use_cache=True)
        else:
            attention=torch.full((1,1,1,len(complete)),torch.finfo(torch.float32).min);attention[:,:,:,-64:]=0
            result=model(input_ids=inputs,attention_mask=attention,past_key_values=cache,use_cache=True,position_ids=torch.tensor([[len(complete)-1]]))
        cache=result.past_key_values;row=result.logits[0,-1].clone();row[0]=-float('inf')
        values,choices=torch.topk(row,8);token=int(choices[torch.multinomial(torch.softmax(values/.8,0),1,generator=generator)])
        complete.append(token);generated.append(token);inputs=torch.tensor([[token]])
    return {'prefix':prefix,'seed':seed,'generated_ids':generated,'generated_text':tok.decode(generated,skip_special_tokens=True),
            'full_text':tok.decode(complete,skip_special_tokens=True),'eos_positions':[i for i,x in enumerate(generated) if x==1]}

def main():
    p=argparse.ArgumentParser();p.add_argument('--step',type=int,default=1000);p.add_argument('--wait-seconds',type=float,default=30);a=p.parse_args()
    candidates=[RECOVERY/'runs'/name/f'checkpoint-{a.step:06d}' for name in ['grammar-ce-6m','grammar-ul-6m']]
    deadline=time.monotonic()+a.wait_seconds
    while any(not (x/'training-metadata.json').exists() for x in candidates):
        if time.monotonic()>deadline:raise TimeoutError('Both completed snapshots are not yet ready')
        time.sleep(.2)
    torch.set_num_threads(2);prompts=json.loads((HERE/'prompts.json').read_text());mapping={};out=[]
    ordered=sorted(candidates,key=lambda x:hashlib.sha256(('blind-grammar-v1:'+sha(x/'model.safetensors')).encode()).hexdigest())
    for label,path in zip(['A','B'],ordered):
        before=sha(path/'model.safetensors');model,tok=load_model(path);model.eval()
        mapping[label]={'path':str(path.resolve()),'weights_sha256':before,'tokenizer_sha256':sha(path/'tokenizer.json')}
        rows=[]
        for seed in [0,42]:rows.append({'id':f'full-{seed}',**generate(model,tok,'"',seed,256)})
        for index,item in enumerate(prompts):rows.append({'id':item['id'],'reasoning_check':item['check'],**generate(model,tok,item['prefix'],42+index,48)})
        assert sha(path/'model.safetensors')==before
        out.append({'label':label,'outputs':rows});del model
    stem=f'step-{a.step:06d}';save(HERE/f'{stem}-blind-outputs.json',{'scope':'Two256-token streams and eight48-token continuation probes per checkpoint; topk8,T0.8,window64; no EOS stopping.','runner_sha256':sha(Path(__file__)),'prompts_sha256':sha(HERE/'prompts.json'),'results':out})
    save(HERE/f'{stem}-mapping.json',mapping)
    text=[]
    for item in out:
        for row in item['outputs']:text.extend([f"LABEL {item['label']} | {row['id']}",row['full_text'],''])
    (HERE/f'{stem}-blind-outputs.txt').write_text('\n'.join(text))
    print(json.dumps({'status':'COMPLETE','step':a.step,'labels':['A','B'],'full_streams':4,'reasoning_continuations':16}))

if __name__=='__main__':main()
