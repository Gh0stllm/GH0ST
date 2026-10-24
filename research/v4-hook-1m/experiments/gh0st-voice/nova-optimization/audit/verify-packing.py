from pathlib import Path
import hashlib,json
p=Path(__file__).resolve().parent
old=p.parent.parent/'voice-v8/exports/grammar4m'
new=p.parent/'selected'
records={};total=0
for file,rows,oldstride,newstride in [('core.bin',3456,1568,1184),('groups.bin',128,1600,1216),('words.bin',8192,1600,1216),('punctuation.bin',5,1600,1216)]:
 a=(old/file).read_bytes();b=(new/file).read_bytes();maximum=0
 for r in range(rows):
  oa=a[r*oldstride:(r+1)*oldstride];nb=b[r*newstride:(r+1)*newstride]
  ow=[int.from_bytes(oa[i:i+4],'big')-32768 for i in range(0,1536,4)]
  offset=int.from_bytes(nb[1152:1184],'big',signed=True)
  assert offset==-min(ow),(file,r,'offset')
  assert int.from_bytes(nb[1120:1152],'big',signed=True)==sum(ow),(file,r,'weight sum')
  for group in range(35):
   packed=int.from_bytes(nb[group*32:(group+1)*32],'big')
   unpacked=[(packed>>(23*(10-j)))&0x7fffff for j in range(11)]
   count=min(11,384-group*11)
   assert unpacked[:count]==[x+offset for x in ow[group*11:group*11+count]],(file,r,group,'weights')
   assert unpacked[count:]==[0]*(11-count),(file,r,group,'padding')
   coefficient=2048*sum(unpacked)
   assert coefficient<2**23,(file,r,group,'carry')
   maximum=max(maximum,coefficient)
  if oldstride==1600:assert oa[1568:1600]==nb[1184:1216],(file,r,'bias')
 assert a[rows*oldstride:]==b[rows*newstride:],(file,'unmodified suffix')
 records[file]={'rows':rows,'weights_compared':rows*384,'max_coefficient':maximum,'all_packed_weights_equal':True,'metadata_equal':True,'suffix_equal':True}
 total+=rows*384
for file in ['fused.bin','vocabulary.bin','sigmoid-delta.bin','exp-q32.bin','reference.npz']:
 assert (old/file).read_bytes()==(new/file).read_bytes(),file
report={'status':'PASS','verification':'Independent original-SIMD8 to selected-SIMD11 byte decoder; no training library or exporter imported.','dynamic_weights_compared':total,'matrices':records,'static_tables_and_reference_unchanged':True,'local_only':True,'public_transactions':0}
(p/'packing-independent-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
