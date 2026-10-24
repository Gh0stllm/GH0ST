"""Exact mixed-domain native GRU versus the original handwritten equations."""
import json
import numpy as np
import torch
from fast_model import OriginalVoiceModel,objective
from language_model import LanguageVoiceModel
from engine import tensor_batch


def main():
    torch.set_num_threads(2);torch.manual_seed(741160)
    a=OriginalVoiceModel(np.ones(8192),hidden=12).double()
    with torch.no_grad():a.domain.weight.normal_(std=.17)
    b=LanguageVoiceModel(np.ones(8192),hidden=12).double();b.load_state_dict(a.state_dict())
    a.dropout=b.dropout=0.;a.eval();b.eval()
    x=torch.randint(0,8192,(3,7));pp=torch.randint(0,5,(3,7));domains=torch.randint(0,2,(3,7))
    resets=torch.zeros((3,7),dtype=torch.bool);resets[:,0]=True
    ah,astate=a(x,pp,resets,domains);bh,bstate=b(x,pp,resets,domains)
    forward=float((ah-bh).abs().max().detach())
    assert torch.allclose(ah,bh,atol=1e-12,rtol=1e-11)
    state=max(float((aa-bb).abs().max().detach())for aa,bb in zip(astate,bstate))
    multiplier=torch.randn_like(ah);(ah*multiplier).sum().backward();(bh*multiplier).sum().backward()
    grad=0.
    for (name,aa),(_,bb)in zip(a.named_parameters(),b.named_parameters()):
        if aa.grad is None:assert bb.grad is None;continue
        grad=max(grad,float((aa.grad-bb.grad).abs().max()));assert torch.allclose(aa.grad,bb.grad,atol=1e-11,rtol=1e-9),name
    a.zero_grad(set_to_none=True);b.zero_grad(set_to_none=True)
    valid=np.ones((3,7),dtype=np.float32);valid[0,4:]=0;valid[1,6:]=0
    batch=tensor_batch({'x':x.numpy(),'y':np.arange(21).reshape(3,7),'prev_punct':pp.numpy(),
      'punct':pp.numpy(),'resets':resets.numpy(),'domains':domains.numpy(),'valid':valid,'word_mask':valid},'cpu')
    al,_,_,_=objective(a,batch);bl,_,_,_=objective(b,batch)
    loss=float((al-bl).abs().detach());assert torch.allclose(al,bl,atol=1e-12,rtol=1e-11)
    al.backward();bl.backward();objective_grad=0.
    for (name,aa),(_,bb)in zip(a.named_parameters(),b.named_parameters()):
        if aa.grad is None:assert bb.grad is None;continue
        objective_grad=max(objective_grad,float((aa.grad-bb.grad).abs().max()));assert torch.allclose(aa.grad,bb.grad,atol=1e-11,rtol=1e-9),name
    r={'status':'PASS','dtype':'CPU float64','domains':'Mixed 0/1 including within-row changes',
       'maximum_forward_difference':forward,'maximum_state_difference':state,
       'maximum_gradient_difference':grad,'masked_objective_difference':loss,
       'maximum_objective_gradient_difference':objective_grad,'parameter_keys_unchanged':set(a.state_dict())==set(b.state_dict())}
    print(json.dumps(r,indent=2));return r


if __name__=='__main__':main()
