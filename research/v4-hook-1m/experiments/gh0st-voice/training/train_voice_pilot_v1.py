#!/usr/bin/env python3
"""Local full-weight voice tuning for the fixed 1.24M SimpleStories architecture.

Reads a supplied original corpus. No corpus generation, network access, deployment,
or modification of the pretrained checkpoint is performed.
"""
from __future__ import annotations
import argparse
import collections
import hashlib
import json
import math
import os
from pathlib import Path
import random
import sys
import time

os.environ.setdefault('HF_HUB_OFFLINE','1')
os.environ.setdefault('TRANSFORMERS_OFFLINE','1')
os.environ.setdefault('TOKENIZERS_PARALLELISM','false')
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader
from transformers import AutoModelForCausalLM, AutoTokenizer

HERE=Path(__file__).resolve().parent
RESEARCH=HERE.parents[2]
DEFAULT_CHECKPOINT=RESEARCH/'experiments/simplestories-v2/model-cache'
EXPECTED={'hidden_size':128,'intermediate_size':341,'num_hidden_layers':4,
          'num_attention_heads':4,'num_key_value_heads':2,'vocab_size':4019}


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n');temporary.replace(path)


def load_corpus(location,tokenizer,block_size,overlap):
    location=Path(location)
    paths=sorted(location.glob('*.jsonl')) if location.is_dir() else [location]
    if not paths:raise ValueError('No JSONL corpus files found')
    rows=[];seen_ids=set();seen_text={};files=[]
    for path in paths:
        files.append({'path':str(path.resolve()),'sha256':digest(path),'bytes':path.stat().st_size})
        implied=path.stem.lower()
        if implied in {'valid','val','dev'}:implied='validation'
        for line_number,line in enumerate(path.read_text().splitlines(),1):
            if not line.strip():continue
            row=json.loads(line);text=row.get('text')
            if not isinstance(text,str) or not text.strip():raise ValueError(f'{path.name}:{line_number}: nonempty text required')
            row_id=str(row.get('id',f'{path.name}:{line_number}'))
            if row_id in seen_ids:raise ValueError(f'Duplicate corpus id: {row_id}')
            seen_ids.add(row_id)
            split=str(row.get('split',implied)).lower()
            split={'valid':'validation','val':'validation','dev':'validation'}.get(split,split)
            if split not in {'train','validation','test'}:raise ValueError(f'{row_id}: explicit train/validation/test split required')
            key=' '.join(text.casefold().split())
            if key in seen_text:raise ValueError(f'Duplicate normalized text: {row_id} and {seen_text[key]}')
            seen_text[key]=row_id
            ids=tokenizer.encode(text,add_special_tokens=False)
            if ids and ids[-1]==1:ids=ids[:-1]
            ids.append(1)
            rows.append({'id':row_id,'split':split,'ids':ids,'text':text})
    blocks={s:[] for s in ['train','validation','test']}
    coverage={}
    for split in blocks:
        selected=[r for r in rows if r['split']==split]
        token_count=sum(len(r['ids'])-1 for r in selected)
        unknown=sum(r['ids'].count(0) for r in selected)
        coverage[split]={'documents':len(selected),'text_tokens':token_count,'unknown_tokens':unknown,
                         'unknown_fraction':unknown/max(token_count,1)}
        for row in selected:
            ids=row['ids'];start=0
            while start<len(ids)-1:
                end=min(start+block_size,len(ids));piece=ids[start:end]
                loss_start=0 if start==0 else overlap
                if len(piece)>loss_start+1:
                    labels=piece.copy();labels[:loss_start]=[-100]*loss_start
                    blocks[split].append((piece,labels))
                if end==len(ids):break
                start+=block_size-overlap
        coverage[split]['blocks']=len(blocks[split])
    if not blocks['train'] or not blocks['validation']:raise ValueError('Training and validation each need at least one usable block')
    return blocks,{'files':files,'coverage':coverage,'append_eos_token_id':1,'padding_token_id':0,
                   'duplicates':'Normalized exact duplicates rejected across every split',
                   'block_size':block_size,'context_overlap':overlap}


def collate(examples):
    width=max(len(x[0]) for x in examples)
    ids=torch.zeros((len(examples),width),dtype=torch.long)
    labels=torch.full_like(ids,-100)
    valid=torch.zeros_like(ids,dtype=torch.bool)
    for i,(tokens,targets) in enumerate(examples):
        ids[i,:len(tokens)]=torch.tensor(tokens);labels[i,:len(tokens)]=torch.tensor(targets);valid[i,:len(tokens)]=True
    return ids,labels,valid


