"""The original H265/V8192 recurrent architecture with device-aware operations."""
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

V,H,D,Q=8192,265,13,1024
PARAMETERS=(V+1)*H+2*H*H+H*6+H+(V-1)*(H+1)
assert PARAMETERS==4492256

def tree_paths():
    ids=np.arange(V)
    bits=((ids[:,None]>>np.arange(D-1,-1,-1))&1).astype(np.float32)
    paths=np.zeros((V,D),dtype=np.int64)
    for depth in range(1,D):paths[:,depth]=paths[:,depth-1]*2+1+bits[:,depth-1]
    return torch.from_numpy(paths),torch.from_numpy(bits)

class WideModel(nn.Module):
    def __init__(self,counts):
        super().__init__()
        self.embedding=nn.Embedding(V+1,H)
        self.wx=nn.Parameter(torch.empty(H,H));self.wh=nn.Parameter(torch.empty(H,H))
        self.wf=nn.Parameter(torch.empty(H,6));self.bh=nn.Parameter(torch.zeros(H))
        self.nodes=nn.Embedding(V-1,H);self.bias=nn.Embedding(V-1,1)
        nn.init.normal_(self.embedding.weight,std=.05);nn.init.normal_(self.nodes.weight,std=.025)
        nn.init.xavier_uniform_(self.wx);nn.init.orthogonal_(self.wh,gain=.8);nn.init.xavier_uniform_(self.wf,gain=.1)
        mass=np.zeros(2*V-1);mass[V-1:]=np.maximum(np.asarray(counts),1e-9)
        for node in range(V-2,-1,-1):mass[node]=mass[node*2+1]+mass[node*2+2]
        with torch.no_grad():self.bias.weight[:,0]=torch.tensor(np.log(mass[2:2*V-1:2]/mass[1:2*V-1:2]),dtype=torch.float32)
        assert sum(p.numel() for p in self.parameters())==PARAMETERS

    def forward(self,x,features,resets):
        state=self.wx.new_zeros((len(x),H));states=[]
        embedded=self.embedding(x)
        incoming=F.linear(embedded,self.wx)+F.linear(features,self.wf)+self.bh
        for t in range(x.shape[1]):
            state=state.masked_fill(resets[:,t,None],0)
            state=torch.clamp(incoming[:,t]+F.linear(state,self.wh),0,8)
            states.append(state)
        return torch.stack(states,dim=1)

    def step(self,previous,state,features):
        return torch.clamp(F.linear(self.embedding(previous),self.wx)+F.linear(state,self.wh)+F.linear(features,self.wf)+self.bh,0,8)

def objective(model,batch,paths,bits):
    x,y,features,resets,mask=batch[:5]
    hidden=model(x,features,resets)
    route=paths[y]
    logits=(model.nodes(route)*hidden.unsqueeze(-2)).sum(-1)+model.bias(route).squeeze(-1)
    losses=F.binary_cross_entropy_with_logits(logits,bits[y],reduction='none').sum(-1)
    return (losses*mask).sum(),mask.sum(),hidden
