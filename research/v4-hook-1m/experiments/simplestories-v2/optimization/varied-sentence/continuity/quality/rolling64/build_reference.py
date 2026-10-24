"""Independent rolling-attention KV oracle; original weights, explicit window mask."""
from __future__ import annotations
import ast
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import time
import numpy as np

OUT=Path(__file__).resolve().parent
sys.path.insert(0,str(OUT.parent))
from continuity_screen import reference, tokenizer
sys.path.insert(0,str(OUT.parents[2]/'quality'))
from exact_sampling import sampled_token

WINDOW=64
MAX_POSITION=2048
Q=4096


def scope():
    tree=ast.parse((reference.BASE/'integer_reference.py').read_text())
    main=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='main')
    funcs=[x for x in main.body if isinstance(x,ast.FunctionDef)]
    f=next(x for x in funcs if x.name=='forward')
    first=next(x for x in f.body if isinstance(x,ast.Assert))
    first.test.comparators[-1]=ast.Constant(MAX_POSITION)
    for node in ast.walk(f):
        if isinstance(node,ast.For) and isinstance(node.target,ast.Name) and node.target.id=='pos':
            node.body.insert(0,ast.parse('start = max(0, pos + 1 - 64)').body[0])
        if isinstance(node,ast.Subscript) and isinstance(node.value,ast.Name) and node.value.id in {'key','value'} and isinstance(node.slice,ast.Tuple):
            first_slice=node.slice.elts[0]
            if isinstance(first_slice,ast.Slice) and first_slice.lower is None:
                first_slice.lower=ast.Name(id='start',ctx=ast.Load())
    s=dict(reference.scope)
    s['cos']=np.asarray([[round(math.cos(p*10000**(-j/16))*Q) for j in range(16)] for p in range(MAX_POSITION)],dtype=np.int64)
    s['sin']=np.asarray([[round(math.sin(p*10000**(-j/16))*Q) for j in range(16)] for p in range(MAX_POSITION)],dtype=np.int64)
    exec(compile(ast.fix_missing_locations(ast.Module(body=funcs,type_ignores=[])),str(reference.BASE/'integer_reference.py'),'exec'),s)
    return s


