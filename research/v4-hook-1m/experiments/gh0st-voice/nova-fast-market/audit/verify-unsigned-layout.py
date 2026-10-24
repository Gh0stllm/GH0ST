"""Independent selected unsigned accumulator proof; no exporter imports."""
from pathlib import Path
import numpy as np,hashlib,json,math,argparse
D=Path(__file__).resolve().parent;V=D.parent.parent
P=argparse.ArgumentParser();P.add_argument('--dir',type=Path,default=D.parent/'layout/b25x10a5');P.add_argument('--out',type=Path,default=D/'unsigned-layout-independent-proof.json');A=P.parse_args();F=A.dir
m=json.loads((F/'proof.json').read_text());bits,lanes,batch=m['bits'],m['lanes'],m['batch'];chunks=math.ceil(384/lanes);base=1<<bits;mask=base-1;shift=(lanes-1)*bits;packedBytes=chunks*32
assert shift+bits<=256
q=np.load(V/'nova-optimization/selected/reference.npz');old=V/'voice-v8/exports/grammar4m';sha=lambda b:hashlib.sha256(b).hexdigest()
sets={'core.bin':(np.concatenate([q['wh1'],q['wx2'],q['wh2']]).astype(np.int64),None,1568),'groups.bin':(q['groups.weight'].astype(np.int64),q['group_bias.weight'][:,0],1600),'words.bin':(q['words.weight'].astype(np.int64),q['word_bias.weight'][:,0],1600),'punctuation.bin':(q['punct_head.weight'].astype(np.int64),q['punct_bias'],1600)}
result={'status':'RUNNING','directory':str(F.relative_to(D.parent)),'sourceSha256':sha((F/'GRU2SIMDModel.sol').read_bytes()),'bits':bits,'lanes':lanes,'batch':batch,'chunks':chunks,'shift':shift,'weightsCompared':0,'batchesProved':0,'maximumCoefficientBound':0,'matrices':{},'mainnetActions':0}
# Test extreme inputs plus diverse deterministic vectors. Domain-wide proof is separate below.
rng=np.random.default_rng(649852);vectors=[np.full(384,-1024,dtype=np.int64),np.zeros(384,dtype=np.int64),np.full(384,1024,dtype=np.int64),np.tile([-1024,1024],192),*list(rng.integers(-1024,1025,(4,384),dtype=np.int64))]
encodedVectors=[]
for vec in vectors:
 groups=[]
 for i in range(chunks):groups.append(sum((int(vec[k])+1024)<<(bits*(k-i*lanes)) for k in range(i*lanes,min((i+1)*lanes,384))))
 encodedVectors.append(groups)
for name,(ref,bias,oldstride) in sets.items():
 raw=(F/name).read_bytes();oldraw=(old/name).read_bytes();stride=packedBytes+(64 if bias is None else 96);count=len(ref)
 original=(np.ndarray(shape=(count,384),dtype='>u4',buffer=oldraw,strides=(oldstride,4)).astype(np.int64)-32768)
 assert np.array_equal(original,ref),('reference drift',name)
 assert oldraw[count*oldstride:]==raw[count*stride:],(name,'static suffix changed')
 rowbounds=[];comparisons=0
 for r,row in enumerate(ref):
  bb=raw[r*stride:(r+1)*stride];offset=int.from_bytes(bb[packedBytes+32:packedBytes+64],'big',signed=True)
  assert offset==-int(row.min());assert int.from_bytes(bb[packedBytes:packedBytes+32],'big',signed=True)==int(row.sum())
  encoded=[];decoded=[]
  for i in range(chunks):
   word=int.from_bytes(bb[i*32:(i+1)*32],'big');assert word>>(bits*lanes)==0;encoded.append(word)
   for j in range(lanes):
    at=i*lanes+j;digit=(word>>(bits*(lanes-1-j)))&mask
    if at<384:decoded.append(digit-offset)
    else:assert digit==0,(name,r,'padding')
  assert decoded==row.tolist(),(name,r,'weights')
  if bias is not None:assert int.from_bytes(bb[packedBytes+64:packedBytes+96],'big',signed=True)==int(bias[r])
  shifted=row+offset;assert shifted.min()>=0
  for start in range(0,chunks,batch):
   # Every convolution digit (not only its center) contains a subset of these
   # nonnegative weights times activations in [0,2048]. This bound applies to all
   # 2*lanes-1 digits and excludes any carry into the extracted center digit.
   bound=2048*int(shifted[start*lanes:min((start+batch)*lanes,384)].sum())
   assert bound<base,(name,r,start,'carry');rowbounds.append(bound);result['batchesProved']+=1
  for v,packedVec in zip(vectors,encodedVectors):
   total=0
   for start in range(0,chunks,batch):
    # Modulo2^256 deliberately matches EVM arithmetic, including high-degree overflow.
    productSum=sum(packedVec[i]*encoded[i] for i in range(start,min(start+batch,chunks)))%(1<<256)
    total+=(productSum>>shift)&mask
   actual=total-offset*int((v+1024).sum())-1024*int(row.sum())
   assert actual==int(row@v),(name,r,'dot mismatch');comparisons+=1
 result['matrices'][name]={'rows':count,'weightsCompared':int(ref.size),'allWeightsEqualOriginalSimd8AndNpz':True,'offsetsRowSumsBiasAndStaticSuffixExact':True,'maxAnyConvolutionCoefficient':max(rowbounds),'exclusiveLimit':base,'universalBatchBounds':len(rowbounds),'independentDotComparisons':comparisons,'fileSha256':sha(raw)}
 result['weightsCompared']+=int(ref.size);result['maximumCoefficientBound']=max(result['maximumCoefficientBound'],max(rowbounds));print(name,'PASS',int(ref.size),comparisons,flush=True)
for name in ['fused.bin','vocabulary.bin','vocabulary.json','exp-q32.bin','sigmoid-delta.bin','reference.npz']:
 assert (F/name).read_bytes()==(V/'nova-optimization/selected'/name).read_bytes(),('static drift',name)
result.update({'status':'PASS','staticBlobsAndReferenceUnchanged':True,'universalProof':'For each batch, every convolution coefficient is nonnegative and <=2048 times the sum of shifted row weights in that batch. Verified this bound is strictly below2^25 for every row/batch. Consequently no base2^25 carry crosses any digit. The desired center digit is entirely below bit256, so modulo2^256 removes only higher digits. Extracting then subtracting exact shift corrections recovers the scalar dot for every hidden input in[-1024,1024].','totalIndependentDotComparisons':sum(v['independentDotComparisons'] for v in result['matrices'].values())})
A.out.write_text(json.dumps(result,indent=2)+'\n');print('ALL PASS',result['weightsCompared'],result['maximumCoefficientBound'],flush=True)
