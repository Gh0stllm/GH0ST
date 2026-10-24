#!/usr/bin/env python3
"""Small matched64-token,16-warmup held-out source comparison."""
import argparse,json,sys
from pathlib import Path
import numpy as np
import torch
HERE=Path(__file__).resolve().parent;V3=HERE.parents[2]
sys.path.insert(0,str(V3/'training-teacher'))
from common import Streams,load_model,mask_for,validate,sha,save

def main():
    p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,required=True);p.add_argument('--checkpoints',type=Path,nargs='+',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    torch.set_num_threads(2);streams=Streams(a.cache);batches={};mask=mask_for(64)
    for index,kind in enumerate(streams.meta['streams']['validation']):
        rng=np.random.default_rng(20261024+index)
        batches[kind]=[streams.batch('validation',rng,16,64,16,{kind:1.},.4) for _ in range(4)]
    report={'scope':'Fixed64 windows per source,64-token blocks,16-token context warmup,40%quote starts; validation only.',
            'runner_sha256':sha(Path(__file__)),'cache_fingerprint':streams.meta['fingerprint'],'checkpoints':[]}
    for path in a.checkpoints:
        model,_=load_model(path);row={'path':str(path),'weight_sha256':sha(path/'model.safetensors'),'by_source':{kind:validate(model,b,mask) for kind,b in batches.items()}}
        report['checkpoints'].append(row);save(a.output,report);print(json.dumps(row),flush=True);del model

if __name__=='__main__':main()
