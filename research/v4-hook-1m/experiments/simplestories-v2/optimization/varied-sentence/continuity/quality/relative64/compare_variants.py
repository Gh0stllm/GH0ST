"""Small offline comparison, not a broad language-quality benchmark."""
from pathlib import Path
import importlib.util
import hashlib
import json
import math
import numpy as np
from build_reference import scope, reference, OUT

spec=importlib.util.spec_from_file_location('absolute_rolling_reference',OUT.parent/'rolling64/build_reference.py')
absolute=importlib.util.module_from_spec(spec);spec.loader.exec_module(absolute)
relative_scope=scope();absolute_scope=absolute.scope()
fixture_path=OUT/'relative64-2060turn-reference.json'
fixture=json.loads(fixture_path.read_text())
tokens=fixture['processed_tokens']

# Verify the unquantized identity independently of the transformer and Q12 code.
rng=np.random.default_rng(20261024);errors=[]
for _ in range(10000):
    i=int(rng.integers(63,1000000));age=int(rng.integers(0,64));j=i-age
    q=rng.normal(size=32);k=rng.normal(size=32)
    def rotate(x,pos):
        theta=np.asarray([pos*10000**(-n/16) for n in range(16)])
        c=np.cos(theta);s=np.sin(theta)
        return np.concatenate((x[:16]*c-x[16:]*s,x[16:]*c+x[:16]*s))
    errors.append(abs(rotate(q,i)@rotate(k,j)-q@rotate(k,-age)))
assert max(errors)<1e-7

import torch
from transformers import AutoModelForCausalLM
torch.set_num_threads(2)
model=AutoModelForCausalLM.from_pretrained(reference.BASE/'model-cache',local_files_only=True,trust_remote_code=False,attn_implementation='eager').eval()
rows=[]
with torch.inference_mode():
    for n in [1,2,16,32,64,65,96,128,150]:
        ids=tokens[:n]
        relative=np.asarray(relative_scope['forward'](ids)['logits'],dtype=np.float64)
        abs_q12=np.asarray(absolute_scope['forward'](ids)['logits'],dtype=np.float64)
        positions=torch.arange(n)
        permitted=(positions[:,None]>=positions[None,:]) & ((positions[:,None]-positions[None,:])<64)
        mask=torch.where(permitted,torch.tensor(0.),torch.tensor(torch.finfo(torch.float32).min))[None,None]
        fp32=model(torch.tensor([ids]),attention_mask=mask,position_ids=positions[None,:],use_cache=False).logits[0,-1].float().numpy()
        rows.append({'prefix_tokens':n,'same_input_ids':True,
            'relative_vs_absolute_q12_max_logit_difference':int(np.max(np.abs(relative-abs_q12))),
            'relative_vs_absolute_q12_rmse':float(np.sqrt(np.mean(((relative-abs_q12)/4096)**2))),
            'relative_vs_absolute_q12_argmax_match':int(np.argmax(relative))==int(np.argmax(abs_q12)),
            'relative_vs_fp32_rmse':float(np.sqrt(np.mean((relative/4096-fp32)**2))),
            'absolute_q12_vs_fp32_rmse':float(np.sqrt(np.mean((abs_q12/4096-fp32)**2))),
            'relative_vs_fp32_argmax_match':int(np.argmax(relative))==int(np.argmax(fp32)),
            'absolute_q12_vs_fp32_argmax_match':int(np.argmax(abs_q12))==int(np.argmax(fp32)),
            'relative_next_id':int(np.argmax(relative)),'absolute_q12_next_id':int(np.argmax(abs_q12)),'fp32_next_id':int(np.argmax(fp32))})

result={'scope':'Nine same-input prefix comparisons against local FP32 checkpoint with explicit causal sliding64 mask. Not a language-quality score.',
    'reference_sha256':hashlib.sha256(fixture_path.read_bytes()).hexdigest(),
    'float_identity_cases':10000,'float_identity_position_range':[63,999999],'float_identity_age_range':[0,63],
    'float_identity_max_absolute_dot_error':max(errors),'rows':rows,
    'relative_vs_fp32_argmax_matches':sum(r['relative_vs_fp32_argmax_match'] for r in rows),
    'absolute_q12_vs_fp32_argmax_matches':sum(r['absolute_q12_vs_fp32_argmax_match'] for r in rows),
    'relative_vs_absolute_q12_argmax_matches':sum(r['relative_vs_absolute_q12_argmax_match'] for r in rows),
    'limitations':['FP32 equivalence of the rotation identity does not imply Q12 bit equivalence.',
        'Both Q12 variants approximate FP32 using quantized weights, integer normalization and lookup nonlinearities.',
        'Only nine prefixes from one generated stream are compared; no comprehensive quality claim is supported.']}
(OUT/'variant-comparison.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