class Incremental:
    def __init__(self,s):
        self.s=s;self.keys=[[] for _ in range(4)];self.values=[[] for _ in range(4)];self.tokens=[];self.results=[]

    def rotate(self,x,pos):
        s=self.s;a=x[:,:16];b=x[:,16:];out=x.copy()
        out[:,:16]=s['div'](a*s['cos'][pos]-b*s['sin'][pos],Q)
        out[:,16:]=s['div'](b*s['cos'][pos]+a*s['sin'][pos],Q)
        return s['checked'](out)

    def append(self,token):
        s=self.s;t=s['tensors'];linear=s['linear'];rms=s['rms'];div=s['div'];checked=s['checked'];pos=len(self.tokens)
        assert pos<MAX_POSITION
        x=t['model.embed_tokens.weight'][[token]].copy()
        for layer in range(4):
            p=f'model.layers.{layer}.'
            normal=rms(x,t[p+'input_layernorm.weight'])
            query=self.rotate(linear(normal,t[p+'self_attn.q_proj.weight']).reshape(4,32),pos)
            key=self.rotate(linear(normal,t[p+'self_attn.k_proj.weight']).reshape(2,32),pos)
            value=linear(normal,t[p+'self_attn.v_proj.weight']).reshape(2,32)
            self.keys[layer].append(key);self.values[layer].append(value)
            start=max(0,pos+1-WINDOW)
            keys=np.asarray(self.keys[layer][start:pos+1]);values=np.asarray(self.values[layer][start:pos+1])
            attended=np.zeros((4,32),dtype=np.int64)
            for head in range(4):
                scores=div(keys[:,head//2]@query[head],23170)
                weights=s['interpolate'](s['exp'],scores.max()-scores,0)
                attended[head]=div(weights@values[:,head//2],int(weights.sum()))
            x=checked(x+linear(attended.reshape(1,128),t[p+'self_attn.o_proj.weight']))
            normal=rms(x,t[p+'post_attention_layernorm.weight'])
            gate=s['silu'](linear(normal,t[p+'mlp.gate_proj.weight']))
            up=linear(normal,t[p+'mlp.up_proj.weight'])
            x=checked(x+linear(checked(div(gate*up,Q)),t[p+'mlp.down_proj.weight']))
        hidden=rms(x,t['model.norm.weight'])[0]
        logits=linear(hidden[None,:],t['model.embed_tokens.weight'])[0]
        self.tokens.append(token);self.results.append({'hidden':hidden,'logits':logits})
        return logits


def hashes(logits_rows):
    data=bytearray()
    for logits in logits_rows:
        data+=(32).to_bytes(32,'big')+len(logits).to_bytes(32,'big')+b''.join(int(x).to_bytes(32,'big',signed=True) for x in logits)
    f=OUT/'logits.local.bin';f.write_bytes(data)
    node='/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
    code='import fs from"node:fs";import{keccak256}from"ethers";const b=fs.readFileSync(process.argv[1]),o=[];for(let i=0;i<b.length;i+=128672)o.push(keccak256(b.subarray(i,i+128672)));process.stdout.write(JSON.stringify(o));'
    result=json.loads(subprocess.check_output([node,'--input-type=module','-e',code,str(f)],cwd=reference.BASE.parents[1]));f.unlink();return result


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--turns',type=int,default=140)
    parser.add_argument('--max-positions',type=int,default=2048)
    parser.add_argument('--stem',default='rolling64-140turn-reference')
    args=parser.parse_args()
    start=time.monotonic();s=scope();state=Incremental(s)
    tables=s['cos'].astype('>i2').tobytes()+s['sin'].astype('>i2').tobytes()+reference.tables[1024:]
    (OUT/'tables-2048.bin').write_bytes(tables)
    seed='0x'+(42).to_bytes(32,'big').hex()
    draws=json.loads((OUT.parent/'stream-draws-256.json').read_text())[seed]
    pending=3;generated=[];turns=[];all_logits=[]
    while len(turns)<args.turns and len(state.tokens)<args.max_positions:
        processed_before=len(state.tokens);maximum=2 if processed_before<=30 else 1
        maximum=min(maximum,args.max_positions-processed_before);out=[];logits=None
        for step in range(maximum):
            logits=state.append(pending);all_logits.append(logits)
            order=np.argsort(-logits,kind='stable');order=order[order!=0][:64]
            token=sampled_token((order.astype(np.uint16),logits[order]),int(draws[len(generated)],16),8,800)
            generated.append(token);out.append(token);pending=token
            if token in {1,2,15,30}:break
        turns.append({'turn':len(turns)+1,'seed':seed,'max_new_tokens_requested':maximum,
            'processed_before':processed_before,'processed_after':len(state.tokens),
            'attention_start_after':max(0,len(state.tokens)-WINDOW),'absolute_next_position':len(state.tokens),
            'total_generated_before':len(generated)-len(out),'total_generated_after':len(generated),
            'tokens':out,'text':tokenizer.decode(out,skip_special_tokens=True),'pending_after':pending,
            'ended_eos':pending==1,'ended_sentence':pending in {2,15,30}})
    hs=hashes(all_logits)
    for turn in turns:turn['last_logit_hash']=hs[turn['processed_after']-1]
    checks=[]
    for pos in [0,1,15,31,63,64,65,95,127,128,149]:
        if pos>=len(state.tokens):continue
        oracle=s['forward'](state.tokens[:pos+1])
        actual=state.results[pos]
        assert oracle['logits']==actual['logits'].tolist()
        assert oracle['last_hidden']==actual['hidden'].tolist()
        checks.append({'absolute_position':pos,'context_tokens':pos+1,'attention_start':max(0,pos+1-WINDOW),
            'all4019_logits_match':True,'all128_hidden_match':True,'logit_hash':hs[pos]})
    # Changing only an old processed input and replaying the same actual later tokens
    # is a controlled test of historical-state dependence, not a new sampled story.
    control=state.tokens[:96].copy();control[0]=1
    changed=s['forward'](control)['logits'];baseline=state.results[95]['logits']
    result={'schema_version':1,'status':'COMPLETE','scope':'Offline rolling64 attention reference; no weights/training/chain changes.',
        'window_tokens_including_current':WINDOW,'maximum_absolute_rope_position_count':MAX_POSITION,
        'initial_prompt_ids':[3],'seed':seed,'top_k':8,'temperature_milli':800,
        'token_policy':'Request 2 while processed <= 30, else 1; stop chunk on native EOS or .!?; retain pending terminal.',
        'attention_semantics':'At every layer and absolute positionp, attendK/V[max(0,p-63)..p]. EarlierK/Vretain computationsmadeat their ownhistoricalpositions.',
        'rope_semantics':'Absolute position never rebased; tables cover 0..2047. No tail refresh in this run.',
        'weights_sha256':hashlib.sha256(reference.blob).hexdigest(),
        'tables_bytes':len(tables),'tables_sha256':hashlib.sha256(tables).hexdigest(),
        'turns':turns,'processed_tokens':state.tokens,'generated_tokens':generated,
        'full_text':tokenizer.decode([3]+generated,skip_special_tokens=True),
        'ended_eos_positions':[i for i,t in enumerate(generated) if t==1],
        'independent_full_prefix_checks':checks,
        'old_input_causality_control':{'tested_position':95,'changed_initial_token_from':3,'changed_initial_token_to':1,
            'same_later_processed_tokens':True,'changed_full_logits':changed!=baseline.tolist()},
        'elapsed_seconds':round(time.monotonic()-start,3),
        'limitations':['Window64changesoriginalfullattentionsemantics afterposition63.',
            'A retainedKVmayencodeinfluencefromtokensolderthan64; thisisnotrecomputedlast64-onlytext.',
            'Position2048requiresanexplicitnewpolicy; noquantizedRoPErebasingisassumed.',
            'Naturalcontinuationdoesnotguaranteenarrativelogicorlanguagequality.',
            'Offlineagreementdoesnotestablishmainnetgasfit.']}
    (OUT/(args.stem+'.json')).write_text(json.dumps(result,indent=2)+'\n')
    (OUT/(args.stem+'.txt')).write_text(result['full_text']+'\n\n'+'\n'.join(f"{x['turn']}. {x['text']}" for x in turns)+'\n')
    print(json.dumps({k:result[k] for k in ['status','tables_bytes','tables_sha256','elapsed_seconds','full_text','old_input_causality_control']},indent=2))
    print('turns',len(turns),'generated',len(generated),'checks',len(checks))


if __name__=='__main__':main()
