from pathlib import Path
import numpy as np,json,hashlib,os
p=Path(__file__).resolve().parent;base=p.parents[1];src=base/'selected';out=p/'signed';out.mkdir(exist_ok=True);q=np.load(src/'reference.npz');mod=(1<<256)-1;B=1<<25;half=1<<24;shift=225
mats={'core':np.concatenate([q['wh1'],q['wx2'],q['wh2']]),'groups':q['groups.weight'],'words':q['words.weight'],'punctuation':q['punct_head.weight']};schedules={'core':[19,20],'groups':[26,13],'words':[26,13],'punctuation':[26,13]}
rng=np.random.default_rng(221944);vectors=[np.zeros(384,dtype=np.int64),np.full(384,-1024),np.full(384,1024),np.tile([-1024,1024],192),rng.integers(-1024,1025,384),rng.integers(-1024,1025,384)]
report={'scope':'LOCAL_ONLY','weightsUnchanged':True,'packing':'signed centered polynomial, modulo256 multiplication, nearest coefficient extraction','bits':25,'lanes':10,'matrices':{}}
for name,matrix in mats.items():
 stride=1312 if name=='core' else 1344;original=(src/(name+'.bin')).read_bytes();rows=[];worst=0;count=0
 for rowindex,row in enumerate(matrix.astype('int64')):
  packed=[]
  for k in range(39):
   v=sum(int(w)<<(25*(9-j)) for j,w in enumerate(row[k*10:(k+1)*10]));packed.append(v&mod)
  pos=0
  for n in schedules[name]:
   bound=1024*sum(abs(int(w)) for w in row[pos*10:min((pos+n)*10,384)]);assert bound<half;worst=max(worst,bound);pos+=n
  for vec in vectors:
   ps=[]
   for k in range(39):ps.append(sum(int(v)<<(25*j) for j,v in enumerate(vec[k*10:(k+1)*10]))&mod)
   total=0;pos=0
   for n in schedules[name]:
    acc=sum(ps[k]*packed[k] for k in range(pos,pos+n))&mod
    raw=(((acc+(1<<(shift-1)))&mod)>>shift)&(B-1)
    total+=(raw^half)-half;pos+=n
   assert total==int(row@vec),(name,rowindex,total,int(row@vec));count+=1
  payload=b''.join(x.to_bytes(32,'big')for x in packed)+original[rowindex*stride+1248:(rowindex+1)*stride];assert len(payload)==stride;rows.append(payload)
 raw=b''.join(rows)+original[len(rows)*stride:]
 if name=='core': raw=b''.join(raw[i:i+18*1312]+bytes(384)for i in range(0,len(rows)*1312,18*1312))+original[len(rows)*stride:]
 (out/(name+'.bin')).write_bytes(raw);report['matrices'][name]={'maxCoefficientAbs':worst,'strictLimit':half,'schedule':schedules[name],'scalarParityCases':count,'sha256':hashlib.sha256(raw).hexdigest()}
source_manifest=json.loads((src/'manifest.json').read_text())
# Keep every unchanged artifact named by the inherited manifest reproducible,
# including lookup tables and the human-readable vocabulary.
unchanged_artifacts=[f for f in source_manifest['artifacts'] if f not in {name+'.bin' for name in mats}]
for f in [*unchanged_artifacts,'reference.npz']:
 if not(out/f).exists():os.link(src/f,out/f)
