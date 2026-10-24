"""Contiguous document lanes. Hidden state carries across BPTT chunks."""
import collections,hashlib,json,math
from pathlib import Path
import numpy as np
import torch
from model import V,H,G,W,BOS,UNK,SUFFIXES,objective

def packed_groups(targets):
    group=np.minimum(targets.reshape(-1),V-1)//W
    order=np.argsort(group,kind='stable');counts=np.bincount(group,minlength=G)
    blocks=[];block_groups=[];offset=0
    for g,n in enumerate(counts):
        indices=order[offset:offset+n];offset+=n
        for start in range(0,int(n),64):blocks.append(indices[start:start+64]);block_groups.append(g)
    out=np.zeros((len(blocks),64),dtype=np.int64);valid=np.zeros_like(out,dtype=np.float32)
    for i,block in enumerate(blocks):out[i,:len(block)]=block;valid[i,:len(block)]=1
    return out,valid,np.asarray(block_groups,dtype=np.int64)

def tensor_batch(arrays,device):
    pi,pv,pg=packed_groups(arrays['y']);arrays.update(pack_indices=pi,pack_valid=pv,pack_groups=pg)
    # Empty arrays keep validation and ordinary training batches compatible
    # without creating a dense [batch,width,vocabulary] grammar mask.
    for name in ('grammar_positions','grammar_bad_tokens','grammar_good_tokens'):
        arrays.setdefault(name,np.empty(0,dtype=np.int64))
    return {key:torch.from_numpy(value).to(device) for key,value in arrays.items()}

class Corpus:
    def __init__(self,path,grammar_pairs=None):
        self.path=Path(path);self.meta=json.loads((self.path/'manifest.json').read_text())
        self.vocabulary=json.loads((self.path/'vocabulary.json').read_text());assert len(self.vocabulary)==V
        assert hashlib.sha256((self.path/'vocabulary.json').read_bytes()).hexdigest()==self.meta['vocabulary_sha256']
        self.counts=json.loads((self.path/'counts.json').read_text());self.rows={}
        self.grammar_pairs_path=Path(grammar_pairs)if grammar_pairs is not None else None
        self.grammar_pairs_meta=None;sidecar={};train_ids=set()
        if self.grammar_pairs_path is not None:
            self.grammar_pairs_meta=json.loads(self.grammar_pairs_path.read_text())
            assert self.grammar_pairs_meta.get('schema_version')==1
            assert self.grammar_pairs_meta.get('training_only')is True
            assert set(self.grammar_pairs_meta.get('allowed_rules',[]))=={'first_person_auxiliary','plural_auxiliary','modal_base_verb'}, 'Only prefix-invalid grammar labels are supported'
            assert self.grammar_pairs_meta['source_train_sha256']==self.meta['artifacts']['train.jsonl']['sha256'], 'Grammar pairs training source mismatch'
            assert self.grammar_pairs_meta['vocabulary_sha256']==self.meta['vocabulary_sha256'], 'Grammar pairs vocabulary mismatch'
            sidecar=self.grammar_pairs_meta['documents']
        for split in ('train','validation','test'):
            file=self.path/f'{split}.jsonl';assert hashlib.sha256(file.read_bytes()).hexdigest()==self.meta['artifacts'][file.name]['sha256']
            groups=collections.defaultdict(list)
            with file.open()as source:
                for line in source:
                    r=json.loads(line);words=np.asarray(r['token_ids'],dtype=np.int64);punct=np.asarray(r['punctuation'],dtype=np.int64)
                    assert len(words)==len(punct)>1 and (words>=0).all() and (words<=UNK).all() and (punct>=0).all() and (punct<5).all()
                    doc={'id':r['id'],'words':words,'punct':punct,'domain':r['domain']}
                    if split=='train':
                        assert r['id']not in train_ids, 'Duplicate training document id'
                        train_ids.add(r['id'])
                        pairs=np.asarray(sidecar.get(r['id'],[]),dtype=np.int64).reshape(-1,2)
                        if len(pairs):
                            assert (pairs[:,0]>=0).all()and(pairs[:,0]<len(words)).all()
                            assert (pairs[:,1]>=0).all()and(pairs[:,1]<V).all()
                            assert (words[pairs[:,0]]<V).all()and(words[pairs[:,0]]!=pairs[:,1]).all()
                            assert len({tuple(pair)for pair in pairs.tolist()})==len(pairs)
                            pairs=pairs[np.lexsort((pairs[:,1],pairs[:,0]))]
                        doc['grammar_pairs']=pairs
                    groups[r['kind']].append(doc)
            self.rows[split]=dict(groups)
        assert set(sidecar)<=train_ids, 'Grammar pairs contain unknown/nontraining document ids'

    def validation_batches(self,rng,device,batch_size=16,per_kind=3):
        batches={}
        for kind,docs in self.rows['validation'].items():
            picked=rng.choice(len(docs),min(len(docs),batch_size*per_kind),replace=False)
            groups=[]
            for offset in range(0,len(picked),batch_size):
                selected=[docs[int(i)] for i in picked[offset:offset+batch_size]];width=max(len(d['words']) for d in selected);shape=(len(selected),width)
                x=np.full(shape,BOS,dtype=np.int64);y=np.full(shape,UNK,dtype=np.int64);pp=np.zeros(shape,dtype=np.int64);p=pp.copy();reset=np.zeros(shape,dtype=bool);reset[:,0]=True
                valid=np.zeros(shape,dtype=np.float32);domain=np.zeros(shape,dtype=np.int64)
                for row,d in enumerate(selected):
                    n=len(d['words']);y[row,:n]=d['words'];p[row,:n]=d['punct'];domain[row,:n]=d['domain'];valid[row,:n]=1
                    x[row,1:n]=d['words'][:-1];pp[row,1:n]=d['punct'][:-1]
                groups.append(tensor_batch({'x':x,'y':y,'prev_punct':pp,'punct':p,'resets':reset,'domains':domain,'valid':valid,'word_mask':valid*(y<V)},device))
            batches[kind]=groups
        return batches

