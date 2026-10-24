#!/usr/bin/env python3
"""Local GPU training with paired word/punctuation targets and carried state."""
import argparse,collections,copy,hashlib,json,math,signal,time
from pathlib import Path
import numpy as np
import torch
from safetensors.torch import load_file,save_file
from model import VoiceModel,V,H,Q,BOS,UNK,objective
from engine import Corpus,Stream,evaluate,sample

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,x):
    temp=p.with_suffix(p.suffix+'.tmp');temp.write_text(json.dumps(x,indent=2)+'\n');temp.replace(p)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--device',choices=['mps','cpu'],default='mps');p.add_argument('--batch',type=int,default=128);p.add_argument('--width',type=int,default=128)
    p.add_argument('--words',type=int,default=20000000);p.add_argument('--stop',type=int,default=0);p.add_argument('--every',type=int,default=2000000)
    p.add_argument('--curriculum-weight',type=float,default=.75);p.add_argument('--adult-weight',type=float,default=.05)
    p.add_argument('--lr',type=float,default=.001);p.add_argument('--dropout',type=float,default=.1);p.add_argument('--seed',type=int,default=741003)
    p.add_argument('--init-weights',type=Path);p.add_argument('--warm-source',type=Path);p.add_argument('--warm-vocabulary',type=Path)
    p.add_argument('--resume',type=Path);p.add_argument('--max-steps',type=int,default=10000000)
    a=p.parse_args();assert not a.output.exists() and not(a.resume and a.init_weights)
    if a.device=='mps':assert torch.backends.mps.is_available()
    a.output.mkdir(parents=True);torch.set_num_threads(2);torch.manual_seed(a.seed)
    data=Corpus(a.data);rng=np.random.default_rng(a.seed+1)
    mix={'curriculum':a.curriculum_weight,'original':1-a.curriculum_weight-a.adult_weight,'adult':a.adult_weight};assert min(mix.values())>=0
    if 'curriculum' not in data.rows['train']:mix={'original':1-a.adult_weight,'adult':a.adult_weight}
    counts=sum(np.asarray(data.counts[k],dtype=float)*value/max(1,sum(data.counts[k])) for k,value in mix.items())
    model=VoiceModel(counts);model.dropout=a.dropout
    assert sum(p.numel()for p in model.parameters())==2364805
    initialization={'type':'fresh','seed':a.seed}
    if a.warm_source:
        assert not a.init_weights and not a.resume and a.warm_vocabulary
        old=load_file(a.warm_source/'model.safetensors');old_vocab=json.loads(a.warm_vocabulary.read_text());old_index={word:i for i,word in enumerate(old_vocab)};matched=0
        with torch.no_grad():
            for name in ('wx1','wh1','wf','bh1','wx2','wh2','bh2','punct_embedding.weight','domain.weight','punct_head.weight','punct_bias'):
                model.state_dict()[name].copy_(old[name])
            for i,word in enumerate(data.vocabulary):
                if word in old_index:
                    j=old_index[word];matched+=1
                    for name in ('embedding.weight','words.weight','word_punct_bias.weight'):model.state_dict()[name][i].copy_(old[name][j])
            model.embedding.weight[BOS].copy_(old['embedding.weight'][BOS]);model.embedding.weight[UNK].copy_(old['embedding.weight'][UNK])
        initialization={'type':'lexically_mapped_body_and_word_vectors','source_sha256':sha(a.warm_source/'model.safetensors'),'matched_words':matched,
                        'group_head':'fresh because vocabulary group membership changed','word_bias':'fresh new training unigram conditional counts'}
    if a.init_weights:
        model.load_state_dict(load_file(a.init_weights/'model.safetensors'))
        initialization={'type':'weights_only_new_phase','source_sha256':sha(a.init_weights/'model.safetensors'),'source':str(a.init_weights.resolve())}
    if a.resume:model.load_state_dict(load_file(a.resume/'model.safetensors'))
    model.to(a.device);opt=torch.optim.AdamW((p for p in model.parameters()if p.requires_grad),lr=a.lr,weight_decay=.01,foreach=False)
    stream=Stream(data,rng,a.batch,a.width,mix);state=None;seen=steps=0
    if a.resume:
        saved=torch.load(a.resume/'optimizer.pt',weights_only=False,map_location=a.device)
        opt.load_state_dict(saved['optimizer']);stream.lanes=saved['lanes'];rng.bit_generator.state=saved['numpy_rng'];seen=saved['seen'];steps=saved['steps']
        state=tuple(v.to(a.device)for v in saved['carry_state'])
        torch.set_rng_state(saved['torch_rng'].cpu())
        if a.device=='mps':torch.mps.set_rng_state(saved['mps_rng'].cpu())
    validation=data.validation_batches(np.random.default_rng(a.seed+2),a.device)
    config={k:str(v)if isinstance(v,Path)else v for k,v in vars(a).items()}
    report={'status':'RUNNING','configuration':config,'architecture':{'layers':2,'hidden_per_layer':H,'vocabulary':V,'punctuation_classes':5,'parameters':2364805},
            'data_manifest_sha256':sha(a.data/'manifest.json'),'code_sha256':{f:sha(Path(__file__).with_name(f))for f in ('model.py','engine.py','prepare.py','train.py')},
            'initialization':initialization,'sampling_mixture_target_words':mix,'state_policy':'Carry both detached layer states across consecutive chunks; reset only at actual source document boundaries. Previous word and punctuation are shifted together.',
            'punctuation_policy':'Supervise all punctuation, including unknown lexical targets. No forced periods or runtime grammar templates.',
            'features':'Market feature projection frozen at zero; language training uses no random market noise.',
            'quality_approved':False,'mainnet_actions':0,'snapshots':[],'history':[]}
    write(a.output/'report.json',report);start=time.monotonic();train_seconds=0.;new_words=0;domain_counts=collections.Counter();best=float('inf');next_save=(seen//a.every+1)*a.every;stop_requested=False
    def request_stop(signum,frame):
        nonlocal stop_requested
        stop_requested=True
    signal.signal(signal.SIGINT,request_stop);signal.signal(signal.SIGTERM,request_stop)
    def snapshot():
        nonlocal best
        val=evaluate(model,validation);cpu=copy.deepcopy(model).cpu().eval();folder=a.output/f'checkpoint-{seen:09d}';folder.mkdir()
        save_file({k:v.detach().contiguous()for k,v in cpu.state_dict().items()},folder/'model.safetensors')
        torch.save({'optimizer':opt.state_dict(),'seen':seen,'steps':steps,'lanes':stream.lanes,'numpy_rng':rng.bit_generator.state,
                    'carry_state':tuple(v.detach().cpu()for v in state)if state is not None else (torch.zeros(a.batch,H),torch.zeros(a.batch,H)),
                    'torch_rng':torch.get_rng_state(),'mps_rng':torch.mps.get_rng_state()if a.device=='mps'else None},folder/'optimizer.pt')
        probes=[]
        for temp in (.5,.8,1.):probes+=sample(cpu,data.vocabulary,temperature=temp,punct_temperature=temp)
        write(folder/'probes.json',probes)
        row={'words':seen,'steps':steps,'elapsed_seconds':time.monotonic()-start,'training_seconds':train_seconds,'new_words_per_second':new_words/max(train_seconds,1e-9),
             'validation':val,'weights_sha256':sha(folder/'model.safetensors'),'checkpoint':str(folder.resolve()),'new_words_by_kind':dict(domain_counts)}
        write(folder/'metadata.json',row);report['snapshots'].append(row)
        if val['macro_joint_nll']<best:best=val['macro_joint_nll'];report['best']=row;write(a.output/'best.json',row)
        report.update(words=seen,steps=steps,elapsed_seconds=time.monotonic()-start);write(a.output/'report.json',report)
        print(json.dumps({'words':seen,'checkpoint':str(folder),'validation':val,'words_per_second':row['new_words_per_second']}),flush=True)
    try:
        snapshot()
        while seen<a.words and steps<a.max_steps:
            t=time.monotonic();batch,kinds=stream.next(a.device);model.train();opt.zero_grad(set_to_none=True)
            fraction=min(seen/a.words,1);lr=a.lr*(.15+.85*.5*(1+math.cos(math.pi*fraction)))
            for group in opt.param_groups:group['lr']=lr
            loss,metrics,state,_=objective(model,batch,state)
            if not torch.isfinite(loss):raise ValueError('Nonfinite loss')
            loss.backward();norm=torch.nn.utils.clip_grad_norm_(model.parameters(),1.);opt.step();state=tuple(v.detach()for v in state)
            with torch.no_grad():
                for parameter in model.parameters():parameter.clamp_(-32768/Q,32767/Q)
            count=sum(kinds.values());seen+=count;new_words+=count;steps+=1;domain_counts.update(kinds);train_seconds+=time.monotonic()-t
            if steps%100==0:
                row={'words':seen,'steps':steps,'joint_loss':float(loss.detach()),'word_nll':float((metrics['word_loss']/metrics['word_count']).detach()),'punctuation_nll':float((metrics['punct_loss']/metrics['punct_count']).detach()),'lr':lr,'gradient_norm':float(norm)}
                report['history'].append(row);print(json.dumps(row),flush=True)
            final=seen>=a.words or steps>=a.max_steps or(a.stop and seen>=a.stop)or stop_requested
            if seen>=next_save or final:snapshot();next_save=(seen//a.every+1)*a.every
            if final:break
        report.update(status='REVIEW_GATE'if (a.stop and seen<a.words)or stop_requested else 'COMPLETE',words=seen,steps=steps,elapsed_seconds=time.monotonic()-start)
        write(a.output/'report.json',report)
    except BaseException as error:
        report.update(status='FAILED',error=str(error),words=seen,steps=steps);write(a.output/'report.json',report);raise

if __name__=='__main__':main()
