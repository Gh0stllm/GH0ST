"""Offline exact Q12 story continuation across simulated swaps; no chain or weight changes."""
from __future__ import annotations
import ast
import hashlib
import json
import math
from pathlib import Path
import sys
import time

sys.dont_write_bytecode=True
OUT=Path(__file__).resolve().parent
COMMON=OUT.parents[1]/'quality'
sys.path.insert(0,str(COMMON))
from exact_sampling import reference, tokenizer, sampled_token
import numpy as np


def extended_forward(maximum=64):
    """Change only the implementation context bound and deterministic RoPE table length."""
    tree=ast.parse((reference.BASE/'integer_reference.py').read_text())
    main=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='main')
    functions=[node for node in main.body if isinstance(node,ast.FunctionDef)]
    forward=next(node for node in functions if node.name=='forward')
    first_assert=next(node for node in forward.body if isinstance(node,ast.Assert))
    assert isinstance(first_assert.test,ast.Compare) and first_assert.test.comparators[-1].value==16
    first_assert.test.comparators[-1]=ast.Constant(maximum)
    scope=dict(reference.scope)
    scope['cos']=np.asarray([[round(math.cos(p*10000**(-j/16))*4096) for j in range(16)] for p in range(maximum)],dtype=np.int64)
    scope['sin']=np.asarray([[round(math.sin(p*10000**(-j/16))*4096) for j in range(16)] for p in range(maximum)],dtype=np.int64)
    assert np.array_equal(scope['cos'][:16],reference.cos)
    assert np.array_equal(scope['sin'][:16],reference.sin)
    exec(compile(ast.fix_missing_locations(ast.Module(body=functions,type_ignores=[])),str(reference.BASE/'integer_reference.py'),'exec'),scope)
    return scope['forward']


class Predictor:
    def __init__(self,forward):self.forward=forward;self.cache={}
    def __call__(self,ids):
        key=tuple(ids)
        if key not in self.cache:
            logits=np.asarray(self.forward(list(ids))['logits'],dtype=np.int64)
            order=np.argsort(-logits,kind='stable');order=order[order!=0][:64]
            self.cache[key]=(order.astype(np.uint16),logits[order])
        return self.cache[key]


def run_story(predictor,draws,initial,mode,seed_start,turns=20,cap=2,k=8,temp=700):
    history=initial.copy();epoch=initial.copy();records=[];refreshes=[];blocked=None
    for turn in range(turns):
        seed=seed_start+turn
        generated=[];contexts=[]
        for step in range(cap):
            if mode=='tail3' and len(epoch)>16:
                refreshes.append({'turn':turn+1,'step':step,'discarded_tokens':len(epoch)-3,'retained_ids':history[-3:]})
                epoch=history[-3:]
            if mode=='sliding16':epoch=history[-16:]
            if mode in {'bounded16','full64'}:epoch=history.copy()
            if mode=='bounded16' and len(epoch)>16:
                blocked='16-token context exceeded without refresh';break
            if len(epoch)>64:
                blocked='64-token experimental context exceeded';break
            contexts.append(epoch.copy())
            offset=(seed*5+step)*32
            draw=int.from_bytes(draws[offset:offset+32],'big')
            token=sampled_token(predictor(epoch),draw,k,temp)
            generated.append(token);history.append(token)
            if mode not in {'bounded16','full64'}:epoch.append(token)
            if token in {1,2,15,30}:break
        records.append({'turn':turn+1,'seed_index':seed,'seed':'0x'+seed.to_bytes(32,'big').hex(),
            'contexts':contexts,'tokens':generated,'text':tokenizer.decode(generated,skip_special_tokens=True),
            'history_ids':history.copy(),'history_text':tokenizer.decode(history,skip_special_tokens=True),
            'ended_eos':bool(generated and generated[-1]==1),'ended_sentence':bool(generated and generated[-1] in {2,15,30})})
        if blocked:break
    return {'mode':mode,'initial_prompt_ids':initial,'initial_prompt':tokenizer.decode(initial),
        'top_k':k,'temperature_milli':temp,'maximum_new_tokens_per_turn':cap,
        'turns_requested':turns,'turns_completed':sum(bool(r['tokens']) for r in records),
        'blocked':blocked,'refreshes':refreshes,'turns':records,'all_ids':history,
        'generated_ids':history[len(initial):],'final_text':tokenizer.decode(history,skip_special_tokens=True)}


