"""CPU-only depth pruning + full-vocabulary logit distillation and SFT.

No RPCs, API inference, wallets or external training services. All teacher
forwards occur locally. Test data is evaluated only after the checkpoint is fixed.
"""
import argparse
import copy
import hashlib
import json
import math
import random
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import torch
import torch.nn.functional as F
from transformers import AutoModelForCausalLM, AutoTokenizer
from transformers.utils import logging
from dataset import ROOT, SYSTEM, build, score


def write(name,data):
    (ROOT/name).write_text(json.dumps(data,indent=2)+'\n')


def prompt_ids(tok,row):
    rendered=tok.apply_chat_template([{'role':'system','content':SYSTEM},{'role':'user','content':row['prompt']}],
        add_generation_prompt=True, tokenize=False)
    return tok.encode(rendered,add_special_tokens=False)


def encode(tok,row):
    prefix=prompt_ids(tok,row)
    answer=tok.encode(json.dumps(row['target'],separators=(',',':')),add_special_tokens=False)+[tok.eos_token_id]
    ids=prefix+answer
    assert len(ids)<=256,(row['id'],len(ids))
    return {'input_ids':ids, 'labels':[-100]*len(prefix)+answer}


def collate(items,pad):
    length=max(len(x['input_ids']) for x in items)
    return {'input_ids':torch.tensor([x['input_ids']+[pad]*(length-len(x['input_ids'])) for x in items]),
            'attention_mask':torch.tensor([[1]*len(x['input_ids'])+[0]*(length-len(x['input_ids'])) for x in items]),
            'labels':torch.tensor([x['labels']+[-100]*(length-len(x['labels'])) for x in items])}


def shrink(teacher, count):
    config=copy.deepcopy(teacher.config)
    indices=[round(i*(config.num_hidden_layers-1)/(count-1)) for i in range(count)]
    config.num_hidden_layers=count
    config._name_or_path='custom-smollm2-depth-distilled-pilot'
    student=AutoModelForCausalLM.from_config(config,attn_implementation='eager').float()
    student.model.embed_tokens.load_state_dict(teacher.model.embed_tokens.state_dict())
    student.model.norm.load_state_dict(teacher.model.norm.state_dict())
    for i,j in enumerate(indices): student.model.layers[i].load_state_dict(teacher.model.layers[j].state_dict())
    student.tie_weights()
    student.generation_config=copy.deepcopy(teacher.generation_config)
    # Preserve the pretrained vocabulary and lower the cost of the first pilot.
    # The tied embedding/output matrix is still part of inference/model storage.
    student.model.embed_tokens.weight.requires_grad_(False)
    return student,indices


@torch.inference_mode()
def evaluate(model,tok,rows,label):
    model.eval(); outputs=[]; started=time.perf_counter()
    for i,row in enumerate(rows):
        ids=torch.tensor([prompt_ids(tok,row)])
        tic=time.perf_counter()
        generated=model.generate(input_ids=ids,attention_mask=torch.ones_like(ids),
            max_new_tokens=72,do_sample=False,use_cache=True,pad_token_id=tok.eos_token_id)
        reply_ids=generated[0,ids.shape[1]:].tolist()
        output=tok.decode(reply_ids,skip_special_tokens=True)
        outputs.append({'id':row['id'],'group':row['group'],'prompt':row['prompt'],
            'expected':row['target'],'output':output,'output_ids':reply_ids,
            'seconds':time.perf_counter()-tic,'output_tokens':len(reply_ids),
            'hit_cap':len(reply_ids)==72 and reply_ids[-1]!=tok.eos_token_id,**score(row,output)})
        if (i+1)%10==0: print(json.dumps({'evaluation':label,'cases_done':i+1}),flush=True)
    summary={key:sum(x[key] for x in outputs) for key in ['schema_valid','intent_correct','case_pass']}
    summary['total']=len(outputs)
    summary['by_group']={g:{'passed':sum(x['case_pass'] for x in outputs if x['group']==g),
                             'total':sum(x['group']==g for x in outputs)} for g in sorted(set(x['group'] for x in outputs))}
    summary['seconds']=time.perf_counter()-started
    result={'variant':label,'summary':summary,'cases':outputs}
    write(f'eval-{label}.json',result)
    print(json.dumps({'evaluation':label,'summary':summary}),flush=True)
    return summary


