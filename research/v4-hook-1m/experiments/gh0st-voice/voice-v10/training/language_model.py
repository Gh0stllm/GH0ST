"""Native GRU with exact original domain biases, including mixed-domain batches."""
import torch
from torch.nn import functional as F
from fast_model import OriginalVoiceModel


class LanguageVoiceModel(OriginalVoiceModel):
    def forward(self, x, prev_punct, resets, domains, state=None):
        embedded=self.embedding(x)+self.punct_embedding(prev_punct)
        embedded=F.dropout(embedded,self.dropout,self.training)
        one_hot=F.one_hot(domains,num_classes=2).to(embedded.dtype)
        inputs=torch.cat((embedded,one_hot),dim=-1)
        initial=embedded.new_zeros((2,x.shape[0],self.hidden))if state is None else torch.stack(state)
        zeros=self.bh1.new_zeros(3*self.hidden)
        # The extra two input channels select existing learned domain biases;
        # concatenation creates no additional trainable parameters.
        first_weight=torch.cat((self.wx1,self.domain.weight.T),dim=1)
        weights=[first_weight,self.wh1,self.bh1,zeros,
                 self.wx2,self.wh2,self.bh2,zeros]
        hidden,final=torch._VF.gru(inputs,initial,weights,True,2,0.0,self.training,False,True)
        return hidden,(final[0],final[1])
