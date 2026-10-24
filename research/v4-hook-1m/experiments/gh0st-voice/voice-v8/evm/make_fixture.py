import argparse,json
from pathlib import Path
import numpy as np
from safetensors.numpy import save_file
p=argparse.ArgumentParser();p.add_argument('--hidden',type=int,default=512);p.add_argument('--out',type=Path,required=True);a=p.parse_args();h=a.hidden;assert h in(384,512)and not a.out.exists();a.out.mkdir(parents=True)
rng=np.random.default_rng(8512+h)
shapes={'embedding.weight':(8194,h),'punct_embedding.weight':(5,h),'wx1':(3*h,h),'wh1':(3*h,h),'wf':(3*h,6),'bh1':(3*h,),
        'wx2':(3*h,h),'wh2':(3*h,h),'bh2':(3*h,),'domain.weight':(2,3*h),'groups.weight':(128,h),'group_bias.weight':(128,1),'words.weight':(8192,h),'word_bias.weight':(8192,1),'punct_head.weight':(5,h),'punct_bias':(5,),'word_punct_bias.weight':(8192,5)}
weights={n:rng.normal(0,.025,size=s).astype(np.float32)for n,s in shapes.items()};weights['wf'][:]=0
for n in('bh1','bh2'):weights[n][:]=0;weights[n][h:2*h]=1
save_file(weights,a.out/'model.safetensors');print(sum(x.size for x in weights.values()))
