#!/usr/bin/env python3
"""Dense independent oracle for V8 sparse contrastive grammar training."""
import argparse
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from safetensors.torch import load_file


def load_module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
    return module


def dense_logp(m,h):
    # Compute all8192 probabilities from the two independently normalized levels.
    group=h@m.groups.weight.T+m.group_bias.weight[:,0]
    group=group-torch.logsumexp(group,dim=1,keepdim=True)
    word=(h@m.words.weight.T+m.word_bias.weight[:,0]).reshape(-1,128,64)
    word=word-torch.logsumexp(word,dim=2,keepdim=True)
    return (word+group[:,:,None]).reshape(-1,8192)


def dense_contrastive(m,h,batch):
    pos=batch['grammar_positions']
    if pos.numel()==0:return h.sum()*0
    logp=dense_logp(m,h)
    difference=2.+logp[pos,batch['grammar_bad_tokens']]-logp[pos,batch['grammar_good_tokens']]
    return torch.logaddexp(torch.zeros_like(difference),difference).mean()


def gradient_error(a,b):
    errors={}
    for (name,x),(other,y)in zip(a.named_parameters(),b.named_parameters()):
        assert name==other
        if x.grad is None and y.grad is None:continue
        gx=torch.zeros_like(x)if x.grad is None else x.grad
        gy=torch.zeros_like(y)if y.grad is None else y.grad
        errors[name]=float((gx-gy).abs().max())
    return max(errors.values(),default=0.)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--training',type=Path,required=True);parser.add_argument('--checkpoint',type=Path)
    parser.add_argument('--output',type=Path,required=True);a=parser.parse_args();assert not a.output.exists()
    torch.set_num_threads(2);torch.manual_seed(7384)
    module=load_module('model',a.training/'model.py');engine=load_module('v8_engine_audit',a.training/'engine.py')
    weights=load_file(a.checkpoint/'model.safetensors')if a.checkpoint else None
    hidden=weights['wx1'].shape[1]if weights else 384
    model=module.VoiceModel(np.ones(8192),hidden=hidden).double().eval();model.dropout=0.
    if weights:model.load_state_dict(weights)
    scenarios=[('empty',[],[],[]),('same_group',[0],[10],[11]),('different_group',[1],[80],[5000]),
               ('multiple_shared_and_repeated',[0,1,1,2,3,4],[10,80,80,600,7000,8191],[11,5000,90,7000,7001,5])]
    results=[]
    for name,pos,good,bad in scenarios:
        one=copy.deepcopy(model);two=copy.deepcopy(model)
        h=torch.randn(5,hidden,dtype=torch.float64,requires_grad=True)*.05;h=h.detach().requires_grad_();other=h.detach().clone().requires_grad_()
        batch={key:torch.tensor(values,dtype=torch.long)for key,values in [('grammar_positions',pos),('grammar_good_tokens',good),('grammar_bad_tokens',bad)]}
        actual=module.grammar_contrastive_loss(one,h,batch,2.)
        expected=dense_contrastive(two,other,batch)
        actual.backward();expected.backward()
        row={'name':name,'pairs':len(pos),'loss_absolute_error':abs(float((actual-expected).detach())),
             'parameter_gradient_max_error':gradient_error(one,two),'hidden_gradient_max_error':float((h.grad-other.grad).abs().max())}
        if name=='same_group':row['group_head_gradient_max']=float(one.groups.weight.grad.abs().max())
        results.append(row)
    # Entire objective also includes packed lexical CE and all-position punctuation.
    y=np.array([[10,80,8193,600],[80,7000,8191,8193]],dtype=np.int64)
    punctuation=np.array([[0,1,2,3],[4,0,1,2]],dtype=np.int64)
    previous=np.concatenate([np.full((2,1),8192),y[:,:-1]],axis=1)
    pp=np.concatenate([np.zeros((2,1),dtype=np.int64),punctuation[:,:-1]],axis=1)
    valid=np.ones_like(y,dtype=np.float64);valid[1,3]=0
    reset=np.zeros_like(y,dtype=bool);reset[:,0]=True
    arr={'x':previous,'y':y,'prev_punct':pp,'punct':punctuation,'resets':reset,'domains':np.zeros_like(y),
         'valid':valid,'word_mask':valid*(y<8192),'grammar_positions':np.array([0,1,1,5]),
         'grammar_good_tokens':np.array([10,80,80,7000]),'grammar_bad_tokens':np.array([11,5000,90,7001])}
    batch=engine.tensor_batch(arr,'cpu');one=copy.deepcopy(model);two=copy.deepcopy(model)
    actual,metrics,_,_=module.objective(one,batch,grammar_weight=.3,grammar_margin=2.)
    h,_=two(batch['x'],batch['prev_punct'],batch['resets'],batch['domains']);h=h.reshape(-1,hidden)
    logp=dense_logp(two,h);flat_y=batch['y'].reshape(-1);safe=flat_y.clamp_max(8191);wm=batch['word_mask'].reshape(-1)
    lexical=-(logp[torch.arange(len(h)),safe]*wm).sum()/wm.sum()
    pl=h@two.punct_head.weight.T+two.punct_bias+(flat_y<8192)[:,None]*two.word_punct_bias.weight[safe]
    target_p=batch['punct'].reshape(-1);pm=batch['valid'].reshape(-1)
    punctuation_loss=((torch.logsumexp(pl,1)-pl[torch.arange(len(h)),target_p])*pm).sum()/pm.sum()
    expected=lexical+punctuation_loss+.3*dense_contrastive(two,h,batch)
    actual.backward();expected.backward()
    whole={'loss_absolute_error':abs(float((actual-expected).detach())),
           'all_parameter_gradient_max_error':gradient_error(one,two),
           'lexical_positions':float(metrics['word_count']),'punctuation_positions':float(metrics['punct_count']),
           'sparse_pair_count':len(arr['grammar_positions'])}
    checks=[v<1e-10 for row in results for k,v in row.items()if k.endswith('error')]
    checks += [whole['loss_absolute_error']<1e-10,whole['all_parameter_gradient_max_error']<1e-10]
    sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
    report={'status':'PASS'if all(checks)else'FAIL','hidden':hidden,'scenarios':results,'whole_objective':whole,
            'source_sha256':{name:sha(a.training/name)for name in ['model.py','engine.py']},
            'checkpoint_sha256':sha(a.checkpoint/'model.safetensors')if a.checkpoint else None,
            'script_sha256':sha(Path(__file__)),
            'input_contract':'Sparse labels must already be validated known-word training positions; Corpus rejects unknown targets/invalid IDs, Stream carries their gold positions across chunks.',
            'scope':'Double precision, dropout disabled. Oracle evaluates all8192 word probabilities; compared to sparse implementation including all parameter gradients. No runtime grammar restrictions introduced.'}
    a.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))


if __name__=='__main__':main()
