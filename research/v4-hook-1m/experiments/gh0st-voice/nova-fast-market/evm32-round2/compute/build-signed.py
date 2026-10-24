from pathlib import Path
import re
P=Path(__file__).parent
base=(P.parent/'profile/signed/GRU2BatchCheckedModel.sol').read_text()
feature=(P/'feature-cache.sol').read_text()
head=(P/'head-cache.sol').read_text()

def function(src,marker):
 start=src.index(marker);i=src.index('{',start);depth=1;j=i+1
 while depth:
  if src[j]=='{':depth+=1
  elif src[j]=='}':depth-=1
  j+=1
 return src[start:j]

s=base.replace('bytes sampleTable;uint256[128]', 'bytes sampleTable;bytes featureSums;uint256[128]')
s=s.replace('s.sampleTable=EXP_Q32;}', 's.sampleTable=EXP_Q32;s.featureSums=new bytes(5792);}')
s=s.replace(' function _gru(',function(feature,' function _prepareFeatures(')+'\n function _gru(',1)
s=s.replace('bytes memory row=scratch.row;', 'bytes memory featureSums=scratch.featureSums;bytes memory row=scratch.row;')
s=s.replace('let auxData:=add(aux,32)', 'let auxData:=add(aux,32)\n   let featureData:=add(featureSums,32)')
s=s.replace('featureDot(auxData,i,features)', 'input(featureData,i)').replace('featureDot(auxData,add(384,i),features)', 'input(featureData,add(384,i))').replace('featureDot(auxData,add(768,i),features)', 'input(featureData,add(768,i))')
s=s.replace('Scratch memory scratch=_scratch();','Scratch memory scratch=_scratch();_prepareFeatures(features,scratch);')

# Use signed model's dot-product arithmetic, but switch its head shard loader
# to the checked reusable buffer and use the associated cached-row bias.
dot=function(s,' function _dot(')
cached=function(head,' function _dot(')
lo=dot.index('   let weights:=');hi=dot.index('\n{ let acc:=0',lo)
a=cached.index('   let entry:=');b=cached.index('\n{ let acc:=0',a)
dot=dot[:lo]+cached[a:b]+dot[hi:]
s=s.replace(function(s,' function _dot('),dot,1)
s=s.replace(function(s,' function _headBias('),function(head,' function _headBias('),1)
# Retain signed packed-vector preparation and signed row math; the surrounding
# output-head call structure is otherwise unchanged.
s=s.replace('bytes memory out=scratch.out;bytes memory buffer=scratch.buffer;', 'bytes memory out=scratch.out;bytes memory buffer=scratch.cache;assembly("memory-safe"){mstore(add(buffer,32),0)}')
s=s.replace('_headBias(buffer)*1024','_headBias(buffer,i)*1024',1)
s=s.replace('  for(uint256 i;i<64;++i)', '  assembly("memory-safe"){mstore(add(buffer,32),0)}\n  for(uint256 i;i<64;++i)')
s=s.replace('_headBias(buffer)*1024','_headBias(buffer,group*64+i)*1024',1)
s=s.replace('  for(uint256 i;i<5;++i)', '  assembly("memory-safe"){mstore(add(buffer,32),0)}\n  for(uint256 i;i<5;++i)')
s=s.replace('_headBias(buffer)+_weight(pb,i)','_headBias(buffer,i)+_weight(pb,i)')
s=s.replace('let cacheData:=add(cache,32)', 'let cacheData:=add(cache,32)\n   mstore(cacheData,0)')

# Unroll only the head's packing loop. This uses exactly the signed packing
# implementation of the same candidate, never the unsigned baseline packer.
c=s.index('   function prepare(');d=s.index('   function input(',c)
f=re.sub(r'\bv\b','sourceVector',s[c:d])
r=' function _prepareInto(int16[768] memory v,uint256 offset,bytes memory packedVector)private pure returns(int256 shiftedSum){\n  assembly("memory-safe"){\n'+f+'   shiftedSum:=prepare(v,offset,add(packedVector,32))\n  }\n }'
s=s.replace(function(s,' function _prepareInto('),r,1)
(P/'signed-combined.sol').write_text(s)

