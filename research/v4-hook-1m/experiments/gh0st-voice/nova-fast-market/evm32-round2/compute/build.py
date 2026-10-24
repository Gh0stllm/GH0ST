from pathlib import Path
P=Path(__file__).parent
base=(P/'baseline.sol').read_text()

# The feature vector is fixed across every neural step in one batch. Compute its
# exact integer contribution once in compact int40 form; there is no rounding
# here, and the existing SDIV occurs after adding embedding and punctuation.
s=base.replace('bytes sampleTable;uint256[128]', 'bytes sampleTable;bytes featureSums;uint256[128]')
s=s.replace('s.sampleTable=EXP_Q32;}', 's.sampleTable=EXP_Q32;s.featureSums=new bytes(5792);}')
where=' function _gru(int16[768] memory state'
fun=''' function _prepareFeatures(int32[6] memory features,Scratch memory s) private pure {
  bytes memory a=s.aux;bytes memory sums=s.featureSums;
  assembly("memory-safe") {
   let src:=add(a,32) let dst:=add(sums,32)
   let f0:=signextend(3,mload(features))
   let f1:=signextend(3,mload(add(features,32)))
   let f2:=signextend(3,mload(add(features,64)))
   let f3:=signextend(3,mload(add(features,96)))
   let f4:=signextend(3,mload(add(features,128)))
   let f5:=signextend(3,mload(add(features,160)))
   for {let i:=0}lt(i,1152){i:=add(i,1)} {
    let ptr:=add(src,mul(i,12))
    let v:=mul(signextend(1,shr(240,mload(ptr))),f0)
    v:=add(v,mul(signextend(1,shr(240,mload(add(ptr,2)))),f1))
    v:=add(v,mul(signextend(1,shr(240,mload(add(ptr,4)))),f2))
    v:=add(v,mul(signextend(1,shr(240,mload(add(ptr,6)))),f3))
    v:=add(v,mul(signextend(1,shr(240,mload(add(ptr,8)))),f4))
    v:=add(v,mul(signextend(1,shr(240,mload(add(ptr,10)))),f5))
    mstore(add(dst,mul(i,5)),shl(216,v))
   }
  }
 }
'''
s=s.replace(where,fun+where)
s=s.replace('bytes memory row=scratch.row;', 'bytes memory featureSums=scratch.featureSums;bytes memory row=scratch.row;')
s=s.replace('let auxData:=add(aux,32)', 'let auxData:=add(aux,32)\n   let featureData:=add(featureSums,32)')
s=s.replace('featureDot(auxData,i,features)', 'input(featureData,i)').replace('featureDot(auxData,add(384,i),features)', 'input(featureData,add(384,i))').replace('featureDot(auxData,add(768,i),features)', 'input(featureData,add(768,i))')
s=s.replace('Scratch memory scratch=_scratch();','Scratch memory scratch=_scratch();_prepareFeatures(features,scratch);')
(P/'feature-cache.sol').write_text(s)

# Reuse a core scratch slot for head shards after the GRU has completed. Reset
# its cache tag when switching catalog to prevent identical-index aliasing.
s=base
start=s.index(' function _dot(address ');end=s.index('\n\n function _gru',start)
old=s[start:end]
new=old.replace('uint256 offset=row*stride;', 'uint256 offset=row*stride;').replace('let weights:=add(buffer,32) let values:=add(vector,32)', 'let entry:=add(buffer,32) let values:=add(vector,32)\n   let index:=div(offset,24000) let inside:=mod(offset,24000)\n   let data:=add(entry,32)\n   if iszero(eq(mload(entry),add(index,1))) {\n    extcodecopy(page,0,add(1,mul(index,20)),20)\n    extcodecopy(shr(96,mload(0)),data,1,24000)\n    mstore(entry,add(index,1))\n   }\n   if gt(add(inside,stride),24000) {\n    extcodecopy(page,0,add(1,mul(add(index,1),20)),20)\n    extcodecopy(shr(96,mload(0)),add(data,24000),1,sub(add(inside,stride),24000))\n   }\n   let weights:=add(data,inside)')
lo=new.index('   let destination:=weights');hi=new.index('\n{ let acc:=0',lo)
new=new[:lo]+new[hi:]
s=s[:start]+new+s[end:]
# Cached head bias comes from the active row's logical offset in cached shard.
s=s.replace('function _headBias(bytes memory d)private pure returns(int256 v){assembly("memory-safe"){v:=mload(add(add(d,32),1312))}}', 'function _headBias(bytes memory d,uint256 row)private pure returns(int256 v){assembly("memory-safe"){v:=mload(add(add(add(d,64),mod(mul(row,1344),24000)),1312))}}')
s=s.replace('bytes memory out=scratch.out;bytes memory buffer=scratch.buffer;', 'bytes memory out=scratch.out;bytes memory buffer=scratch.cache;assembly("memory-safe"){mstore(add(buffer,32),0)}')
s=s.replace('_headBias(buffer)*1024','_headBias(buffer,i)*1024',1)
s=s.replace('  for(uint256 i;i<64;++i)', '  assembly("memory-safe"){mstore(add(buffer,32),0)}\n  for(uint256 i;i<64;++i)')
s=s.replace('_headBias(buffer)*1024','_headBias(buffer,group*64+i)*1024',1)
s=s.replace('  for(uint256 i;i<5;++i)', '  assembly("memory-safe"){mstore(add(buffer,32),0)}\n  for(uint256 i;i<5;++i)')
s=s.replace('_headBias(buffer)+_weight(pb,i)','_headBias(buffer,i)+_weight(pb,i)')
s=s.replace('let cacheData:=add(cache,32)', 'let cacheData:=add(cache,32)\n   mstore(cacheData,0)')
(P/'head-cache.sol').write_text(s)