def main():
    start=time.monotonic();draws=(COMMON/'seed-draws-65536x5.bin').read_bytes()
    forward=extended_forward(64);predictor=Predictor(forward)
    initials=[('quote','"',1000),('bird','The little bird',1100),('key','Mia found a key',1200)]
    result={'schema_version':1,'scope':'Offline exact Q12 numerical reference; no training, model-weight changes, or chain access.',
        'native_checkpoint_max_positions':2048,'deployed_port_max_positions':16,'experimental_reference_max_positions':64,
        'weights_sha256':hashlib.sha256(reference.blob).hexdigest(),
        'reference_file_sha256':hashlib.sha256((reference.BASE/'integer_reference.py').read_bytes()).hexdigest(),
        'long_context_change':'Only AST input length bound and exact rounded-Q12 sine/cosine table length; every weight, equation and sampler retained.',
        'sampler':'Exact existing top-k/table/Keccak sampler. Seed is zero-padded uint256 seed_start+turn; step hashes restart each turn.',
        'runs':[],'causality_checks':[]}
    for label,text,seed in initials:
        ids=tokenizer.encode(text,add_special_tokens=False)
        for mode in ['bounded16','tail3','sliding16','full64']:
            row=run_story(predictor,draws,ids,mode,seed)
            row['label']=label;result['runs'].append(row)
            print(json.dumps({'label':label,'mode':mode,'turns':row['turns_completed'],'refreshes':len(row['refreshes']),'text':row['final_text']}),flush=True)
        # Same next-turn seed, two different histories: carrying real context versus restarting the prompt.
        full=next(r for r in result['runs'] if r['label']==label and r['mode']=='full64')
        for turn_index in [2,5,10,15]:
            history=full['turns'][turn_index]['history_ids']
            continued=run_story(predictor,draws,history,'full64',seed+turn_index+1,turns=1)
            reset=run_story(predictor,draws,ids,'full64',seed+turn_index+1,turns=1)
            result['causality_checks'].append({'label':label,'after_turn':turn_index+1,
                'same_next_seed_index':seed+turn_index+1,'carried_context_ids':history,'reset_context_ids':ids,
                'continued_tokens':continued['generated_ids'],'reset_tokens':reset['generated_ids'],
                'continued_text':tokenizer.decode(continued['generated_ids'],skip_special_tokens=True),
                'reset_text':tokenizer.decode(reset['generated_ids'],skip_special_tokens=True),
                'tokens_differ':continued['generated_ids']!=reset['generated_ids'],
                'logit_vectors_differ':not np.array_equal(np.asarray(forward(history)['logits']),np.asarray(forward(ids)['logits']))})
    result['causality_summary']={'checks':len(result['causality_checks']),
        'different_token_continuations':sum(r['tokens_differ'] for r in result['causality_checks']),
        'different_full_logit_vectors':sum(r['logit_vectors_differ'] for r in result['causality_checks'])}
    result['unique_prefix_evaluations']=len(predictor.cache);result['elapsed_seconds']=round(time.monotonic()-start,3)
    result['limitations']=['Two-token turns are text fragments, not a complete sentence per swap.',
        'Tail3 refresh preserves recent tokens but discards older causal context and can lose plot continuity.',
        'Sliding-window full recomputation is a quality reference, not evidence it fits a 32M-gas transaction.',
        'The 64-position reference requires new RoPE tables and a separately tested model implementation.',
        'Changed logits prove contextual dependence, not reliable long-story coherence.']
    result['status']='COMPLETE'
    (OUT/'continuity-screen.json').write_text(json.dumps(result,indent=2)+'\n')
    lines=[]
    for r in result['runs']:
        lines.extend([f"{r['label']} / {r['mode']}",r['final_text'],*['Turn '+str(t['turn'])+': '+repr(t['text']) for t in r['turns']], ''])
    (OUT/'continuity-transcripts.txt').write_text('\n'.join(lines))
    print(json.dumps(result['causality_summary']),flush=True)


if __name__=='__main__':main()
