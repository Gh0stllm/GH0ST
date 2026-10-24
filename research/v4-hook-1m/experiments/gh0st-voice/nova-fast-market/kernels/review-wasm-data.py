from pathlib import Path
import hashlib,json
import numpy as np
P=Path(__file__).resolve().parent
S=P.parent.parent/'nova-optimization/selected'
R=P.parent/'stylus/raw-model'
sha=lambda data:hashlib.sha256(data).hexdigest()
m=json.loads((R/'manifest.json').read_text())
q={k:v.astype(np.int64)for k,v in dict(np.load(S/'reference.npz',allow_pickle=False)).items()}
checks=[];values=0
raw=(R/'core.bin').read_bytes()
core=np.frombuffer(raw[:2654208],dtype='<i2').astype(np.int64).reshape(3456,384)
expected=np.concatenate([q['wh1'],q['wx2'],q['wh2']])
assert np.array_equal(core,expected);values+=core.size
assert raw[2654208:]==(S/'core.bin').read_bytes()[4091904:];checks+=['All1,327,104 recurrent/projection weights exact','Big-endian feature/bias tail unchanged']
for file,matrix,bias in [('groups',q['groups.weight'],q['group_bias.weight'][:,0]),('words',q['words.weight'],q['word_bias.weight'][:,0]),('punct',q['punct_head.weight'],q['punct_bias'])]:
 data=(R/(file+'.bin')).read_bytes();rows=len(matrix)
 assert len(data)==rows*772
 for i in range(rows):
  assert np.array_equal(np.frombuffer(data[i*772:i*772+768],dtype='<i2'),matrix[i])
  assert int.from_bytes(data[i*772+768:(i+1)*772],'little',signed=True)==int(bias[i])
 values+=matrix.size+bias.size;checks.append(file+' all rows/biases exact')
wpb=np.frombuffer((R/'word-punct.bin').read_bytes(),dtype='<i2').reshape(8192,5)
assert np.array_equal(wpb,q['word_punct_bias.weight']);values+=wpb.size
for name in ['fused.bin','sigmoid-delta.bin','exp-q32.bin','vocabulary.bin','vocabulary.json']:
 assert (R/name).read_bytes()==(S/name).read_bytes();checks.append(name+' unchanged bytes')
assert (R/'punct-fold.bin').read_bytes()==(S/'punctuation.bin').read_bytes()[88000:]
def decode40(data):
 b=np.frombuffer(data,dtype=np.uint8).astype(np.int64).reshape(-1,5)
 v=sum(b[:,i]<<(8*(4-i)) for i in range(5))
 return np.where(v&(1<<39),v-(1<<40),v)
fused=(R/'fused.bin').read_bytes()
for token in [0,1,1047,3412,8191,8192]:
 expected=q['wx1']@q['embedding.weight'][token]+(q['bh1']+q['domain.weight'][0])*1024
 assert np.array_equal(decode40(fused[token*5760:(token+1)*5760]),expected)
fold=(R/'punct-fold.bin').read_bytes()
for punct in range(5):
 assert np.array_equal(decode40(fold[punct*5760:(punct+1)*5760]),q['wx1']@q['punct_embedding.weight'][punct])
checks+=['Six fused-token rows reconstructed independently','All five punctuation folds reconstructed independently']
assert m['source_reference_sha256']==sha((S/'reference.npz').read_bytes())
assert m['checkpoint_sha256']=='904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3'
for name,info in m['artifacts'].items():
 data=(R/name).read_bytes();assert len(data)==info['bytes'];assert sha(data)==info['sha256']
result={'status':'PASS','scope':'INDEPENDENT_LOCAL_WASM_DATA_REVIEW','publicTransactions':0,'checkpointSha256':m['checkpoint_sha256'],'referenceSha256':m['source_reference_sha256'],'directlyComparedQuantizedValues':int(values),'fusedRowsIndependentlyReconstructed':6,'punctuationFoldRowsIndependentlyReconstructed':5,'checks':checks,'limitations':['Data/reference identity is not a measured Stylus gas result','Production model catalogs and code hashes are not implemented in the local WASM kernel']}
(P/'wasm-data-review.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
