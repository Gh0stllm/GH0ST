"""Document-contained WordPiece windows and explicit supervised-target accounting."""
import hashlib
import json
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent
VOICE=HERE.parents[1]
RESEARCH=HERE.parents[3]
BASE=RESEARCH/'experiments/simplestories-v2/model-cache'

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def save(path,obj):
    path=Path(path);temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(obj,indent=2)+'\n');temporary.replace(path)

def windows(ids,width=128,warmup=64):
    """Cover each known target exactly once; overlap is input-only at later chunks."""
    if not 1<=warmup<width:raise ValueError('Invalid overlap')
    start=0
    while start<len(ids)-1:
        chunk=list(ids[start:start+width]);labels=chunk.copy()
        ignored=warmup if start else 1
        labels[:ignored]=[-100]*min(ignored,len(labels))
        labels=[-100 if x==0 else x for x in labels]
        if any(x!=-100 for x in labels[1:]):
            yield {'start':start,'ids':chunk,'labels':labels,
                   'targets':sum(x!=-100 for x in labels[1:])}
        if start+width>=len(ids):break
        start+=width-warmup

class Corpus:
    def __init__(self,path,width=128,warmup=64):
        self.path=Path(path);self.manifest=json.loads((self.path/'manifest.json').read_text())
        if self.manifest['status']!='COMPLETE':raise ValueError('Incomplete prepared corpus')
        self.items={};self.probabilities={}
        for split in ('train','validation','test'):
            filename=self.path/f'{split}.jsonl'
            if sha(filename)!=self.manifest['artifacts'][filename.name]['sha256']:raise ValueError('Corpus hash mismatch')
            by_kind={'grammar':[],'voice':[]}
            for line in filename.open():
                row=json.loads(line)
                for chunk in windows(row['token_ids'],width,warmup):
                    by_kind[row['kind']].append(chunk|{'document_id':row['id'],'group_id':row['group_id']})
            for kind,items in by_kind.items():
                if not items:raise ValueError(f'No {split}/{kind} windows')
                weights=np.asarray([x['targets']for x in items],dtype=np.float64)
                self.items[split,kind]=items;self.probabilities[split,kind]=weights/weights.sum()

    def sample(self,split,kind,rng):
        index=int(rng.choice(len(self.items[split,kind]),p=self.probabilities[split,kind]))
        return self.items[split,kind][index]

def make_batch(corpus,rng,counts,batch_size=64,width=128,total_limit=400000,
               voice_limit=100000,voice_boundary=50000):
    """Balance by actual known targets, including exact hard caps at review boundaries."""
    work=dict(counts);result=[]
    for _ in range(batch_size):
        if sum(work.values())>=total_limit or work['voice']>=min(voice_limit,voice_boundary):break
        kind='voice' if work['voice']<.25*sum(work.values()) else 'grammar'
        item=corpus.sample('train',kind,rng)
        available=min(item['targets'],total_limit-sum(work.values()))
        if kind=='voice':available=min(available,voice_limit-work['voice'],voice_boundary-work['voice'])
        if available<=0:break
        labels=item['labels'].copy();left=available
        for i in range(1,len(labels)):
            if labels[i]!=-100:
                if left:left-=1
                else:labels[i]=-100
        result.append(item|{'kind':kind,'labels':labels,'targets':available})
        work[kind]+=available
    return result,work

def tensors(items,width,device):
    import torch
    ids=torch.zeros((len(items),width),dtype=torch.long,device=device)
    labels=torch.full_like(ids,-100)
    valid=torch.zeros_like(ids,dtype=torch.bool)
    for i,item in enumerate(items):
        n=len(item['ids']);ids[i,:n]=torch.tensor(item['ids'],device=device)
        labels[i,:n]=torch.tensor(item['labels'],device=device);valid[i,:n]=True
    pos=torch.arange(width,device=device)
    allowed=(pos[None,:]<=pos[:,None])&(pos[None,:]>pos[:,None]-64)
    # Padded queries have ignored labels. Give each a finite softmax row even if
    # its causal window is entirely beyond the real document; real queries never
    # see padded keys or this fallback edge.
    keep=allowed[None,None]&valid[:,None,None,:]
    keep[:,:,:,0] |= ~valid[:,None,:]
    mask=torch.zeros((len(items),1,width,width),dtype=torch.float32,device=device)
    mask.masked_fill_(~keep,torch.finfo(torch.float32).min)
    return ids,labels,mask

def freeze_top2(model):
    for name,param in model.named_parameters():
        param.requires_grad_(name.startswith(('model.layers.2.','model.layers.3.')))
    return sum(p.numel()for p in model.parameters()if p.requires_grad)

def tensor_sha(tensor):
    return hashlib.sha256(tensor.detach().cpu().contiguous().numpy().tobytes()).hexdigest()

def frozen_hashes(model):
    return {n:tensor_sha(p)for n,p in model.named_parameters()if not p.requires_grad}

def audit(model):
    import torch
    rows=[]
    for name,param in model.named_parameters():
        value=torch.round(param.detach()*4096);lo,hi=(-2048,2047)if param.ndim==2 else(-32768,32767)
        rows.append({'name':name,'min_q12':int(value.min()),'max_q12':int(value.max()),
                     'out_of_range':int(((value<lo)|(value>hi)).sum())})
    return {'eligible':all(x['out_of_range']==0 for x in rows),'tensors':rows,'clipped_values':0}
