"""Independent Q12 relative-key, rolling64 reference; no chain calls or training."""
from __future__ import annotations
import ast
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
Q=4096
WINDOW=64


def scope():
    tree=ast.parse((reference.BASE/'integer_reference.py').read_text())
    main=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='main')
    funcs=[x for x in main.body if isinstance(x,ast.FunctionDef)]
    f=next(x for x in funcs if x.name=='forward')
    first=next(x for x in f.body if isinstance(x,ast.Assert))
    first.test.ops=first.test.ops[:1];first.test.comparators=first.test.comparators[:1]
    for node in ast.walk(f):
        if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name):
            if node.targets[0].id in {'query','key'}:
                assert isinstance(node.value,ast.Call) and node.value.func.id=='rotate'
                node.value=node.value.args[0]
            elif node.targets[0].id=='scores':
                node.value=ast.parse('div(relative[:, h // 2] @ query[pos, h], 23170)',mode='eval').body
        if isinstance(node,ast.For) and isinstance(node.target,ast.Name) and node.target.id=='pos':
            node.body[0:0]=ast.parse('start=max(0,pos+1-64)\nrelative=relative_keys(key[start:pos+1],np.arange(pos-start,-1,-1))').body
        if isinstance(node,ast.Subscript) and isinstance(node.value,ast.Name) and node.value.id=='value' and isinstance(node.slice,ast.Tuple):
            sl=node.slice.elts[0]
            if isinstance(sl,ast.Slice) and sl.lower is None:sl.lower=ast.Name(id='start',ctx=ast.Load())
    s=dict(reference.scope)
    s['cos']=np.asarray([[round(math.cos(p*10000**(-j/16))*Q) for j in range(16)] for p in range(WINDOW)],dtype=np.int64)
    s['sin']=np.asarray([[round(math.sin(p*10000**(-j/16))*Q) for j in range(16)] for p in range(WINDOW)],dtype=np.int64)
    assert np.array_equal(s['cos'][:16],reference.cos)
    assert np.array_equal(s['sin'][:16],reference.sin)
    def relative_keys(keys,ages):
        a=keys[:,:,:16];b=keys[:,:,16:];c=s['cos'][ages,None,:];sn=s['sin'][ages,None,:]
        return s['checked'](np.concatenate((s['div'](a*c+b*sn,Q),s['div'](b*c-a*sn,Q)),axis=2))
    s['relative_keys']=relative_keys
    exec(compile(ast.fix_missing_locations(ast.Module(body=funcs,type_ignores=[])),str(reference.BASE/'integer_reference.py'),'exec'),s)
    return s


