#!/usr/bin/env python3
"""Bounded, local, short-context tone experiment; frozen parent artifacts stay untouched."""
import argparse,collections,hashlib,json,sys,time
from pathlib import Path
import numpy as np
import torch

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'training-teacher'))
from common import RESEARCH,load_model,mask_for,loss_for,validate,constrain,audit,free_generate,save,sha


def normalized(text):return ' '.join(text.casefold().split())
def clean(text):
    text=text.strip()
    return text[1:-1].strip() if len(text)>1 and text[0]==text[-1]=='"' else text


class Documents:
    def __init__(self,groups):self.groups=groups
    def batch(self,rng,count=16):
        ids=np.empty((count,64),dtype=np.int64);labels=np.empty_like(ids);mix=collections.Counter()
        for i in range(count):
            kind='sharp' if rng.random()<.7 else 'existing';docs=self.groups[kind]
            doc=docs[int(rng.integers(len(docs)))];quoted=rng.random()<.5
            cursor=1 if quoted else 0;within=0 if quoted else int(rng.integers(len(doc)))
            if quoted:ids[i,0]=3
            while cursor<64:
                take=min(64-cursor,len(doc)-within);ids[i,cursor:cursor+take]=doc[within:within+take];cursor+=take
                if cursor<64:doc=docs[int(rng.integers(len(docs)))];within=0
            labels[i]=ids[i];labels[i,:1 if quoted else 16]=-100
            mix[kind]+=int((labels[i,1:]!=-100).sum())
        return torch.from_numpy(ids),torch.from_numpy(labels),dict(mix)


@torch.no_grad()
def short_samples(model,tok):
    prompts=['i asked the machine','my wallet','the market','i built','i believe','the crowd','i opened','i wanted to know']
    records=[];model.eval()
    for index,prompt in enumerate(prompts):
        ids=tok.encode('"'+prompt,add_special_tokens=False);generator=torch.Generator().manual_seed(42+index)
        full=list(ids);cache=None;input_ids=torch.tensor([ids]);length=len(ids)
        for step in range(48):
            if step==0:
                out=model(input_ids=input_ids,attention_mask=mask_for(length),use_cache=True)
            else:
                attention=torch.full((1,1,1,len(full)),torch.finfo(torch.float32).min);attention[:,:,:,-64:]=0
                out=model(input_ids=input_ids,attention_mask=attention,past_key_values=cache,use_cache=True,
                          position_ids=torch.tensor([[len(full)-1]]))
            cache=out.past_key_values;row=out.logits[0,-1].clone();row[0]=-float('inf')
            values,indices=torch.topk(row,8);token=int(indices[torch.multinomial(torch.softmax(values/.8,0),1,generator=generator)])
            full.append(token);input_ids=torch.tensor([[token]])
        records.append({'prefix':prompt,'token_ids':full,'text':tok.decode(full,skip_special_tokens=True)})
    return records


