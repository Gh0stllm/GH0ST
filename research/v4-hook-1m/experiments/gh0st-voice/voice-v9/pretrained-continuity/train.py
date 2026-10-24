#!/usr/bin/env python3
"""Bounded local top-two-layer adaptation; never deploys or approves model quality."""
import argparse,copy,json,os,time
from pathlib import Path
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['TOKENIZERS_PARALLELISM']='false'
import numpy as np
import torch
from core import BASE,Corpus,make_batch,tensors,freeze_top2,frozen_hashes,audit,sha,save

def ce(model,items,device):
    ids,labels,mask=tensors(items,128,device)
    logits=model(input_ids=ids,attention_mask=mask,use_cache=False).logits
    loss=torch.nn.functional.cross_entropy(logits[:,:-1].reshape(-1,4019),labels[:,1:].reshape(-1),ignore_index=-100,reduction='sum')
    return loss,int((labels[:,1:]!=-100).sum())

@torch.no_grad()
def validate(model,validation,device):
    model.eval();result={}
    for kind,batches in validation.items():
        summed=count=0
        for batch in batches:
            loss,n=ce(model,batch,device);summed+=float(loss);count+=n
        result[kind]={'loss':summed/count,'known_targets':count,
                      'windows':sum(len(b)for b in batches),'scope':'Fixed document-contained held-out windows'}
    return result

@torch.no_grad()
def samples(model,tok,maximum):
    model.eval();rows=[]
    for prompt in ('i','"'):
        prefix=tok.encode(prompt,add_special_tokens=False)
        for seed in (0,42):
            gen=torch.Generator().manual_seed(seed);produced=[];past=None
            for step in range(maximum):
                current=prefix if step==0 else[produced[-1]]
                x=torch.tensor([current],dtype=torch.long)
                start=len(prefix)+step-len(current);total=len(prefix)+step
                q=torch.arange(start,total)[:,None];k=torch.arange(total)[None,:]
                allowed=(k<=q)&(k>q-64)
                mask=torch.zeros((1,1,len(current),total)).masked_fill(~allowed[None,None],torch.finfo(torch.float32).min)
                out=model(input_ids=x,attention_mask=mask,past_key_values=past,use_cache=True,
                          position_ids=torch.arange(start,total)[None,:])
                past=out.past_key_values;logits=out.logits[0,-1].float();logits[0]=-float('inf')
                values,indices=torch.topk(logits,8)
                selected=int(indices[torch.multinomial(torch.softmax(values/.8,0),1,generator=gen)])
                produced.append(selected)
            rows.append({'prompt':prompt,'prompt_ids':prefix,'seed':seed,'generated_token_ids':produced,
                         'continuation':tok.decode(produced,skip_special_tokens=True),
                         'text':tok.decode(prefix+produced,skip_special_tokens=True),
                         'eos_positions':[i for i,v in enumerate(produced)if v==1]})
    return {'scope':'Unedited FP32 development samples; no EOS stop/reset; not Q12 or semantic approval.',
            'temperature':.8,'top_k':8,'new_tokens':maximum,'streams':rows}

