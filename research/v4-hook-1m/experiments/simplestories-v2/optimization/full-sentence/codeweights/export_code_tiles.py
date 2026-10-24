"""Compile unchanged packed Q12 matrix weights into exact straight-line EVM kernels.

This is an offline exporter. No RPC, keys or chain state are accessed.
"""
from pathlib import Path
import hashlib,json,os,subprocess
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent
PACKED=ROOT/'optimization/kernel8/model'
DOMAIN='GH0ST_SIMPLESTORIES_V2_Q12_CODEWEIGHTS_CTX16_V1'
MASK=(1<<256)-1

def push(x):
    x &= MASK
    if x==0:return b'\x5f'
    n=(x.bit_length()+7)//8
    return bytes([0x5f+n])+x.to_bytes(n,'big')

def prefix(groups):
    # Jump destination is byte 12: CALLDATASIZE, PUSH2, EQ, PUSH2, JUMPI, zero/zero/revert.
    size=(groups+1)*32
    return b'\x36\x61'+size.to_bytes(2,'big')+b'\x14\x61\x00\x0c\x57\x5f\x5f\xfd\x5b'

def row_code(raw,groups,local_row):
    code=bytearray()
    for group in range(groups):
        weight=int.from_bytes(raw[group*32:(group+1)*32],'big')
        code+=push(weight)+push(group*32)+b'\x35\x02'+push(224)+b'\x1c'
        if group:code+=b'\x01'
    row_sum=int.from_bytes(raw[groups*32:groups*32+32],'big',signed=True)
    # SUB and SDIV consume their left argument from the top of the EVM stack.
    code+=push(groups*32)+b'\x35'+push(row_sum<<16)+b'\x01\x90\x03'
    code+=push(4096)+b'\x90\x05'+push(local_row*32)+b'\x52'
    return code

def suffix(rows):return push(rows*32)+b'\x5f\xf3'

def main():
    OUT.mkdir(exist_ok=True);(OUT/'tiles').mkdir(exist_ok=True)
    manifest=json.loads((PACKED/'manifest.json').read_text())
    mapping=json.loads((PACKED/'packed_offsets.json').read_text())
    blob=(PACKED/'weights.bin').read_bytes()
    assert hashlib.sha256(blob).hexdigest()==manifest['artifacts']['weights.bin']['sha256']
    result={'schema_version':1,'format':'EVM straight-line exact SWAR8 Q12 matrix tiles','model_hash_domain':DOMAIN,
      'parameters':manifest['parameters'],'source_packed_weights_sha256':hashlib.sha256(blob).hexdigest(),
      'source_weights_sha256':manifest['source_weights_sha256'],'checkpoint_sha256':manifest['checkpoint_sha256'],
      'calldata':'groups uint256 packed input words followed by int256 commonCorrection; no ABI selector',
      'common_correction':'(sum(actual_inputs)<<11) + (padded_columns<<27)',
      'return_data':'row_count consecutive int256 Q12 outputs, no ABI header',
      'safety':'Caller must enforce signed17-bit input fast path; every matrix weight is lossless signed12-bit. Then abs(output)<12M and int32 range is guaranteed.',
      'matrices':{},'code_tiles':[]}
    total_rows=0
    for key,info in sorted(mapping['matrices'].items(),key=lambda kv:kv[1]['offset']):
        offset=info['offset'];groups=info['groups'];stride=info['row_stride'];rows=info['rows'];first=0;ids=[]
        while first<rows:
            code=bytearray(prefix(groups));count=0
            while first+count<rows:
                at=offset+(first+count)*stride
                candidate=row_code(blob[at:at+stride],groups,count)
                if len(code)+len(candidate)+len(suffix(count+1))>24000:break
                code+=candidate;count+=1
            assert count>0
            code+=suffix(count);index=len(result['code_tiles']);path=f'tiles/tile-{index:04d}.bin'
            (OUT/path).write_bytes(code)
            entry={'index':index,'path':path,'bytes':len(code),'sha256':hashlib.sha256(code).hexdigest(),
              'matrix_packed_offset':offset,'matrix_original_offset':info['original_offset'],'matrix_name':info['name'],
              'row_start':first,'row_count':count,'groups':groups,'columns':info['columns'],
              'input_bytes':(groups+1)*32,'return_bytes':count*32}
            result['code_tiles'].append(entry);ids.append(index);first+=count;total_rows+=count
        result['matrices'][str(offset)]={'name':info['name'],'packed_offset':offset,'original_offset':info['original_offset'],
             'rows':rows,'columns':info['columns'],'groups':groups,'tile_indices':ids,'first_tile':ids[0],'tile_count':len(ids)}
    result['total_matrix_rows']=total_rows
    result['total_runtime_bytes']=sum(x['bytes'] for x in result['code_tiles'])
    result['tile_count']=len(result['code_tiles'])
    (OUT/'tile-manifest.json').write_text(json.dumps(result,indent=2)+'\n')
    node=os.environ.get('NODE_BINARY','/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')
    js='''import fs from "node:fs";import path from "node:path";import {keccak256,AbiCoder,ZeroHash} from "ethers";const dir=process.argv[1],file=path.join(dir,"tile-manifest.json"),m=JSON.parse(fs.readFileSync(file));let root=ZeroHash;for(const t of m.code_tiles){t.keccak256=keccak256(fs.readFileSync(path.join(dir,t.path)));root=keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32","bytes32"],[root,t.keccak256]));}m.code_commitment=root;fs.writeFileSync(file,JSON.stringify(m,null,2)+"\\n");console.log(JSON.stringify({tile_count:m.tile_count,total_runtime_bytes:m.total_runtime_bytes,total_matrix_rows:m.total_matrix_rows,code_commitment:root}));'''
    subprocess.run([node,'--input-type=module','-e',js,str(OUT)],check=True,cwd=ROOT.parent.parent)
if __name__=='__main__':main()