class Stream:
    def __init__(self,corpus,rng,batch,width,mixture):
        self.corpus=corpus;self.rng=rng;self.batch=batch;self.width=width;self.lanes=[None]*batch
        self.kinds=[kind for kind in mixture if mixture[kind]>0 and kind in corpus.rows['train']]
        rates=np.array([mixture[k]/np.mean([len(d['words'])for d in corpus.rows['train'][k]]) for k in self.kinds]);self.rates=rates/rates.sum()

    def next(self,device):
        shape=(self.batch,self.width);x=np.zeros(shape,dtype=np.int64);y=x.copy();prev=x.copy();p=x.copy();domains=x.copy();resets=np.zeros(shape,dtype=bool);counts=collections.Counter()
        grammar_positions=[];grammar_bad_tokens=[];grammar_good_tokens=[]
        for row in range(self.batch):
            pos=0
            while pos<self.width:
                lane=self.lanes[row]
                if lane is None:
                    kind=str(self.rng.choice(self.kinds,p=self.rates));docs=self.corpus.rows['train'][kind]
                    lane=[kind,int(self.rng.integers(len(docs))),0];self.lanes[row]=lane
                kind,idx,start=lane;doc=self.corpus.rows['train'][kind][idx];n=min(self.width-pos,len(doc['words'])-start)
                y[row,pos:pos+n]=doc['words'][start:start+n];p[row,pos:pos+n]=doc['punct'][start:start+n];domains[row,pos:pos+n]=doc['domain']
                x[row,pos]=BOS if start==0 else doc['words'][start-1];prev[row,pos]=0 if start==0 else doc['punct'][start-1];resets[row,pos]=start==0
                if n>1:x[row,pos+1:pos+n]=doc['words'][start:start+n-1];prev[row,pos+1:pos+n]=doc['punct'][start:start+n-1]
                # Labels were judged in the complete source document. A chunk
                # boundary changes only their destination, not their context.
                pairs=doc.get('grammar_pairs')
                if pairs is not None and len(pairs):
                    lower=np.searchsorted(pairs[:,0],start,side='left')
                    upper=np.searchsorted(pairs[:,0],start+n,side='left')
                    for source_pos,bad in pairs[lower:upper]:
                        col=pos+int(source_pos)-start
                        grammar_positions.append(row*self.width+col)
                        grammar_bad_tokens.append(int(bad))
                        grammar_good_tokens.append(int(doc['words'][source_pos]))
                counts[kind]+=int((doc['words'][start:start+n]<V).sum());pos+=n;lane[2]+=n
                if lane[2]==len(doc['words']):self.lanes[row]=None
        valid=np.ones(shape,dtype=np.float32)
        return tensor_batch({'x':x,'y':y,'prev_punct':prev,'punct':p,'resets':resets,'domains':domains,'valid':valid,'word_mask':(y<V).astype(np.float32),
            'grammar_positions':np.asarray(grammar_positions,dtype=np.int64),
            'grammar_bad_tokens':np.asarray(grammar_bad_tokens,dtype=np.int64),
            'grammar_good_tokens':np.asarray(grammar_good_tokens,dtype=np.int64)},device),dict(counts)

@torch.no_grad()
def evaluate(model,batches):
    model.eval();result={}
    for kind,rows in batches.items():
        wl=wc=pl=pc=0.
        for batch in rows:
            _,m,_,_=objective(model,batch);wl+=float(m['word_loss']);wc+=float(m['word_count']);pl+=float(m['punct_loss']);pc+=float(m['punct_count'])
        result[kind]={'word_nll':wl/wc,'punctuation_nll':pl/pc,'known_words':int(wc),'all_punctuation_positions':int(pc),'joint_nll':wl/wc+pl/pc}
    return {'kinds':result,'macro_joint_nll':float(np.mean([x['joint_nll']for x in result.values()]))}

@torch.no_grad()
def sample(model,vocabulary,seeds=(0,42),words=128,temperature=.8,punct_temperature=.8):
    model.eval();out=[];H=model.hidden
    for seed in seeds:
        rng=torch.Generator().manual_seed(seed);state=(torch.zeros(1,H),torch.zeros(1,H));prev=torch.tensor([BOS]);pp=torch.zeros(1,dtype=torch.long);text=[];ids=[];puncts=[]
        for _ in range(words):
            state=model.step(prev,pp,state);h=state[1]
            g=int(torch.multinomial(torch.softmax(model.logits(h)/temperature,-1),1,generator=rng))
            w=int(torch.multinomial(torch.softmax(model.logits(h,g)/temperature,-1),1,generator=rng));token=g*W+w
            punct=int(torch.multinomial(torch.softmax(model.punctuation_logits(h,torch.tensor([token]))/punct_temperature,-1),1,generator=rng))
            ids.append(token);puncts.append(punct);text.append(vocabulary[token]+SUFFIXES[punct]);prev=torch.tensor([token]);pp=torch.tensor([punct])
        grams=collections.Counter(tuple(ids[i:i+4])for i in range(len(ids)-3))
        out.append({'seed':seed,'word_temperature':temperature,'punctuation_temperature':punct_temperature,'word_ids':ids,'punctuation':puncts,'text':' '.join(text),'terminal_count':sum(p>=2 for p in puncts),'state_resets':0,'repeat4_fraction':sum(n-1 for n in grams.values())/max(1,len(ids)-3)})
    return out
