"""Small independent numerical checks for masked, packed adaptive-head training."""
import json
import numpy as np
import torch
from torch.nn import functional as F
from model import VoiceModel,V,H,G,W,UNK,objective
from engine import packed_groups

torch.manual_seed(612);torch.set_num_threads(2)
m=VoiceModel(np.ones(V));m.dropout=0;m.eval()
x=torch.tensor([[V,12,UNK,8],[V,89,2,43]])
y=torch.tensor([[12,UNK,8,4],[89,2,43,92]])
mask=(y<V).float();resets=torch.zeros_like(x,dtype=torch.bool);resets[:,0]=True
pi,pv,pg=packed_groups(y.numpy())
b={'x':x,'y':y,'mask':mask,'features':torch.zeros(2,4,6),'resets':resets,'domains':torch.zeros_like(x),
   'pack_indices':torch.tensor(pi),'pack_valid':torch.tensor(pv),'pack_groups':torch.tensor(pg)}
loss,n,h=objective(m,b)
direct=loss.new_zeros(())
for i in range(2):
    for t in range(4):
        if mask[i,t]:
            target=int(y[i,t]);hidden=h[i,t:t+1]
            direct=direct+F.cross_entropy(m.logits(hidden),torch.tensor([target//W]),reduction='sum')
            direct=direct+F.cross_entropy(m.logits(hidden,target//W),torch.tensor([target%W]),reduction='sum')
assert torch.allclose(loss,direct,atol=1e-5),(loss,direct)
(loss/n).backward()
assert torch.isfinite(m.embedding.weight.grad).all()
assert m.embedding.weight.grad[UNK].abs().sum()>0,'Following known targets must train through UNK input'
assert m.domain.weight.grad[0].abs().sum()>0
assert h.abs().max()<=1
assert sum(p.numel() for p in m.parameters())==4014560
result={'status':'PASS','parameters':4014560,'packed_equals_independent_losses':True,'unknown_target_masked':True,
        'following_known_loss_trains_unknown_input':True,'domain_gradient_nonzero':True,'signed_state_bounded':True,'known_targets':int(n)}
open('objective-checks.json','w').write(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
