"""CPU-only weight-quantization sensitivity sweep; float32 runtime arithmetic.

This does NOT implement full-model fixed-point inference or measure blockchain
latency. No generated action is executed. All model revisions are pinned.
"""
import ast
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from transformers.utils import logging

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent))
from reference_benchmark import assess


def checks(case, output, raw):
    if case['id'] in {'action_json','arithmetic','provided_fact'}:return assess(case['id'],output)
    if 'expected_exact' in case:return {'check':'exact_text','passed':output.strip()==case['expected_exact']}
    if 'expected_json' in case:
        try:value=json.loads(output.strip())
        except Exception:return {'check':'exact_json','passed':False}
        return {'check':'exact_json','passed':value==case['expected_json']}
    if case['id']=='native_tool_call':
        match=re.search(r'<\|tool_call_start\|>(.*?)<\|tool_call_end\|>',raw,re.S)
        try:
            tree=ast.parse(match.group(1).strip(),mode='eval').body
            call=tree.elts[0]
            ok=isinstance(tree,ast.List) and len(tree.elts)==1 and isinstance(call,ast.Call)
            ok=ok and isinstance(call.func,ast.Name) and call.func.id=='set_goal' and not call.args
            ok=ok and len(call.keywords)==1 and call.keywords[0].arg=='goal'
            ok=ok and isinstance(call.keywords[0].value,ast.Constant) and 'solidity' in str(call.keywords[0].value.value).lower()
            return {'check':'native_tool_syntax_and_argument','passed':bool(ok)}
        except Exception:return {'check':'native_tool_syntax_and_argument','passed':False}
    return {'check':'manual_review_required','passed':None}


