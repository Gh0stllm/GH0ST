from pathlib import Path
import hashlib,json,numpy as np
p=Path(__file__).resolve().parent;s=p/'signed';q=np.load(s/'reference.npz');B=1<<25;half=B>>1
mats={'core':np.concatenate([q['wh1'],q['wx2'],q['wh2']]),'groups':q['groups.weight'],'words':q['words.weight'],'punctuation':q['punct_head.weight']}
r={'scope':'UNFORKED_LOCAL_ONLY','status':'RUNNING','weightValuesCompared':0,'matrixResults':{},'proof':'Each packed polynomial coefficient has abs<=280<B/2. Rounded base-B digit recovery reconstructs original signed coefficient. For inference, every convolution coefficient is bounded by 1024 times the relevant chunk-group sum of absolute weights, strictly below B/2. Therefore lower terms have absolute sum below half target radix place; nearest-coefficient extraction is exact for every allowed hidden vector. Modulo2^256 does not change the low25 bits after a225-bit shift.'}
for name,mat in mats.items():
 data=(s/(name+'.bin')).read_bytes();n=0
 for row,a in enumerate(mat.astype('int64')):
  offset=(row//18)*24000+(row%18)*1312 if name=='core' else row*1344
  for chunk in range(39):
   packed=int.from_bytes(data[offset+chunk*32:offset+(chunk+1)*32],'big')
   for j in range(min(10,384-chunk*10)):
    exponent=25*(9-j);rounded=packed+(1<<(exponent-1)) if exponent else packed
    raw=(rounded>>exponent)&(B-1);actual=(raw^half)-half
    assert actual==int(a[chunk*10+j]),(name,row,chunk,j,actual,int(a[chunk*10+j]));n+=1
 r['matrixResults'][name]={'weightsCompared':n,'sha256':hashlib.sha256(data).hexdigest()};r['weightValuesCompared']+=n
r['status']='PASS_ALL_PACKED_WEIGHT_VALUES_EQUAL_REFERENCE';(p/'signed-data-audit.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
