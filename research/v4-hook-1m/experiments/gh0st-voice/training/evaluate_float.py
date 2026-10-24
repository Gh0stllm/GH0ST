#!/usr/bin/env python3
"""Held-out FP32 generation comparison; never selects or changes checkpoints."""
from __future__ import annotations
import argparse,collections,json,time
from pathlib import Path
import torch
from transformers import AutoModelForCausalLM,AutoTokenizer
from train_voice import attention_mask,validate_architecture,digest,save,load_corpus,collate,evaluate
from torch.utils.data import DataLoader


def generation_batches(model,tokenizer,prompts,seed_count,max_new,batch_size):
    cases=[{'prompt_id':r['id'],'category':r.get('category',''), 'prefix':r.get('prefix',r.get('prompt','')),'seed':20261024+s} for r in prompts for s in range(seed_count)]
    rows=[];start=time.monotonic()
    for off in range(0,len(cases),batch_size):
        batch=cases[off:off+batch_size]
        initial=[tokenizer.encode(r['prefix'],add_special_tokens=False) for r in batch]
        if any(not x for x in initial):raise ValueError('Empty evaluation prefix')
        histories=[x.copy() for x in initial];outputs=[[] for _ in batch];done=[False]*len(batch)
        generators=[torch.Generator().manual_seed(r['seed']) for r in batch]
        for _ in range(max_new):
            n=max(map(len,histories));ids=torch.zeros((len(batch),n),dtype=torch.long);valid=torch.zeros_like(ids,dtype=torch.bool)
            for i,h in enumerate(histories):ids[i,:len(h)]=torch.tensor(h);valid[i,:len(h)]=True
            with torch.no_grad():logits=model(input_ids=ids,attention_mask=attention_mask(valid,64,torch.float32,'cpu'),use_cache=False).logits
            for i,h in enumerate(histories):
                if done[i]:continue
                row=logits[i,len(h)-1].float();row[0]=-float('inf')
                values,indices=torch.topk(row,8)
                token=int(indices[torch.multinomial(torch.softmax(values/.8,0),1,generator=generators[i])])
                outputs[i].append(token);h.append(token);done[i]=token==1
            if all(done):break
        for row,ids,output,stopped in zip(batch,initial,outputs,done):
            counts=collections.Counter(tuple(output[i:i+4]) for i in range(max(0,len(output)-3)))
            rows.append({**row,'prompt_tokens':ids,'output_tokens':output,'text':tokenizer.decode(output,skip_special_tokens=True),
                         'ended_eos':stopped,'hit_token_cap':not stopped,'unknown_tokens':output.count(0),
                         'largest_repeated_4gram_count':max(counts.values(),default=0)})
        print(json.dumps({'generated':len(rows),'total':len(cases),'seconds':time.monotonic()-start}),flush=True)
    return rows


def main():
    p=argparse.ArgumentParser();p.add_argument('--checkpoint',action='append',required=True,help='label=local_path');p.add_argument('--prompts',type=Path,required=True);p.add_argument('--corpus',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--seeds',type=int,default=4);p.add_argument('--max-new',type=int,default=64);p.add_argument('--batch-size',type=int,default=16);p.add_argument('--threads',type=int,default=2);p.add_argument('--continuous-corpus',action='store_true');a=p.parse_args()
    torch.set_num_threads(a.threads);obj=json.loads(a.prompts.read_text());prompts=obj['prompts'] if isinstance(obj,dict) else obj
    report={'status':'RUNNING','scope':'FP32 heldout comparison only; no checkpoint selection, training, quantized or EVM claim.','prompts_sha256':digest(a.prompts),'prompt_count':len(prompts),'settings':{'seeds':a.seeds,'max_new_tokens':a.max_new,'top_k':8,'temperature':.8,'sliding_window':64},'checkpoints':{}}
    for item in a.checkpoint:
        label,raw=item.split('=',1);path=Path(raw)
        tokenizer=AutoTokenizer.from_pretrained(path,local_files_only=True,trust_remote_code=False)
        model=AutoModelForCausalLM.from_pretrained(path,local_files_only=True,trust_remote_code=False,attn_implementation='eager',torch_dtype=torch.float32);model.eval();validate_architecture(model,tokenizer)
        blocks,_=load_corpus(a.corpus,tokenizer,128,64,a.continuous_corpus);loader=DataLoader(blocks['test'],batch_size=a.batch_size,shuffle=False,collate_fn=collate)
        loss=evaluate(model,loader,'cpu',64,0)
        rows=generation_batches(model,tokenizer,prompts,a.seeds,a.max_new,a.batch_size)
        report['checkpoints'][label]={'path':str(path.resolve()),'weights_sha256':digest(path/'model.safetensors'),'test_loss':loss,
            'summary':{'outputs':len(rows),'unique_outputs':len({r['text'] for r in rows}),'eos_outputs':sum(r['ended_eos'] for r in rows),'capped_outputs':sum(r['hit_token_cap'] for r in rows),'unknown_tokens':sum(r['unknown_tokens'] for r in rows),'outputs_with_4gram_repeated_3_times':sum(r['largest_repeated_4gram_count']>=3 for r in rows)},'rows':rows}
        save(a.output,report);del model
    report['status']='COMPLETE';save(a.output,report)
    print(json.dumps({k:v['summary']|{'test_loss':v['test_loss']} for k,v in report['checkpoints'].items()}))
if __name__=='__main__':main()
