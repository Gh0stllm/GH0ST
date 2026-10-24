"""Two-layer word GRU with independently supervised punctuation."""
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

V,H,G,W,P,Q=8192,512,128,64,5,1024
BOS,UNK=V,V+1
SUFFIXES=('',',','.','!','?')

class VoiceModel(nn.Module):
    def __init__(self,counts,hidden=H):
        super().__init__();self.dropout=.1;self.hidden=hidden;H=hidden
        self.embedding=nn.Embedding(V+2,H);self.punct_embedding=nn.Embedding(P,H)
        self.wx1=nn.Parameter(torch.empty(3*H,H));self.wh1=nn.Parameter(torch.empty(3*H,H))
        self.wf=nn.Parameter(torch.zeros(3*H,6),requires_grad=False)
        self.bh1=nn.Parameter(torch.zeros(3*H));self.domain=nn.Embedding(2,3*H)
        self.wx2=nn.Parameter(torch.empty(3*H,H));self.wh2=nn.Parameter(torch.empty(3*H,H))
        self.bh2=nn.Parameter(torch.zeros(3*H))
        self.groups=nn.Embedding(G,H);self.group_bias=nn.Embedding(G,1)
        self.words=nn.Embedding(V,H);self.word_bias=nn.Embedding(V,1)
        self.punct_head=nn.Linear(H,P,bias=False);self.punct_bias=nn.Parameter(torch.zeros(P))
        self.word_punct_bias=nn.Embedding(V,P)
        nn.init.normal_(self.embedding.weight,std=.06);nn.init.normal_(self.punct_embedding.weight,std=.04)
        nn.init.zeros_(self.domain.weight);nn.init.zeros_(self.word_punct_bias.weight)
        for name in ('wx1','wx2'):nn.init.xavier_uniform_(getattr(self,name))
        for name in ('wh1','wh2'):
            for block in getattr(self,name).chunk(3,dim=0):nn.init.orthogonal_(block,gain=.9)
        nn.init.normal_(self.groups.weight,std=.03);nn.init.normal_(self.words.weight,std=.03)
        mass=np.maximum(np.asarray(counts,dtype=np.float64),1e-8).reshape(G,W);gm=mass.sum(1)
        with torch.no_grad():
            self.bh1[H:2*H]=1;self.bh2[H:2*H]=1
            self.group_bias.weight[:,0]=torch.tensor(np.log(gm/gm.sum()),dtype=torch.float32)
            self.word_bias.weight[:,0]=torch.tensor(np.log(mass/gm[:,None]).reshape(-1),dtype=torch.float32)
            self.punct_bias.copy_(torch.log(torch.tensor([.84,.06,.09,.005,.005])))

    @staticmethod
    def cell(incoming,state,weight):
        ir,iz,inn=incoming.chunk(3,-1);hr,hz,hn=F.linear(state,weight).chunk(3,-1)
        r=torch.sigmoid(ir+hr);z=torch.sigmoid(iz+hz)
        return z*state+(1-z)*torch.tanh(inn+r*hn)

    def forward(self,x,prev_punct,resets,domains,state=None):
        H=self.hidden
        h1,h2=(self.wx1.new_zeros((len(x),H)),self.wx1.new_zeros((len(x),H))) if state is None else state
        embedded=self.embedding(x)+self.punct_embedding(prev_punct)
        embedded=F.dropout(embedded,self.dropout,self.training)
        incoming=F.linear(embedded,self.wx1)+self.bh1+self.domain(domains)
        states=[]
        for t in range(x.shape[1]):
            h1=h1.masked_fill(resets[:,t,None],0);h2=h2.masked_fill(resets[:,t,None],0)
            h1=self.cell(incoming[:,t],h1,self.wh1)
            h2=self.cell(F.linear(h1,self.wx2)+self.bh2,h2,self.wh2)
            states.append(h2)
        return torch.stack(states,1),(h1,h2)

    def step(self,previous,prev_punct,state,domain=0):
        h1,h2=state
        x=F.linear(self.embedding(previous)+self.punct_embedding(prev_punct),self.wx1)+self.bh1+self.domain.weight[domain]
        h1=self.cell(x,h1,self.wh1);h2=self.cell(F.linear(h1,self.wx2)+self.bh2,h2,self.wh2)
        return h1,h2

    def logits(self,h,group=None):
        if group is None:return F.linear(h,self.groups.weight,self.group_bias.weight[:,0])
        start=int(group)*W;return F.linear(h,self.words.weight[start:start+W],self.word_bias.weight[start:start+W,0])

    def punctuation_logits(self,h,word):
        known=(word<V).unsqueeze(-1)
        return self.punct_head(h)+self.punct_bias+known*self.word_punct_bias(word.clamp_max(V-1))

def joint_word_log_probability(model,h,tokens):
    """Exact normalized hierarchical log probabilities for sparse labels.

    Training only: this neither masks nor changes the inference vocabulary.
    """
    groups=tokens//W
    group_logp=F.log_softmax(model.logits(h),dim=-1).gather(1,groups[:,None])[:,0]
    rows=model.words.weight.reshape(G,W,model.hidden)[groups]
    logits=torch.bmm(rows,h[:,:,None])[:,:,0]+model.word_bias.weight.reshape(G,W)[groups]
    word_logp=F.log_softmax(logits,dim=-1).gather(1,(tokens%W)[:,None])[:,0]
    return group_logp+word_logp


def grammar_contrastive_loss(model,h,batch,margin=2.):
    positions=batch.get('grammar_positions')
    if positions is None or positions.numel()==0:return h.sum()*0
    good=batch['grammar_good_tokens'];bad=batch['grammar_bad_tokens']
    context=h[positions]
    good_logp=joint_word_log_probability(model,context,good)
    bad_logp=joint_word_log_probability(model,context,bad)
    return F.softplus(margin+bad_logp-good_logp).mean()


def objective(model,batch,state=None,punct_weight=1.,grammar_weight=0.,grammar_margin=2.):
    H=model.hidden
    hidden,state=model(batch['x'],batch['prev_punct'],batch['resets'],batch['domains'],state)
    h=F.dropout(hidden,model.dropout,model.training).reshape(-1,H)
    targets=batch['y'].reshape(-1);safe=targets.clamp_max(V-1)
    word_mask=batch['word_mask'].reshape(-1);valid=batch['valid'].reshape(-1)
    group_loss=F.cross_entropy(model.logits(h),safe//W,reduction='none')
    indices=batch['pack_indices'];packs=batch['pack_groups']
    wl=torch.bmm(h[indices],model.words.weight.reshape(G,W,H)[packs].transpose(1,2))
    wl=wl+model.word_bias.weight.reshape(G,1,W)[packs]
    word_loss=F.cross_entropy(wl.transpose(1,2),safe[indices]%W,reduction='none')
    word_sum=(group_loss*word_mask).sum()+(word_loss*word_mask[indices]*batch['pack_valid']).sum()
    punct_loss=F.cross_entropy(model.punctuation_logits(h,targets),batch['punct'].reshape(-1),reduction='none')
    punct_sum=(punct_loss*valid).sum()
    grammar_loss=grammar_contrastive_loss(model,h,batch,grammar_margin)if grammar_weight else h.sum()*0
    loss=word_sum/word_mask.sum().clamp_min(1)+punct_weight*punct_sum/valid.sum().clamp_min(1)+grammar_weight*grammar_loss
    return loss,{'word_loss':word_sum,'word_count':word_mask.sum(),'punct_loss':punct_sum,'punct_count':valid.sum(),'grammar_loss':grammar_loss},state,hidden
