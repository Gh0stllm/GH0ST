#!/usr/bin/env python3
"""Report held-out loss separately for each corpus source; never changes selection."""
from __future__ import annotations
import argparse,json
from pathlib import Path
import numpy as np
import torch
from common import Streams,load_model,mask_for,validate,sha,save


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cache',type=Path,required=True)
    p.add_argument('--checkpoints',type=Path,nargs='+',required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--blocks-per-source',type=int,default=128)
    p.add_argument('--threads',type=int,default=2)
    a=p.parse_args();torch.set_num_threads(a.threads)
    if a.blocks_per_source<1:raise ValueError('Positive block count required')
    streams=Streams(a.cache);mask=mask_for(128);batches={}
    for index,kind in enumerate(streams.meta['streams']['validation']):
        rng=np.random.default_rng(20261024+101+index)
        batches[kind]=[streams.batch('validation',rng,min(16,a.blocks_per_source-start),128,64,
                         {kind:1.},.25)
                       for start in range(0,a.blocks_per_source,16)]
    report={'scope':'Deterministic held-out validation only, split by source; no test data or model changes.',
            'cache_fingerprint':streams.meta['fingerprint'],'runner_sha256':sha(Path(__file__)),
            'common_sha256':sha(Path(__file__).with_name('common.py')),
            'blocks_per_source':a.blocks_per_source,'checkpoints':[]}
    for path in a.checkpoints:
        model,_=load_model(path)
        row={'path':str(path.resolve()),'weights_sha256':sha(path/'model.safetensors'),
             'validation_by_source':{kind:validate(model,values,mask) for kind,values in batches.items()}}
        report['checkpoints'].append(row);save(a.output,report);print(json.dumps(row),flush=True)


if __name__=='__main__':main()
