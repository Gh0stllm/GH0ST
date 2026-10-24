"""Local training and evaluation helpers; input-only UNK is never a prediction."""
import collections,json,math,hashlib
from pathlib import Path
import numpy as np
import torch
from model import V,H,G,W,BOS,UNK,objective

def packed_groups(targets):
    flat=np.minimum(targets.reshape(-1),V-1);groups=flat//W
    order=np.argsort(groups,kind='stable');counts=np.bincount(groups,minlength=G)
    blocks=[];block_groups=[];offset=0
    for group,count in enumerate(counts):
        selected=order[offset:offset+count];offset+=count
        for start in range(0,int(count),64):blocks.append(selected[start:start+64]);block_groups.append(group)
    indices=np.zeros((len(blocks),64),dtype=np.int64);valid=np.zeros(indices.shape,dtype=np.float32)
    for i,block in enumerate(blocks):indices[i,:len(block)]=block;valid[i,:len(block)]=1
    return indices,valid,np.asarray(block_groups,dtype=np.int64)

class Corpus:
    def __init__(self,path):
        self.path=Path(path);self.meta=json.loads((self.path/'manifest.json').read_text())
        self.vocabulary=json.loads((self.path/'vocabulary.json').read_text())
        self.counts=json.loads((self.path/'counts.json').read_text());self.rows={}
        assert len(set(self.vocabulary))==V
        assert hashlib.sha256((self.path/'vocabulary.json').read_bytes()).hexdigest()==self.meta['vocabulary_sha256']
        for split in ('train','validation','test'):
            name=f'{split}.jsonl'
            assert hashlib.sha256((self.path/name).read_bytes()).hexdigest()==self.meta['artifacts'][name]['sha256'],f'Changed corpus: {name}'
            grouped=collections.defaultdict(list)
            for line in (self.path/f'{split}.jsonl').open():
                row=json.loads(line);domain=int(row['domain'])
                tokens=np.asarray(row['token_ids'],dtype=np.int64)
                assert len(tokens)>1 and (tokens>=0).all() and (tokens<=UNK).all()
                grouped[domain].append(tokens)
            self.rows[split]=dict(grouped)
        self.probabilities={split:{d:np.array([len(x) for x in docs],dtype=float)/sum(map(len,docs))
                                 for d,docs in domains.items()} for split,domains in self.rows.items()}

    def batch(self,split,rng,batch_size,width,warmup,voice_weight,device):
        x=np.zeros((batch_size,width),dtype=np.int64);y=x.copy()
        domains=np.zeros_like(x);resets=np.zeros(x.shape,dtype=bool);mask=np.ones(x.shape,dtype=np.float32)
        f=rng.random((*x.shape,6),dtype=np.float32);f[...,:3]*=4
        f[...,4:]=np.where(f[...,4:]<.5,-1.,1.)
        domain_words=collections.Counter()
        for b in range(batch_size):
            domain=int(rng.random()>=voice_weight);docs=self.rows[split][domain]
            pos=0
            while pos<width:
                di=int(rng.choice(len(docs),p=self.probabilities[split][domain]));doc=docs[di]
                start=0
                if split=='train' and pos==0 and len(doc)>width and rng.random()<.7:
                    start=int(rng.integers(1,len(doc)-width+1));mask[b,:warmup]=0
                n=min(width-pos,len(doc)-start)
                y[b,pos:pos+n]=doc[start:start+n];domains[b,pos:pos+n]=domain
                x[b,pos]=BOS if start==0 else doc[start-1]
                if n>1:x[b,pos+1:pos+n]=doc[start:start+n-1]
                resets[b,pos]=True;pos+=n
            mask[b]*=(y[b]<V)
            domain_words[domain]+=int(mask[b].sum())
        pack,valid,pack_groups=packed_groups(y)
        arrays={'x':x,'y':y,'features':f,'resets':resets,'mask':mask,'domains':domains,
                'pack_indices':pack,'pack_valid':valid,'pack_groups':pack_groups}
        result={name:torch.from_numpy(value).to(device) for name,value in arrays.items()}
        result['word_counts']=dict(domain_words);return result

@torch.no_grad()
def evaluate(model,batches):
    model.eval();result={};saturated=total_hidden=0
    for domain,rows in batches.items():
        loss_sum=words=0
        for row in rows:
            loss,n,h=objective(model,row);loss_sum+=float(loss);words+=int(n)
            saturated+=int((h.abs()>=.999).sum());total_hidden+=h.numel()
        result[str(domain)]={'nll_known_target':loss_sum/words,'words':words,'perplexity':math.exp(min(20,loss_sum/words))}
    return {'domains':result,'balanced_nll':sum(r['nll_known_target'] for r in result.values())/len(result),
            'saturation_fraction':saturated/total_hidden}

@torch.no_grad()
def sample(model,vocabulary,seeds=(0,42),words=96,temperature=.75,prompt='',domain=0):
    index={word:i for i,word in enumerate(vocabulary)};rows=[];model.eval()
    for seed in seeds:
        rng=torch.Generator().manual_seed(seed);state=torch.zeros(1,H);prev=torch.tensor([BOS]);output=[]
        features=torch.tensor([[.125,.25,.125,.5,-1.,-1.]])
        for word in prompt.lower().split():
            if word not in index:raise ValueError('Prompt not fully covered')
            state=model.step(prev,state,features,domain);prev=torch.tensor([index[word]])
        for _ in range(words):
            state=model.step(prev,state,features,domain)
            group=int(torch.multinomial(torch.softmax(model.logits(state)/temperature,-1),1,generator=rng))
            within=int(torch.multinomial(torch.softmax(model.logits(state,group)/temperature,-1),1,generator=rng))
            token=group*W+within;output.append(token);prev=torch.tensor([token])
        grams=collections.Counter(tuple(output[i:i+4]) for i in range(max(0,len(output)-3)))
        rows.append({'seed':seed,'temperature':temperature,'domain':domain,'prompt':prompt,
                     'text':' '.join(vocabulary[t] for t in output),'tokens':output,
                     'repeated_4gram_fraction':sum(max(0,c-1) for c in grams.values())/max(1,len(output)-3),
                     'state_resets':0,'forced_punctuation':False})
    return rows
