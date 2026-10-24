#!/usr/bin/env python3
"""Check packed loss and retained-UNK gradients without training or editing inputs."""
import argparse,hashlib,json,sys
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'training'))
from model import VoiceModel,objective,V,H,UNK
from engine import packed_groups


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    torch.set_num_threads(2);torch.manual_seed(2901)
    model=VoiceModel(np.ones(V));model.eval()
    x=torch.tensor([[V,5,UNK,9],[V,UNK,33,15]],dtype=torch.long)
    y=torch.tensor([[5,UNK,9,18],[UNK,33,15,7]])
    mask=(y<V).float();mask[0,0]=0
    indices,valid,groups=packed_groups(y.numpy())
    batch={'x':x,'y':y,'mask':mask,'features':torch.randn(2,4,6),
           'resets':torch.tensor([[1,0,0,0],[1,0,0,0]],dtype=torch.bool),'domains':torch.zeros_like(x),
           'pack_indices':torch.from_numpy(indices),'pack_valid':torch.from_numpy(valid),'pack_groups':torch.from_numpy(groups)}
    packed,n,_=objective(model,batch);named=list(model.named_parameters())
    actual=torch.autograd.grad(packed,[param for _,param in named])
    hidden=model(batch['x'],batch['features'],batch['resets'],batch['domains']).reshape(-1,H)
    direct=hidden.sum()*0
    for i,target in enumerate(y.reshape(-1)):
        if mask.reshape(-1)[i]>0:
            t=int(target);g=t//64
            direct+=F.cross_entropy(model.logits(hidden[i:i+1]),torch.tensor([g]),reduction='sum')
            direct+=F.cross_entropy(model.logits(hidden[i:i+1],g),torch.tensor([t%64]),reduction='sum')
    expected=torch.autograd.grad(direct,[param for _,param in named])
    loss_error=abs(float(packed.detach())-float(direct.detach()))
    gradient_error=max(float((a-b).abs().max())for a,b in zip(actual,expected))
    unknown_gradient=float(dict(zip([name for name,_ in named],actual))['embedding.weight'][UNK].abs().sum())
    assert loss_error<1e-5 and gradient_error<1e-5 and unknown_gradient>0
    result={'status':'PASS','loss_difference':loss_error,'max_parameter_gradient_difference':gradient_error,
            'known_supervised_targets':int(n),'masked_targets':int((mask==0).sum()),
            'unknown_input_embedding_gradient_l1':unknown_gradient,
            'meaning':'Packed CE equals direct known-target CE. Later known targets differentiate through retained UNK input. Dropout disabled for this algebra check.',
            'sources':{name:hashlib.sha256((ROOT/'training'/name).read_bytes()).hexdigest()for name in ['model.py','engine.py']}}
    a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))


if __name__=='__main__':main()
