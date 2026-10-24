"""Independent decoder of selected accumulator representation against original SIMD8 bytes."""
from pathlib import Path
import json,hashlib
HERE=Path(__file__).resolve().parent
OLD=HERE.parents[1]/'voice-v8/exports/grammar4m'
NEW=HERE/'b25x10a5'
sha=lambda b:hashlib.sha256(b).hexdigest()
BITS,LANES,BATCH,CHUNKS=25,10,5,39
PACK=CHUNKS*32
report={'name':'b25x10a5','status':'RUNNING','local_only':True,'public_transactions':0,'source_sha256':sha((NEW/'GRU2SIMDModel.sol').read_bytes()),'source_weights_compared':0,'worst_nonnegative_coefficient':0,'limit_exclusive':2**BITS,'matrices':{}}
for file,count,oldstride,bias in [('core.bin',3456,1568,False),('groups.bin',128,1600,True),('words.bin',8192,1600,True),('punctuation.bin',5,1600,True)]:
 old=(OLD/file).read_bytes();new=(NEW/file).read_bytes();stride=PACK+(96 if bias else 64);worst=0
 for r in range(count):
  ob=old[r*oldstride:(r+1)*oldstride];nb=new[r*stride:(r+1)*stride];weights=[int.from_bytes(ob[j:j+4],'big')-32768 for j in range(0,1536,4)]
  offset=int.from_bytes(nb[PACK+32:PACK+64],'big',signed=True)
  assert offset==-min(weights);assert int.from_bytes(nb[PACK:PACK+32],'big',signed=True)==sum(weights)
  decoded=[]
  for j in range(CHUNKS):
   x=int.from_bytes(nb[j*32:(j+1)*32],'big');digits=[(x>>(BITS*(LANES-1-k)))&(2**BITS-1) for k in range(LANES)];decoded+=digits
  assert [w-offset for w in decoded[:384]]==weights,(file,r,'weights')
  assert all(w==0 for w in decoded[384:]),(file,r,'padding')
  if bias:assert ob[1568:1600]==nb[PACK+64:PACK+96]
  for j in range(0,CHUNKS,BATCH):
   bound=2048*sum(decoded[j*LANES:min(CHUNKS*LANES,(j+BATCH)*LANES)])
   assert bound<2**BITS,(file,r,j,'coefficientbound');worst=max(worst,bound)
 assert old[count*oldstride:]==new[count*stride:],(file,'suffix')
 report['matrices'][file]={'rows':count,'weights_compared':count*384,'all_weights_identical':True,'bias_and_suffix_identical':True,'worst_nonnegative_coefficient':worst};report['source_weights_compared']+=count*384;report['worst_nonnegative_coefficient']=max(worst,report['worst_nonnegative_coefficient'])
for file in ['fused.bin','vocabulary.bin','sigmoid-delta.bin','exp-q32.bin','reference.npz']:
 assert (OLD/file).read_bytes()==(NEW/file).read_bytes(),file
report['status']='PASS';(HERE/'unsigned-independent-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
