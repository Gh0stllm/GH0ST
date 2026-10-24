"""Small CPU parity check: native GRU vs original handwritten gate equations."""
import copy, json
import numpy as np
import torch
from fast_model import OriginalVoiceModel, FastVoiceModel, objective, project_packing
from engine import tensor_batch


def main():
    torch.set_num_threads(2)
    torch.manual_seed(1024)
    original = OriginalVoiceModel(np.ones(8192), hidden=12).double()
    fast = FastVoiceModel(np.ones(8192), hidden=12).double()
    fast.load_state_dict(original.state_dict())
    original.dropout = fast.dropout = 0.0
    original.eval(); fast.eval()
    x = torch.randint(0, 8192, (3, 7))
    pp = torch.randint(0, 5, (3, 7))
    reset = torch.zeros((3, 7), dtype=torch.bool); reset[:, 0] = True
    domains = torch.zeros_like(x)
    first, fs = original(x, pp, reset, domains)
    second, ss = fast(x, pp, reset, domains)
    forward_max = float((first-second).abs().max().detach())
    state_max = max(float((a-b).abs().max().detach()) for a,b in zip(fs,ss))
    assert torch.allclose(first, second, atol=1e-12, rtol=1e-11)
    # Nontrivial shared objective reaches all recurrent/input parameters.
    multiplier = torch.randn_like(first)
    (first*multiplier).sum().backward(); (second*multiplier).sum().backward()
    gradients = {}
    for (name,a), (_,b) in zip(original.named_parameters(), fast.named_parameters()):
        if a.grad is None:
            assert b.grad is None; continue
        maximum = float((a.grad-b.grad).abs().max())
        gradients[name] = maximum
        assert torch.allclose(a.grad,b.grad,atol=1e-11,rtol=1e-9), name
    # Prefix states are the same at every valid length, including padded rows.
    for n in (1,3,7):
        o,_=original(x[:,:n],pp[:,:n],reset[:,:n],domains[:,:n])
        f,_=fast(x[:,:n],pp[:,:n],reset[:,:n],domains[:,:n])
        assert torch.allclose(o,f,atol=1e-12,rtol=1e-11)
    original.zero_grad(set_to_none=True);fast.zero_grad(set_to_none=True)
    targets=np.arange(21,dtype=np.int64).reshape(3,7)
    valid=np.ones((3,7),dtype=np.float32);valid[0,3:]=0;valid[1,5:]=0
    batch=tensor_batch({'x':x.numpy(),'y':targets,'prev_punct':pp.numpy(),
      'punct':pp.numpy(),'resets':reset.numpy(),'domains':domains.numpy(),
      'valid':valid,'word_mask':valid},'cpu')
    ol,_,_,_=objective(original,batch);fl,_,_,_=objective(fast,batch)
    assert torch.allclose(ol,fl,atol=1e-12,rtol=1e-11)
    ol.backward();fl.backward();objective_grad_max=0.
    for (name,a),(_,b) in zip(original.named_parameters(),fast.named_parameters()):
        if a.grad is None:assert b.grad is None;continue
        objective_grad_max=max(objective_grad_max,float((a.grad-b.grad).abs().max()))
        assert torch.allclose(a.grad,b.grad,atol=1e-11,rtol=1e-9),name
    result={'status':'PASS','dtype':'float64 CPU','max_forward_difference':forward_max,
            'max_final_state_difference':state_max,'gradient_maxima':gradients,
            'padded_objective_difference':float((ol-fl).abs().detach()),
            'all_objective_gradient_maximum':objective_grad_max,
            'policy':'Each row has zero initial state, domain0, reset at first position only.'}
    print(json.dumps(result,indent=2))
    return result


if __name__=='__main__': main()