def main():
    p=argparse.ArgumentParser();p.add_argument('--steps',type=int,default=160)
    p.add_argument('--batch-size',type=int,default=4);p.add_argument('--layers',type=int,default=8)
    p.add_argument('--threads',type=int,default=4);p.add_argument('--learning-rate',type=float,default=0.0003)
    p.add_argument('--kd-weight',type=float,default=0.2);p.add_argument('--temperature',type=float,default=2.0)
    p.add_argument('--max-seconds',type=float,default=900)
    args=p.parse_args();logging.disable_progress_bar()
    torch.set_num_threads(args.threads);torch.set_num_interop_threads(1)
    torch.manual_seed(23);random.seed(23);torch.use_deterministic_algorithms(True)
    splits=build();lock=json.loads((ROOT/'teacher-lock.json').read_text())
    tok=AutoTokenizer.from_pretrained(lock['model_id'],revision=lock['revision'],local_files_only=True,trust_remote_code=False)
    teacher=AutoModelForCausalLM.from_pretrained(lock['model_id'],revision=lock['revision'],local_files_only=True,
        trust_remote_code=False,dtype=torch.float32,attn_implementation='eager').eval()
    for param in teacher.parameters(): param.requires_grad_(False)
    student,indices=shrink(teacher,args.layers)
    report={'status':'running','started_at':datetime.now(timezone.utc).isoformat(),'teacher':lock,
        'student_layers_from_teacher':indices,'teacher_parameters':sum(p.numel() for p in teacher.parameters()),
        'student_parameters':sum(p.numel() for p in student.parameters()),
        'trainable_parameters':sum(p.numel() for p in student.parameters() if p.requires_grad),
        'configuration':vars(args),'method':'Depth-pruned pretrained student; frozen tied embeddings; 80% checked-target CE + 20% teacher KL at T=2 (defaults).',
        'compute':'Local CPU float32. No external inference. No chain execution.',
        'limitations':['Small hand-authored curriculum, not representative real-user data.','Test prompts are held out but share the task domain.','Chat scoring uses keyword smoke checks.','No on-chain inference or gas measurement for this model.'],
        'training':[]}
    write('run.json',report);student.config.to_json_file(ROOT/'student-config.json')
    print(json.dumps({k:report[k] for k in ['teacher_parameters','student_parameters','trainable_parameters','student_layers_from_teacher']}),flush=True)
    # Fixed small validation subset for baseline visibility; no test examples yet.
    val=splits['validation']; selected=[]
    for group in sorted(set(r['group'] for r in val)):
        selected.extend([r for r in val if r['group']==group][:2])
    report['teacher_validation']=evaluate(teacher,tok,selected,'teacher-validation')
    report['untrained_validation']=evaluate(student,tok,selected,'pruned-validation')
    encoded=[encode(tok,r) for r in splits['train']]
    # Balance rare reply/clarify/refuse examples against numeric-action templates.
    freq=Counter(r['group'] for r in splits['train'])
    weights=[1/freq[r['group']] for r in splits['train']]
    optimizer=torch.optim.AdamW([p for p in student.parameters() if p.requires_grad],lr=args.learning_rate,weight_decay=0.01)
    start=time.perf_counter(); student.train()
    for step in range(1,args.steps+1):
        items=random.choices(encoded,weights=weights,k=args.batch_size)
        batch=collate(items,tok.eos_token_id);labels=batch.pop('labels')[:,1:]
        valid=labels!=-100
        with torch.no_grad():
            teacher_logits=teacher(**batch,use_cache=False).logits[:,:-1][valid]
            teacher_logp=F.log_softmax(teacher_logits/args.temperature,dim=-1)
        student_logits=student(**batch,use_cache=False).logits[:,:-1][valid]
        ce=F.cross_entropy(student_logits,labels[valid])
        kd=F.kl_div(F.log_softmax(student_logits/args.temperature,dim=-1),teacher_logp,
                    reduction='batchmean',log_target=True)*(args.temperature**2)
        loss=(1-args.kd_weight)*ce+args.kd_weight*kd
        if not torch.isfinite(loss): raise RuntimeError('nonfinite loss')
        optimizer.zero_grad(set_to_none=True);loss.backward()
        norm=torch.nn.utils.clip_grad_norm_(student.parameters(),1.0)
        warmup=min(1.0,step/10); decay=0.5*(1+math.cos(math.pi*step/args.steps))
        for g in optimizer.param_groups:g['lr']=args.learning_rate*warmup*(0.2+0.8*decay)
        optimizer.step()
        item={'step':step,'loss':float(loss.detach()),'ce':float(ce.detach()),'kd':float(kd.detach()),
              'gradient_norm':float(norm),'elapsed_seconds':time.perf_counter()-start}
        report['training'].append(item)
        if step==1 or step%10==0:
            print(json.dumps(item),flush=True);write('run.json',report)
        if time.perf_counter()-start>=args.max_seconds:
            report['time_cap_reached']=True;break
    report['completed_steps']=step; report['training_seconds']=time.perf_counter()-start
    del optimizer
    # Fix/save the model before opening held-out test outputs. BF16 serialization
    # is an offline storage choice; reloaded CPU evaluation uses float32 weights.
    student.eval().to(torch.bfloat16)
    modeldir=ROOT/'checkpoint';student.save_pretrained(modeldir,safe_serialization=True)
    tok.save_pretrained(modeldir)
    student.to(torch.float32)
    report['checkpoint_sha256']={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in modeldir.iterdir() if f.is_file()}
    report['checkpoint_precision']='BF16-rounded weights evaluated with float32 CPU arithmetic.'
    report['student_validation']=evaluate(student,tok,splits['validation'],'student-validation')
    report['student_test']=evaluate(student,tok,splits['test'],'student-test')
    report['teacher_test']=evaluate(teacher,tok,splits['test'],'teacher-test')
    report['status']='complete';report['finished_at']=datetime.now(timezone.utc).isoformat();write('run.json',report)
    print(json.dumps({'status':'complete','student_test':report['student_test'],'teacher_test':report['teacher_test']}),flush=True)


if __name__=='__main__':main()
