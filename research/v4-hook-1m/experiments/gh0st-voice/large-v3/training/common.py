"""Local fixed-architecture utilities for large-corpus training."""
from __future__ import annotations
import collections,hashlib,json,math,os
from pathlib import Path
os.environ.setdefault('HF_HUB_OFFLINE','1');os.environ.setdefault('TRANSFORMERS_OFFLINE','1');os.environ.setdefault('TOKENIZERS_PARALLELISM','false')
import numpy as np
import torch
from transformers import AutoModelForCausalLM,AutoTokenizer

HERE=Path(__file__).resolve().parent
RESEARCH=HERE.parents[3]
KINDS=('authored','compositional','public_domain')
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path,obj):
    path=Path(path);tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(obj,indent=2)+'\n');tmp.replace(path)

def load_model(path):
    path=Path(path);tok=AutoTokenizer.from_pretrained(path,local_files_only=True,trust_remote_code=False)
    model=AutoModelForCausalLM.from_pretrained(path,local_files_only=True,trust_remote_code=False,attn_implementation='eager',torch_dtype=torch.float32)
    expected={'hidden_size':128,'intermediate_size':341,'num_hidden_layers':4,'num_attention_heads':4,'num_key_value_heads':2,'vocab_size':4019}
    assert all(getattr(model.config,k)==v for k,v in expected.items())
    assert len(tok)==4019 and tok.convert_tokens_to_ids('[EOS]')==1 and tok.convert_tokens_to_ids('"')==3
    assert model.model.embed_tokens.weight.data_ptr()==model.lm_head.weight.data_ptr()
    assert sum(p.numel() for p in model.parameters())==1235968
    model.config.eos_token_id=1;model.config.pad_token_id=0;model.config.bos_token_id=None
    model.generation_config.eos_token_id=1;model.generation_config.pad_token_id=0;model.generation_config.bos_token_id=None
    return model,tok

class Streams:
    def __init__(self,cache,verify=True):
        self.path=Path(cache);self.meta=json.loads((self.path/'manifest.json').read_text());self.arrays={};self.documents={};self.starts={}
        assert self.meta['status']=='COMPLETE' and self.meta['vocabulary']==4019 and not self.meta['eos_inserted']
        for split,groups in self.meta['streams'].items():
            for kind,row in groups.items():
                if verify:
                    assert sha(self.path/row['tokens_file'])==row['tokens_sha256']
                    assert sha(self.path/row['documents_file'])==row['documents_sha256']
                self.arrays[split,kind]=np.memmap(self.path/row['tokens_file'],dtype='<u2',mode='r')
                self.documents[split,kind]=np.load(self.path/row['documents_file'],mmap_mode='r')
                self.starts[split,kind]=np.asarray(self.documents[split,kind][:,0]).copy()
                assert len(self.arrays[split,kind])==row['unique_corpus_tokens']
    def batch(self,split,rng,batch_size,width=128,warmup=64,authored=.4,quote_probability=.25,public_domain=0.):
        ids=np.empty((batch_size,width),dtype=np.int64);labels=np.empty_like(ids);counts=collections.Counter();kinds=[];quoted=[]
        for i in range(batch_size):
            draw=rng.random();kind='authored' if draw<authored else 'public_domain' if draw<authored+public_domain else 'compositional'
            stream=self.arrays[split,kind];docs=self.documents[split,kind]
            quote=rng.random()<quote_probability
            if quote:
                document=int(rng.integers(len(docs)));within=0;cursor=1;ids[i,0]=3
            else:
                start=int(rng.integers(len(stream)))
                document=int(np.searchsorted(self.starts[split,kind],start,side='right'))-1
                within=start-int(docs[document,0]);cursor=0
            while cursor<width:
                start,length=map(int,docs[document]);take=min(width-cursor,length-within)
                ids[i,cursor:cursor+take]=stream[start+within:start+within+take];cursor+=take
                if cursor<width:
                    document=int(rng.integers(len(docs)));within=0
            labels[i]=ids[i]
            labels[i,:1 if quote else warmup]=-100
            targets=int(np.count_nonzero(labels[i,1:]!=-100));counts[kind]+=targets
            kinds.append(kind);quoted.append(quote)
        return torch.from_numpy(ids),torch.from_numpy(labels),dict(counts),kinds,quoted

def mask_for(width,window=64):
    p=torch.arange(width);allowed=(p[None,:]<=p[:,None])&(p[None,:]>p[:,None]-window)
    return torch.zeros((1,1,width,width),dtype=torch.float32).masked_fill(~allowed,torch.finfo(torch.float32).min)

