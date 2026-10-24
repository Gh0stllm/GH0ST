#!/usr/bin/env python3
"""Local gated H224 recurrent training with per-source CE and continuous probes."""
import argparse,collections,copy,hashlib,json,math,time
from pathlib import Path
import numpy as np
import torch
from safetensors.torch import save_file,load_file
from model import WideModel,tree_paths,objective,V,H,D,Q,PARAMETERS
from sample import sample

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path,value):
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(value,indent=2)+'\n');tmp.replace(path)

def random_features(rng,shape):
    values=rng.random((*shape,6),dtype=np.float32)
    values[...,:3]*=4
    values[...,4:]=np.where(values[...,4:]<.5,-1.,1.)
    return values

class Corpus:
    def __init__(self,folder):
        self.folder=folder;self.meta=json.loads((folder/'manifest.json').read_text())
        self.vocab=json.loads((folder/'vocabulary.json').read_text());self.rows={}
        self.counts=json.loads((folder/'counts.json').read_text())
        assert len(self.vocab)==V and self.meta['retained_training_vocabulary_unseen']==0
        for split in ['train','validation','test']:
            assert sha(folder/f'{split}.jsonl')==self.meta['artifacts'][f'{split}.jsonl']['sha256']
            groups=collections.defaultdict(list)
            for line in (folder/f'{split}.jsonl').open():
                row=json.loads(line);groups[row['source_kind']].append(np.asarray(row['token_ids'],dtype=np.int64))
            self.rows[split]=dict(groups)
    def batch(self,split,rng,batch,width,warmup,weights,device):
        kinds=list(weights);probabilities=np.asarray(list(weights.values()),dtype=np.float64)
        x=np.empty((batch,width),dtype=np.int64);y=np.empty_like(x)
        reset=np.zeros((batch,width),dtype=bool);mask=np.ones((batch,width),dtype=np.float32)
        features=random_features(rng,(batch,width));counter=collections.Counter();samples=[]
        for row in range(batch):
            kind=kinds[int(rng.choice(len(kinds),p=probabilities))];documents=self.rows[split][kind]
            cursor=0
            while cursor<width:
                doc=documents[int(rng.integers(len(documents)))];start=0
                # Only training may start inside a paragraph; its unsupervised
                # prefix warms the hidden state. Held-out examples start whole.
                if split=='train' and cursor==0 and len(doc)>width and rng.random()<.5:
                    start=int(rng.integers(1,len(doc)-width+1));mask[row,:min(warmup,width)]=0
                take=min(width-cursor,len(doc)-start)
                y[row,cursor:cursor+take]=doc[start:start+take]
                x[row,cursor]=V if start==0 else doc[start-1]
                if take>1:x[row,cursor+1:cursor+take]=doc[start:start+take-1]
                reset[row,cursor]=True;cursor+=take
            counter[kind]+=int(mask[row].sum());samples.append(kind)
        tensors=[torch.from_numpy(v).to(device) for v in [x,y,features,reset,mask]]
        return (*tensors,counter,samples,y,mask)

@torch.no_grad()
def validation(model,batches,paths,bits):
    model.eval();result={};zeros=saturated=count=0
    for kind,rows in batches.items():
        total=words=0
        for batch in rows:
            loss,n,hidden=objective(model,batch,paths,bits)
            total+=float(loss);words+=int(n)
            zeros+=int((hidden==0).sum());saturated+=int((hidden.abs()>=.999).sum());count+=hidden.numel()
        result[kind]={'ce_nats_per_word':total/words,'perplexity':math.exp(min(total/words,30)),'words':words}
    return {'per_source':result,'balanced_ce':sum(row['ce_nats_per_word'] for row in result.values())/len(result),
            'hidden_zero_fraction':zeros/count,'hidden_saturated_fraction':saturated/count}

