#!/usr/bin/env python3
"""Float-reference continuous RNN generation; no forced punctuation or resets."""
import argparse
import collections
import json
from pathlib import Path
import numpy as np
import torch
from safetensors.torch import load_file
from model import WideModel,V,H,Q
from prepare_data import words

def sample(model,vocabulary,seeds=(0,42),count=128,temperature_q10=1024,prompt='',feature_mode='nominal'):
    assert count>0 and 64<=temperature_q10<=4096
    index={word:i for i,word in enumerate(vocabulary)}
    prompt_tokens=words(prompt)
    if any(word not in index for word in prompt_tokens):
        raise ValueError('Prompt contains an out-of-vocabulary word')
    model.eval();results=[]
    with torch.inference_mode():
        for seed in seeds:
            generator=torch.Generator().manual_seed(int(seed))
            previous=torch.tensor([V]);state=torch.zeros((1,H));output=[];zeros=0;saturated=0;steps=0
            def features(step):
                if feature_mode=='extreme':
                    return torch.tensor([[4.,4.,4.,1.,1. if step%2 else -1.,-1. if step%2 else 1.]])
                return torch.tensor([[.125,.25,.125,.5,-1.,-1.]])
            for word in prompt_tokens:
                state=model.step(previous,state,features(steps));previous=torch.tensor([index[word]]);steps+=1
            for step in range(count):
                state=model.step(previous,state,features(steps));steps+=1
                zeros+=int((state==0).sum());saturated+=int((state>=8).sum())
                node=torch.zeros(1,dtype=torch.long)
                for depth in range(13):
                    logit=(model.nodes(node)*state).sum(-1)+model.bias(node).squeeze(-1)
                    probability=torch.sigmoid(logit/(temperature_q10/Q))
                    right=torch.rand(1,generator=generator)<probability
                    node=node*2+1+right.long()
                previous=node-(V-1);output.append(int(previous))
            text=' '.join(vocabulary[token] for token in output)
            grams=collections.Counter(tuple(output[i:i+4]) for i in range(max(0,len(output)-3)))
            repeated=sum(max(n-1,0) for n in grams.values())/max(1,len(output)-3)
            results.append({'seed':int(seed),'prompt':prompt,'generated_text':text,'tokens':output,'words':len(output),
                            'temperature_q10':temperature_q10,'feature_mode':feature_mode,'state_resets_after_start':0,
                            'forced_punctuation':False,'hidden_zero_fraction':zeros/max(1,count*H),
                            'hidden_saturated_fraction':saturated/max(1,count*H),'repeated_4gram_fraction':repeated})
    return results

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint',type=Path,required=True);parser.add_argument('--data',type=Path,required=True)
    parser.add_argument('--seeds',default='0,42,7,123');parser.add_argument('--words',type=int,default=128)
    parser.add_argument('--temperature-q10',type=int,default=1024);parser.add_argument('--prompt',default='')
    parser.add_argument('--features',choices=['nominal','extreme'],default='nominal');parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();torch.set_num_threads(2)
    vocab=json.loads((args.data/'vocabulary.json').read_text());counts=json.loads((args.data/'counts.json').read_text())
    model=WideModel(sum(np.asarray(row) for row in counts.values()))
    model.load_state_dict(load_file(args.checkpoint/'model.safetensors'))
    result={'scope':'Float reference; independent integer/EVM parity remains separate.','runs':sample(model,vocab,[int(s) for s in args.seeds.split(',')],args.words,args.temperature_q10,args.prompt,args.features)}
    args.output.mkdir(parents=True,exist_ok=False)
    (args.output/'samples.json').write_text(json.dumps(result,indent=2)+'\n')
    (args.output/'samples.txt').write_text('\n\n'.join(f"seed {r['seed']} / prompt: {r['prompt']}\n{r['generated_text']}" for r in result['runs'])+'\n')
    print(json.dumps({'output':str(args.output),'streams':len(result['runs'])}))
if __name__=='__main__':main()
