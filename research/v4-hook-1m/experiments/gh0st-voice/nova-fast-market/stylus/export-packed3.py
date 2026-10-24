from pathlib import Path
import json,hashlib,os
import numpy as np
P=Path(__file__).resolve().parent;S=P/'raw-model';O=P/'packed3-model';O.mkdir(exist_ok=True);Q=P.parent.parent/'nova-optimization/selected';q=np.load(Q/'reference.npz')
reports={};rng=np.random.default_rng(74219);vectors=[np.zeros(384,dtype=np.int64),np.full(384,-1024,dtype=np.int64),np.full(384,1024,dtype=np.int64),np.tile([-1024,1024],192),*[rng.integers(-1024,1025,384,dtype=np.int64) for _ in range(4)]]
for filename,matrix,bias in [('core',np.concatenate([q['wh1'],q['wx2'],q['wh2']]),None),('groups',q['groups.weight'],q['group_bias.weight'][:,0]),('words',q['words.weight'],q['word_bias.weight'][:,0]),('punct',q['punct_head.weight'],q['punct_bias'])]:
 w=matrix.astype(np.int64);triples=w.reshape(-1,128,3);packed=(triples[:,:,0]<<42)+(triples[:,:,1]<<21)+triples[:,:,2]
 remainder=packed.copy();digits=[]
 for _ in range(3):
  digit=(remainder+2**20)%(2**21)-2**20;digits.append(digit);remainder=(remainder-digit)//2**21
 assert np.all(remainder==0);decoded=np.stack(list(reversed(digits)),axis=2).reshape(-1,384);assert np.array_equal(decoded,w)
 bound=int(np.abs(triples).sum(2).max())*1024;assert bound<2**20
 for v in vectors:
  t=v.reshape(128,3);vp=((t[:,0]<<0)+(t[:,1]<<21)+(t[:,2]<<42)).astype(np.uint64)
  prods=packed.astype(np.uint64)*vp[np.newaxis,:]
  central=((prods+np.uint64(1<<41))<<np.uint64(1)).astype(np.int64)>>43
  assert np.array_equal(central.sum(1),w@v)
 rows=packed.astype('<i8')
 if bias is None:data=rows.tobytes()+(S/'core.bin').read_bytes()[2654208:]
 else:data=b''.join(row.tobytes()+np.asarray(b,dtype='<i4').tobytes()for row,b in zip(rows,bias))
 (O/(filename+'.bin')).write_bytes(data);reports[filename]={'rows':len(w),'weights_exact':int(w.size),'max_signed_coefficient':bound,'limit_exclusive':2**20,'row_vector_dot_checks':len(w)*len(vectors)}
for file in ['fused.bin','word-punct.bin','punct-fold.bin','sigmoid-delta.bin','exp-q32.bin','vocabulary.bin','vocabulary.json']:
 if not (O/file).exists():os.link(S/file,O/file)
meta=json.loads((S/'manifest.json').read_text());meta['scope']='Exact 3-lane signed21 radix64 WASM data, local-only';meta['packing']='Three signed Q10 weights per u64; unsigned product plus2^41 followed by signedextractbits42..62';meta['artifacts']={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in O.iterdir()if p.is_file()and p.name!='manifest.json'};(O/'manifest.json').write_text(json.dumps(meta,indent=2)+'\n');(P/'packed3-proof.json').write_text(json.dumps({'status':'PASS','local_only':True,'matrices':reports},indent=2)+'\n');print(json.dumps(reports,indent=2))