# Independently gated zero recurrent-vector fast path.
s=s.replace('function prepare(v,off,d)->total {','function prepare(v,off,d)->total,nonzero {')
s=s.replace('function prepare(sourceVector,off,d)->total {','function prepare(sourceVector,off,d)->total,nonzero {')
s=s.replace('total:=add(total,value) packed:=add(packed,', 'total:=add(total,value) nonzero:=or(nonzero,value) packed:=add(packed,')
s=s.replace('let sumA:=prepare(state,0,a)','let sumA,nonzeroA:=prepare(state,0,a)')
s=s.replace('let sumB:=prepare(state,384,b)','let sumB,nonzeroB:=prepare(state,384,b)')
s=s.replace('let sumC:=prepare(next,0,c)','let sumC,nonzeroC:=prepare(next,0,c)')
s=s.replace('shiftedSum:=prepare(v,offset,add(packedVector,32))','let unused\n   shiftedSum,unused:=prepare(v,offset,add(packedVector,32))')
lo=s.index('    let rr:=sdiv(dot(page,mul(i,1312)');hi=s.index('    let old:=',lo)
chunk=s[lo:hi].replace('let rr:=','rr:=').replace('let rz:=','rz:=').replace('let rn:=','rn:=')
s=s[:lo]+'    let rr:=0 let rz:=0 let rn:=0\n    if nonzeroA {\n'+chunk+'    }\n'+s[hi:]
lo=s.index('    let rr:=sdiv(dot(page,mul(add(2304,i),1312)');hi=s.index('    let idx:=',lo)
chunk=s[lo:hi].replace('let rr:=','rr:=').replace('let rz:=','rz:=').replace('let rn:=','rn:=')
s=s[:lo]+'    let rr:=0 let rz:=0 let rn:=0\n    if nonzeroB {\n'+chunk+'    }\n'+s[hi:]
(P/'signed-combined-zero.sol').write_text(s)

# Detect zero initial state once per batch, rather than extending every vector
# packer with another live accumulator. Later steps conservatively use the full
# recurrent path even if they happen to become exactly zero.
s=(P/'signed-combined.sol').read_text()
s=s.replace('uint256[128] weights;}', 'uint256[128] weights;uint256 zeroMask;}')
helper=''' function _initialZeros(int16[768] memory state)private pure returns(uint256 mask){
  assembly("memory-safe") {
   let a:=0 let b:=0
   for{let i:=0}lt(i,12288){i:=add(i,32)} {
    a:=or(a,mload(add(state,i)))
    b:=or(b,mload(add(add(state,12288),i)))
   }
   mask:=or(iszero(a),shl(1,iszero(b)))
  }
 }
'''
s=s.replace(' function _gru(',helper+' function _gru(',1)
s=s.replace('_prepareFeatures(features,scratch);','_prepareFeatures(features,scratch);scratch.zeroMask=_initialZeros(state);')
s=s.replace('  address page=coreRowsPage;', '  uint256 zeroMask=scratch.zeroMask;scratch.zeroMask=0;\n  address page=coreRowsPage;',1)
lo=s.index('    let rr:=sdiv(dot(page,mul(i,1312)');hi=s.index('    let old:=',lo)
chunk=s[lo:hi].replace('let rr:=','rr:=').replace('let rz:=','rz:=').replace('let rn:=','rn:=')
s=s[:lo]+'    let rr:=0 let rz:=0 let rn:=0\n    if iszero(and(zeroMask,1)) {\n'+chunk+'    }\n'+s[hi:]
lo=s.index('    let rr:=sdiv(dot(page,mul(add(2304,i),1312)');hi=s.index('    let idx:=',lo)
chunk=s[lo:hi].replace('let rr:=','rr:=').replace('let rz:=','rz:=').replace('let rn:=','rn:=')
s=s[:lo]+'    let rr:=0 let rz:=0 let rn:=0\n    if iszero(and(zeroMask,2)) {\n'+chunk+'    }\n'+s[hi:]
(P/'signed-combined-initial.sol').write_text(s)
