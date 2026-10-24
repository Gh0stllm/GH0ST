#!/usr/bin/env python3
"""Independent arbitrary-width two-layer FP32 generation, with visible punctuation per word."""
import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
import numpy as np
from safetensors.numpy import load_file

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]/'recurrent-v1/evaluation'))
from screen_checkpoint import metrics

ENTROPY = {}
SUFFIX = ['', ',', '.', '!', '?']


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def entropy(seed, index, stage):
    key = (seed, index//256)
    if key not in ENTROPY:
        script = "import{AbiCoder,keccak256}from'ethers';const c=AbiCoder.defaultAbiCoder(),s=process.argv[1],n=Number(process.argv[2]);process.stdout.write(JSON.stringify(Array.from({length:256},(_,i)=>[0,1,2].map(j=>keccak256(c.encode(['bytes32','uint256','uint256'],[s,n+i,j]))))));"
        node = os.environ.get('NODE_BINARY', '/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')
        ENTROPY[key] = json.loads(subprocess.check_output([node, '--input-type=module', '-e', script, '0x'+int(seed).to_bytes(32,'big').hex(), str(key[1]*256)], cwd=HERE.parents[3]))
    return int(ENTROPY[key][index%256][stage], 16)


class Independent:
    def __init__(self, checkpoint, data):
        self.weights = load_file(str(checkpoint/'model.safetensors'))
        self.vocab = json.loads((data/'vocabulary.json').read_text())
        self.index = {w:i for i,w in enumerate(self.vocab)}
        spec = importlib.util.spec_from_file_location('v7_parser_for_eval', HERE.parent/'training/prepare.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.parse = module.parse
        w = self.weights
        self.hidden = w['wx1'].shape[1]
        assert w['embedding.weight'].shape == (8194,self.hidden)
        assert w['word_punct_bias.weight'].shape == (8192,5)
        assert all(w[name].shape==(3*self.hidden,self.hidden) for name in ['wx1','wh1','wx2','wh2'])
        self.source = {'hidden_width':self.hidden,'checkpoint':str(checkpoint),'weights_sha256':sha(checkpoint/'model.safetensors'),
                       'vocabulary_sha256':sha(data/'vocabulary.json'),'parser_sha256':sha(HERE.parent/'training/prepare.py')}

    @staticmethod
    def cell(incoming, hidden, recurrent):
        ir, iz, inn = np.split(incoming,3)
        hr, hz, hn = np.split(recurrent@hidden,3)
        reset = 1/(1+np.exp(-np.clip(ir+hr,-80,80)))
        update = 1/(1+np.exp(-np.clip(iz+hz,-80,80)))
        return (update*hidden+(1-update)*np.tanh(inn+reset*hn)).astype(np.float32)

    def step(self, previous, punct, state):
        w = self.weights
        first = w['wx1']@(w['embedding.weight'][previous]+w['punct_embedding.weight'][punct])+w['bh1']+w['domain.weight'][0]
        h1 = self.cell(first,state[0],w['wh1'])
        h2 = self.cell(w['wx2']@h1+w['bh2'],state[1],w['wh2'])
        assert np.isfinite(h1).all() and np.isfinite(h2).all()
        return h1,h2

    @staticmethod
    def choose(scores, seed, index, stage, temperature):
        scaled=(scores.astype(np.float64)-float(scores.max()))/temperature
        weight=np.floor(np.exp(np.maximum(scaled,-80))*4294967296+.5).astype(np.int64)
        draw=entropy(seed,index,stage)%int(weight.sum())
        return int(np.searchsorted(np.cumsum(weight),draw,side='right'))

    def generate(self, seed, count, group_temp, word_temp, punct_temp, prefix=''):
        words,punctuation=self.parse(prefix)
        missing=[{'position':i,'word':w}for i,w in enumerate(words)if w not in self.index]
        if missing:return {'status':'PREFIX_NOT_FULLY_REPRESENTABLE','seed':seed,'prompt':prefix,'unknown_inputs':missing}
        state=(np.zeros(self.hidden,np.float32),np.zeros(self.hidden,np.float32));previous=8192;prev_punct=0
        for word,pm in zip(words,punctuation):
            state=self.step(previous,prev_punct,state);previous=self.index[word];prev_punct=pm
        ids=[];pmarks=[];texts=[];hashes=[];sat=[];w=self.weights
        for pos in range(count):
            state=self.step(previous,prev_punct,state);h=state[1]
            group=self.choose(w['groups.weight']@h+w['group_bias.weight'][:,0],seed,pos,0,group_temp)
            start=group*64
            within=self.choose(w['words.weight'][start:start+64]@h+w['word_bias.weight'][start:start+64,0],seed,pos,1,word_temp)
            previous=start+within
            prev_punct=self.choose(w['punct_head.weight']@h+w['punct_bias']+w['word_punct_bias.weight'][previous],seed,pos,2,punct_temp)
            ids.append(previous);pmarks.append(prev_punct);texts.append(self.vocab[previous]+SUFFIX[prev_punct])
            hashes.append(hashlib.sha256(np.concatenate(state).astype('<f4').tobytes()).hexdigest())
            sat.append(float(np.mean(np.abs(np.concatenate(state))>=.999)))
        return {'status':'GENERATED','seed':seed,'prompt':prefix,'group_temperature':group_temp,'word_temperature':word_temp,
                'punctuation_temperature':punct_temp,'word_ids':ids,'punctuation':pmarks,'text':' '.join(texts),
                'state_sha256_each_step':hashes,'metrics':metrics(texts,{'mean_saturated_fraction':float(np.mean(sat)),
                'final_min':float(min(s.min()for s in state)),'final_max':float(max(s.max()for s in state))}),
                'state_resets':0,'forced_punctuation':False}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--data',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--group-temperature',type=float,default=1.)
    p.add_argument('--word-temperature',type=float,default=.8);p.add_argument('--punctuation-temperature',type=float,default=.8)
    p.add_argument('--words',type=int,default=128);p.add_argument('--seeds',default='0,42');p.add_argument('--prompt',default='')
    a=p.parse_args();assert not a.output.exists();a.output.mkdir(parents=True)
    model=Independent(a.checkpoint,a.data)
    rows=[model.generate(int(s),a.words,a.group_temperature,a.word_temperature,a.punctuation_temperature,a.prompt)for s in a.seeds.split(',')]
    result={'status':'RAW_FP32_REQUIRES_HUMAN_REVIEW','source':model.source,'script_sha256':sha(Path(__file__)),
            'decoder':'Three independent Keccak(seed,index,stage) draws for group,word,punctuation; float exp roundedQ32, not the integer logits/LUT. Domain0 fixed.',
            'outputs':rows}
    (a.output/'raw-outputs.json').write_text(json.dumps(result,indent=2)+'\n')
    (a.output/'raw-outputs.txt').write_text('\n\n'.join(f"seed{r['seed']} {r['status']}\n{r.get('text',r.get('unknown_inputs'))}"for r in rows)+'\n')
    print(json.dumps({'output':str(a.output),'generated':sum(r['status']=='GENERATED'for r in rows)}))


if __name__=='__main__':main()
