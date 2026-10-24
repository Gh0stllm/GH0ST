"""Independent byte decoder; uses original SIMD8 export, not exporter or numpy."""
from pathlib import Path
import json,hashlib
HERE=Path(__file__).resolve().parent
OLD=HERE.parents[1]/'voice-v8/exports/grammar4m'
sha=lambda b:hashlib.sha256(b).hexdigest()
records=[]
for name,bits,lanes,batch in [('s23x11a3',23,11,3),('s24x10a8',24,10,8),('s25x10a19',25,10,19),('s26x9a43',26,9,43)]:
 d=HERE/name;chunks=(384+lanes-1)//lanes;pack=chunks*32
 record={'name':name,'status':'RUNNING','source_sha256':sha((d/'GRU2SIMDModel.sol').read_bytes()),'source_weights_compared':0,'worst_absolute_coefficient':0,'matrices':{}}
 for file,count,oldstride,bias in [('core.bin',3456,1568,False),('groups.bin',128,1600,True),('words.bin',8192,1600,True),('punctuation.bin',5,1600,True)]:
  old=(OLD/file).read_bytes();new=(d/file).read_bytes();stride=pack+(96 if bias else 64);worst=0
  for r in range(count):
   ob=old[r*oldstride:(r+1)*oldstride];nb=new[r*stride:(r+1)*stride];weights=[int.from_bytes(ob[j:j+4],'big')-32768 for j in range(0,1536,4)]
   decoded=[]
   for j in range(chunks):
    x=int.from_bytes(nb[j*32:(j+1)*32],'big',signed=True);digits=[]
    for _ in range(lanes):
     digit=(x+2**(bits-1))%2**bits-2**(bits-1);digits.append(digit);x=(x-digit)//2**bits
    assert x==0,(name,file,r,j,'highdigits');decoded+=list(reversed(digits))
   assert decoded[:384]==weights,(name,file,r,'weights');assert all(x==0 for x in decoded[384:]),(name,file,r,'padding')
   assert int.from_bytes(nb[pack:pack+32],'big',signed=True)==sum(weights)
   assert nb[pack+32:pack+64]==b'\0'*32
   if bias:assert ob[1568:1600]==nb[pack+64:pack+96]
   for j in range(0,chunks,batch):
    bound=1024*sum(abs(w) for w in weights[j*lanes:min(384,(j+batch)*lanes)])
    assert bound<2**(bits-1),(name,file,r,j,'coefficientbound');worst=max(worst,bound)
  assert old[count*oldstride:]==new[count*stride:],(name,file,'suffix')
  record['matrices'][file]={'rows':count,'weights_compared':count*384,'all_weights_identical':True,'bias_and_suffix_identical':True,'worst_absolute_coefficient':worst};record['source_weights_compared']+=count*384;record['worst_absolute_coefficient']=max(worst,record['worst_absolute_coefficient'])
 for file in ['fused.bin','vocabulary.bin','sigmoid-delta.bin','exp-q32.bin','reference.npz']:
  assert (OLD/file).read_bytes()==(d/file).read_bytes(),(name,file)
 record['status']='PASS';record['local_only']=True;record['public_transactions']=0;records.append(record);print(name,'PASS',record['source_weights_compared'],flush=True)
(HERE/'signed-independent-audit.json').write_text(json.dumps(records,indent=2)+'\n')