@torch.no_grad()
def constrain(model):
    count=torch.zeros((),dtype=torch.int64,device=next(model.parameters()).device)
    for param in model.parameters():
        count+=((param<-32768/Q)|(param>32767/Q)).sum();param.clamp_(-32768/Q,32767/Q)
    return count

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--device',choices=['cpu','mps'],default='mps');p.add_argument('--batch-size',type=int,default=64)
    p.add_argument('--width',type=int,default=64);p.add_argument('--warmup',type=int,default=16)
    p.add_argument('--target-words',type=int,default=4000000);p.add_argument('--stop-after-words',type=int,default=0)
    p.add_argument('--max-steps',type=int,default=1000000);p.add_argument('--eval-every-words',type=int,default=250000)
    p.add_argument('--validation-batches',type=int,default=2);p.add_argument('--probe-words',type=int,default=128)
    p.add_argument('--learning-rate',type=float,default=.001);p.add_argument('--seed',type=int,default=631001)
    p.add_argument('--threads',type=int,default=2);p.add_argument('--log-every',type=int,default=25)
    p.add_argument('--source-weights',type=json.loads,default={'authored':.1,'grammar':.75,'teacher':.15})
    p.add_argument('--resume',type=Path);a=p.parse_args()
    if a.output.exists():raise ValueError('New output path required')
    if a.device=='mps' and not torch.backends.mps.is_available():raise ValueError('MPS unavailable')
    assert min(a.batch_size,a.width,a.target_words,a.max_steps,a.eval_every_words,a.validation_batches,a.probe_words)>0
    assert 0<=a.warmup<a.width and abs(sum(a.source_weights.values())-1)<1e-8 and min(a.source_weights.values())>=0
    a.output.mkdir(parents=True);torch.set_num_threads(a.threads);torch.manual_seed(a.seed)
    rng=np.random.default_rng(a.seed+1);corpus=Corpus(a.data);device=torch.device(a.device)
    frequencies=sum(a.source_weights[k]*np.asarray(corpus.counts[k])/sum(corpus.counts[k]) for k in a.source_weights)
    model=WideModel(frequencies)
    if a.resume:model.load_state_dict(load_file(a.resume/'model.safetensors'))
    model=model.to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=a.learning_rate,weight_decay=0,foreach=False)
    paths,bits=[value.to(device) for value in tree_paths()]
    seen=0;step=0;resume_state=None;resume_metadata={}
    if a.resume:
        resume_state=torch.load(a.resume/'training-state.pt',map_location=device,weights_only=False)
        optimizer.load_state_dict(resume_state['optimizer']);seen=resume_state['seen'];step=resume_state['step'];rng.bit_generator.state=resume_state['rng']
        resume_metadata=json.loads((a.resume/'training-metadata.json').read_text())
    valid_rng=np.random.default_rng(a.seed+2)
    batches={kind:[corpus.batch('validation',valid_rng,min(a.batch_size,32),a.width,a.warmup,{kind:1.},device) for _ in range(a.validation_batches)] for kind in a.source_weights}
    previous_report=json.loads((a.resume.parent/'training-report.json').read_text()) if a.resume else {}
    report={'status':'RUNNING','architecture':{'cell':'reset-after GRU without recurrent bias','vocabulary':V,'hidden':H,'tree_depth':D,'q':Q,'parameters':PARAMETERS},
            'configuration':{k:str(v) if isinstance(v,Path) else v for k,v in vars(a).items()},
            'data_manifest_sha256':sha(a.data/'manifest.json'),'vocabulary_sha256':sha(a.data/'vocabulary.json'),
            'trainer_sha256':sha(Path(__file__)),'model_code_sha256':sha(Path(__file__).with_name('model.py')),
            'initialization':'Independent random GRU tensors; all parameters trainable unless resume supplied.',
            'features':'Independent random bounded six-vectors per word; nuisance robustness, not semantic market conditioning.',
            'continuity':'No hidden reset at sentence punctuation; reset only at new independent source document. Mid-document training windows have unsupervised warmup.',
            'validation':'Plain hierarchical CE by source; equal source mean for selection; test unused.',
            'resume_checkpoint_sha256':sha(a.resume/'model.safetensors') if a.resume else None,
            'resume_from_words':seen,'previous_target_words':previous_report.get('configuration',{}).get('target_words'),
            'learning_rate_reheated_by_extended_cosine_target':bool(a.resume and a.target_words>previous_report.get('configuration',{}).get('target_words',a.target_words)),
            'snapshots':[],'history':[],'manual_quality_review_required':True}
    save(a.output/'training-report.json',report)
    start=time.monotonic();training_seconds=0.;trained_this_run=0;source_words=collections.Counter(resume_metadata.get('source_words',{}));projected=torch.tensor(resume_metadata.get('projected_values',0),dtype=torch.int64,device=device)
    seen_vocab=np.zeros(V,dtype=bool);seen_nodes=np.zeros(V-1,dtype=bool);np_paths=tree_paths()[0].numpy();best=float('inf')
    if resume_state and 'seen_vocab' in resume_state:
        seen_vocab=resume_state['seen_vocab'];seen_nodes=resume_state['seen_nodes']
    report['coverage_scope']='Cumulative supervised targets' if not a.resume else previous_report.get('coverage_scope','Current resume segment only; old snapshot did not save coverage arrays')
    next_eval=((seen//a.eval_every_words)+1)*a.eval_every_words
    stop_reason=None
    def snapshot(final=False):
        nonlocal best,stop_reason
        metrics=validation(model,batches,paths,bits)
        if metrics['hidden_saturated_fraction']>.05:stop_reason='Hidden saturation exceeded5% of validation activations'
        if metrics['balanced_ce']>best+.5:stop_reason='Balanced validation CE rose more than0.5 above best in this run'
        cpu=copy.deepcopy(model).to('cpu').float().eval()
        checkpoint=a.output/f'checkpoint-{seen:08d}';checkpoint.mkdir()
        save_file({k:v.detach().contiguous() for k,v in cpu.state_dict().items()},checkpoint/'model.safetensors')
        config={'vocabulary':V,'hidden':H,'tree_depth':D,'q':Q,'parameters':PARAMETERS}
        save(checkpoint/'config.json',config)
        state={'optimizer':optimizer.state_dict(),'seen':seen,'step':step,'rng':rng.bit_generator.state,'seen_vocab':seen_vocab.copy(),'seen_nodes':seen_nodes.copy()}
        torch.save(state,checkpoint/'training-state.pt')
        generated=[]
        for temperature in [512,768,1024]:generated+=sample(cpu,corpus.vocab,(0,42),a.probe_words,temperature)
        generated+=sample(cpu,corpus.vocab,(42,),a.probe_words,1024,feature_mode='extreme')
        save(checkpoint/'probe.json',{'scope':'Float continuous generation; no punctuation insertion.','runs':generated})
        row={'step':step,'supervised_words':seen,'elapsed_seconds':time.monotonic()-start,'validation':metrics,
             'checkpoint':str(checkpoint.resolve()),'weight_sha256':sha(checkpoint/'model.safetensors'),
             'source_words':dict(source_words),'projected_values':int(projected),
             'target_leaves_seen':int(seen_vocab.sum()),'decoder_nodes_seen':int(seen_nodes.sum()),
             'q10_weight_min':min(int(torch.round(v*Q).min()) for v in cpu.state_dict().values()),
             'q10_weight_max':max(int(torch.round(v*Q).max()) for v in cpu.state_dict().values()),
             'training_step_seconds':training_seconds,'training_words_per_second':trained_this_run/max(training_seconds,1e-9)}
        save(checkpoint/'training-metadata.json',row);report['snapshots'].append(row)
        if seen>0 and metrics['balanced_ce']<best:
            best=metrics['balanced_ce'];report['best']=row;save(a.output/'best-candidate.json',row)
        report.update({'supervised_words':seen,'completed_steps':step,'source_words':dict(source_words),'elapsed_seconds':time.monotonic()-start})
        save(a.output/'training-report.json',report)
        print(json.dumps({'snapshot':str(checkpoint),'words':seen,'validation':metrics,'projected_values':int(projected)}),flush=True)
        model.train()
    try:
        snapshot()
        while seen<a.target_words and step<a.max_steps:
            step_start=time.monotonic()
            step+=1;batch=corpus.batch('train',rng,a.batch_size,a.width,a.warmup,a.source_weights,device)
            optimizer.zero_grad(set_to_none=True);model.train()
            fraction=min(seen/a.target_words,1);lr=a.learning_rate*(.1+.9*.5*(1+math.cos(math.pi*fraction)))
            for group in optimizer.param_groups:group['lr']=lr
            loss,n,hidden=objective(model,batch,paths,bits)
            if not bool(torch.isfinite(loss)):raise ValueError('Nonfinite training loss')
            (loss/n).backward();norm=torch.nn.utils.clip_grad_norm_(model.parameters(),5.)
            optimizer.step();projected+=constrain(model)
            words=int(n);seen+=words;source_words.update(batch[5]);targets=batch[7][batch[8]>0]
            seen_vocab[targets]=True;seen_nodes[np_paths[targets].reshape(-1)]=True
            training_seconds+=time.monotonic()-step_start;trained_this_run+=words
            if step%a.log_every==0:
                row={'step':step,'supervised_words':seen,'ce':float(loss.detach()/n),'gradient_norm':float(norm),'lr':lr,'elapsed_seconds':time.monotonic()-start}
                report['history'].append(row);print(json.dumps(row),flush=True)
            final=seen>=a.target_words or step>=a.max_steps or (a.stop_after_words and seen>=a.stop_after_words)
            if seen>=next_eval or final:
                snapshot(final);next_eval=((seen//a.eval_every_words)+1)*a.eval_every_words
            if final or stop_reason:break
        report.update({'status':'PAUSED_AT_REVIEW_GATE' if a.stop_after_words and seen<a.target_words else 'COMPLETE','supervised_words':seen,'completed_steps':step,'elapsed_seconds':time.monotonic()-start,'training_step_seconds':training_seconds,'training_words_per_second':trained_this_run/max(training_seconds,1e-9)})
        if stop_reason:report.update({'status':'STOPPED_VALIDATION_GUARD','stop_reason':stop_reason})
        save(a.output/'training-report.json',report)
        print(json.dumps({k:report[k] for k in ['status','supervised_words','completed_steps','elapsed_seconds']}),flush=True)
    except BaseException as error:
        report.update({'status':'FAILED','error':str(error),'supervised_words':seen,'completed_steps':step});save(a.output/'training-report.json',report);raise

if __name__=='__main__':main()
