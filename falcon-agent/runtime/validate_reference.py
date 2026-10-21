"""Compare the independent Q32/history engine against the pinned HF model."""
import argparse
import hashlib
import json
import time
from pathlib import Path

import torch
import transformers
from transformers import AutoModelForCausalLM, AutoTokenizer
from reference import Model, ROOT, STUDY, ONE
from codec import load_into_model


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--export',type=Path,required=True)
    p.add_argument('--tokens',type=int,nargs='+',default=[1,450])
    p.add_argument('--new-tokens',type=int,default=2)
    p.add_argument('--trace',type=Path,required=True)
    args=p.parse_args()
    torch.set_num_threads(4)
    transformers.utils.logging.disable_progress_bar()
    started=time.monotonic()
    fixed=Model(args.export/'weights.bin')
    print(json.dumps({'status':'weights_loaded','tensors':len(fixed.tensors)}),flush=True)
    hf=AutoModelForCausalLM.from_pretrained(args.checkpoint,local_files_only=True,trust_remote_code=False,
                                          dtype=torch.float32,attn_implementation='eager').eval()
    load_into_model(hf,args.export)
    tokenizer=AutoTokenizer.from_pretrained(args.checkpoint,local_files_only=True,trust_remote_code=False)
    tokens=list(args.tokens)
    generated=[]
    reference_generated=[]
    rows=[]
    for i in range(len(tokens)-1):
        fixed.step(tokens[i])
    for step in range(args.new_tokens):
        prediction,raw_logits=fixed.step(tokens[-1])
        with torch.inference_mode():
            logit=hf(input_ids=torch.tensor([tokens]),use_cache=False).logits[0,-1].float()
        expected=int(logit.argmax())
        generated.append(prediction);reference_generated.append(expected)
        row={'generation_index':step,'fixed_token':prediction,'float32_token_on_same_prefix':expected,
             'agrees':prediction==expected,'float32_top5':logit.topk(5).indices.tolist()}
        rows.append(row);print(json.dumps(row),flush=True)
        tokens.append(prediction)
        if prediction==11:break
    result={'status':'passed' if all(r['agrees']for r in rows)else'numerical_mismatch',
            'scope':'Q32 and adaptive int16 engine versus float32 activations using identical deployed four-bit weights',
            'prompt_tokens':args.tokens,'generated_tokens':generated,'reference_tokens_on_same_prefix':reference_generated,
            'decoded':tokenizer.decode(generated),'comparisons':rows,'context_limit':64,'greedy_only':True,
            'new_public_contracts':0,'public_transactions_sent':0,'seconds':time.monotonic()-started,
            'traces':fixed.traces}
    args.trace.parent.mkdir(parents=True,exist_ok=True)
    args.trace.write_text(json.dumps(result)+'\n')
    summary={k:v for k,v in result.items()if k!='traces'}
    (ROOT/'reference-validation.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary),flush=True)


if __name__=='__main__':main()
