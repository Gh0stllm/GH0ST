"""Small synthetic timing probe; does not train or select a model."""
import argparse,json,time
import numpy as np
import torch
from fast_model import FastVoiceModel,OriginalVoiceModel,objective,project_packing
from train import batch_rows,synchronize

def main():
    p=argparse.ArgumentParser();p.add_argument('--device',default='mps');a=p.parse_args()
    torch.set_num_threads(2);torch.manual_seed(11)
    if a.device=='mps':assert torch.backends.mps.is_available()
    rng=np.random.default_rng(123)
    rows=[{'id':str(i),'tokens':rng.integers(0,256,128),'punct':np.zeros(128,dtype=np.int64)}for i in range(8)]
    batch=batch_rows(rows,a.device);result={'device':a.device,'torch':torch.__version__,
      'batch':8,'width':128,'scope':'synthetic three-step local timing only'}
    state=None
    for cls in (FastVoiceModel,OriginalVoiceModel):
        model=cls(np.ones(8192),hidden=384)
        if state is None:state=model.state_dict()
        else:model.load_state_dict(state)
        model.dropout=0.;model.to(a.device);times=[]
        for j in range(3 if cls is FastVoiceModel else 1):
            synchronize(a.device);start=time.monotonic();model.zero_grad(set_to_none=True)
            loss,_,_,_=objective(model,batch);loss.backward()
            if cls is FastVoiceModel:project_packing(model)
            synchronize(a.device);times.append(time.monotonic()-start)
        result[cls.__name__]={'seconds':times,'loss':float(loss.detach())}
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
