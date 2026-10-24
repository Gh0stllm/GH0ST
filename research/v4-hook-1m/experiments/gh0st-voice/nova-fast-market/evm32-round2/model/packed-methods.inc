 uint256 public constant PACKED_BATCH_BYTES=7089;
 function _packStep(bytes memory output,uint256 ordinal,uint16 token,uint8 punct,string memory text,int16[768] memory state,int256[197] memory scores) private pure {
  uint256 size=bytes(text).length;
  if(size==0||size>33||token>=8192||punct>4)revert InvalidModel();
  uint256 bad=uint32(InvalidModel.selector);
  assembly("memory-safe"){
   let target:=add(add(output,38),mul(ordinal,2361))
   mstore(target,shl(240,token))
   mstore8(add(target,2),punct)
   mstore8(add(target,3),size)
   mcopy(add(target,4),add(text,32),size)
   for{let j:=0}lt(j,768){j:=add(j,1)}{
    let v:=mload(add(state,mul(j,32)))
    if gt(add(v,1024),2048){mstore(0,shl(224,bad))revert(0,4)}
    mstore(add(add(target,37),mul(j,2)),shl(240,v))
   }
   for{let j:=0}lt(j,197){j:=add(j,1)}{
    let v:=mload(add(scores,mul(j,32)))
    if iszero(eq(signextend(3,v),v)){mstore(0,shl(224,bad))revert(0,4)}
    mstore(add(add(target,1573),mul(j,4)),shl(224,v))
   }
  }
 }
 struct PackedInput {uint16 previous;uint8 previousPunct;int16[768] state;int32[6] features;bytes32 seed;uint256 wordIndex;uint16 temperature;}
 struct PackedWord {uint16 token;uint8 punct;string text;bool terminal;}
 function stepBatchPacked(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature,uint8 maxWords)external view returns(bytes memory){
  _validate(previous,previousPunct,state,features,temperature);
  if(maxWords==0||maxWords>3||wordIndex>type(uint256).max-(maxWords-1))revert InvalidInput();
  return _packed(PackedInput(previous,previousPunct,state,features,seed,wordIndex,temperature),maxWords);
 }
 function _packed(PackedInput memory p,uint8 maxWords)private view returns(bytes memory output){
  // Extra physical tail keeps the last overlapping mstore within owned memory.
  output=new bytes(PACKED_BATCH_BYTES+32);
  assembly("memory-safe"){mstore(add(output,32),shl(224,0x4e563031))}
  Scratch memory scratch=_scratch();int16[768] memory next;int256[197] memory scores;
  uint8 count;PackedWord memory g;
  for(uint8 i;i<maxWords;++i){
   (g.token,g.punct,g.text,g.terminal)=_step(p.previous,p.previousPunct,p.state,p.features,p.seed,p.wordIndex+i,p.temperature,scratch,next,scores);
   _packStep(output,i,g.token,g.punct,g.text,next,scores);
   p.previous=g.token;p.previousPunct=g.punct;count=i+1;
   int16[768] memory old=p.state;p.state=next;next=old;
   if(g.terminal)break;
  }
  bool terminal=g.terminal;
  assembly("memory-safe"){
   mstore8(add(output,36),count)
   mstore8(add(output,37),terminal)
   mstore(output,7089)
  }
 }
