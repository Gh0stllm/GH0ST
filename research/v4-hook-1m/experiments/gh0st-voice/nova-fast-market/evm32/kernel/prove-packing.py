"""Independent exactness audit of the revised accumulation schedules, local only."""
from pathlib import Path
import hashlib,json
import numpy as np
p=Path(__file__).resolve().parent
selected=p.parents[1]/'selected'
q=np.load(selected/'reference.npz')
schedules={'core.bin':[6,6,5,6,6,6,4],'groups.bin':[7,8,8,7,7,2],'words.bin':[7,8,8,7,7,2],'punctuation.bin':[7,8,8,7,7,2]}
matrices={'core.bin':np.concatenate([q['wh1'],q['wx2'],q['wh2']]),'groups.bin':q['groups.weight'],'words.bin':q['words.weight'],'punctuation.bin':q['punct_head.weight']}
rng=np.random.default_rng(147732)
vectors=[np.zeros(384,dtype=np.int64),np.full(384,-1024),np.full(384,1024),np.tile([-1024,1024],192),rng.integers(-1024,1025,384),rng.integers(-1024,1025,384)]
mask=(1<<25)-1;mod=(1<<256)-1
report={'scope':'UNFORKED_LOCAL_ONLY','status':'RUNNING','source_weights_changed':False,'matrices':{}}
for filename,matrix in matrices.items():
 data=(selected/filename).read_bytes();stride=1312 if filename=='core.bin' else 1344; schedule=schedules[filename]
 count=0;worst=0;decoded=0
 for r,row in enumerate(matrix.astype('int64')):
  blob=data[r*stride:(r+1)*stride]; packed=[int.from_bytes(blob[i*32:(i+1)*32],'big') for i in range(39)];offset=int.from_bytes(blob[1280:1312],'big',signed=True);total=int.from_bytes(blob[1248:1280],'big',signed=True)
  weights=[]
  for v in packed: weights.extend([(v>>((9-j)*25))&mask for j in range(10)])
  assert weights[384:]==[0]*6
  assert [v-offset for v in weights[:384]]==row.tolist()
  assert total==int(row.sum());decoded+=384
  pos=0
  for size in schedule:
   bound=2048*sum(weights[pos*10:(pos+size)*10]);assert bound<(1<<25),(filename,r,pos,size,bound);worst=max(worst,bound);pos+=size
  assert pos==39
  for vector in vectors:
   pv=[]
   for c in range(39):pv.append(sum((int(v)+1024)<<(j*25) for j,v in enumerate(vector[c*10:(c+1)*10])))
   result=0;pos=0
   for size in schedule:
    result+=((sum(pv[k]*packed[k] for k in range(pos,pos+size))&mod)>>225)&mask;pos+=size
   result-=offset*sum(int(v)+1024 for v in vector)+1024*total
   assert result==sum(int(a)*int(b) for a,b in zip(row,vector));count+=1
 report['matrices'][filename]={'rows':len(matrix),'decoded_weights':decoded,'scalar_dot_parity_cases':count,'schedule':schedule,'maximum_coefficient':worst,'limit_exclusive':1<<25,'artifact_sha256':hashlib.sha256(data).hexdigest()}
report['status']='PASS';report['total_scalar_dot_parity_cases']=sum(x['scalar_dot_parity_cases'] for x in report['matrices'].values());report['total_decoded_weights']=sum(x['decoded_weights'] for x in report['matrices'].values());(p/'packing-proof.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
