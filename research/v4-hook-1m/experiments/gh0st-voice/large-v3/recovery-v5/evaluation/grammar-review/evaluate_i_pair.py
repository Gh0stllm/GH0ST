#!/usr/bin/env python3
"""Read-only single-token 'i' conditioning with fixed optional decoding controls."""
import argparse,collections,hashlib,json,sys,time
from pathlib import Path
import torch
HERE=Path(__file__).resolve().parent;RECOVERY=HERE.parents[1];V3=HERE.parents[2]
sys.path.insert(0,str(V3/'training-teacher'))
sys.path.insert(0,str(RECOVERY/'decoder-screen'))
from common import load_model,save,sha
from screen import STOP
from evaluate_pair import generate

@torch.no_grad()
def controlled(model,tok,seed):
    initial=tok.encode('i',add_special_tokens=False);assert len(initial)==1
    vocab=[tok.convert_ids_to_tokens(i) for i in range(4019)];content={i for i,w in enumerate(vocab) if w.isalpha() and w not in STOP}
    ids=[];inputs=torch.tensor([initial]);cache=None;generator=torch.Generator().manual_seed(seed)
    for step in range(128):
        attention=torch.full((1,1,1,step+1),torch.finfo(torch.float32).min);attention[:,:,:,-64:]=0
        out=model(input_ids=inputs,attention_mask=attention,past_key_values=cache,use_cache=True,position_ids=torch.tensor([[step]]));cache=out.past_key_values
        row=out.logits[0,-1].clone();row[0]=-float('inf');recent=list(set(ids[-64:])&content)
        if recent:
            values=row[recent];row[recent]=torch.where(values<0,values*1.15,values/1.15)
        words=[vocab[i] for i in ids if vocab[i].isalpha()][-32:];counts=collections.Counter(words)
        ban=[i for i in content if counts[vocab[i]]>=2];row[ban]=-float('inf')
        values,choices=torch.topk(row,16);token=int(choices[torch.multinomial(torch.softmax(values/.7,0),1,generator=generator)])
        ids.append(token);inputs=torch.tensor([[token]])
    return {'prefix':'i','prefix_token_id':initial[0],'seed':seed,'generated_ids':ids,'full_text':tok.decode(initial+ids,skip_special_tokens=True),'eos_positions':[i for i,t in enumerate(ids) if t==1]}

def main():
    p=argparse.ArgumentParser();p.add_argument('--step',type=int,default=1000);p.add_argument('--wait-seconds',type=float,default=0);a=p.parse_args()
    paths=[RECOVERY/'runs'/n/f'checkpoint-{a.step:06d}' for n in ['grammar-ce-6m','grammar-ul-6m']]
    deadline=time.monotonic()+a.wait_seconds
    while any(not (x/'training-metadata.json').exists() for x in paths):
        if time.monotonic()>deadline:raise TimeoutError('Both completed snapshots not available')
        time.sleep(.2)
    torch.set_num_threads(2);rows=[];mapping={}
    for label,path in zip(['A','B'],sorted(paths,key=lambda x:hashlib.sha256(('blind-grammar-v1:'+sha(x/'model.safetensors')).encode()).hexdigest())):
        before=sha(path/'model.safetensors');model,tok=load_model(path);model.eval();assert len(tok.encode('i',add_special_tokens=False))==1
        mapping[label]={'path':str(path),'weights_sha256':before,'tokenizer_sha256':sha(path/'tokenizer.json')}
        outputs=[]
        for seed in [0,42]:outputs.append({'setting':'baseline-k8-t080',**generate(model,tok,'i',seed,128)})
        for seed in [0,42]:outputs.append({'setting':'k16-t070-content-penalty115-wordlimit2',**controlled(model,tok,seed)})
        rows.append({'label':label,'outputs':outputs});assert sha(path/'model.safetensors')==before;del model
    stem=f'step-{a.step:06d}-i';save(HERE/f'{stem}-blind-outputs.json',{'scope':'Single-token i conditioning,128newtokens,noEOSstop; baseline and fixed optional decoder controls.','runner_sha256':sha(Path(__file__)),'results':rows});save(HERE/f'{stem}-mapping.json',mapping)
    texts=[]
    for r in rows:
        for x in r['outputs']:texts.extend([f"LABEL {r['label']} | {x['setting']} | SEED {x['seed']}",x['full_text'],''])
    (HERE/f'{stem}-blind-outputs.txt').write_text('\n'.join(texts));print(json.dumps({'status':'COMPLETE','step':a.step,'outputs':8}))

if __name__=='__main__':main()
