#!/usr/bin/env python3
"""GPU training for the local V6 conditional adaptive-head language model."""
import argparse,collections,copy,hashlib,json,math,time
from pathlib import Path
import numpy as np
import torch
from safetensors.torch import load_file,save_file
from model import VoiceModel,V,H,G,W,Q,objective,BOS,UNK
from engine import Corpus,evaluate,sample

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,x):
    temp=p.with_suffix(p.suffix+'.tmp');temp.write_text(json.dumps(x,indent=2)+'\n');temp.replace(p)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--device',choices=['cpu','mps'],default='mps')
    p.add_argument('--batch',type=int,default=64);p.add_argument('--width',type=int,default=128)
    p.add_argument('--warmup',type=int,default=32);p.add_argument('--words',type=int,default=40000000)
    p.add_argument('--stop',type=int,default=0);p.add_argument('--every',type=int,default=2000000)
    p.add_argument('--voice-weight',type=float,default=.10);p.add_argument('--lr',type=float,default=.001)
    p.add_argument('--weight-decay',type=float,default=.01);p.add_argument('--dropout',type=float,default=.1)
    p.add_argument('--seed',type=int,default=641001);p.add_argument('--resume',type=Path)
    p.add_argument('--warm-source',type=Path);p.add_argument('--warm-vocab',type=Path)
    p.add_argument('--max-steps',type=int,default=10000000);p.add_argument('--probe-words',type=int,default=128)
    a=p.parse_args();assert not a.output.exists();assert 0<=a.voice_weight<=1 and 0<=a.warmup<a.width
    if a.device=='mps':assert torch.backends.mps.is_available()
    a.output.mkdir(parents=True);torch.set_num_threads(2);torch.manual_seed(a.seed)
    rng=np.random.default_rng(a.seed+1);data=Corpus(a.data)
    counts=np.asarray(data.counts['0'])*a.voice_weight/max(sum(data.counts['0']),1)+np.asarray(data.counts['1'])*(1-a.voice_weight)/max(sum(data.counts['1']),1)
    model=VoiceModel(counts);model.dropout=a.dropout;warm={'mode':'fresh'}
    if a.warm_source:
        old=load_file(a.warm_source/'model.safetensors');old_vocab=json.loads(a.warm_vocab.read_text());old_index={w:i for i,w in enumerate(old_vocab)};matched=0
        with torch.no_grad():
            for name in ('wx','wh','wf','bh'):model.state_dict()[name].copy_(old[name])
            for i,word in enumerate(data.vocabulary):
                if word in old_index:model.embedding.weight[i].copy_(old['embedding.weight'][old_index[word]]);matched+=1
            model.embedding.weight[BOS].copy_(old['embedding.weight'][len(old_vocab)])
            model.embedding.weight[UNK].copy_(old['embedding.weight'].mean(0))
        warm={'mode':'mapped_embeddings_and_recurrent_body_only','matched_words':matched,'source_sha256':sha(a.warm_source/'model.safetensors'),'output_head':'fresh'}
    if a.resume:model.load_state_dict(load_file(a.resume/'model.safetensors'))
    device=torch.device(a.device);model.to(device)
    opt=torch.optim.AdamW(model.parameters(),lr=a.lr,weight_decay=a.weight_decay,foreach=False)
    seen=steps=0
    if a.resume:
        state=torch.load(a.resume/'optimizer.pt',map_location=device,weights_only=False)
        opt.load_state_dict(state['optimizer']);seen=state['seen'];steps=state['steps'];rng.bit_generator.state=state['rng']
        torch.set_rng_state(state['torch_rng'].cpu())
        if a.device=='mps':torch.mps.set_rng_state(state['mps_rng'].cpu())
    vrng=np.random.default_rng(a.seed+2)
    validation={d:[data.batch('validation',vrng,min(16,a.batch),a.width,a.warmup,1. if d==0 else 0.,device) for _ in range(4)] for d in (0,1)}
    report={'status':'RUNNING','configuration':{k:str(v) if isinstance(v,Path) else v for k,v in vars(a).items()},
            'architecture':{'hidden':H,'vocabulary':V,'groups':G,'words_per_group':W,'parameters':sum(t.numel() for t in model.parameters()),'input_only_unk':UNK,'domains':2},
            'data_manifest_sha256':sha(a.data/'manifest.json'),'vocabulary_sha256':sha(a.data/'vocabulary.json'),
            'code_sha256':{x:sha(Path(__file__).with_name(x)) for x in ('train.py','engine.py','model.py')},
            'initialization':warm,'loss':'group CE + conditional-word CE, known targets only; unknown inputs retained',
            'continuity':'128-word windows,32-word masked burn-in for mid-paragraph starts; reset only at new source paragraph',
            'snapshots':[],'history':[],'quality_approval':False,'mainnet_actions':0}
    write(a.output/'report.json',report);started=time.monotonic();train_time=0.;new_words=0;clipped=0;domain_words=collections.Counter();next_save=((seen//a.every)+1)*a.every;best=float('inf')
    def snapshot():
        nonlocal best
        val=evaluate(model,validation);cpu=copy.deepcopy(model).to('cpu').eval()
        folder=a.output/f'checkpoint-{seen:09d}';folder.mkdir()
        save_file({k:v.detach().contiguous() for k,v in cpu.state_dict().items()},folder/'model.safetensors')
        torch.save({'optimizer':opt.state_dict(),'seen':seen,'steps':steps,'rng':rng.bit_generator.state,
                    'torch_rng':torch.get_rng_state(),'mps_rng':torch.mps.get_rng_state() if a.device=='mps' else None},folder/'optimizer.pt')
        probes=[]
        for t in (.35,.6,.85):probes+=sample(cpu,data.vocabulary,words=a.probe_words,temperature=t)
        write(folder/'probes.json',probes)
        row={'words':seen,'steps':steps,'elapsed':time.monotonic()-started,'training_seconds':train_time,
             'new_words_per_second':new_words/max(train_time,1e-9),'validation':val,'checkpoint':str(folder.resolve()),
             'weight_sha256':sha(folder/'model.safetensors'),'clipped_parameters':clipped,'new_domain_words':dict(domain_words)}
        write(folder/'metadata.json',row);report['snapshots'].append(row)
        if val['balanced_nll']<best:best=val['balanced_nll'];report['best']=row;write(a.output/'best.json',row)
        report.update(words=seen,steps=steps,elapsed=time.monotonic()-started);write(a.output/'report.json',report)
        print(json.dumps({'checkpoint':str(folder),'words':seen,'validation':val,'speed':row['new_words_per_second']}),flush=True)
    try:
        snapshot()
        while seen<a.words and steps<a.max_steps:
            t=time.monotonic();batch=data.batch('train',rng,a.batch,a.width,a.warmup,a.voice_weight,device)
            model.train();opt.zero_grad(set_to_none=True)
            fraction=min(seen/a.words,1);lr=a.lr*(.15+.85*.5*(1+math.cos(math.pi*fraction)))
            for pg in opt.param_groups:pg['lr']=lr
            loss,n,_=objective(model,batch)
            if not torch.isfinite(loss):raise ValueError('Nonfinite loss')
            (loss/n).backward();norm=torch.nn.utils.clip_grad_norm_(model.parameters(),1.)
            opt.step()
            with torch.no_grad():
                over=torch.zeros((),dtype=torch.int64,device=device)
                for par in model.parameters():over+=((par<-32768/Q)|(par>32767/Q)).sum();par.clamp_(-32768/Q,32767/Q)
                clipped+=int(over)
            nw=int(n);seen+=nw;new_words+=nw;steps+=1;domain_words.update(batch['word_counts']);train_time+=time.monotonic()-t
            if steps%100==0:
                row={'words':seen,'steps':steps,'nll':float(loss.detach()/n),'lr':lr,'gradient_norm':float(norm),'elapsed':time.monotonic()-started}
                report['history'].append(row);print(json.dumps(row),flush=True)
            final=seen>=a.words or steps>=a.max_steps or(a.stop>0 and seen>=a.stop)
            if seen>=next_save or final:snapshot();next_save=((seen//a.every)+1)*a.every
            if final:break
        report.update(status='REVIEW_GATE' if a.stop and seen<a.words else 'COMPLETE',words=seen,steps=steps,elapsed=time.monotonic()-started)
        write(a.output/'report.json',report)
    except BaseException as error:
        report.update(status='FAILED',error=str(error),words=seen,steps=steps);write(a.output/'report.json',report);raise

if __name__=='__main__':main()
