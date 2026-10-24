"""Independent compressed-byte decoder vs immutable original quantized reference.

Does not import the exporter or Rust loader. Decode each row as one integer,
instead of the producer/consumer's streaming accumulator.
"""
from pathlib import Path
import hashlib,json,struct
import numpy as np
P=Path(__file__).resolve().parent
C=P.parent/'kernels/wasm-packed'
D=C/'model'
S=P.parent.parent/'nova-optimization/selected'
q=np.load(S/'reference.npz',allow_pickle=False)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=json.loads((D/'manifest.json').read_text())
for name,data in manifest['artifacts'].items():
 assert (D/name).stat().st_size==data['bytes'] and sha(D/name)==data['sha256'],name

def row(data,at,with_bias):
 assert at+3<=len(data)
 lo=int.from_bytes(data[at:at+2],'little',signed=True);bits=data[at+2];at+=3
 assert bits<=16
 bias=None
 if with_bias:assert at+4<=len(data);bias=int.from_bytes(data[at:at+4],'little',signed=True);at+=4
 length=48*bits;assert at+length<=len(data)
 packed=int.from_bytes(data[at:at+length],'little')
 vals=np.asarray([lo+((packed>>(bits*i))&((1<<bits)-1)) for i in range(384)],dtype=np.int64)
 assert np.all((-32768<=vals)&(vals<=32767))
 triple=np.abs(vals).reshape(128,3).sum(1);assert np.all(triple<1024)
 assert packed>>(bits*384)==0
 return vals,bias,at+length,bits,int(triple.max())*1024

report={'status':'RUNNING','local_only':True,'chain_rpc_calls':0,'public_transactions':0,'reference_sha256':sha(S/'reference.npz'),'rust_source_sha256':sha(C/'wasm/src/lib.rs'),'matrices':{},'static_data':{},'dynamic_weights_compared':0,'head_biases_compared':0}
for name,weights,biases in [('core',np.concatenate([q['wh1'],q['wx2'],q['wh2']]),None),('groups',q['groups.weight'],q['group_bias.weight'][:,0]),('words',q['words.weight'],q['word_bias.weight'][:,0]),('punct',q['punct_head.weight'],q['punct_bias'])]:
 data=(D/(name+'.bin')).read_bytes();offsets=None
 if name=='core':assert struct.unpack_from('<4sIII',data)==(b'N0C1',3456,16128,0);at=16
 elif name=='words':
  assert struct.unpack_from('<4sIII',data)==(b'N0W1',128,64,0);offsets=struct.unpack_from('<129I',data,16);assert offsets[0]==532 and offsets[-1]==len(data);assert all(a<b for a,b in zip(offsets,offsets[1:]));at=532
 else:assert struct.unpack_from('<4sI',data)==(b'N0H1',len(weights));at=8
 histogram={};maximum=0;ends=[]
 for i,expected in enumerate(weights):
  if offsets is not None and i%64==0:assert at==offsets[i//64]
  values,bias,at,bits,bound=row(data,at,biases is not None)
  assert np.array_equal(values,expected),(name,i,'weights')
  if biases is not None:assert bias==int(biases[i]),(name,i,'bias')
  histogram[str(bits)]=histogram.get(str(bits),0)+1;maximum=max(maximum,bound)
  if offsets is not None and i%64==63:ends.append(at);assert at==offsets[i//64+1]
 if name=='core':assert data[at:]==(S/'core.bin').read_bytes()[4091904:]
 else:assert at==len(data)
 report['matrices'][name]={'rows':len(weights),'weights_exact':int(weights.size),'biases_exact':0 if biases is None else len(biases),'bit_width_histogram':histogram,'maximum_triple_coefficient':maximum,'coefficient_limit_exclusive':2**20,'all_source_bytes_consumed':True,'word_group_boundaries_verified':len(ends)}
 report['dynamic_weights_compared']+=int(weights.size);report['head_biases_compared']+=0 if biases is None else len(biases)
for name in ['fused.bin','vocabulary.bin','vocabulary.json','sigmoid-delta.bin','exp-q32.bin']:
 assert (D/name).read_bytes()==(S/name).read_bytes(),name
 report['static_data'][name]={'identical_to_original':True,'sha256':sha(D/name)}
assert (D/'word-punct.bin').read_bytes()==q['word_punct_bias.weight'].astype('<i2').tobytes()
assert (D/'punct-fold.bin').read_bytes()==(S/'punctuation.bin').read_bytes()[88000:]
report['static_data']['word-punct.bin']={'identical_to_original_reference':True,'sha256':sha(D/'word-punct.bin')}
report['static_data']['punct-fold.bin']={'identical_to_original':True,'sha256':sha(D/'punct-fold.bin')}
report['status']='PASS';(P/'delta-packed-independent-review.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k]for k in ['status','dynamic_weights_compared','head_biases_compared','rust_source_sha256']}))
