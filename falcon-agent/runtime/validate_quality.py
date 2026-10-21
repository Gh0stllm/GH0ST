"""Small regression for extra activation drift, not a general quality benchmark."""
import argparse
import hashlib
import json
import time
from pathlib import Path

import torch
import transformers
from transformers import AutoTokenizer,AutoModelForCausalLM
from reference import Model,ROOT
from codec import load_into_model

CASES=['Hi','What is 2 plus 2? Reply only with the number.',
       'Name one primary colour.','My name is Iris. What is my name?']


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--export',type=Path,required=True)
    p.add_argument('--chat-trace',type=Path,required=True)
    args=p.parse_args()
    torch.set_num_threads(4);transformers.utils.logging.disable_progress_bar()
    tok=AutoTokenizer.from_pretrained(args.checkpoint,local_files_only=True,trust_remote_code=False)
    model=AutoModelForCausalLM.from_pretrained(args.checkpoint,local_files_only=True,trust_remote_code=False,
                                            dtype=torch.float32,attn_implementation='eager').eval()
    load_into_model(model,args.export)
    fixed=Model(args.export/'weights.bin')
    began=time.monotonic();rows=[]
    for text in CASES:
        fixed.reset()
        prompt=tok.apply_chat_template([{'role':'user','content':text}],add_generation_prompt=True,
                                      tokenize=True,return_dict=True)['input_ids']
        assert len(prompt)+2<=64
        tokens=list(prompt)
        for token in prompt[:-1]:fixed.step(token)
        out=[];expected=[]
        for _ in range(2):
            best,_=fixed.step(tokens[-1])
            with torch.inference_mode():target=int(model(input_ids=torch.tensor([tokens]),use_cache=False).logits[0,-1].argmax())
            out.append(best);expected.append(target);tokens.append(best)
            if best==11:break
        row={'prompt':text,'prompt_tokens':prompt,'prompt_length':len(prompt),'generated_tokens':out,
             'float32_tokens_on_same_prefix':expected,'all_tokens_agree':out==expected,'decoded':tok.decode(out)}
        rows.append(row);print(json.dumps(row),flush=True)
        if text=='Hi':
            args.chat_trace.write_text(json.dumps({'status':'passed'if out==expected else'numerical_mismatch',
                'prompt_tokens':prompt,'generated_tokens':out,'traces':fixed.traces})+'\n')
    report={'status':'passed'if all(r['all_tokens_agree']for r in rows)else'numerical_mismatch',
            'scope':'Four short regression prompts compare Q32/int16 greedy predictions with float32 using identical four-bit weights',
            'cases':rows,'predictions':sum(len(r['generated_tokens'])for r in rows),
            'agreements':sum(sum(a==b for a,b in zip(r['generated_tokens'],r['float32_tokens_on_same_prefix']))for r in rows),
            'seconds':time.monotonic()-began,'training_performed':False,'public_transactions_sent':0,
            'general_accuracy_claim':False,'chat_trace_sha256':hashlib.sha256(args.chat_trace.read_bytes()).hexdigest()}
    (ROOT/'quality-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items()if k!='cases'}),flush=True)


if __name__=='__main__':main()
