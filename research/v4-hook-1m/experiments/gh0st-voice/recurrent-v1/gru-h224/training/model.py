"""Gated H224 recurrent comparator; no recurrent bias, reset-after convention."""
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

V,H,D,Q=8192,224,13,1024
PARAMETERS=(V+1)*H+6*H*H+3*H*6+3*H+(V-1)*(H+1)

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
        self.wx=nn.Parameter(torch.empty(3*H,H))
        self.wh=nn.Parameter(torch.empty(3*H,H))
        self.wf=nn.Parameter(torch.empty(3*H,6))
        self.bh=nn.Parameter(torch.zeros(3*H))
        self.nodes=nn.Embedding(V-1,H)
        self.bias=nn.Embedding(V-1,1)
        nn.init.normal_(self.embedding.weight,std=.05)
        nn.init.normal_(self.nodes.weight,std=.025)
        nn.init.xavier_uniform_(self.wx)
        nn.init.xavier_uniform_(self.wf,gain=.1)
        for block in self.wh.chunk(3,dim=0):nn.init.orthogonal_(block,gain=.9)
        mass=np.zeros(2*V-1)
        mass[V-1:]=np.maximum(np.asarray(counts),1e-9)
        for node in range(V-2,-1,-1):mass[node]=mass[2*node+1]+mass[2*node+2]
        with torch.no_grad():
            self.bh[H:2*H]=1.
            self.bias.weight[:,0]=torch.tensor(np.log(mass[2:2*V-1:2]/mass[1:2*V-1:2]),dtype=torch.float32)
        assert sum(p.numel() for p in self.parameters())==PARAMETERS

    def cell(self,incoming,state):
        ir,iz,inn=incoming.chunk(3,dim=-1)
        hr,hz,hn=F.linear(state,self.wh).chunk(3,dim=-1)
        reset=torch.sigmoid(ir+hr)
        update=torch.sigmoid(iz+hz)
        candidate=torch.tanh(inn+reset*hn)
        return update*state+(1-update)*candidate

    def forward(self,x,features,resets):
        state=self.wx.new_zeros((len(x),H))
        incoming=F.linear(self.embedding(x),self.wx)+F.linear(features,self.wf)+self.bh
        states=[]
        for t in range(x.shape[1]):
            state=state.masked_fill(resets[:,t,None],0)
            state=self.cell(incoming[:,t],state)
            states.append(state)
        return torch.stack(states,dim=1)

    def step(self,previous,state,features):
        incoming=F.linear(self.embedding(previous),self.wx)+F.linear(features,self.wf)+self.bh
        return self.cell(incoming,state)

def objective(model,batch,paths,bits):
    x,y,features,resets,mask=batch[:5]
    hidden=model(x,features,resets)
    route=paths[y]
    logits=(model.nodes(route)*hidden.unsqueeze(-2)).sum(-1)+model.bias(route).squeeze(-1)
    losses=F.binary_cross_entropy_with_logits(logits,bits[y],reduction='none').sum(-1)
    return (losses*mask).sum(),mask.sum(),hidden