s=(p/'aligned/GRU2BatchCheckedModel.sol').read_text();s=s.replace('),1024) shiftedSum',') ) shiftedSum') if False else s
s=s.replace('let value:=add(signextend(1,mload(add(v,shl(5,add(offset,i))))),1024)','let value:=signextend(1,mload(add(v,shl(5,add(offset,i)))))')
# Unrolled prepare has value expressions that differ only at the indexed address.
import re
s=re.sub(r'let value:=add\((signextend\(1,mload\(add\(v,mul\(add\((?:base|off),\d+\),32\)\)\)\)),1024\)',r'let value:=\1',s)
s=s.replace('packedValue:=or(packedValue,','packedValue:=add(packedValue,').replace('packed:=or(packed,','packed:=add(packed,')
# Drop bias correction: centered packing directly yields dot product.
s=s.replace('sum:=sub(sub(sum,mul(mload(add(weights,1280)),shiftedSum)),mul(1024,mload(add(weights,1248))))','')
s=s.replace('total:=sub(sub(total,mul(mload(add(weights,1280)),shiftedSum)),mul(1024,mload(add(weights,1248))))','')
def blocks(dest,schedule):
 pos=0;result=''
 for n in schedule:
  result+='{ let acc:=0\n'
  for k in range(pos,pos+n): result+=f'acc:=add(acc,mul(mload(add(values,{k*32})),mload(add(weights,{k*32}))))\n'
  result+=f'{dest}:=add({dest},sub(xor(and(shr(225,add(acc,0x100000000000000000000000000000000000000000000000000000000)),0x1ffffff),0x1000000),0x1000000)) }}\n';pos+=n
 return result
# 1 <<224 encoded independently to guard editing mistakes.
roundhex=hex(1<<224)
for func,dest,schedule in [(' function _dot(', 'sum',[26,13]),('   function dot(', 'total',[19,20])]:
 start=s.index(func);a=s.index('{ let acc:=0',start);b=s.index('\n   }',a) if dest=='total' else s.index('}}\n',a)
 # End after final unrolled extraction brace, identified by the following blank final correction location.
 marker='\n   }' if dest=='total' else '\n}}'
 # Directly locate last old extraction based on fixed tail source.
 oldend=s.index('sum:=add(sum,and(shr(225,acc),0x1ffffff)) }',a)+len('sum:=add(sum,and(shr(225,acc),0x1ffffff)) }') if dest=='sum' else s.index('total:=add(total,and(shr(225,acc),0x1ffffff)) }',a)+len('total:=add(total,and(shr(225,acc),0x1ffffff)) }')
 # There are multiple extraction blocks; take last before next function or variables.
 limit=s.index(' function _gru(',start) if dest=='sum' else s.index('   let a:=add(packedA',start)
 search=s[a:limit];pat=f'{dest}:=add({dest},and(shr(225,acc),0x1ffffff)) }}';oldend=a+search.rindex(pat)+len(pat)
 s=s[:a]+blocks(dest,schedule).replace('0x100000000000000000000000000000000000000000000000000000000',roundhex)+s[oldend:]
s=s.replace('GH0ST_GRU2_SIMD10_BITS25_ALIGNED18_H384_Q10_LOCAL_V1','GH0ST_GRU2_SIGNED10_BITS25_ALIGNED18_H384_Q10_LOCAL_V1')
(out/'GRU2BatchCheckedModel.sol').write_text(s)
m=json.loads((p/'aligned/manifest.json').read_text());m['artifacts'].update({(name+'.bin'):{'bytes':(out/(name+'.bin')).stat().st_size,'sha256':x['sha256']}for name,x in report['matrices'].items()});m['source_sha256']=hashlib.sha256(s.encode()).hexdigest();m['model_domain']='GH0ST_GRU2_SIGNED10_BITS25_ALIGNED18_H384_Q10_LOCAL_V1';m['scope']='Exact signed polynomial representation; Q10 weights and model semantics unchanged';m['packing']='10 signed lanes x 25 bits; GRU accumulation schedule 19+20, head schedule 26+13; nearest coefficient extraction; 18 core rows per 24000-byte shard';(out/'manifest.json').write_text(json.dumps(m,indent=2)+'\n');report['sourceSha256']=m['source_sha256'];report['status']='PASS_SCALAR_PARITY';report['cpuCases']=sum(x['scalarParityCases']for x in report['matrices'].values());(p/'signed-proof.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
