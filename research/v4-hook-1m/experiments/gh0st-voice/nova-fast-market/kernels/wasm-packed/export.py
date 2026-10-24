from pathlib import Path
import hashlib,json,struct,shutil,collections
import numpy as np
P=Path(__file__).resolve().parent;V=P.parent.parent;Q=V.parent/'nova-optimization/selected';O=P/'model';O.mkdir(exist_ok=True)
q=np.load(Q/'reference.npz',allow_pickle=False);proof={};stats={}
def packrow(row,bias=None):
 vals=list(map(int,row));lo=min(vals);bits=(max(vals)-lo).bit_length();assert -32768<=lo<=32767 and bits<=16
 data=bytearray(struct.pack('<hB',lo,bits))
 if bias is not None:data+=struct.pack('<i',int(bias))
 acc=0;count=0
 for x in vals:
  acc|=(x-lo)<<count;count+=bits
  while count>=8:data.append(acc&255);acc>>=8;count-=8
 assert count==0 and acc==0
 return bytes(data),bits

def unpackrow(data,pos,bias=False):
 lo,bits=struct.unpack_from('<hB',data,pos);pos+=3;b=None
 if bias:b=struct.unpack_from('<i',data,pos)[0];pos+=4
 assert bits<=16
 acc=0;count=0;out=[];mask=(1<<bits)-1
 for _ in range(384):
  while count<bits:acc|=data[pos]<<count;pos+=1;count+=8
  value=lo+(acc&mask);acc>>=bits;count-=bits
  assert -32768<=value<=32767;out.append(value)
 assert count==0 and acc==0
 return np.array(out,dtype=np.int64),b,pos

for name,mat,bias in [('core',np.concatenate([q['wh1'],q['wx2'],q['wh2']]),None),('groups',q['groups.weight'],q['group_bias.weight'][:,0]),('words',q['words.weight'],q['word_bias.weight'][:,0]),('punct',q['punct_head.weight'],q['punct_bias'])]:
 rows=[];hist=collections.Counter()
 for i,row in enumerate(mat):
  payload,bits=packrow(row,None if bias is None else bias[i]);rows.append(payload);hist[bits]+=1
 if name=='core':
  aux=(V/'stylus/raw-model/core.bin').read_bytes()[2654208:];assert len(aux)==16128
  data=struct.pack('<4sIII',b'N0C1',3456,len(aux),0)+b''.join(rows)+aux;pos=16
 elif name=='words':
  base=16+129*4;offsets=[base];groups=[]
  for i in range(128):groups.append(b''.join(rows[i*64:(i+1)*64]));offsets.append(offsets[-1]+len(groups[-1]))
  data=struct.pack('<4sIII',b'N0W1',128,64,0)+struct.pack('<129I',*offsets)+b''.join(groups);pos=base
  stats['wordGroupBytes']={'min':min(map(len,groups)),'max':max(map(len,groups)),'mean':sum(map(len,groups))/128}
 else:data=struct.pack('<4sI',b'N0H1',len(mat))+b''.join(rows);pos=8
 for i,row in enumerate(mat):
  decoded,b,pos=unpackrow(data,pos,bias is not None);assert np.array_equal(decoded,row)
  if bias is not None:assert b==int(bias[i])
 if name=='core':assert data[pos:]==aux
 else:assert pos==len(data)
 (O/(name+'.bin')).write_bytes(data)
 old=(V/'stylus/raw-model'/(name+'.bin')).stat().st_size
 packed3=(V/'stylus/packed3-model'/(name+'.bin')).stat().st_size
 proof[name]={'rows':len(mat),'allWeightsExact':int(mat.size),'biasesExact':0 if bias is None else len(bias),'bitsHistogram':dict(sorted(hist.items())),'bytes':len(data),'rawBytes':old,'packed3Bytes':packed3,'savingVsRawPercent':100*(1-len(data)/old),'savingVsPacked3Percent':100*(1-len(data)/packed3)}
for name in ['fused.bin','word-punct.bin','punct-fold.bin','sigmoid-delta.bin','exp-q32.bin','vocabulary.bin','vocabulary.json']:
 shutil.copyfile(V/'stylus/raw-model'/name,O/name)
meta=json.loads((V/'stylus/raw-model/manifest.json').read_text());meta['scope']='Lossless per-row delta bitpacked Q10 weights for local WASM research only'
for old,new in [('source_sha256','original_solidity_source_sha256'),('data_manifest_sha256','original_solidity_data_manifest_sha256'),('model_domain','original_solidity_model_domain'),('catalog','original_solidity_catalog'),('pool_hook_source','original_pool_hook_source'),('pool_hook_source_sha256','original_pool_hook_source_sha256')]:
 if old in meta:meta[new]=meta.pop(old)
for key in ['selected_inference_budget','tested_transaction_gas_limit','tested_block_gas_limit','fixed_runtime_domain']:meta.pop(key,None)
meta['optimization_status']='LOCAL_UNMETERED_WASM_PARITY_ONLY_NOT_STYLUS_GAS_VALIDATED'
meta['packing']='signed little-endian i16 minimum + u8 bit width + optional little-endian i32 bias + 384 little-bit-order unsigned deltas';meta['artifacts']={f.name:{'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}for f in O.iterdir() if f.is_file() and f.name!='manifest.json'}
(O/'manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
(P/'packing-proof.json').write_text(json.dumps({'status':'PASS','unchangedQuantizedValues':sum(x['allWeightsExact']+x['biasesExact']for x in proof.values()),'noQuantizationOrPruning':True,'matrices':proof,'stats':stats},indent=2)+'\n')
print(json.dumps({'matrices':proof,'stats':stats},indent=2))
