"""Conditional GRU language model, with a 128 x 64 adaptive word head."""
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

V,H,G,W,Q=8192,224,128,64,1024
BOS,UNK=V,V+1

class VoiceModel(nn.Module):
    def __init__(self,counts):
        super().__init__()
        self.dropout=.1
        self.embedding=nn.Embedding(V+2,H)
        self.wx=nn.Parameter(torch.empty(3*H,H))
        self.wh=nn.Parameter(torch.empty(3*H,H))
        self.wf=nn.Parameter(torch.empty(3*H,6))
        self.bh=nn.Parameter(torch.zeros(3*H))
        self.domain=nn.Embedding(2,3*H)
        self.groups=nn.Embedding(G,H)
        self.group_bias=nn.Embedding(G,1)
        self.words=nn.Embedding(V,H)
        self.word_bias=nn.Embedding(V,1)
        nn.init.normal_(self.embedding.weight,std=.05)
        nn.init.xavier_uniform_(self.wx)
        nn.init.xavier_uniform_(self.wf,gain=.1)
        for block in self.wh.chunk(3,dim=0):nn.init.orthogonal_(block,gain=.9)
        nn.init.zeros_(self.domain.weight)
        nn.init.normal_(self.groups.weight,std=.025)
        nn.init.normal_(self.words.weight,std=.025)
        mass=np.maximum(np.asarray(counts,dtype=np.float64),1e-9).reshape(G,W)
        group_mass=mass.sum(1)
        with torch.no_grad():
            self.bh[H:2*H]=1
            self.group_bias.weight[:,0]=torch.tensor(np.log(group_mass/group_mass.sum()),dtype=torch.float32)
            self.word_bias.weight[:,0]=torch.tensor(np.log(mass/group_mass[:,None]).reshape(-1),dtype=torch.float32)

    def cell(self,incoming,state):
        ir,iz,inn=incoming.chunk(3,dim=-1)
        hr,hz,hn=F.linear(state,self.wh).chunk(3,dim=-1)
        r=torch.sigmoid(ir+hr)
        z=torch.sigmoid(iz+hz)
        n=torch.tanh(inn+r*hn)
        return z*state+(1-z)*n

    def forward(self,x,features,resets,domains):
        state=self.wx.new_zeros((len(x),H));states=[]
        embedded=F.dropout(self.embedding(x),p=self.dropout,training=self.training)
        incoming=F.linear(embedded,self.wx)+F.linear(features,self.wf)+self.bh+self.domain(domains)
        for t in range(x.shape[1]):
            state=state.masked_fill(resets[:,t,None],0)
            state=self.cell(incoming[:,t],state)
            states.append(state)
        return torch.stack(states,dim=1)

    def step(self,previous,state,features,domain=0):
        incoming=F.linear(self.embedding(previous),self.wx)+F.linear(features,self.wf)+self.bh+self.domain.weight[domain]
        return self.cell(incoming,state)

    def logits(self,hidden,group=None):
        if group is None:return F.linear(hidden,self.groups.weight,self.group_bias.weight[:,0])
        start=int(group)*W
        return F.linear(hidden,self.words.weight[start:start+W],self.word_bias.weight[start:start+W,0])

def objective(model,batch):
    hidden=model(batch['x'],batch['features'],batch['resets'],batch['domains'])
    h=F.dropout(hidden,p=model.dropout,training=model.training).reshape(-1,H)
    target=batch['y'].reshape(-1).clamp_max(V-1)
    mask=batch['mask'].reshape(-1)
    group_logits=F.linear(h,model.groups.weight,model.group_bias.weight[:,0])
    group_loss=F.cross_entropy(group_logits,target//W,reduction='none')
    # Pack by target class. This avoids an N x 64 x H weight gather while
    # retaining exactly the same target-conditional softmax objective.
    indices=batch['pack_indices'];valid=batch['pack_valid']
    packed_hidden=h[indices]
    pack_groups=batch['pack_groups']
    word_logits=torch.bmm(packed_hidden,model.words.weight.reshape(G,W,H)[pack_groups].transpose(1,2))
    word_logits=word_logits+model.word_bias.weight.reshape(G,1,W)[pack_groups]
    packed_targets=target[indices]%W
    word_loss=F.cross_entropy(word_logits.transpose(1,2),packed_targets,reduction='none')
    loss=(group_loss*mask).sum()+(word_loss*mask[indices]*valid).sum()
    return loss,mask.sum(),hidden
