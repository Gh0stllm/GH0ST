"""Exact accumulator SIMD layouts, all source weights and model semantics unchanged."""
import hashlib,json,math,os,re
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
SOURCE=HERE.parents[1]/'nova-optimization/selected'
q=np.load(SOURCE/'reference.npz')
source=(SOURCE/'GRU2SIMDModel.sol').read_text()
manifest=json.loads((SOURCE/'manifest.json').read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
configs=[('b24x10a2',24,10,2),('b25x10a5',25,10,5),('b26x9a13',26,9,13),('b27x9a28',27,9,28),('b28x9a43',28,9,43)]
matrices={'core.bin':(np.concatenate([q['wh1'],q['wx2'],q['wh2']]),None,3456*1184),'groups.bin':(q['groups.weight'],q['group_bias.weight'][:,0],128*1216),'words.bin':(q['words.weight'],q['word_bias.weight'][:,0],8192*1216),'punctuation.bin':(q['punct_head.weight'],q['punct_bias'],5*1216)}
rng=np.random.default_rng(93851)
vectors=[np.zeros(384,dtype=np.int64),np.full(384,-1024,dtype=np.int64),np.full(384,1024,dtype=np.int64),np.tile([-1024,1024],192),*[rng.integers(-1024,1025,384,dtype=np.int64) for _ in range(2)]]
reports=[]
for name,bits,lanes,batch in configs:
 out=HERE/name;out.mkdir(exist_ok=True);chunks=math.ceil(384/lanes);packedbytes=chunks*32;corestride=packedbytes+64;headstride=packedbytes+96;mask=(1<<bits)-1;shift=(lanes-1)*bits
 report={'name':name,'status':'RUNNING','bits':bits,'lanes':lanes,'batch':batch,'chunks':chunks,'checkpoint_sha256':manifest['checkpoint_sha256'],'reference_sha256':sha((SOURCE/'reference.npz').read_bytes()),'local_only':True,'public_transactions':0,'matrices':{}}
 for filename,(matrix,bias,suffix) in matrices.items():
  matrix=matrix.astype(np.int64);rows=bytearray();worst=0;cases=0
  expected=np.stack([matrix@v for v in vectors])
  for r,row in enumerate(matrix):
   offset=-int(row.min());weights=[int(v)+offset for v in row];rowbytes=bytearray();packed=[]
   for j in range(chunks):
    items=weights[j*lanes:(j+1)*lanes]+[0]*max(0,(j+1)*lanes-384)
    value=sum(w<<((lanes-1-k)*bits) for k,w in enumerate(items));assert value < 2**256
    assert [((value>>((lanes-1-k)*bits))&mask)-offset for k in range(min(lanes,384-j*lanes))]==[int(v) for v in row[j*lanes:(j+1)*lanes]]
    rowbytes.extend(value.to_bytes(32,'big'));packed.append(value)
   for j in range(0,chunks,batch):
    bound=2048*sum(weights[j*lanes:min(384,(j+batch)*lanes)]);worst=max(worst,bound);assert bound<2**bits,(name,filename,r,j,bound)
   rowbytes.extend(int(row.sum()).to_bytes(32,'big',signed=True));rowbytes.extend(offset.to_bytes(32,'big',signed=True))
   if bias is not None:rowbytes.extend(int(bias[r]).to_bytes(32,'big',signed=True))
   # Test exact cyclic 256-bit multiply-and-accumulate against scalar int64.
   for vindex,vec in enumerate(vectors):
    acc=0
    for j in range(0,chunks,batch):
     psum=0
     for k in range(j,min(chunks,j+batch)):
      vals=[int(v)+1024 for v in vec[k*lanes:(k+1)*lanes]]+[0]*max(0,(k+1)*lanes-384)
      vp=sum(value<<(l*bits) for l,value in enumerate(vals))
      psum=(psum+vp*packed[k])%(2**256)
     acc+=(psum>>shift)&mask
    actual=acc-offset*sum(int(v)+1024 for v in vec)-1024*int(row.sum());assert actual==int(expected[vindex,r]),(name,filename,r,vindex)
    cases+=1
   rows.extend(rowbytes)
  rows.extend((SOURCE/filename).read_bytes()[suffix:]);(out/filename).write_bytes(rows)
  report['matrices'][filename]={'rows':len(matrix),'max_batch_coefficient':worst,'limit_exclusive':2**bits,'row_vector_parity_cases':cases,'all_decoded_weights_exact':True}
 for file in ['fused.bin','vocabulary.bin','vocabulary.json','sigmoid-delta.bin','exp-q32.bin','reference.npz']:
  if not (out/file).exists():os.link(SOURCE/file,out/file)
 s=source.replace('CORE_BYTES=4108032',f'CORE_BYTES={3456*corestride+16128}').replace('GROUP_BYTES=155648',f'GROUP_BYTES={128*headstride}').replace('WORD_BYTES=9961472',f'WORD_BYTES={8192*headstride}').replace('PUNCTUATION_BYTES=116800',f'PUNCTUATION_BYTES={5*headstride+8192*10+5*5760}')
 s=s.replace('CORE_STRIDE=1184;uint256 constant HEAD_STRIDE=1216;uint256 constant CORE_MATRICES=4091904;uint256 constant PUNCT_FOLD=88000',f'CORE_STRIDE={corestride};uint256 constant HEAD_STRIDE={headstride};uint256 constant CORE_MATRICES={3456*corestride};uint256 constant PUNCT_FOLD={5*headstride+8192*10}')
 domain=f'GH0ST_GRU2_SIMD{lanes}_BITS{bits}_ACC{batch}_H384_Q10_LOCAL_V1';s=s.replace('GH0ST_GRU2_SIMD11_H384_Q10_LOCAL_V1',domain)
 start=s.index(' function _prepare(');end=s.index(' function _dot(',start)
 s=s[:start]+f''' function _prepare(int16[768] memory v,uint256 offset)private pure returns(bytes memory packedVector,int256 shiftedSum){{packedVector=new bytes({packedbytes});
  assembly("memory-safe"){{for{{let group:=0}}lt(group,{chunks}){{group:=add(group,1)}}{{let packedValue:=0 for{{let j:=0}}lt(j,{lanes}){{j:=add(j,1)}}{{let i:=add(mul(group,{lanes}),j) if lt(i,384){{let value:=add(signextend(1,mload(add(v,shl(5,add(offset,i))))),1024) shiftedSum:=add(shiftedSum,value) packedValue:=or(packedValue,shl(mul(j,{bits}),value))}}}}mstore(add(add(packedVector,32),mul(group,32)),packedValue)}}}}}}
'''+s[end:]
 start=s.index('   sum:=add(sum,and(shr(230,');end=s.index('\n function _headBias',start)
 statements=[]
 for j in range(0,chunks,batch):
  terms=[f'mul(mload(add(values,{k*32})),mload(add(weights,{k*32})))' for k in range(j,min(chunks,j+batch))]
  term=terms[0]
  for t in terms[1:]:term=f'add({term},{t})'
  statements.append(f'sum:=add(sum,and(shr({shift},{term}),{hex(mask)}))')
 s=s[:start]+'   '+('\n'.join(statements))+f'\n   sum:=sub(sub(sum,mul(mload(add(weights,{packedbytes+32})),shiftedSum)),mul(1024,mload(add(weights,{packedbytes}))))}}}}\n'+s[end:]
 s=s.replace('mload(add(add(d,32),1184))',f'mload(add(add(d,32),{corestride}))').replace('_read(punctuationCatalog,6080+',f'_read(punctuationCatalog,{5*headstride}+')
 (out/'GRU2SIMDModel.sol').write_text(s)
 m=dict(manifest);m.update({'scope':'Exact wider-lane accumulation derived representation; Q10 weights and model semantics unchanged','model_domain':domain,'source_sha256':sha(s.encode()),'packing':f'{lanes} lanes x {bits} bits, modulo-256 accumulation of <= {batch} chunks before extraction'})
 m['optimization_status']='CANDIDATE_PENDING_INTEGRATION'
 for key in ['selected_inference_budget','tested_transaction_gas_limit','tested_block_gas_limit']:m.pop(key,None)
 m['artifacts']={p.name:{'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in out.iterdir() if p.is_file() and p.suffix in ['.bin','.json'] and p.name not in ['manifest.json','proof.json']}
 (out/'manifest.json').write_text(json.dumps(m,indent=2)+'\n');report['status']='PASS';report['source_sha256']=m['source_sha256'];report['total_row_vector_parity_cases']=sum(r['row_vector_parity_cases'] for r in report['matrices'].values());report['max_coefficient']=max(r['max_batch_coefficient'] for r in report['matrices'].values());(out/'proof.json').write_text(json.dumps(report,indent=2)+'\n');reports.append(report);print(name,'PASS',report['total_row_vector_parity_cases'],report['max_coefficient'],flush=True)
(HERE/'packing-proofs.json').write_text(json.dumps(reports,indent=2)+'\n')
