#!/usr/bin/env python3
"""Teacher-forced probability of frozen V7 grammar pairs; no generation filter."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from sample_wide_fp32 import Independent


def log_probability(scores,index,temperature):
    logits=scores.astype(np.float64)/temperature
    return float(logits[index]-np.logaddexp.reduce(logits))


def score(model,text,temperatures):
    words,punct=model.parse(text)
    unknown=[w for w in words if w not in model.index]
    if unknown:return {'status':'UNSUPPORTED','unknown_words':unknown}
    state=(np.zeros(128,np.float32),np.zeros(128,np.float32));previous=8192;pp=0
    word_logp=punct_logp=0.;w=model.weights;gt,wt,pt=temperatures
    for word,pm in zip(words,punct):
        state=model.step(previous,pp,state);h=state[1];token=model.index[word];g=token//64;start=g*64
        word_logp+=log_probability(w['groups.weight']@h+w['group_bias.weight'][:,0],g,gt)
        word_logp+=log_probability(w['words.weight'][start:start+64]@h+w['word_bias.weight'][start:start+64,0],token%64,wt)
        punct_logp+=log_probability(w['punct_head.weight']@h+w['punct_bias']+w['word_punct_bias.weight'][token],pm,pt)
        previous,pp=token,pm
    return {'status':'SCORED','word_log_probability':word_logp,'punctuation_log_probability':punct_logp,
            'joint_log_probability':word_logp+punct_logp,'words':len(words)}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--data',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);a=p.parse_args();assert not a.output.exists()
    model=Independent(a.checkpoint,a.data);gate=Path(__file__).with_name('v7-gates.json');pairs=json.loads(gate.read_text())['development']['grammar_pairs']
    rows=[]
    for pair in pairs:
        for setting in [(1.,1.,1.),(1.,.5,.7)]:
            preferred,other=[score(model,pair[key],setting)for key in ('preferred','dispreferred')]
            supported=preferred['status']==other['status']=='SCORED'
            rows.append(pair|{'temperatures':setting,'preferred_score':preferred,'dispreferred_score':other,
                             'preferred_wins':preferred['joint_log_probability']>other['joint_log_probability']if supported else None})
    report={'status':'COMPLETE_GRAMMAR_DIAGNOSTIC','source':model.source,'gate_sha256':hashlib.sha256(gate.read_bytes()).hexdigest(),
            'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'method':'Full word+punctuation teacher-forced probability; known-prefix pairs only, same length; no runtime grammar mask.','rows':rows}
    a.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'output':str(a.output),'summary':{str(s):{'supported':sum(r['preferred_wins']is not None for r in rows if tuple(r['temperatures'])==s),
        'preferred_wins':sum(r['preferred_wins']is True for r in rows if tuple(r['temperatures'])==s)}for s in [(1.,1.,1.),(1.,.5,.7)]}}))


if __name__=='__main__':main()
