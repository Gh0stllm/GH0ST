"""Short local throughput comparison; synthetic targets, never quality evidence."""
import json,time
from pathlib import Path
import numpy as np
import torch
from model import VoiceModel,V,objective
from engine import tensor_batch

torch.set_num_threads(2)
assert torch.backends.mps.is_available()
results=[]
for size in (64,128,192):
    torch.manual_seed(771)
    model=VoiceModel(np.ones(V),hidden=384).to('mps')
    opt=torch.optim.AdamW((p for p in model.parameters()if p.requires_grad),lr=.0007,foreach=False)
    shape=(size,128);rng=np.random.default_rng(771)
    arrays={'x':rng.integers(0,V,shape,dtype=np.int64),'y':rng.integers(0,V,shape,dtype=np.int64),
            'prev_punct':np.zeros(shape,np.int64),'punct':np.zeros(shape,np.int64),
            'resets':np.zeros(shape,bool),'domains':np.zeros(shape,np.int64),
            'valid':np.ones(shape,np.float32),'word_mask':np.ones(shape,np.float32)}
    batch=tensor_batch(arrays,'mps');timings=[]
    for step in range(4):
        torch.mps.synchronize();start=time.monotonic();opt.zero_grad(set_to_none=True)
        loss,_,_,_=objective(model,batch);loss.backward();opt.step()
        torch.mps.synchronize();timings.append(time.monotonic()-start)
    elapsed=sum(timings[1:]);row={'batch':size,'width':128,'steps':3,'seconds':elapsed,'words_per_second':size*128*3/elapsed}
    results.append(row);print(json.dumps(row),flush=True)
    del model,opt,batch,loss;torch.mps.empty_cache()
out=Path(__file__).with_name('gpu-throughput.json')
out.write_text(json.dumps({'device':'mps','synthetic_benchmark_only':True,'hidden':384,'results':results},indent=2)+'\n')