# Exact zero-state fast path. The OR checks every original activation; a zero
# flag is therefore an iff test, not a sum-based heuristic. Zero recurrent
# vectors have zero dot products regardless of the (unchanged) model weights.
s=base
s=s.replace('function prepare(v,off,d)->total {','function prepare(v,off,d)->total,nonzero {')
s=s.replace('total:=add(total,value) packed:=or(packed,', 'total:=add(total,value) nonzero:=or(nonzero,sub(value,1024)) packed:=or(packed,')
s=s.replace('let sumA:=prepare(state,0,a)','let sumA,nonzeroA:=prepare(state,0,a)')
s=s.replace('let sumB:=prepare(state,384,b)','let sumB,nonzeroB:=prepare(state,384,b)')
s=s.replace('let sumC:=prepare(next,0,c)','let sumC,nonzeroC:=prepare(next,0,c)')
lo=s.index('    let rr:=sdiv(dot(page,mul(i,1312)');hi=s.index('    let old:=',lo)
chunk=s[lo:hi]
chunk=chunk.replace('let rr:=','rr:=').replace('let rz:=','rz:=').replace('let rn:=','rn:=')
s=s[:lo]+'    let rr:=0 let rz:=0 let rn:=0\n    if nonzeroA {\n'+chunk+'    }\n'+s[hi:]
lo=s.index('    let rr:=sdiv(dot(page,mul(add(2304,i),1312)');hi=s.index('    let idx:=',lo)
chunk=s[lo:hi]
chunk=chunk.replace('let rr:=','rr:=').replace('let rz:=','rz:=').replace('let rn:=','rn:=')
s=s[:lo]+'    let rr:=0 let rz:=0 let rn:=0\n    if nonzeroB {\n'+chunk+'    }\n'+s[hi:]
(P/'zero-state.sol').write_text(s)

# Unroll the independent output-head vector packing loop exactly as the GRU's.
s=base
a=s.index(' function _prepareInto(');b=s.index(' function _dot(',a)
c=s.index('   function prepare(');d=s.index('   function input(',c)
import re
f=re.sub(r'\bv\b','sourceVector',s[c:d])
r=' function _prepareInto(int16[768] memory v,uint256 offset,bytes memory packedVector)private pure returns(int256 shiftedSum){\n  assembly(\"memory-safe\"){\n'+f+'   shiftedSum:=prepare(v,offset,add(packedVector,32))\n  }\n }\n'
s=s[:a]+r+s[b:]
(P/'unroll-head-prepare.sol').write_text(s)

def function(src,marker):
 start=src.index(marker);i=src.index('{',start);depth=1;j=i+1
 while depth:
  if src[j]=='{':depth+=1
  elif src[j]=='}':depth-=1
  j+=1
 return src[start:j]
def replace_fun(dst,src,marker):
 return dst.replace(function(dst,marker),function(src,marker),1)
s=(P/'feature-cache.sol').read_text()
head=(P/'head-cache.sol').read_text()
for marker in [' function _dot(', ' function _headBias(', ' function _step(']:
 s=replace_fun(s,head,marker)
s=s.replace('let cacheData:=add(cache,32)', 'let cacheData:=add(cache,32)\n   mstore(cacheData,0)')
unroll=(P/'unroll-head-prepare.sol').read_text()
s=replace_fun(s,unroll,' function _prepareInto(')
(P/'combined.sol').write_text(s)

s=s.replace('function prepare(v,off,d)->total {','function prepare(v,off,d)->total,nonzero {')
s=s.replace('total:=add(total,value) packed:=or(packed,', 'total:=add(total,value) nonzero:=or(nonzero,sub(value,1024)) packed:=or(packed,')
s=s.replace('let sumA:=prepare(state,0,a)','let sumA,nonzeroA:=prepare(state,0,a)')
s=s.replace('let sumB:=prepare(state,384,b)','let sumB,nonzeroB:=prepare(state,384,b)')
s=s.replace('let sumC:=prepare(next,0,c)','let sumC,nonzeroC:=prepare(next,0,c)')
# The public head-vector helper also contains prepare(), so consume its second
# return explicitly; allzero tracking there is dead and optimized away.
s=s.replace('shiftedSum:=prepare(v,offset,add(packedVector,32))','let unused\n   shiftedSum,unused:=prepare(v,offset,add(packedVector,32))')
lo=s.index('    let rr:=sdiv(dot(page,mul(i,1312)');hi=s.index('    let old:=',lo)
chunk=s[lo:hi].replace('let rr:=','rr:=').replace('let rz:=','rz:=').replace('let rn:=','rn:=')
s=s[:lo]+'    let rr:=0 let rz:=0 let rn:=0\n    if nonzeroA {\n'+chunk+'    }\n'+s[hi:]
lo=s.index('    let rr:=sdiv(dot(page,mul(add(2304,i),1312)');hi=s.index('    let idx:=',lo)
chunk=s[lo:hi].replace('let rr:=','rr:=').replace('let rz:=','rz:=').replace('let rn:=','rn:=')
s=s[:lo]+'    let rr:=0 let rz:=0 let rn:=0\n    if nonzeroB {\n'+chunk+'    }\n'+s[hi:]
s=s.replace('function prepare(sourceVector,off,d)->total {', 'function prepare(sourceVector,off,d)->total,nonzero {')
(P/'combined-zero.sol').write_text(s)
