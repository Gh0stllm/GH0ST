"""Independent exact signed-radix audit against the selected reference arrays."""
from pathlib import Path
from fractions import Fraction
import numpy as np,hashlib,json,math,argparse
D=Path(__file__).resolve().parent;V=D.parent.parent
P=argparse.ArgumentParser();P.add_argument('--dir',type=Path);A=P.parse_args()
q=np.load(V/'nova-optimization/selected/reference.npz')
sets={'core.bin':(np.concatenate([q['wh1'],q['wx2'],q['wh2']]).astype(np.int64),None,16128),'groups.bin':(q['groups.weight'].astype(np.int64),q['group_bias.weight'][:,0],0),'words.bin':(q['words.weight'].astype(np.int64),q['word_bias.weight'][:,0],0),'punctuation.bin':(q['punct_head.weight'].astype(np.int64),q['punct_bias'],8192*10+5*5760)}
configs=[A.dir] if A.dir else sorted((D.parent/'layout').glob('s*x*a*'))
sha=lambda b:hashlib.sha256(b).hexdigest();records=[]
for folder in configs:
 if not (folder/'proof.json').exists():continue
 meta=json.loads((folder/'proof.json').read_text());bits,lanes,batch=meta['bits'],meta['lanes'],meta['batch'];base=1<<bits;chunks=math.ceil(384/lanes);shift=(lanes-1)*bits;mask=base-1;bytesPacked=chunks*32
 assert shift+bits<=256 and shift>0
 record={'directory':str(folder.relative_to(D.parent)),'bits':bits,'lanes':lanes,'batch':batch,'source_sha256':sha((folder/'GRU2SIMDModel.sol').read_bytes()),'weightsCompared':0,'rowBatchUniversalProofs':0,'maxAbsoluteCoefficient':0,'matrices':{},'status':'RUNNING','mainnetActions':0}
 for filename,(weights,bias,suffixLength) in sets.items():
  b=(folder/filename).read_bytes();stride=bytesPacked+(64 if bias is None else 96);assert len(b)==len(weights)*stride+suffixLength
  maxB=0
  for ridx,row in enumerate(weights):
   bb=b[ridx*stride:(ridx+1)*stride];decoded=[]
   for c in range(chunks):
    packed=int.from_bytes(bb[c*32:(c+1)*32],'big',signed=True);digits=[]
    for i in range(lanes):
     remainder=packed%base
     digit=remainder if remainder<base//2 else remainder-base
     digits.append(digit);packed=(packed-digit)//base
    assert packed==0
    decoded.extend(reversed(digits))
   assert decoded[:384]==row.tolist(),(folder,filename,ridx,'weights')
   assert not any(decoded[384:]),'nonzero pad'
   assert int.from_bytes(bb[bytesPacked:bytesPacked+32],'big',signed=True)==int(row.sum())
   assert int.from_bytes(bb[bytesPacked+32:bytesPacked+64],'big',signed=True)==0
   if bias is not None:assert int.from_bytes(bb[bytesPacked+64:bytesPacked+96],'big',signed=True)==int(bias[ridx])
   # Every coefficient in the convolution is bounded by the sum of absolute weights
   # times max(abs(hidden))=1024. This includes all lower coefficients, not just the
   # target coefficient. The geometric-series bound proves no lower-digit borrow
   # survives rounding by half a target unit, including negative central values.
   for c in range(0,chunks,batch):
    bound=1024*int(np.abs(row[c*lanes:min(384,(c+batch)*lanes)]).sum());maxB=max(maxB,bound)
    lowerAbs=Fraction(bound*(base**(lanes-1)-1),base-1)
    assert lowerAbs < Fraction(base**(lanes-1),2),(folder,filename,ridx,c,'lower digit rounding can leak')
    assert bound<base//2,(folder,filename,ridx,c,'signed target overflow')
    record['rowBatchUniversalProofs']+=1
  record['matrices'][filename]={'rows':len(weights),'weightsCompared':int(weights.size),'largestBound':maxB,'lowerDigitFractionUpperBound':str(Fraction(maxB,base-1)),'strictlyLessThanHalf':2*maxB<base-1,'suffixLength':suffixLength}
  record['weightsCompared']+=int(weights.size);record['maxAbsoluteCoefficient']=max(record['maxAbsoluteCoefficient'],maxB)
 # Unchanged static inputs, vocabulary, old reference tables and trained checkpoint reference.
 for filename in ['fused.bin','vocabulary.bin','vocabulary.json','exp-q32.bin','sigmoid-delta.bin','reference.npz']:
  assert (folder/filename).read_bytes()==(V/'nova-optimization/selected'/filename).read_bytes(),filename
 # Carry cancellation edge cases, constructed independently from the convolution:
 # target can be negative; lower contribution is nearest-half strictly below cutoff.
 rounding=0
 radius=record['maxAbsoluteCoefficient'];unit=1<<shift;lowerBound=int(Fraction(radius*(unit-1),base-1))
 for middle in [-base//2+1,-radius,-1,0,1,radius,base//2-1]:
  for low in [-lowerBound,-1,0,1,lowerBound]:
   for high in [-9,-1,0,1,9]:
    integer=(middle*unit+low+high*unit*base)%(1<<256)
    field=(((integer+unit//2)%(1<<256))>>shift)&mask
    actual=field if field<base//2 else field-base
    assert actual==middle,(folder,middle,low,high,actual);rounding+=1
 record.update({'status':'PASS','roundingBoundaryCases':rounding,'staticBlobsUnchanged':True,'universalRoundingArgument':'For every product-sum, all convolution coefficient magnitudes <=B<radix/2. Lower coefficients contribute at most B*(radix^target-1)/(radix-1), strictly below half a target unit. Adding half then shifting recovers the exact target integer modulo radix; signed range bound makes sign extension unique. The proof covers all hidden inputs in[-1024,1024], not only sampled vectors.'})
 records.append(record);print(folder.name,'PASS',record['weightsCompared'],record['rowBatchUniversalProofs'],flush=True)
(D/'signed-radix-independent-proof.json').write_text(json.dumps(records,indent=2)+'\n')
