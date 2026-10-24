#!/usr/bin/env python3
"""Small strictly offline GPT-2 voice adaptation. Not launched automatically."""
import argparse,hashlib,json,math,random,time
from pathlib import Path
import torch
from load_local_gpt2 import load_teacher

def write(path,value):
    temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(value,indent=2)+'\n');temp.replace(path)
def documents(path):
    rows=[json.loads(line)for line in path.open()]
    return [r for r in rows if r.get('kind')=='original' or r.get('source_kind')=='original_voice']
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--device',choices=['cpu','mps'],default='cpu');p.add_argument('--mode',choices=['top4','all'],default='top4')
    p.add_argument('--epochs',type=int,default=2);p.add_argument('--max-steps',type=int,default=376);p.add_argument('--batch',type=int,default=4)
    p.add_argument('--length',type=int,default=256);p.add_argument('--lr',type=float,default=2e-5);p.add_argument('--eval-every',type=int,default=94);p.add_argument('--seed',type=int,default=8124)
    a=p.parse_args();assert not a.out.exists();assert 0<a.length<=1024 and a.epochs>0 and a.max_steps>0
    if a.device=='mps':assert torch.backends.mps.is_available()
    torch.set_num_threads(2);torch.manual_seed(a.seed);rng=random.Random(a.seed)
    train=documents(a.data/'train.jsonl');valid=documents(a.data/'validation.jsonl');test=documents(a.data/'test.jsonl')
    assert train and valid
    sets=[{r['group_id']for r in rows}for rows in(train,valid,test)]
    assert not(sets[0]&sets[1] or sets[0]&sets[2] or sets[1]&sets[2])
    model,tok,info,checksum=load_teacher();assert not any(info.get(k)for k in('missing_keys','unexpected_keys','mismatched_keys','error_msgs'))
    tok.pad_token=tok.eos_token;tok.padding_side='right';model.config.pad_token_id=tok.eos_token_id;model.config.use_cache=False
    for param in model.parameters():param.requires_grad_(a.mode=='all')
    if a.mode=='top4':
        for block in model.transformer.h[-4:]:
            for param in block.parameters():param.requires_grad_(True)
        for param in model.transformer.ln_f.parameters():param.requires_grad_(True)
    truncated_train=sum(len(tok(tok.eos_token+r['text'].strip()+tok.eos_token)['input_ids'])>a.length for r in train)
    model.to(a.device);opt=torch.optim.AdamW([p for p in model.parameters()if p.requires_grad],lr=a.lr,weight_decay=.01,foreach=False)
    def batch(rows):
        text=[tok.eos_token+r['text'].strip()+tok.eos_token for r in rows]
        data=tok(text,return_tensors='pt',padding=True,truncation=True,max_length=a.length).to(a.device)
        labels=data['input_ids'].clone();labels[data['attention_mask']==0]=-100;return data,labels
    @torch.no_grad()
    def evaluate():
        model.eval();total=words=0
        for i in range(0,len(valid),a.batch):
            x,y=batch(valid[i:i+a.batch]);loss=model(**x,labels=y,use_cache=False).loss;n=int((y[:,1:]!=-100).sum());total+=float(loss)*n;words+=n
        return total/words
    a.out.mkdir(parents=True);report={'status':'RUNNING','configuration':{k:str(v)if isinstance(v,Path)else v for k,v in vars(a).items()},'base_sha256':checksum,
        'total_parameters':sum(p.numel()for p in model.parameters()),'trainable_parameters':sum(p.numel()for p in model.parameters()if p.requires_grad),
        'train_documents':len(train),'validation_documents':len(valid),'test_documents_unused':len(test),'source_sha256':{s:hashlib.sha256((a.data/(s+'.jsonl')).read_bytes()).hexdigest()for s in('train','validation','test')},
        'training_words':sum(len(r['text'].split())for r in train),'truncated_training_documents':truncated_train,'checkpoints':[],'quality_approval':False,'downloads':0}
    best=evaluate();report['initial_validation_nll']=best;started=time.monotonic();step=0
    def checkpoint(score):
        nonlocal best
        record={'step':step,'validation_nll':score,'seconds':time.monotonic()-started};report['checkpoints'].append(record)
        if score<best:
            best=score;model.save_pretrained(a.out/'checkpoint-best',safe_serialization=True);tok.save_pretrained(a.out/'checkpoint-best');report['best']=record
        write(a.out/'report.json',report);print(json.dumps(record),flush=True)
    write(a.out/'report.json',report)
    for epoch in range(a.epochs):
        rng.shuffle(train)
        for i in range(0,len(train),a.batch):
            model.train();x,y=batch(train[i:i+a.batch]);opt.zero_grad(set_to_none=True);loss=model(**x,labels=y,use_cache=False).loss
            if not bool(torch.isfinite(loss)):raise ValueError('Nonfinite teacher loss')
            loss.backward();torch.nn.utils.clip_grad_norm_([p for p in model.parameters()if p.requires_grad],1.);opt.step();step+=1
            if step%a.eval_every==0:checkpoint(evaluate())
            if step>=a.max_steps:break
        if step>=a.max_steps:break
    if not report['checkpoints'] or report['checkpoints'][-1]['step']!=step:checkpoint(evaluate())
    model.save_pretrained(a.out/'checkpoint-last',safe_serialization=True);tok.save_pretrained(a.out/'checkpoint-last')
    report.update(status='COMPLETE',steps=step,seconds=time.monotonic()-started,best_validation_nll=best)
    if 'best'not in report:report['selection']='No improvement; retain original pretrained teacher, do not select checkpoint-last automatically'
    write(a.out/'report.json',report)
if __name__=='__main__':main()