def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--steps',type=int,default=200)
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False);torch.set_num_threads(2);torch.manual_seed(20261024)
    base=RESEARCH/'experiments/simplestories-v2/model-cache';_,tok=load_model(base)
    data_root=HERE.parent/'data';sharp_path=data_root/'sharp-voice-original.jsonl'
    sharp=[json.loads(x) for x in sharp_path.read_text().splitlines() if x.strip()]
    assert len(sharp)==100 and len({normalized(r['text']) for r in sharp})==100
    sharp=sorted(sharp,key=lambda r:hashlib.sha256(('tone-split-v1:'+r['id']).encode()).hexdigest())
    training=sharp[20:];heldout=sharp[:20]
    def read_existing(split):return [r for r in map(json.loads,(data_root/'corpus'/f'{split}.jsonl').read_text().splitlines()) if r['source_kind']=='authored']
    old_train=read_existing('train');old_val=read_existing('validation')
    encode=lambda rows:[tok.encode(clean(r['text']),add_special_tokens=False) for r in rows]
    train={'sharp':encode(training),'existing':encode(old_train)};val={'sharp':encode(heldout),'existing':encode(old_val)}
    assert max(map(len,train['sharp']+val['sharp']))<=63
    assert not any(0 in x or 1 in x for groups in (train,val) for docs in groups.values() for x in docs)
    grams=lambda groups:{tuple(x[i:i+12]) for docs in groups.values() for x in docs for i in range(max(0,len(x)-11))}
    train_grams=grams(train);val_grams=grams(val);assert not train_grams&val_grams,'12-token train/validation overlap'
    for name,rows in [('train-sharp',training),('validation-sharp',heldout)]:
        (a.output/f'{name}.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
    metadata={'sharp_source_sha256':sha(sharp_path),'split_seed':'tone-split-v1','sharp_train_ids':[r['id'] for r in training],
              'sharp_validation_ids':[r['id'] for r in heldout],'existing_train_count':len(old_train),'existing_validation_count':len(old_val),
              'sharp_train_tokens':sum(map(len,train['sharp'])),'sharp_validation_tokens':sum(map(len,val['sharp'])),
              'no_12token_overlap':True,'no_eos_inserted':True,'source_probabilities':{'sharp':.7,'existing':.3},
              'window':64,'quote_probability':.5,'random_window_warmup':16,'runner_sha256':sha(Path(__file__)),
              'common_sha256':sha(HERE.parent/'training-teacher/common.py')}
    save(a.output/'data-manifest.json',metadata)
    vrng=np.random.default_rng(1001);vdocs=Documents(val);vbatches=[vdocs.batch(vrng) for _ in range(8)];mask=mask_for(64)
    starts={'original':base,'teacher4m':HERE.parent/'runs/teacher-v4-final-4m/checkpoint-003126'};summary=[]
    for label,checkpoint in starts.items():
        outdir=a.output/label;outdir.mkdir();model,tok=load_model(checkpoint);torch.manual_seed(20261024)
        rng=np.random.default_rng(20261024);docs=Documents(train);optimizer=torch.optim.AdamW(model.parameters(),lr=1e-5,weight_decay=.01,foreach=False)
        report={'start_checkpoint':str(checkpoint),'start_sha256':sha(checkpoint/'model.safetensors'),'steps':a.steps,
                'lr':1e-5,'optimizer':'Fresh AdamW, default betas/epsilon, decay0.01, gradclip1; no scheduler.',
                'scope':'Local short-context style ablation; no EVM/mainnet. Small corpus, high overfit risk. Selection is provisional pending raw generation review.',
                'data_manifest_sha256':sha(a.output/'data-manifest.json'),'history':[],'snapshots':[]}
        started=time.monotonic();seen=0;mix=collections.Counter();best=None
        def measure(step,snapshot):
            nonlocal best
            metric=validate(model,vbatches,mask);row={'step':step,'tokens':seen,'validation':metric}
            if snapshot:
                path=outdir/f'checkpoint-{step:06d}';path.mkdir();model.save_pretrained(path,safe_serialization=True);tok.save_pretrained(path)
                probe=free_generate(model,tok,(0,42),512)
                for stream in probe['streams']:
                    matched=set();ids=stream['tokens']
                    for i in range(len(ids)-11):
                        if tuple(ids[i:i+12]) in train_grams:matched.update(range(i,i+12))
                    stream['train_12token_copy_fraction']=len(matched)/len(ids)
                save(path/'probe.json',probe);save(path/'short-prompts.json',short_samples(model,tok));save(path/'quantization-audit.json',audit(model))
                row.update({'path':str(path),'weights_sha256':sha(path/'model.safetensors'),'basic_guard_pass':probe['passes_basic_guards']})
                report['snapshots'].append(row.copy())
                if step>0 and (best is None or metric['loss']<best['validation']['loss']):best=row.copy()
            report['history'].append(row);report['tokens']=seen;report['source_tokens']=dict(mix);report['best_validation_snapshot']=best
            save(outdir/'report.json',report);print(json.dumps({'start':label,**row}),flush=True);model.train()
        measure(0,True)
        for step in range(1,a.steps+1):
            batch=docs.batch(rng);model.train();optimizer.zero_grad(set_to_none=True);loss,n=loss_for(model,batch,mask)
            assert torch.isfinite(loss);(loss/n).backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1.);optimizer.step()
            clipped=constrain(model);assert audit(model)['eligible'];seen+=n;mix.update(batch[2])
            if step%25==0 or step==a.steps:measure(step,step%50==0 or step==a.steps)
        report['status']='COMPLETE';report['elapsed_seconds']=time.monotonic()-started;save(outdir/'report.json',report)
        summary.append({'start':label,'tokens':seen,'best':best,'final_validation':report['history'][-1]['validation'],'elapsed_seconds':report['elapsed_seconds']})
        del model,optimizer
    save(a.output/'summary.json',{'status':'COMPLETE','runs':summary,'data_manifest_sha256':sha(a.output/'data-manifest.json')})


if __name__=='__main__':main()
