#!/usr/bin/env python3
"""Local full-document training for the existing H384 N0VA Q10 architecture.

One document per batch row, no cross-document state, exact native GRU gates.
Every saved result is a development candidate, never an automatic release.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import time
import numpy as np
import torch
from safetensors.torch import load_file, save_file
from fast_model import (FastVoiceModel, objective, V, BOS, UNK, Q,
                        project_packing, packing_names, packing_audit)
from engine import tensor_batch, sample


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    path=Path(path); temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(value,indent=2)+'\n'); temp.replace(path)


def synchronize(device):
    if device=='mps': torch.mps.synchronize()


def load_rows(path):
    rows=[]
    for line in path.read_text().splitlines():
        row=json.loads(line); tokens=np.asarray(row['token_ids'],dtype=np.int64)
        punct=np.asarray(row['punctuation'],dtype=np.int64)
        assert len(tokens)>1 and len(tokens)==len(punct)
        assert (tokens>=0).all() and (tokens<=UNK).all()
        assert (punct>=0).all() and (punct<5).all()
        assert int(row.get('domain',0))==0, 'Voice training requires domain0'
        rows.append({'id':row['id'],'tokens':tokens,'punct':punct})
    assert rows
    return rows


def batch_rows(rows, device):
    width=max(len(r['tokens']) for r in rows); shape=(len(rows),width)
    x=np.full(shape,BOS,dtype=np.int64); y=np.full(shape,UNK,dtype=np.int64)
    prev=np.zeros(shape,dtype=np.int64); punct=prev.copy()
    reset=np.zeros(shape,dtype=bool); reset[:,0]=True
    valid=np.zeros(shape,dtype=np.float32)
    for i,row in enumerate(rows):
        n=len(row['tokens']); y[i,:n]=row['tokens']; punct[i,:n]=row['punct']
        x[i,1:n]=row['tokens'][:-1]; prev[i,1:n]=row['punct'][:-1]
        valid[i,:n]=1
    return tensor_batch({'x':x,'y':y,'prev_punct':prev,'punct':punct,
                         'domains':np.zeros(shape,dtype=np.int64),'resets':reset,
                         'valid':valid,'word_mask':valid*(y<V)},device)


@torch.no_grad()
def evaluate(model, rows, batch, device):
    model.eval(); total=np.zeros(4,dtype=np.float64)
    for start in range(0,len(rows),batch):
        _,m,_,_=objective(model,batch_rows(rows[start:start+batch],device))
        total+=np.array([float(m['word_loss']),float(m['word_count']),
                         float(m['punct_loss']),float(m['punct_count'])])
    return {'word_nll':total[0]/total[1], 'punctuation_nll':total[2]/total[3],
            'joint_nll':total[0]/total[1]+total[2]/total[3],
            'known_words':int(total[1]), 'punctuation_positions':int(total[3])}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data',type=Path,required=True)
    p.add_argument('--init-weights',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--steps',type=int,default=600)
    p.add_argument('--batch',type=int,default=16)
    p.add_argument('--lr',type=float,default=0.0001)
    p.add_argument('--every',type=int,default=100)
    p.add_argument('--device',choices=('mps','cpu'),default='mps')
    p.add_argument('--dropout',type=float,default=0.05)
    p.add_argument('--weight-decay',type=float,default=0.01)
    p.add_argument('--packing-limit',type=float,default=15.5)
    p.add_argument('--no-packing-projection',action='store_true')
    p.add_argument('--reset-output-priors',action='store_true',
                   help='Initialize group/conditional word biases from smoothed new training counts; keep full vocabulary.')
    p.add_argument('--sample-words',type=int,default=128)
    p.add_argument('--temperature',type=float,default=0.6)
    p.add_argument('--seed',type=int,default=741110)
    p.add_argument('--threads',type=int,default=2)
    a=p.parse_args()
    assert a.steps>0 and a.batch>0 and a.every>0 and 0<a.lr<0.1
    assert 0<=a.dropout<1 and 0<a.packing_limit<=15.5
    assert not a.output.exists(), 'Use a new output directory'
    if a.device=='mps': assert torch.backends.mps.is_available(), 'MPS unavailable'
    torch.set_num_threads(a.threads);torch.manual_seed(a.seed)
    rng=np.random.default_rng(a.seed);a.output.mkdir(parents=True)
    vocabulary=json.loads((a.data/'vocabulary.json').read_text());assert len(vocabulary)==V
    counts=np.zeros(V,dtype=np.float64); datasets={}
    for split in ('train','validation','test'):
        datasets[split]=load_rows(a.data/f'{split}.jsonl')
    for r in datasets['train']:
        counts+=np.bincount(r['tokens'][r['tokens']<V],minlength=V)
    init=a.init_weights/'model.safetensors' if a.init_weights.is_dir() else a.init_weights
    weights=load_file(init);hidden=weights['embedding.weight'].shape[1]
    assert hidden==384, 'This fast trainer targets the unchanged H384 architecture'
    model=FastVoiceModel(counts,hidden=hidden);model.load_state_dict(weights)
    if a.reset_output_priors:
        mass=(counts+0.25).reshape(128,64); group_mass=mass.sum(axis=1)
        with torch.no_grad():
            model.group_bias.weight[:,0].copy_(torch.tensor(np.log(group_mass/group_mass.sum()),dtype=torch.float32))
            model.word_bias.weight[:,0].copy_(torch.tensor(np.log(mass/group_mass[:,None]).reshape(-1),dtype=torch.float32))
    model.dropout=a.dropout;model.to(a.device)
    parameters=sum(v.numel()for v in model.parameters());assert parameters==8175493
    projection=torch.zeros(12,dtype=torch.int64,device=a.device)
    if not a.no_packing_projection: projection+=project_packing(model,a.packing_limit)
    initial_projection=projection.detach().cpu().tolist()
    opt=torch.optim.AdamW((v for v in model.parameters()if v.requires_grad),lr=a.lr,
                         weight_decay=a.weight_decay,foreach=False)
    config={k:str(v.resolve())if isinstance(v,Path)else v for k,v in vars(a).items()}
    config.update(architecture='GRU2_H384_V8192_P5',parameters=parameters,
                  state_policy='Full source document per row; reset only at start; padding targets masked.',
                  initial_weights_sha256=sha(init),vocabulary_sha256=sha(a.data/'vocabulary.json'))
    report={'status':'RUNNING_LOCAL_DEVELOPMENT','config':config,
            'source_sha256':{n:sha(Path(__file__).with_name(n))for n in ('train.py','fast_model.py')},
            'data_sha256':{s:sha(a.data/f'{s}.jsonl')for s in datasets},
            'dataset_counts':{s:{'documents':len(rs),'words':sum(len(r['tokens'])for r in rs)}for s,rs in datasets.items()},
            'projection_policy':'Post-update group L1 training regularization; export independently rechecks integer bounds.',
            'output_priors':'Reinitialized from new training counts plus0.25; all8192words remain available.' if a.reset_output_priors else 'Inherited unchanged from initial checkpoint.',
            'initial_projection_rows':dict(zip(packing_names(),initial_projection)),
            'checkpoints':[],'history':[],'mainnet_actions':0,'quality_approved':False}
    write(a.output/'config.json',config);write(a.output/'report.json',report)
    start=time.monotonic();trained_words=0;best=math.inf;order=np.array([],dtype=np.int64);cursor=0

    def checkpoint(step):
        nonlocal best
        synchronize(a.device);model.eval()
        validation=evaluate(model,datasets['validation'],a.batch,a.device)
        # Test split is intentionally not used for per-checkpoint selection.
        folder=a.output/f'checkpoint-{step:06d}';folder.mkdir()
        cpu={k:v.detach().cpu().contiguous()for k,v in model.state_dict().items()}
        assert all(torch.isfinite(v).all()for v in cpu.values())
        exact_bounds={k:[int(torch.round(v.double()*Q).min()),int(torch.round(v.double()*Q).max())]for k,v in cpu.items()}
        assert all(lo>=-32768 and hi<=32767 for lo,hi in exact_bounds.values())
        save_file(cpu,folder/'model.safetensors')
        cpu_model=FastVoiceModel(counts,hidden=hidden);cpu_model.load_state_dict(cpu);cpu_model.eval()
        bounds=packing_audit(cpu_model)
        samples=sample(cpu_model,vocabulary,seeds=(0,42),words=a.sample_words,
                       temperature=a.temperature,punct_temperature=a.temperature)
        write(folder/'samples.json',samples)
        write(folder/'config.json',config);shutil.copyfile(a.data/'vocabulary.json',folder/'vocabulary.json')
        row={'step':step,'trained_words':trained_words,'elapsed_seconds':time.monotonic()-start,
             'validation':validation,'weights_sha256':sha(folder/'model.safetensors'),
             'packing_q10_max_abs_sums':bounds,'tensor_q10_bounds':exact_bounds,
             'projection_rows':dict(zip(packing_names(),projection.detach().cpu().tolist())),
             'checkpoint':str(folder.resolve()),'quality_approved':False}
        write(folder/'metadata.json',row);report['checkpoints'].append(row)
        if validation['joint_nll']<best:
            best=validation['joint_nll'];report['best_validation_candidate']=row
        write(a.output/'report.json',report)
        print(json.dumps({'checkpoint':str(folder),'step':step,'validation':validation,
                          'elapsed_seconds':row['elapsed_seconds']}),flush=True)

    checkpoint(0)
    for step in range(1,a.steps+1):
        if cursor>=len(order): order=rng.permutation(len(datasets['train']));cursor=0
        ids=order[cursor:cursor+a.batch];cursor+=len(ids)
        rows=[datasets['train'][int(i)]for i in ids]
        batch=batch_rows(rows,a.device);model.train();opt.zero_grad(set_to_none=True)
        lr=a.lr*(0.2+0.8*0.5*(1+math.cos(math.pi*(step-1)/a.steps)))
        for group in opt.param_groups: group['lr']=lr
        loss,metrics,_,_=objective(model,batch)
        if not torch.isfinite(loss): raise ValueError('Nonfinite training loss')
        loss.backward();norm=torch.nn.utils.clip_grad_norm_(model.parameters(),1.)
        opt.step()
        with torch.no_grad():
            for parameter in model.parameters():parameter.clamp_(-32768/Q,32767/Q)
            if not a.no_packing_projection:projection+=project_packing(model,a.packing_limit)
        trained_words+=sum(int((r['tokens']<V).sum())for r in rows)
        if step%10==0:
            row={'step':step,'trained_words':trained_words,'loss':float(loss.detach()),
                 'gradient_norm':float(norm),'lr':lr,'elapsed_seconds':time.monotonic()-start}
            report['history'].append(row);print(json.dumps(row),flush=True)
        if step%a.every==0 or step==a.steps: checkpoint(step)
    report.update(status='COMPLETE_LOCAL_DEVELOPMENT',elapsed_seconds=time.monotonic()-start,
                  steps=a.steps,trained_words=trained_words)
    write(a.output/'report.json',report)


if __name__=='__main__':main()