def attention_mask(valid,window,dtype,device):
    valid=valid.to(device);n=valid.shape[1];positions=torch.arange(n,device=device)
    causal=(positions[None,:]<=positions[:,None])&(positions[None,:]>positions[:,None]-window)
    allowed=causal[None,None,:,:]&valid[:,None,None,:]
    return torch.zeros(allowed.shape,dtype=dtype,device=device).masked_fill(~allowed,torch.finfo(dtype).min)


def batch_loss(model,batch,device,window):
    ids,labels,valid=batch;ids=ids.to(device);labels=labels.to(device)
    logits=model(input_ids=ids,attention_mask=attention_mask(valid,window,torch.float32,device),use_cache=False).logits
    shifted=labels[:,1:].reshape(-1);predictions=logits[:,:-1,:].reshape(-1,logits.shape[-1])
    count=int((shifted!=-100).sum().item())
    loss=F.cross_entropy(predictions,shifted,ignore_index=-100,reduction='sum')
    return loss,count


@torch.no_grad()
def evaluate(model,loader,device,window,max_batches):
    model.eval();total=0.;tokens=0
    for i,batch in enumerate(loader):
        if max_batches and i>=max_batches:break
        loss,n=batch_loss(model,batch,device,window);total+=float(loss);tokens+=n
    return {'loss_nats_per_token':total/max(tokens,1),'perplexity':math.exp(min(total/max(tokens,1),30)),'tokens':tokens}


@torch.no_grad()
def constrain(model,enabled):
    result={'matrix_values_projected':0,'norm_values_projected':0}
    if enabled:
        for _,p in model.named_parameters():
            lo,hi=(-.5,2047/4096) if p.ndim==2 else (-8.,32767/4096)
            count=int(((p<lo)|(p>hi)).sum().item())
            result['matrix_values_projected' if p.ndim==2 else 'norm_values_projected']+=count
            p.clamp_(lo,hi)
    return result


@torch.no_grad()
def quantization_audit(model):
    matrices=[];norms=[]
    for name,p in model.named_parameters():
        q=torch.round(p.detach().cpu()*4096)
        lo,hi=(-2048,2047) if p.ndim==2 else (-32768,32767)
        row={'name':name,'minimum_q12':int(q.min()),'maximum_q12':int(q.max()),
             'out_of_range':int(((q<lo)|(q>hi)).sum())}
        (matrices if p.ndim==2 else norms).append(row)
    return {'matrix_signed12_eligible':all(x['out_of_range']==0 for x in matrices),
            'norm_signed16_eligible':all(x['out_of_range']==0 for x in norms),'matrices':matrices,'norms':norms}


def validate_architecture(model,tokenizer):
    actual={k:getattr(model.config,k) for k in EXPECTED}
    if actual!=EXPECTED:raise ValueError(f'Architecture drift: {actual}')
    if len(tokenizer)!=4019 or tokenizer.convert_tokens_to_ids('[EOS]')!=1 or tokenizer.unk_token_id!=0:raise ValueError('Tokenizer identity changed')
    if model.lm_head.weight.data_ptr()!=model.model.embed_tokens.weight.data_ptr():raise ValueError('Embedding/output head must remain tied')
    count=sum(p.numel() for p in model.parameters())
    if count!=1235968:raise ValueError(f'Parameter count changed: {count}')
    model.config.eos_token_id=1;model.config.pad_token_id=0;model.config.bos_token_id=None
    model.generation_config.eos_token_id=1;model.generation_config.pad_token_id=0;model.generation_config.bos_token_id=None
    return {'parameters':count,**actual,'tied_embeddings':True,'runtime_eos_token_id':1,'automatic_bos':False}


def save_checkpoint(model,tokenizer,path,metadata):
    path=Path(path);path.mkdir(parents=True,exist_ok=True)
    model.save_pretrained(path,safe_serialization=True);tokenizer.save_pretrained(path)
    save(path/'training-metadata.json',metadata)
    return {p.name:digest(p) for p in path.iterdir() if p.is_file()}