def loss_for(model,batch,mask):
    ids,labels=batch[:2];logits=model(input_ids=ids,attention_mask=mask,use_cache=False).logits
    target=labels[:,1:].reshape(-1);pred=logits[:,:-1].reshape(-1,4019)
    loss=torch.nn.functional.cross_entropy(pred,target,ignore_index=-100,reduction='sum')
    return loss,int((target!=-100).sum())

@torch.no_grad()
def validate(model,batches,mask):
    model.eval();loss=0.;count=0
    for batch in batches:
        value,n=loss_for(model,batch,mask);loss+=float(value);count+=n
    return {'loss':loss/count,'perplexity':math.exp(min(loss/count,30)),'target_tokens':count}

@torch.no_grad()
def constrain(model):
    counts={'matrix':0,'norm':0}
    for p in model.parameters():
        lo,hi=(-.5,2047/4096) if p.ndim==2 else (-8.,32767/4096)
        counts['matrix' if p.ndim==2 else 'norm']+=int(((p<lo)|(p>hi)).sum())
        p.clamp_(lo,hi)
    return counts

@torch.no_grad()
def audit(model):
    rows=[]
    for name,p in model.named_parameters():
        values=torch.round(p.detach()*4096);lo,hi=(-2048,2047) if p.ndim==2 else (-32768,32767)
        rows.append({'name':name,'min_q12':int(values.min()),'max_q12':int(values.max()),'out_of_range':int(((values<lo)|(values>hi)).sum())})
    return {'eligible':all(r['out_of_range']==0 for r in rows),'tensors':rows}

@torch.no_grad()
def free_generate(model,tok,seeds=(0,42),tokens=512,top_k=8,temperature=.8):
    """Closed-loop generation with a persistent KV cache and no stopping/reset at EOS."""
    model.eval();batch=len(seeds);inputs=torch.full((batch,1),3,dtype=torch.long);cache=None;outputs=[[] for _ in seeds]
    generators=[torch.Generator().manual_seed(int(seed)) for seed in seeds]
    for step in range(tokens):
        width=step+1;attention=torch.full((1,1,1,width),torch.finfo(torch.float32).min)
        attention[:,:,:,-64:]=0
        result=model(input_ids=inputs,attention_mask=attention,past_key_values=cache,use_cache=True,
                     position_ids=torch.full((batch,1),step,dtype=torch.long))
        cache=result.past_key_values;rows=result.logits[:,-1].float();next_ids=[]
        for i,row in enumerate(rows):
            row=row.clone();row[0]=-float('inf');values,indices=torch.topk(row,top_k)
            token=int(indices[torch.multinomial(torch.softmax(values/temperature,0),1,generator=generators[i])])
            outputs[i].append(token);next_ids.append(token)
        inputs=torch.tensor(next_ids,dtype=torch.long)[:,None]
    rows=[]
    for seed,ids in zip(seeds,outputs):
        grams=collections.Counter(tuple(ids[i:i+4]) for i in range(max(0,len(ids)-3)))
        repeated=sum(n-1 for n in grams.values())/max(1,len(ids)-3)
        streak=maximum=1
        for a,b in zip(ids,ids[1:]):streak=streak+1 if a==b else 1;maximum=max(maximum,streak)
        eos=[i for i,x in enumerate(ids) if x==1]
        guards={'repeated4_fraction_ok':repeated<=.30,'constant_token_run_ok':maximum<8,
                'vocabulary_diversity_ok':len(set(ids))>=min(32,max(1,len(ids)//16)),
                'eos_storm_absent':len(eos)<=max(8,len(ids)//32)}
        rows.append({'seed':seed,'tokens':ids,'text':tok.decode(ids,skip_special_tokens=True),
                     'last160_tokens':ids[-160:],'last160_text':tok.decode(ids[-160:],skip_special_tokens=True),
                     'eos_positions':eos,'repeated4_fraction':repeated,'longest_constant_token_run':maximum,
                     'distinct_token_ids':len(set(ids)),'guards':guards,'passes_basic_guards':all(guards.values())})
    return {'scope':'FP32 closed-loop numerical continuation; no EOS stopping or reset. Not an EVM or semantic-quality proof.',
            'initial_tokens':[3],'top_k':top_k,'temperature':temperature,'new_tokens':tokens,'streams':rows,
            'passes_basic_guards':all(r['passes_basic_guards'] for r in rows)}
