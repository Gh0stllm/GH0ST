"""Compile immutable int4 weights into small, straight-line EVM programs.

Programs receive an exact signed-bias correction followed by five-lane packed
activation words. They return packed int32 row outputs, not ABI wrappers.
No inference is performed offline; only the constant weights become code.
"""
import hashlib
import json
from pathlib import Path
from eth_utils import keccak

ROOT=Path(__file__).resolve().parent

def push(value,width=None):
    assert value>=0
    n=width or max(1,(value.bit_length()+7)//8)
    assert 1<=n<=32 and value<(1<<(8*n))
    return bytes([0x5f+n])+value.to_bytes(n,'big')

def decode_rows(payload,rows,cols):
    stride=4+cols//2
    assert len(payload)==rows*stride
    result=[]
    for r in range(rows):
        off=r*stride;scale=int.from_bytes(payload[off:off+4],'big',signed=True)
        assert scale>0
        weights=[]
        for c in range(cols):
            q=(payload[off+4+c//2]>>((c%2)*4))&15
            weights.append(q-16 if q>=8 else q)
        result.append((scale,weights))
    return result

def runtime(rows,cols):
    groups=(cols+4)//5
    code=bytearray();jumps=[]
    def fail_if():
        code.extend(b'\x61\x00\x00\x57');jumps.append(len(code)-3)
    # Exact raw input length: one bias correction plus the packed activations.
    code.extend(b'\x36'+push(32*(groups+1))+b'\x14\x15');fail_if()
    for row,(scale,weights) in enumerate(rows):
        assert len(weights)==cols and scale>0
        padded=weights+[0]*(groups*5-cols)
        code.extend(push(0))
        for g in range(groups):
            bp=sum((padded[g*5+i]+8)<<(48*(4-i)) for i in range(5))
            code.extend(push(bp)+push(32*(g+1))+b'\x35\x02\x01')
        # C = desired coefficient; add common activation correction.
        code.extend(push(192)+b'\x1c'+push((1<<48)-1)+b'\x16'+push(0)+b'\x35\x01')
        # EVM SUB pops the top operand first: swap to obtain C - weight bias.
        code.extend(push(sum(w+8 for w in padded)*(1<<31))+b'\x90\x03')
        code.extend(push(scale)+b'\x02'+push(1<<24)+b'\x90\x05')
        # Check exact int32 representability, preserving the result on stack.
        code.extend(b'\x80'+push(3)+b'\x0b\x81\x14\x15');fail_if()
        code.extend(push(224)+b'\x1b'+push(row*4)+b'\x52')
    code.extend(push(len(rows)*4)+push(0)+b'\xf3')
    dest=len(code)
    code.extend(b'\x5b'+push(0)+push(0)+b'\xfd')
    for off in jumps:code[off:off+2]=dest.to_bytes(2,'big')
    assert len(code)<=24576
    return bytes(code)

def creation(code):
    # 15-byte Paris-compatible code-copy constructor; no mutable state.
    prefix=push(len(code),2)+push(15,2)+push(0)+b'\x39'+push(len(code),2)+push(0)+b'\xf3'
    assert len(prefix)==15
    return prefix+code

def packed_input(x):
    values=list(x);groups=(len(values)+4)//5
    values += [0]*(groups*5-len(values))
    biased=[int(v)+(1<<31) for v in values]
    correction=len(values)*(1<<34)-8*sum(biased)
    return (correction%(1<<256)).to_bytes(32,'big')+b''.join(
        sum(biased[g*5+i]<<(48*i) for i in range(5)).to_bytes(32,'big') for g in range(groups))

def export():
    original=json.loads((ROOT/'manifest.json').read_text())
    folder=ROOT/'compiled-weight-data';folder.mkdir(exist_ok=True)
    result={'format':'straight-line EVM, packed five-lane int32/int4 dot products',
        'original_manifest_sha256':hashlib.sha256((ROOT/'manifest.json').read_bytes()).hexdigest(),
        'model':original['model'],'programs':[],'logical_shards':[]}
    for index,shard in enumerate(original['shards'][:352]):
        cols=1024 if index<288 else 2560
        rows=shard['rows'];chunk=3 if cols==1024 else 1
        decoded=decode_rows((ROOT/'data'/shard['file']).read_bytes(),rows,cols)
        first=len(result['programs'])
        for start in range(0,rows,chunk):
            selected=decoded[start:start+chunk];code=runtime(selected,cols)
            number=len(result['programs']);filename=f'program-{number:04d}.bin'
            (folder/filename).write_bytes(code)
            result['programs'].append({'file':filename,'logical_shard':index,'row':start,'rows':len(selected),
                'columns':cols,'bytes':len(code),'sha256':hashlib.sha256(code).hexdigest(),'codehash':'0x'+keccak(code).hex()})
        result['logical_shards'].append({'index':index,'first_program':first,'program_count':len(result['programs'])-first})
    result['total_runtime_bytes']=sum(p['bytes'] for p in result['programs'])
    (ROOT/'compiled-weight-manifest.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'programs':len(result['programs']),'bytes':result['total_runtime_bytes'],
        'max_program_bytes':max(p['bytes'] for p in result['programs'])}))

if __name__=='__main__':export()
