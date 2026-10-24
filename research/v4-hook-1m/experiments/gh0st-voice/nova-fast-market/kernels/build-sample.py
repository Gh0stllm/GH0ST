from pathlib import Path
p=Path(__file__).parent
s=(p/'assembly-table.sol').read_text()
a=s.index(' function _sample(')
b=s.index(' function word(',a)
s=s[:a]+''' function _sample(int256[197] memory scores,uint256 start,uint256 count,uint256 temperature,uint256 entropy) private pure returns(uint256 result) {
  bytes memory t=EXP_Q32;
  uint256[] memory weights=new uint256[](count);
  assembly("memory-safe") {
   let source:=add(scores,mul(start,32))
   let maximum:=mload(source)
   for {let i:=1}lt(i,count){i:=add(i,1)} {
    let value:=mload(add(source,mul(i,32)))
    if sgt(value,maximum) {maximum:=value}
   }
   let total:=0
   let dest:=add(weights,32)
   for {let i:=0}lt(i,count){i:=add(i,1)} {
    let index:=div(add(div(mul(sub(maximum,mload(add(source,mul(i,32)))),1024),temperature),32),64)
    if gt(index,256){index:=256}
    let weight:=shr(192,mload(add(add(t,32),mul(index,8))))
    mstore(add(dest,mul(i,32)),weight)
    total:=add(total,weight)
   }
   let draw:=mod(entropy,total)
   result:=count
   for {let i:=0}lt(i,count){i:=add(i,1)} {
    let weight:=mload(add(dest,mul(i,32)))
    if lt(draw,weight){result:=i break}
    draw:=sub(draw,weight)
   }
  }
  if(result==count) revert InvalidInput();
 }
'''+s[b:]
(p/'assembly-sample.sol').write_text(s)