@torch.no_grad()
def development_samples(model,tokenizer,prompts,device,window,seed,maximum=64):
    if not prompts:return []
    model.eval();result=[]
    for index,prompt in enumerate(prompts):
        ids=tokenizer.encode(prompt,add_special_tokens=False);generated=[]
        if not ids:continue
        generator=torch.Generator(device='cpu').manual_seed(seed+index)
        for _ in range(maximum):
            inputs=torch.tensor([ids+generated],dtype=torch.long,device=device)
            valid=torch.ones_like(inputs,dtype=torch.bool)
            logits=model(input_ids=inputs,attention_mask=attention_mask(valid,window,torch.float32,device),use_cache=False).logits[0,-1].float().cpu()
            logits[0]=-float('inf');values,indices=torch.topk(logits,8)
            selected=int(indices[torch.multinomial(torch.softmax(values/.8,dim=0),1,generator=generator)])
            generated.append(selected)
            if selected==1:break
        result.append({'prompt':prompt,'tokens':generated,'text':tokenizer.decode(generated,skip_special_tokens=True),
                       'scope':'FP32 development sample; not an EVM or Q12 parity result','top_k':8,'temperature':.8,'seed':seed+index})
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint',type=Path,default=DEFAULT_CHECKPOINT)
    parser.add_argument('--corpus',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--steps',type=int,default=600)
    parser.add_argument('--batch-size',type=int,default=16)
    parser.add_argument('--gradient-accumulation',type=int,default=1)
    parser.add_argument('--block-size',type=int,default=128)
    parser.add_argument('--overlap',type=int,default=64)
    parser.add_argument('--learning-rate',type=float,default=1e-4)
    parser.add_argument('--weight-decay',type=float,default=.01)
    parser.add_argument('--eval-every',type=int,default=100)
    parser.add_argument('--validation-batches',type=int,default=0)
    parser.add_argument('--log-every',type=int,default=20)
    parser.add_argument('--patience',type=int,default=5)
    parser.add_argument('--min-delta',type=float,default=.002)
    parser.add_argument('--seed',type=int,default=20261024)
    parser.add_argument('--device',choices=['auto','cpu','mps'],default='auto')
    parser.add_argument('--threads',type=int,default=2)
    parser.add_argument('--project-ranges',action=argparse.BooleanOptionalAction,default=True)
    parser.add_argument('--prompts',type=Path)
    parser.add_argument('--inspect',action='store_true')
    args=parser.parse_args()
    if args.steps<1 or args.batch_size<1 or args.gradient_accumulation<1 or not 64<args.block_size<=512 or not 0<=args.overlap<args.block_size:raise ValueError('Invalid training dimensions')
    torch.set_num_threads(args.threads);random.seed(args.seed);torch.manual_seed(args.seed)
    use_mps=args.device=='mps' or (args.device=='auto' and torch.backends.mps.is_available())
    if use_mps and not torch.backends.mps.is_available():raise ValueError('Requested MPS is unavailable')
    device=torch.device('mps' if use_mps else 'cpu')
    tokenizer=AutoTokenizer.from_pretrained(args.checkpoint,local_files_only=True,trust_remote_code=False)
    model=AutoModelForCausalLM.from_pretrained(args.checkpoint,local_files_only=True,trust_remote_code=False,attn_implementation='eager',torch_dtype=torch.float32)
    architecture=validate_architecture(model,tokenizer)
    blocks,corpus=load_corpus(args.corpus,tokenizer,args.block_size,args.overlap)
    configuration={k:str(v) if isinstance(v,Path) else v for k,v in vars(args).items()}
    report={'status':'INSPECTED' if args.inspect else 'RUNNING','scope':'Local original-corpus full-weight fine-tuning only; no network or deployment.',
            'configuration':configuration,'architecture':architecture,'corpus':corpus,'device':str(device),
            'software':{'python':sys.version.split()[0],'torch':torch.__version__},
            'base_checkpoint_sha256':digest(args.checkpoint/'model.safetensors'),
            'tokenizer_sha256':digest(args.checkpoint/'tokenizer.json'),
            'attention':{'window_including_current':64,'mask':'causal sliding64, eager FP32 attention',
                         'difference_from_evm':'FP32 uses equivalent absolute rotary arithmetic; relative-key Q12 has different rounding and needs independent export evaluation.'},
            'quantization_constraint':{'enabled':args.project_ranges,'matrices':[-.5,2047/4096],'norms':[-8,32767/4096],
                                       'semantics':'Explicit projected optimizer bounds, not post-export silent clipping'},
            'history':[]}
    if args.inspect:
        print(json.dumps(report,indent=2));return
    if args.output.exists() and any(args.output.iterdir()):raise ValueError('Output directory must be new/empty; existing checkpoints are never overwritten')
    args.output.mkdir(parents=True,exist_ok=True);save(args.output/'training-report.json',report)
    model.to(device)
    loader=DataLoader(blocks['train'],batch_size=args.batch_size,shuffle=True,num_workers=0,collate_fn=collate,generator=torch.Generator().manual_seed(args.seed))
    validation=DataLoader(blocks['validation'],batch_size=args.batch_size,shuffle=False,num_workers=0,collate_fn=collate)
    prompts=[]
    if args.prompts:
        obj=json.loads(args.prompts.read_text());items=obj.get('prompts',[]) if isinstance(obj,dict) else obj
        prompts=[x if isinstance(x,str) else x.get('prompt',x.get('prefix','')) for x in items]
    baseline=evaluate(model,validation,device,64,args.validation_batches)
    report['baseline_validation']=baseline;report['initial_quantization']=quantization_audit(model)
    optimizer=torch.optim.AdamW(model.parameters(),lr=args.learning_rate,weight_decay=args.weight_decay,foreach=False)
    start=time.monotonic();iterator=iter(loader);best=baseline['loss_nats_per_token'];best_step=0;clipped=collections.Counter();trained_tokens=0;bad_evaluations=0;completed_steps=0
    report['best_checkpoint_files']=save_checkpoint(model,tokenizer,args.output/'checkpoint-best',{'step':0,'validation':baseline,'architecture':architecture,'corpus':corpus,'quantization':report['initial_quantization']})
    def finish_validation(step,train_loss):
        nonlocal best,best_step,bad_evaluations
        metrics=evaluate(model,validation,device,64,args.validation_batches);audit=quantization_audit(model)
        entry={'step':step,'training_loss':train_loss,'validation':metrics,'elapsed_seconds':time.monotonic()-start,
               'quantization_eligible':audit['matrix_signed12_eligible'] and audit['norm_signed16_eligible']}
        if not entry['quantization_eligible']:raise RuntimeError('Checkpoint no longer fits exact signed12/16 export bounds')
        if metrics['loss_nats_per_token']<best-args.min_delta:
            best=metrics['loss_nats_per_token'];best_step=step;bad_evaluations=0
            report['best_checkpoint_files']=save_checkpoint(model,tokenizer,args.output/'checkpoint-best',{'step':step,'validation':metrics,'architecture':architecture,'corpus':corpus,'quantization':audit})
            entry['selected_best']=True
            if prompts:save(args.output/'development-samples.json',{'step':step,'samples':development_samples(model,tokenizer,prompts,device,64,args.seed)})
        if not entry.get('selected_best'):bad_evaluations+=1
        report['history'].append(entry);report['best_step']=best_step;report['best_validation_loss']=best
        report['validation_rounds_without_improvement']=bad_evaluations
        report['trained_target_tokens']=trained_tokens;report['projection_counts']=dict(clipped)
        save(args.output/'training-report.json',report);print(json.dumps(entry),flush=True);model.train()
    try:
        for step in range(1,args.steps+1):
            model.train();optimizer.zero_grad(set_to_none=True);loss_value=0.;count_value=0
            warm=max(1,int(args.steps*.05));rate=step/warm if step<=warm else .1+.9*.5*(1+math.cos(math.pi*(step-warm)/max(1,args.steps-warm)))
            for group in optimizer.param_groups:group['lr']=args.learning_rate*rate
            for _ in range(args.gradient_accumulation):
                try:batch=next(iterator)
                except StopIteration:iterator=iter(loader);batch=next(iterator)
                loss,count=batch_loss(model,batch,device,64)
                if count==0 or not bool(torch.isfinite(loss)):raise RuntimeError('Invalid loss or empty supervised batch')
                (loss/count/args.gradient_accumulation).backward();loss_value+=float(loss.detach());count_value+=count;trained_tokens+=count
            grad_norm=float(torch.nn.utils.clip_grad_norm_(model.parameters(),1.0));optimizer.step();clipped.update(constrain(model,args.project_ranges))
            if step%args.log_every==0:print(json.dumps({'step':step,'loss':loss_value/count_value,'lr':optimizer.param_groups[0]['lr'],'gradient_norm':grad_norm,'elapsed_seconds':time.monotonic()-start}),flush=True)
            completed_steps=step
            if step%args.eval_every==0 or step==args.steps:
                finish_validation(step,loss_value/count_value)
                if args.patience and bad_evaluations>=args.patience:
                    report['early_stopped']=True;break
        report['completed_steps']=completed_steps
        report['last_checkpoint_files']=save_checkpoint(model,tokenizer,args.output/'checkpoint-last',{'step':completed_steps,'architecture':architecture,'quantization':quantization_audit(model)})
        report['status']='COMPLETE';report['elapsed_seconds']=time.monotonic()-start;save(args.output/'training-report.json',report)
        print(json.dumps({'status':'COMPLETE','best_step':best_step,'best_validation_loss':best,'output':str(args.output.resolve()),'elapsed_seconds':report['elapsed_seconds']}),flush=True)
    except BaseException as error:
        report['status']='FAILED';report['error']=str(error);report['elapsed_seconds']=time.monotonic()-start;save(args.output/'training-report.json',report);raise


if __name__=='__main__':main()