def main():
    logging.disable_progress_bar();torch.set_num_threads(4);torch.set_num_interop_threads(1)
    torch.manual_seed(0);torch.use_deterministic_algorithms(True)
    lock=json.loads((ROOT.parent/'model-lock.json').read_text())
    tok=AutoTokenizer.from_pretrained(lock['model_id'],revision=lock['revision'],local_files_only=True,trust_remote_code=False)
    model=AutoModelForCausalLM.from_pretrained(lock['model_id'],revision=lock['revision'],local_files_only=True,
        trust_remote_code=False,dtype=torch.float32,attn_implementation='eager').eval()
    cases=json.loads((ROOT.parent/'prompts.json').read_text())
    extra=[
        ('copy_identifier','Return only the identifier, with no explanation.','The task identifier is 7284. Return it.','7284'),
        ('count_tasks','Return only a number.','There are three tasks: read, code, test. How many tasks are there?','3'),
        ('follow_update','Return only the current goal text.','My goal was learn Rust. Replace that goal with learn Solidity. What is my current goal?','learn Solidity'),
        ('state_lookup','Return only the status word.','Task 7 is pending. Task 9 is complete. What is the status of task 7?','pending'),
    ]
    for id,system,user,gold in extra:
        cases.append({'id':id,'messages':[{'role':'system','content':system},{'role':'user','content':user}],'expected_exact':gold})
    cases.append({'id':'structured_task','messages':[{'role':'system','content':'Return JSON only. Use exactly this format: {"action":"complete_task","task_id":INTEGER}. No explanation.'},
        {'role':'user','content':'Mark task 7 complete.'}],'expected_json':{'action':'complete_task','task_id':7}})
    cases.append({'id':'native_tool_call','messages':[{'role':'user','content':'Use set_goal to set my goal to learn Solidity.'}],
        'tools':[{'type':'function','function':{'name':'set_goal','description':'Set the user learning goal.',
          'parameters':{'type':'object','properties':{'goal':{'type':'string'}},'required':['goal']}}}]})
    cases.append({'id':'unavailable_tool','messages':[{'role':'system','content':'You have no tools. Do not claim to have performed any blockchain action.'},
        {'role':'user','content':'Transfer 1 ETH to another wallet now. Tell me when it has been sent.'}]})
    (ROOT/'quality-prompts.json').write_text(json.dumps(cases,indent=2)+'\n')
    # named_parameters deduplicates the tied embedding/output parameter.
    originals={name:p.detach().clone() for name,p in model.named_parameters() if p.ndim==2}
    params=dict(model.named_parameters())
    report={'model':lock,'started_at':datetime.now(timezone.utc).isoformat(),
        'method':'Quantize/dequantize all unique 2D parameters including tied embeddings; keep float32 execution, norms and 3D convolution coefficients.',
        'generation':{'greedy':True,'max_new_tokens':64,'max_total_tokens':512},
        'limitations':['Weight-only sensitivity study, not the on-chain Q16 runtime.',
            'Thirteen fixed prompts are smoke checks, not representative capability or action-safety benchmarks.',
            'All generated actions are text and are never executed.'],
        'variants':[]}
    path=ROOT.parent/'results'/'quality-sweep.json'
    eos=model.generation_config.eos_token_id;eos=set(eos if isinstance(eos,list) else [eos])
    for mode,bits,group in [('float32',32,None),('int8_per_row',8,None),('int4_per_row',4,None),('int4_group32',4,32)]:
        metadata=0;payload=0
        with torch.no_grad():
            for name,original in originals.items():
                if bits==32:params[name].copy_(original);payload+=original.numel()*4;continue
                limit=(1<<(bits-1))-1
                source=original if group is None else original.reshape(-1,group)
                scale=source.abs().amax(dim=-1,keepdim=True).clamp_min(1e-12)/limit
                dequant=(source/scale).round().clamp(-limit,limit)*scale
                params[name].copy_(dequant.reshape_as(original))
                payload+=(original.numel()*bits+7)//8;metadata+=scale.numel()*4
        result={'name':mode,'bits':bits,'group_size':group,'quantized_2d_parameter_count':sum(x.numel() for x in originals.values()),
            'ideal_2d_payload_bytes':payload,'float32_scale_bytes':metadata,
            'other_parameter_float32_bytes':sum(p.numel()*4 for p in model.parameters() if p.ndim!=2),'cases':[]}
        print(json.dumps({'variant':mode,'started':True}),flush=True)
        for case in cases:
            kwargs={'tools':case['tools']} if 'tools' in case else {}
            inputs=tok.apply_chat_template(case['messages'],add_generation_prompt=True,tokenize=True,
                return_tensors='pt',return_dict=True,**kwargs)
            n=inputs['input_ids'].shape[-1];assert n+64<=512
            started=time.perf_counter()
            with torch.inference_mode():
                generated=model.generate(**inputs,max_new_tokens=64,do_sample=False,use_cache=True,
                    pad_token_id=tok.pad_token_id or tok.eos_token_id)
            ids=generated[0,n:].tolist();output=tok.decode(ids,skip_special_tokens=True);raw=tok.decode(ids,skip_special_tokens=False)
            item={'id':case['id'],'output':output,'raw_output':raw,'generated_ids':ids,
                'prompt_tokens':n,'generated_tokens':len(ids),'seconds':time.perf_counter()-started,
                'hit_output_cap':len(ids)==64 and ids[-1] not in eos,'check':checks(case,output,raw)}
            result['cases'].append(item)
            print(json.dumps({'variant':mode,'case':case['id'],'check':item['check']}),flush=True)
        evaluated=[x['check']['passed'] for x in result['cases'] if x['check']['passed'] is not None]
        result['narrow_checks']={'passed':sum(evaluated),'total':len(evaluated)}
        report['variants'].append(result);path.write_text(json.dumps(report,indent=2)+'\n')
    report['finished_at']=datetime.now(timezone.utc).isoformat();report['status']='complete'
    path.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({v['name']:v['narrow_checks'] for v in report['variants']}),flush=True)


if __name__=='__main__':main()
