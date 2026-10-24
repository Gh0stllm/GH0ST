from pathlib import Path
import os,json,hashlib
p=Path(__file__).resolve().parent;base=p.parents[1];src=base/'selected';out=p/'aligned';out.mkdir(exist_ok=True)
data=(src/'core.bin').read_bytes(); rows=data[:3456*1312];tail=data[3456*1312:];assert len(tail)==16128
aligned=b''.join(rows[i:i+18*1312]+bytes(384) for i in range(0,len(rows),18*1312))+tail
assert len(aligned)==4624128
for i in range(3456): assert rows[i*1312:(i+1)*1312]==aligned[(i//18)*24000+(i%18)*1312:(i//18)*24000+(i%18+1)*1312]
(out/'core.bin').write_bytes(aligned)
source_manifest=json.loads((src/'manifest.json').read_text())
for f in [*[f for f in source_manifest['artifacts'] if f!='core.bin'],'reference.npz']:
 if not (out/f).exists():os.link(src/f,out/f)
s=(base/'evm32/batch/GRU2BatchCheckedModel.sol').read_text().replace('CORE_BYTES=4550400','CORE_BYTES=4624128').replace('CORE_MATRICES=4534272','CORE_MATRICES=4608000')
start=s.index('   function dot(pg,off,entry,values,shiftedSum)');end=s.index('    let weights:=add(data,inside)',start)
old=s[start:end]
new='''   function dot(pg,off,entry,values,shiftedSum)->total {
    let rowIndex:=div(off,1312)
    let index:=div(rowIndex,18)
    let inside:=mul(mod(rowIndex,18),1312)
    let data:=add(entry,32)
    if iszero(eq(mload(entry),add(index,1))) {
     extcodecopy(pg,0,add(1,mul(index,20)),20)
     let source:=shr(96,mload(0))
     extcodecopy(source,data,1,24000)
     mstore(entry,add(index,1))
    }
'''
s=s[:start]+new+s[end:]
# Identity domain includes new representation.
s=s.replace('GH0ST_GRU2_SIMD10_BITS25_ACC5_H384_Q10_LOCAL_V1','GH0ST_GRU2_SIMD10_BITS25_ALIGNED18_H384_Q10_LOCAL_V1')
(out/'GRU2BatchCheckedModel.sol').write_text(s)
m=json.loads((src/'manifest.json').read_text());m['artifacts']['core.bin']={'bytes':len(aligned),'sha256':hashlib.sha256(aligned).hexdigest()};m['source_sha256']=hashlib.sha256(s.encode()).hexdigest();m['model_domain']='GH0ST_GRU2_SIMD10_BITS25_ALIGNED18_H384_Q10_LOCAL_V1';m['scope']='Exact aligned core representation; Q10 weights and model semantics unchanged';m['packing']='10 lanes x 25 bits; unsigned accumulated products; 18 core rows per 24000-byte shard';(out/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
(p/'aligned-proof.json').write_text(json.dumps({'scope':'LOCAL_ONLY','changedModelWeights':False,'all3456RowPayloadsIdentical':True,'oldCoreBytes':len(data),'newCoreBytes':len(aligned),'coreRowsPerShard':18,'paddingBytesPerShard':384,'rowCrossesShard':False,'sha256':hashlib.sha256(aligned).hexdigest()},indent=2)+'\n')
