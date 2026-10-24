#!/usr/bin/env python3
"""Check the target V8 model class actually preserves the widened function."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import numpy as np
import torch
from safetensors.torch import load_file


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True);p.add_argument('--target',type=Path,required=True)
    p.add_argument('--model',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();assert not a.output.exists();torch.set_num_threads(2)
    spec=importlib.util.spec_from_file_location('independent_target_v8_model',a.model)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    narrow=load_file(a.source/'model.safetensors');wide=load_file(a.target/'model.safetensors')
    old_h=narrow['wx1'].shape[1];new_h=wide['wx1'].shape[1];factor=new_h//old_h
    m1=module.VoiceModel(np.ones(8192),hidden=old_h).eval();m1.load_state_dict(narrow)
    m2=module.VoiceModel(np.ones(8192),hidden=new_h).eval();m2.load_state_dict(wide)
    generator=torch.Generator().manual_seed(7512)
    x=torch.randint(0,8194,(2,13),generator=generator);pp=torch.randint(0,5,x.shape,generator=generator)
    domains=torch.arange(2)[:,None].expand_as(x);reset=torch.zeros(x.shape,dtype=torch.bool);reset[:,0]=True;reset[1,7]=True
    with torch.inference_mode():
        hs,ss=m1(x,pp,reset,domains);hw,sw=m2(x,pp,reset,domains)
        errors={'hidden_sequence':float((hw-hs.repeat_interleave(factor,-1)).abs().max()),
                'layer1_final':float((sw[0]-ss[0].repeat_interleave(factor,-1)).abs().max()),
                'layer2_final':float((sw[1]-ss[1].repeat_interleave(factor,-1)).abs().max()),
                'group_logits':float((m2.logits(hw)-m1.logits(hs)).abs().max())}
        # All8192 lexical logits are checked, not just one chosen group.
        out1=hs@narrow['words.weight'].T+narrow['word_bias.weight'][:,0]
        out2=hw@wide['words.weight'].T+wide['word_bias.weight'][:,0]
        errors['all_word_logits']=float((out1-out2).abs().max())
        words=torch.randint(0,8194,x.shape,generator=generator)
        errors['punctuation_logits']=float((m1.punctuation_logits(hs,words)-m2.punctuation_logits(hw,words)).abs().max())
        hfirst,state=m2(x[:,:5],pp[:,:5],reset[:,:5],domains[:,:5])
        hlast,laststate=m2(x[:,5:],pp[:,5:],reset[:,5:],domains[:,5:],state)
        errors['wide_chunk_carry']=float((torch.cat([hfirst,hlast],1)-hw).abs().max())
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    report={'status':'PASS'if max(errors.values())<1e-4 else'FAIL','source_width':old_h,'target_width':new_h,
            'class_parameter_values':sum(v.numel()for v in m2.parameters()),'fp32_max_errors':errors,
            'tolerance':1e-4,'scope':'Target class forward, all lexical heads, punctuation including unknown-word bias masking, reset and chunk carry; dropout disabled.',
            'source_sha256':sha(a.source/'model.safetensors'),'target_sha256':sha(a.target/'model.safetensors'),
            'model_source_sha256':sha(a.model),'script_sha256':sha(Path(__file__))}
    a.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))


if __name__=='__main__':main()