class Incremental:
    def __init__(self,s,absolute_offset=0):
        self.s=s;self.keys=[[] for _ in range(4)];self.values=[[] for _ in range(4)]
        self.tokens=[];self.results=[];self.absolute_offset=absolute_offset
    def append(self,token):
        s=self.s;t=s['tensors'];linear=s['linear'];rms=s['rms'];div=s['div'];checked=s['checked'];pos=len(self.tokens)
        assert self.absolute_offset+pos<2**64
        x=t['model.embed_tokens.weight'][[token]].copy()
        for layer in range(4):
            p=f'model.layers.{layer}.';normal=rms(x,t[p+'input_layernorm.weight'])
            query=linear(normal,t[p+'self_attn.q_proj.weight']).reshape(4,32)
            key=linear(normal,t[p+'self_attn.k_proj.weight']).reshape(2,32)
            value=linear(normal,t[p+'self_attn.v_proj.weight']).reshape(2,32)
            self.keys[layer].append(key);self.values[layer].append(value)
            start=max(0,pos+1-WINDOW)
            keys=s['relative_keys'](np.asarray(self.keys[layer][start:pos+1]),np.arange(pos-start,-1,-1))
            values=np.asarray(self.values[layer][start:pos+1]);attended=np.zeros((4,32),dtype=np.int64)
            for head in range(4):
                scores=div(keys[:,head//2]@query[head],23170)
                weights=s['interpolate'](s['exp'],scores.max()-scores,0)
                attended[head]=div(weights@values[:,head//2],int(weights.sum()))
            x=checked(x+linear(attended.reshape(1,128),t[p+'self_attn.o_proj.weight']))
            normal=rms(x,t[p+'post_attention_layernorm.weight'])
            gate=s['silu'](linear(normal,t[p+'mlp.gate_proj.weight']));up=linear(normal,t[p+'mlp.up_proj.weight'])
            x=checked(x+linear(checked(div(gate*up,Q)),t[p+'mlp.down_proj.weight']))
        hidden=rms(x,t['model.norm.weight'])[0];logits=linear(hidden[None,:],t['model.embed_tokens.weight'])[0]
        self.tokens.append(token);self.results.append({'hidden':hidden,'logits':logits})
        return logits


def hashes(rows):
    tmp=OUT/'logits.local.bin'
    with tmp.open('wb') as f:
        for row in rows:
            f.write((32).to_bytes(32,'big')+len(row).to_bytes(32,'big'))
            f.write(b''.join(int(x).to_bytes(32,'big',signed=True) for x in row))
    node='/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
    script='import fs from"node:fs";import{keccak256}from"ethers";const b=fs.readFileSync(process.argv[1]),o=[];for(let i=0;i<b.length;i+=128672)o.push(keccak256(b.subarray(i,i+128672)));process.stdout.write(JSON.stringify(o));'
    result=json.loads(subprocess.check_output([node,'--input-type=module','-e',script,str(tmp)],cwd=reference.BASE.parents[1]));tmp.unlink();return result


def get_draws(count):
    node='/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
    script='import{AbiCoder,keccak256,toBeHex,zeroPadValue}from"ethers";const c=AbiCoder.defaultAbiCoder(),s=zeroPadValue(toBeHex(42),32);process.stdout.write(JSON.stringify(Array.from({length:Number(process.argv[1])},(_,i)=>keccak256(c.encode(["string","bytes32","uint256"],["GH0ST_SAMPLE_STEP_V1",s,i])))));'
    rows=json.loads(subprocess.check_output([node,'--input-type=module','-e',script,str(count)],cwd=reference.BASE.parents[1]))
    (OUT/f'seed42-draws-{count}.json').write_text(json.dumps(rows)+'\n')
    return rows


def main():
    started=time.monotonic();s=scope();state=Incremental(s);count=4096;draws=get_draws(count)
    table=s['cos'].astype('>i2').tobytes()+s['sin'].astype('>i2').tobytes()+reference.tables[1024:]
    (OUT/'tables-relative64.bin').write_bytes(table)
    pending=3;generated=[];turns=[]
    while len(turns)<2060:
        before=len(state.tokens);maximum=min(2 if before<=30 else 1,count-before);out=[]
        for _ in range(maximum):
            logits=state.append(pending);order=np.argsort(-logits,kind='stable');order=order[order!=0][:64]
            token=sampled_token((order.astype(np.uint16),logits[order]),int(draws[len(generated)],16),8,800)
            generated.append(token);out.append(token);pending=token
            if token in {1,2,15,30}:break
        turns.append({'turn':len(turns)+1,'seed':'0x'+(42).to_bytes(32,'big').hex(),
            'max_new_tokens_requested':maximum,'processed_before':before,'processed_after':len(state.tokens),
            'attention_start_after':max(0,len(state.tokens)-64),'total_generated_before':before,'total_generated_after':len(generated),
            'tokens':out,'text':tokenizer.decode(out,skip_special_tokens=True),'pending_after':pending,
            'ended_eos':pending==1,'ended_sentence':pending in {2,15,30}})
        if len(state.tokens)%256==0:print(f'processed {len(state.tokens)}',flush=True)
    hs=hashes([r['logits'] for r in state.results])
    for turn in turns:turn['last_logit_hash']=hs[turn['processed_after']-1]
    checks=[]
    for pos in [0,1,15,31,63,64,65,95,127,128,149]:
        expected=s['forward'](state.tokens[:pos+1]);actual=state.results[pos]
        assert expected['logits']==actual['logits'].tolist();assert expected['last_hidden']==actual['hidden'].tolist()
        checks.append({'absolute_position':pos,'all4019_logits_match':True,'all128_hidden_match':True,'logit_hash':hs[pos]})
    late=s['forward'](state.tokens[:2051],True)
    late_x=np.asarray(late['layer_outputs'][-1],dtype=np.int64)
    for pos in [2047,2048,2049,2050]:
        h=s['rms'](late_x[[pos]],s['tensors']['model.norm.weight'])[0]
        logits=s['linear'](h[None,:],s['tensors']['model.embed_tokens.weight'])[0]
        assert np.array_equal(h,state.results[pos]['hidden']);assert np.array_equal(logits,state.results[pos]['logits'])
        checks.append({'absolute_position':pos,'all4019_logits_match':True,'all128_hidden_match':True,'logit_hash':hs[pos]})
    # The two reference implementations do not consult absolute positions for rotary
    # lookup. Replay with shifted counters to verify practical old-boundary cases.
    shifts=[]
    for offset in [2048,65536,2**32,2**64-512]:
        other=Incremental(s,offset)
        for token in state.tokens[:150]:other.append(token)
        identical=all(np.array_equal(a['logits'],b['logits']) and np.array_equal(a['hidden'],b['hidden']) for a,b in zip(state.results,other.results))
        assert identical
        shifts.append({'absolute_counter_offset':str(offset),'steps':150,'all_logits_and_hidden_identical':True})
    result={'schema_version':1,'status':'COMPLETE','scope':'Offline independent relative-key Q12 rolling64 reference; no chain calls or weight changes.',
        'window_tokens_including_current':64,'absolute_counter_type':'uint64','absolute_position_table_limit':None,
        'initial_prompt_ids':[3],'seed':'0x'+(42).to_bytes(32,'big').hex(),'top_k':8,'temperature_milli':800,
        'token_policy':'Request 2 iff processed <= 30, then 1; native EOS or .!? ends current chunk; retain pending terminal.',
        'relative_formula':'For age a=i-j, rotate rawK: first=trunc((k0*cos[a]+k1*sin[a])/4096), second=trunc((k1*cos[a]-k0*sin[a])/4096). Dot rawQ with rotatedK; divide by23170.',
        'weights_sha256':hashlib.sha256(reference.blob).hexdigest(),'tables_bytes':len(table),'tables_sha256':hashlib.sha256(table).hexdigest(),
        'turns':turns,'processed_tokens':state.tokens,'generated_tokens':generated,'every_step_logit_hash':hs,
        'full_text':tokenizer.decode([3]+generated,skip_special_tokens=True),'ended_eos_positions':[i for i,t in enumerate(generated) if t==1],
        'independent_full_prefix_checks':checks,'absolute_counter_shift_checks':shifts,'elapsed_seconds':round(time.monotonic()-started,3),
        'limitations':['Relative-key Q12 changes rounding versus absolute Q12 and requires new EVM parity tests.',
            'Window64 changes original full-attention semantics after position63.','This finite stream is not proof of arbitrary-length narrative quality.',
            'There is no 2048-position table cutoff; uint64 overflow still requires explicit safe handling.','Offline arithmetic does not establish gas fit.']}
    (OUT/'relative64-2060turn-reference.json').write_text(json.dumps(result,indent=2)+'\n')
    first=turns[:140]
    small={k:v for k,v in result.items() if k not in {'turns','processed_tokens','generated_tokens','every_step_logit_hash','full_text'}}
    small.update(turns=first,processed_tokens=state.tokens[:first[-1]['processed_after']],generated_tokens=generated[:first[-1]['processed_after']],every_step_logit_hash=hs[:first[-1]['processed_after']],full_text=tokenizer.decode([3]+generated[:first[-1]['processed_after']],skip_special_tokens=True))
    (OUT/'relative64-early-reference.json').write_text(json.dumps(small,indent=2)+'\n')
    (OUT/'relative64-transcript.txt').write_text(result['full_text']+'\n\n'+'\n'.join(f"{r['turn']}. {r['text']}" for r in turns)+'\n')
    print(json.dumps({'turns':len(turns),'processed':len(state.tokens),'eos_count':len(result['ended_eos_positions']),'tables_bytes':len(table),'tables_sha256':result['tables_sha256'],'elapsed_seconds':result['elapsed_seconds'],'first154_text':small['full_text']},indent=2),flush=True)


if __name__=='__main__':main()
