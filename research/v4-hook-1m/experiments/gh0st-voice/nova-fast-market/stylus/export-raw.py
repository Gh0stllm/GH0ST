from pathlib import Path
import hashlib,json
import numpy as np
P=Path(__file__).resolve().parent;S=P.parent.parent/'nova-optimization/selected';O=P/'raw-model';O.mkdir(exist_ok=True)
q=np.load(S/'reference.npz');i16=lambda a:np.asarray(a,dtype='<i2').tobytes();i32=lambda a:np.asarray(a,dtype='<i4').tobytes()
core=i16(np.concatenate([q['wh1'],q['wx2'],q['wh2']]))+(S/'core.bin').read_bytes()[4091904:]
assert len(core)==2670336
(O/'core.bin').write_bytes(core)
for file,mat,bias in [('groups',q['groups.weight'],q['group_bias.weight'][:,0]),('words',q['words.weight'],q['word_bias.weight'][:,0]),('punct',q['punct_head.weight'],q['punct_bias'])]:
 (O/(file+'.bin')).write_bytes(b''.join(i16(row)+i32(b)for row,b in zip(mat,bias)))
(O/'word-punct.bin').write_bytes(i16(q['word_punct_bias.weight']))
(O/'punct-fold.bin').write_bytes((S/'punctuation.bin').read_bytes()[88000:])
for name in ['fused.bin','sigmoid-delta.bin','exp-q32.bin','vocabulary.bin','vocabulary.json']:
 (O/name).write_bytes((S/name).read_bytes())
meta=json.loads((S/'manifest.json').read_text());meta.update({'scope':'Raw exact Q10 weights for local WASM backend research; not deployment artifacts','raw_endianness':'little endian i16 weights/i32 head biases; fused/aux tables preserve original big endian formats','artifacts':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in O.iterdir()if p.is_file() and p.name!='manifest.json'},'source_reference_sha256':hashlib.sha256((S/'reference.npz').read_bytes()).hexdigest()});
for key in ['source_sha256','model_domain','catalog','fixed_runtime_domain','pool_hook_source','pool_hook_source_sha256']:
 if key in meta:meta['original_'+key]=meta.pop(key)
for key in ['selected_inference_budget','tested_transaction_gas_limit','tested_block_gas_limit']:meta.pop(key,None)
meta['optimization_status']='CANDIDATE_PENDING_WASM_VALIDATION'
(O/'manifest.json').write_text(json.dumps(meta,indent=2)+'\n');print('Raw weights exported:',sum(p.stat().st_size for p in O.iterdir()))
