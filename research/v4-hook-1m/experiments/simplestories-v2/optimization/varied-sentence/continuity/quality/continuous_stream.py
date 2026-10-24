"""Exact 128-position Q12 continuation fixtures using the prototype's global sampling step."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import subprocess
import time
import numpy as np
from continuity_screen import extended_forward, reference, tokenizer, sampled_token, OUT


class Predictor:
    def __init__(self):self.forward=extended_forward(128);self.cache={};self.logits={}
    def __call__(self,ids):
        key=tuple(ids)
        if key not in self.cache:
            logits=np.asarray(self.forward(list(ids))['logits'],dtype=np.int64)
            order=np.argsort(-logits,kind='stable');order=order[order!=0][:64]
            self.cache[key]=(order.astype(np.uint16),logits[order]);self.logits[key]=logits
        return self.cache[key]


def continue_tokens(predict,context,draws,total,count=2,k=8,temp=800):
    ctx=context.copy();generated=[];contexts=[]
    for step in range(count):
        contexts.append(ctx.copy())
        token=sampled_token(predict(ctx),int(draws[total+step],16),k,temp)
        generated.append(token);ctx.append(token)
        if token in {1,2,15,30}:break
    return generated,contexts


def run(predict,initial,seed,draws,mode='full128',turns=20):
    history=initial.copy();context=initial.copy();total=0;records=[];refreshes=[]
    for index in range(turns):
        maximum=128 if mode=='full128' else 16
        if len(context)-1+2>maximum:
            refreshes.append({'before_turn':index+1,'old_processed':len(context)-1,'retained_tail_ids':history[-3:]})
            context=history[-3:]
        before=context.copy()
        tokens,contexts=continue_tokens(predict,context,draws,total)
        context.extend(tokens);history.extend(tokens)
        records.append({'turn':index+1,'seed':seed,'total_generated_before':total,
            'context_ids_before':before,'contexts_evaluated':contexts,'tokens':tokens,
            'chunk_text':tokenizer.decode(tokens,skip_special_tokens=True),
            'ended_eos':tokens[-1]==1,'ended_sentence':tokens[-1] in {2,15,30},
            'processed_kv_after':len(context)-1,'pending_token_after':context[-1],
            'history_ids_after':history.copy(),'total_generated_after':total+len(tokens)})
        total+=len(tokens)
    return {'mode':mode,'initial_prompt_ids':initial,'initial_prompt':tokenizer.decode(initial),
        'top_k':8,'temperature_milli':800,'maximum_new_tokens_per_turn':2,'turns':records,
        'refreshes':refreshes,'total_generated':total,'final_history_ids':history,
        'final_text':tokenizer.decode(history,skip_special_tokens=True),
        'generated_text':tokenizer.decode(history[len(initial):],skip_special_tokens=True),
        'eos_turns':[r['turn'] for r in records if r['ended_eos']]}


def add_hashes(predict,rows):
    payload=bytearray()
    for row in rows:
        logits=predict.logits[tuple(row['contexts_evaluated'][-1])]
        payload+=(32).to_bytes(32,'big')+len(logits).to_bytes(32,'big')+b''.join(int(x).to_bytes(32,'big',signed=True) for x in logits)
    local=OUT/'stream-logits.local.bin';local.write_bytes(payload)
    node='/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
    code='import fs from "node:fs";import{keccak256}from"ethers";const b=fs.readFileSync(process.argv[1]),o=[];for(let i=0;i<b.length;i+=128672)o.push(keccak256(b.subarray(i,i+128672)));process.stdout.write(JSON.stringify(o));'
    hashes=json.loads(subprocess.check_output([node,'--input-type=module','-e',code,str(local)],cwd=reference.BASE.parents[1]))
    local.unlink()
    for row,value in zip(rows,hashes):row['last_logit_hash']=value


def main():
    start=time.monotonic();predict=Predictor();all_draws=json.loads((OUT/'stream-draws.json').read_text())
    result={'schema_version':1,'status':'RUNNING','scope':'Offline exact Q12 continuous story reference; no training or chain actions.',
        'weights_sha256':hashlib.sha256(reference.blob).hexdigest(),
        'arithmetic':'Original Q12 equations and weights. Only context bound and exact rounded-Q12 RoPE tables extended to128.',
        'sampling':'Constant bytes32 seed per story; topK8, temperature800; drawstep=totalPreviouslyGenerated+tokenIndexWithinTurn.',
        'maximum_new_tokens_per_turn':2,'runs':[],'causality_checks':[]}
    configs=[('quote','"',42),('bird','The little bird',43),('key','Mia found a key',44)]
    for label,text,number in configs:
        initial=tokenizer.encode(text,add_special_tokens=False);seed='0x'+number.to_bytes(32,'big').hex();draws=all_draws[seed]
        for mode in ['full128','tail3-at16']:
            row=run(predict,initial,seed,draws,mode);row['label']=label;result['runs'].append(row)
            print(json.dumps({'label':label,'mode':mode,'total_generated':row['total_generated'],'refreshes':len(row['refreshes']),'eos_turns':row['eos_turns'],'text':row['final_text']}),flush=True)
        full=next(r for r in result['runs'] if r['label']==label and r['mode']=='full128')
        for at in [3,6,11,16]:
            turn=full['turns'][at-1];history=turn['history_ids_after'];step=turn['total_generated_after']
            kept,ctx=continue_tokens(predict,history,draws,step)
            reset,_=continue_tokens(predict,initial,draws,step)
            result['causality_checks'].append({'label':label,'after_turn':at,'same_seed':seed,'same_global_step':step,
                'retained_history_ids':history,'reset_history_ids':initial,'continued_tokens':kept,'reset_tokens':reset,
                'continued_text':tokenizer.decode(kept,skip_special_tokens=True),'reset_text':tokenizer.decode(reset,skip_special_tokens=True),
                'tokens_differ':kept!=reset,'full_logits_differ':not np.array_equal(predict.logits[tuple(history)],predict.logits[tuple(initial)])})
    add_hashes(predict,[turn for row in result['runs'] for turn in row['turns']])
    result['causality_summary']={'cases':len(result['causality_checks']),'changed_tokens':sum(x['tokens_differ'] for x in result['causality_checks']),
        'changed_full_logits':sum(x['full_logits_differ'] for x in result['causality_checks'])}
    result['unique_contexts_evaluated']=len(predict.cache);result['elapsed_seconds']=round(time.monotonic()-start,3)
    result['limitations']=['Each swap-sized turn emits up to2tokens, usually a fragment; sentences span turns.',
        'Full128history is retained in this20turn reference, but behavior at128capacity needs a separate boundary test.',
        'Continuity is model conditioning, not a guarantee of logical or narrative consistency.',
        'The extended RoPE table/reference needs its own EVM implementation and gas validation.']
    result['status']='COMPLETE';(OUT/'continuous-stream-reference.json').write_text(json.dumps(result,indent=2)+'\n')
    text=[]
    for row in result['runs']:
        text += [f"{row['label']} / {row['mode']}",row['final_text']]
        text += [f"{t['turn']:02d}. {t['chunk_text']}" for t in row['turns']]
        text.append('')
    (OUT/'continuous-stream-transcripts.txt').write_text('\n'.join(text))
    print(json.dumps(result['causality_summary']),flush=True)


if __name__=='__main__':main()
