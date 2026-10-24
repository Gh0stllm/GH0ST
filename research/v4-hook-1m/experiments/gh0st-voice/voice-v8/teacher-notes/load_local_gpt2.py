#!/usr/bin/env python3
"""Strictly offline CPU loader/six-token smoke; no downloads, training or GPU."""
import hashlib,json,os,time
from pathlib import Path
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1';os.environ['HF_HUB_DISABLE_PROGRESS_BARS']='1'
os.environ['TOKENIZERS_PARALLELISM']='false'

def load_teacher():
    import torch
    from transformers import AutoModelForCausalLM,AutoTokenizer
    research=Path(__file__).resolve().parents[4]
    checkpoint=research/'experiments/gpt2/model-cache'
    expected='248dfc3911869ec493c76e65bf2fcf7f615828b0254c12b473182f0f81d3a707'
    actual=hashlib.sha256((checkpoint/'model.safetensors').read_bytes()).hexdigest();assert actual==expected
    tok=AutoTokenizer.from_pretrained(checkpoint,local_files_only=True,trust_remote_code=False)
    model,info=AutoModelForCausalLM.from_pretrained(checkpoint,local_files_only=True,trust_remote_code=False,use_safetensors=True,attn_implementation='eager',dtype=torch.float32,output_loading_info=True)
    model=model.eval().to('cpu');assert sum(p.numel()for p in model.parameters())==124439808
    return model,tok,info,actual

def main():
    import torch,importlib.metadata
    torch.set_num_threads(2);start=time.monotonic();model,tok,info,checksum=load_teacher();load_seconds=time.monotonic()-start
    prompt='I am a machine keeping a notebook beside the trading pool. I found a small brass key and'
    inputs=tok(prompt,return_tensors='pt');t=time.monotonic()
    with torch.inference_mode():result=model.generate(**inputs,max_new_tokens=6,do_sample=False,use_cache=True,pad_token_id=tok.eos_token_id)
    new=result[0,inputs['input_ids'].shape[1]:].tolist()
    report={'status':'PASS_OFFLINE_CPU_SMOKE','checkpoint_sha256':checksum,'learned_parameters':sum(p.numel()for p in model.parameters()),'load_seconds':load_seconds,'generation_seconds':time.monotonic()-t,'prompt':prompt,'new_tokens':new,'continuation':tok.decode(new),'device':str(next(model.parameters()).device),'load_info':info,'versions':{n:importlib.metadata.version(n)for n in('torch','transformers','tokenizers','safetensors')},'downloads':0,'gpu_actions':0,'training_actions':0,'quality_approval':False}
    encoded=json.dumps(report,indent=2,default=lambda value:sorted(value)if isinstance(value,set)else str(value))
    Path(__file__).with_name('loader-smoke.json').write_text(encoded+'\n');print(encoded)
if __name__=='__main__':main()
