#!/usr/bin/env python3
"""Independently audit checkpoint widening without importing its converter."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from safetensors.numpy import load_file


def cell(x,h,weight):
    dim=len(h)
    recurrent=weight@h
    r=1/(1+np.exp(-np.clip(x[:dim]+recurrent[:dim],-80,80)))
    z=1/(1+np.exp(-np.clip(x[dim:2*dim]+recurrent[dim:2*dim],-80,80)))
    return z*h+(1-z)*np.tanh(x[2*dim:]+r*recurrent[2*dim:])


def forward(t,word,punct,state,domain,features):
    incoming=t['wx1']@(t['embedding.weight'][word]+t['punct_embedding.weight'][punct])
    incoming+=t['bh1']+t['domain.weight'][domain]+t['wf']@features
    h1=cell(incoming,state[0],t['wh1'])
    h2=cell(t['wx2']@h1+t['bh2'],state[1],t['wh2'])
    group=t['groups.weight']@h2+t['group_bias.weight'][:,0]
    allwords=t['words.weight']@h2+t['word_bias.weight'][:,0]
    pl=t['punct_head.weight']@h2+t['punct_bias']
    if word<len(t['words.weight']):pl+=t['word_punct_bias.weight'][word]
    return (h1,h2),(group,allwords,pl)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True);p.add_argument('--target',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);a=p.parse_args();assert not a.output.exists()
    source=load_file(str(a.source/'model.safetensors'));target=load_file(str(a.target/'model.safetensors'))
    h=source['wx1'].shape[1];wide=target['wx1'].shape[1];factor=wide//h
    assert factor*h==wide and factor>=1 and set(source)==set(target)
    checks={}
    for name in ('wx1','wh1','wx2','wh2'):
        expanded=target[name].reshape(3,h,factor,h,factor)
        base=source[name].reshape(3,h,h)
        checks[name]=bool(np.all(expanded==base[:, :, None, :, None]/factor))
    for name in ('embedding.weight','punct_embedding.weight'):
        checks[name]=bool(np.all(target[name].reshape(-1,h,factor)==source[name][:,:,None]))
    for name in ('groups.weight','words.weight','punct_head.weight'):
        checks[name]=bool(np.all(target[name].reshape(-1,h,factor)==source[name][:,:,None]/factor))
    for name in ('bh1','bh2'):
        checks[name]=bool(np.all(target[name].reshape(3,h,factor)==source[name].reshape(3,h,1)))
    checks['wf']=bool(np.all(target['wf'].reshape(3,h,factor,6)==source['wf'].reshape(3,h,1,6)))
    checks['domain.weight']=bool(np.all(target['domain.weight'].reshape(-1,3,h,factor)==source['domain.weight'].reshape(-1,3,h,1)))
    for name in ('group_bias.weight','word_bias.weight','punct_bias','word_punct_bias.weight'):
        checks[name]=bool(np.array_equal(source[name],target[name]))
    narrow={k:v.astype(np.float64)for k,v in source.items()}
    wider={k:v.astype(np.float64)for k,v in target.items()}
    rng=np.random.default_rng(73042)
    state=tuple(rng.uniform(-.8,.8,h)for _ in range(2));other=tuple(np.repeat(v,factor)for v in state)
    maxima={'layer1':0.,'layer2':0.,'group_logits':0.,'all8192_word_logits':0.,'punctuation_logits':0.}
    for step in range(64):
        word=[0,8191,8192,8193][step]if step<4 else int(rng.integers(8194))
        pm=step%5;domain=step%2;features=rng.uniform(-.5,.5,6)
        state,logits=forward(narrow,word,pm,state,domain,features)
        other,other_logits=forward(wider,word,pm,other,domain,features)
        errors=[np.max(np.abs(other[i]-np.repeat(state[i],factor)))for i in range(2)]
        errors += [np.max(np.abs(x-y))for x,y in zip(logits,other_logits)]
        maxima={k:max(maxima[k],float(v))for k,v in zip(maxima,errors)}
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    report={'status':'PASS'if all(checks.values())and max(maxima.values())<(1e-9 if factor&(factor-1)==0 else 1e-4) else'FAIL',
            'source_width':h,'target_width':wide,'factor':factor,'all_tensor_mapping_checks':checks,
            'factor_power_of_two':factor&(factor-1)==0,'tolerance':1e-9 if factor&(factor-1)==0 else 1e-4,'steps':64,'state_init':'Fixed random nonzero state, repeated adjacent channels','domains':'Both0/1',
            'inputs':'All previous punctuation values plus real first/last/BOS/UNK input rows; deterministic random remaining words',
            'float64_forward_max_error':maxima,'precision_scope':'Independent float64 arithmetic on exact stored float32 tensors. Power-of-two expansion is algebraically preserved by stored floats. Non-power-of-two division rounds the stored coefficients, so approximate function preservation is checked. No FP32 bit identity or Q10 preservation claim.',
            'source_sha256':sha(a.source/'model.safetensors'),'target_sha256':sha(a.target/'model.safetensors'),
            'converter_sha256':sha(a.target.parent/'widen.py')if(a.target.parent/'widen.py').exists()else None,
            'script_sha256':sha(Path(__file__))}
    a.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))


if __name__=='__main__':main()
