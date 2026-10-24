#!/usr/bin/env python3
"""Independent FP32 H224 reset-after GRU probes, same draws as H265 screen."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from safetensors.numpy import load_file
from screen_checkpoint import Model, copy_matches, metrics, sha

V,H=8192,224


class GRUModel(Model):
    def __init__(self, checkpoint, data):
        weights_path=checkpoint/'model.safetensors'
        self.weights=load_file(str(weights_path))
        self.vocab=json.loads((data/'vocabulary.json').read_text())
        self.index={s:i for i,s in enumerate(self.vocab)}
        self.source={'checkpoint':str(checkpoint),'weights_sha256':sha(weights_path),
                     'vocabulary_sha256':sha(data/'vocabulary.json'),'cell':'H224 reset-after GRU, no recurrent bias'}
        shapes={'embedding.weight':(V+1,H),'wx':(3*H,H),'wh':(3*H,H),'wf':(3*H,6),
                'bh':(3*H,),'nodes.weight':(V-1,H),'bias.weight':(V-1,1)}
        for key,shape in shapes.items():assert self.weights[key].shape==shape,(key,shape)

    def step(self, previous, hidden, features):
        w=self.weights
        ir,iz,inn=np.split(w['wx']@w['embedding.weight'][previous]+w['wf']@features+w['bh'],3)
        hr,hz,hn=np.split(w['wh']@hidden,3)
        reset=1/(1+np.exp(-np.clip(ir+hr,-80,80)))
        update=1/(1+np.exp(-np.clip(iz+hz,-80,80)))
        candidate=np.tanh(inn+reset*hn)
        result=(update*hidden+(1-update)*candidate).astype(np.float32)
        assert np.isfinite(result).all() and np.max(np.abs(result))<=1.000001
        return result

    def generate(self, seed, count, temperature, prompt='', features=None):
        hidden=np.zeros(H,dtype=np.float32)
        features=np.asarray(features if features is not None else [.125,.25,.125,.5,-1.,-1.],dtype=np.float32)
        previous=V
        for word in prompt.split():
            assert word in self.index,f'Prompt OOV:{word}'
            hidden=self.step(previous,hidden,features);previous=self.index[word]
        words=[];ids=[];trace=[];zeros=[];saturated=[]
        for index in range(count):
            hidden=self.step(previous,hidden,features);previous=self.sample(hidden,seed,index,temperature)
            words.append(self.vocab[previous]);ids.append(previous)
            zeros.append(float(np.mean(hidden==0)));saturated.append(float(np.mean(np.abs(hidden)>=.999)))
            trace.append(hashlib.sha256(hidden.astype('<f4').tobytes()).hexdigest())
        stats={'mean_zero_fraction':float(np.mean(zeros)),'mean_saturated_fraction':float(np.mean(saturated)),
               'final_zero_fraction':zeros[-1],'final_saturated_fraction':saturated[-1],
               'final_l2_norm':float(np.linalg.norm(hidden)),'final_min':float(hidden.min()),'final_max':float(hidden.max()),
               'saturation_definition':'absolute hidden >=0.999; signed GRU state bound [-1,1]'}
        return {'seed':seed,'temperature_q10':round(temperature*1024),'prompt':prompt,'text':' '.join(words),
                'token_ids':ids,'hidden_sha256_per_word':trace,'metrics':metrics(words,stats)}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--data',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--seeds',default='0,42,7,123')
    p.add_argument('--words',type=int,default=128);p.add_argument('--temperatures-q10',default='512,768,1024')
    p.add_argument('--prompt',default='');p.add_argument('--heldout',action='store_true')
    a=p.parse_args();assert not a.output.exists();a.output.mkdir(parents=True)
    model=GRUModel(a.checkpoint,a.data);rows=[]
    docs=[None]
    if a.heldout:
        docs=sorted([json.loads(line) for line in (a.data/'test.jsonl').open()],key=lambda r:r['id'])
        docs=[r for r in docs if r['source_kind']=='authored' and len(r['text'].split())>=40][:2]
    for doc in docs:
        prompt=' '.join(doc['text'].split()[:8]) if doc else a.prompt
        for t in map(int,a.temperatures_q10.split(',')):
            for seed in map(int,a.seeds.split(',')):
                row=model.generate(seed,a.words,t/1024,prompt)
                if doc:row['heldout_source']={'id':doc['id'],'group_id':doc['group_id'],'actual_continuation':' '.join(doc['text'].split()[8:])}
                rows.append(row)
    copy_matches(rows,a.data)
    result={'status':'GENERATED_REQUIRES_HUMAN_QUALITY_REVIEW','source':model.source,'script_sha256':sha(Path(__file__)),
            'state_policy':'Initialize once; persistent signed hidden across every emitted word. No punctuation insertion or state reset.',
            'features':[.125,.25,.125,.5,-1.,-1.],'outputs':rows}
    (a.output/'raw-outputs.json').write_text(json.dumps(result,indent=2)+'\n')
    (a.output/'raw-outputs.txt').write_text('\n\n'.join(f"SEED {r['seed']} / TEMPERATURE Q10 {r['temperature_q10']} / PROMPT {r['prompt']!r}\n{r['text']}" for r in rows)+'\n')
    print(json.dumps({'path':str(a.output),'outputs':len(rows),'source':model.source}))


if __name__=='__main__':main()