def main():
    from transformers import AutoModelForCausalLM,AutoTokenizer
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--checkpoint',type=Path,default=BASE);p.add_argument('--resume',type=Path)
    p.add_argument('--device',choices=['cpu','mps'],default='cpu');p.add_argument('--batch',type=int,default=64)
    p.add_argument('--lr',type=float,default=2e-6);p.add_argument('--weight-decay',type=float,default=.01)
    p.add_argument('--max-voice-targets',type=int,default=100000);p.add_argument('--max-targets',type=int,default=400000)
    p.add_argument('--stop-voice-targets',type=int,default=50000);p.add_argument('--every-voice',type=int,default=25000)
    p.add_argument('--validation-windows',type=int,default=128);p.add_argument('--probe-tokens',type=int,default=128)
    p.add_argument('--seed',type=int,default=912024);a=p.parse_args()
    if a.out.exists():raise ValueError('Output must be new')
    if not 0<a.stop_voice_targets<=a.max_voice_targets<=100000 or not 0<a.max_targets<=400000:raise ValueError('Bounded target budget exceeded')
    if min(a.batch,a.every_voice,a.validation_windows,a.probe_tokens)<1 or not 0<a.lr<=2e-6:raise ValueError('Invalid bounded configuration')
    if a.device=='mps' and not torch.backends.mps.is_available():raise ValueError('MPS unavailable; no fallback')
    torch.set_num_threads(2);torch.manual_seed(a.seed);rng=np.random.default_rng(a.seed)
    corpus=Corpus(a.data);tok=AutoTokenizer.from_pretrained(a.checkpoint,local_files_only=True,trust_remote_code=False)
    if sha(a.checkpoint/'model.safetensors')!=corpus.manifest['base_sha256'] or sha(a.checkpoint/'tokenizer.json')!=corpus.manifest['tokenizer_sha256']:raise ValueError('Prepared corpus/base mismatch')
    model=AutoModelForCausalLM.from_pretrained(a.checkpoint,local_files_only=True,trust_remote_code=False,
                                              attn_implementation='eager',dtype=torch.float32)
    expected={'hidden_size':128,'intermediate_size':341,'num_hidden_layers':4,'num_attention_heads':4,'num_key_value_heads':2,'vocab_size':4019}
    assert all(getattr(model.config,k)==v for k,v in expected.items())
    assert sum(v.numel()for v in model.parameters())==1235968 and len(tok)==4019
    assert model.model.embed_tokens.weight.data_ptr()==model.lm_head.weight.data_ptr()
    model.config.eos_token_id=1;model.config.pad_token_id=0;model.config.bos_token_id=None
    model.generation_config.eos_token_id=1;model.generation_config.pad_token_id=0;model.generation_config.bos_token_id=None
    trainable=freeze_top2(model);frozen=frozen_hashes(model);counts={'grammar':0,'voice':0};step=0
    if a.resume:
        from safetensors.torch import load_file
        loaded=model.load_state_dict(load_file(str(a.resume/'model.safetensors')),strict=False)
        if loaded.unexpected_keys or set(loaded.missing_keys)-{'lm_head.weight'}:
            raise ValueError('Resume checkpoint tensor keys do not match fixed architecture')
        previous=json.loads((a.resume/'training-metadata.json').read_text())
        if previous['data_manifest_sha256']!=sha(a.data/'manifest.json'):raise ValueError('Resume corpus changed')
        if frozen_hashes(model)!=frozen:raise ValueError('Resume altered frozen tensors')
        counts=previous['source_targets'];step=previous['step']
    device=torch.device(a.device);model.to(device)
    optimizer=torch.optim.AdamW([v for v in model.parameters()if v.requires_grad],lr=a.lr,weight_decay=a.weight_decay,foreach=False)
    if a.resume:
        state=torch.load(a.resume/'training-state.pt',map_location='cpu',weights_only=False)
        optimizer.load_state_dict(state['optimizer']);rng.bit_generator.state=state['numpy_rng']
        torch.set_rng_state(state['torch_rng'])
    validation={}
    vrng=np.random.default_rng(a.seed+1)
    for kind in ('grammar','voice'):
        allitems=corpus.items['validation',kind]
        chosen=vrng.choice(len(allitems),size=min(a.validation_windows,len(allitems)),replace=False)
        items=[allitems[int(i)]for i in chosen]
        validation[kind]=[items[i:i+a.batch]for i in range(0,len(items),a.batch)]
    a.out.mkdir(parents=True);started=time.monotonic()
    report={'status':'RUNNING','configuration':{k:str(v)if isinstance(v,Path)else v for k,v in vars(a).items()},
            'total_parameters':1235968,'trainable_parameters':trainable,'frozen_parameters':1235968-trainable,
            'base_sha256':sha(a.checkpoint/'model.safetensors'),'data_manifest_sha256':sha(a.data/'manifest.json'),
            'source_files_sha256':corpus.manifest['source_files_sha256'],'tokenizer_sha256':sha(a.checkpoint/'tokenizer.json'),
            'code_sha256':{name:sha(Path(__file__).with_name(name))for name in ('train.py','core.py','prepare.py')},
            'attention':{'block':128,'window_including_current':64,'mid_document_warmup':64,'within_document_only':True,
                         'scope':'Cropped coherent-document windows; not a claim of exact equivalence to a long-running multi-layer KV cache.'},
            'source_mix_by_known_targets':{'grammar':.75,'voice':.25},'history':[],
            'quantization':'No clipping/projection; reject saved checkpoints outside signed12/16 Q12 bounds.',
            'quality_approved':False,'mainnet_actions':0,'automatic_selection':False}
    def checkpoint():
        metrics=validate(model,validation,device)
        cpu=copy.deepcopy(model).to('cpu').float();cpu.eval()
        if frozen_hashes(cpu)!=frozen:raise RuntimeError('Frozen tensors changed')
        numerical=audit(cpu)
        if not numerical['eligible']:raise RuntimeError('Q12 export bounds failed; no silent clipping')
        directory=a.out/f'checkpoint-voice{counts["voice"]:06d}-total{sum(counts.values()):06d}';directory.mkdir()
        cpu.save_pretrained(directory,safe_serialization=True);tok.save_pretrained(directory)
        probe=samples(cpu,tok,a.probe_tokens);save(directory/'samples.json',probe)
        save(directory/'quantization-audit.json',numerical)
        metadata={'step':step,'source_targets':dict(counts),'validation':metrics,
                  'data_manifest_sha256':report['data_manifest_sha256'],'weight_sha256':sha(directory/'model.safetensors'),
                  'frozen_tensors_verified':len(frozen),'frozen_tensor_hashes':frozen,'quality_approved':False,
                  'elapsed_seconds':time.monotonic()-started}
        save(directory/'training-metadata.json',metadata)
        torch.save({'optimizer':optimizer.state_dict(),'numpy_rng':rng.bit_generator.state,
                    'torch_rng':torch.get_rng_state()},directory/'training-state.pt')
        report['history'].append(metadata|{'path':str(directory.resolve())});save(a.out/'report.json',report)
        print(json.dumps({'step':step,'targets':counts,'validation':metrics,'path':str(directory)}),flush=True)
        model.train()
    try:
        checkpoint();next_eval=(counts['voice']//a.every_voice+1)*a.every_voice
        while counts['voice']<a.stop_voice_targets and sum(counts.values())<a.max_targets:
            boundary=min(next_eval,a.stop_voice_targets)
            batch,next_counts=make_batch(corpus,rng,counts,a.batch,128,a.max_targets,a.max_voice_targets,boundary)
            if not batch:break
            model.train();optimizer.zero_grad(set_to_none=True);loss,n=ce(model,batch,device)
            if not bool(torch.isfinite(loss)):raise RuntimeError('Nonfinite training loss')
            (loss/n).backward();torch.nn.utils.clip_grad_norm_([v for v in model.parameters()if v.requires_grad],1.)
            optimizer.step();counts=next_counts;step+=1
            if counts['voice']>=boundary or sum(counts.values())>=a.max_targets:
                checkpoint();next_eval+=a.every_voice
        report.update(status='COMPLETE_REVIEW_REQUIRED',steps=step,source_targets=counts,
                      elapsed_seconds=time.monotonic()-started,
                      stop_reason='VOICE_REVIEW_BOUNDARY'if counts['voice']>=a.stop_voice_targets else'TOTAL_TARGET_CAP')
        save(a.out/'report.json',report)
    except BaseException as error:
        report.update(status='FAILED',error=str(error),source_targets=counts,steps=step)
        save(a.out/'report.json',report);raise

if __name__=='__main__':main()
