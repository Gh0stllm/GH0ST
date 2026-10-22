// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
/// @notice 9-lane synthetic research tile, not full GPT-OSS inference.
/// @dev Exactly 9 rows, <=160 groups, 32 int16 inputs per group, scales [96,160].
///      Per-lane biased product sum <=32*24*65535 <2**26; 26-bit lane fields cannot carry.
///      Per-row scaled signed accumulation <2**96 within the supported domain.
contract LaneMxfp4 {
function tile(bytes calldata frames,bytes calldata x) external pure returns(int256[] memory result){
require(frames.length%153==0);uint256 groups=frames.length/153;
require(groups<=160&&x.length==groups*64);result=new int256[](9);
assembly ("memory-safe"){let frameStart:=frames.offset 
let ones:=0x10000004000001000000400000100000040000010000004000001
for {let g:=0} lt(g,groups) {g:=add(g,1)} {
let base:=add(frameStart,mul(g,153))
let xp:=add(x.offset,mul(g,64))
let sums:=0
let weightsums:=0
let sumx:=0
for {let j:=0} lt(j,32) {j:=add(j,1)} {
let n:=and(shr(sub(220,mul(and(j,1),4)),calldataload(add(base,div(mul(j,9),2)))),0xfffffffff)
n:=and(or(n,shl(176,n)),0xf00000000000000000000000000000000000000000000ffffffff)
n:=and(or(n,shl(88,n)),0xffff0000000000000000000000ffff0000000000000000000000ffff)
n:=and(or(n,shl(44,n)),0xff00000000000ff00000000000ff00000000000ff00000000000ff)
n:=and(or(n,shl(22,n)),0xf000003c00000f000003c00000f000003c00000f000003c00000f)
let m:=and(n,ones)
let e0:=and(shr(1,n),ones)
let e1:=and(shr(2,n),ones)
let neg:=and(shr(3,n),ones)
let highpair:=and(e1,e0)
let mag:=add(and(n,0x7000001c000007000001c000007000001c000007000001c000007),add(and(e1,m),shl(1,add(highpair,and(highpair,m)))))
let weights:=sub(add(0xc000003000000c000003000000c000003000000c000003000000c,mag),shl(1,and(mag,mul(neg,67108863))))
let a:=sar(240,calldataload(add(xp,mul(j,2))))
sumx:=add(sumx,a)
weightsums:=add(weightsums,weights)
sums:=add(sums,mul(weights,add(a,32768)))
}
for {let r:=0} lt(r,9) {r:=add(r,1)} {
let s:=byte(0,calldataload(add(add(base,144),r)))
if or(lt(s,96),gt(s,160)){revert(0,0)}
let shift:=mul(r,26)
let value:=sub(sub(and(shr(shift,sums),67108863),shl(15,and(shr(shift,weightsums),67108863))),mul(12,sumx))
let slot:=add(add(result,32),mul(r,32))
mstore(slot,add(mload(slot),shl(sub(s,96),value)))
}
}}}
function tileCode(address store,bytes32 expectedHash,uint256 groups,bytes calldata x) external view returns(int256[] memory result){
require(groups<=160&&x.length==groups*64&&store.codehash==expectedHash&&expectedHash!=bytes32(0));
bytes memory data=store.code;require(data.length==groups*153+1&&data[0]==bytes1(0));
result=new int256[](9);
assembly ("memory-safe"){let frameStart:=add(data,33) 
let ones:=0x10000004000001000000400000100000040000010000004000001
for {let g:=0} lt(g,groups) {g:=add(g,1)} {
let base:=add(frameStart,mul(g,153))
let xp:=add(x.offset,mul(g,64))
let sums:=0
let weightsums:=0
let sumx:=0
for {let j:=0} lt(j,32) {j:=add(j,1)} {
let n:=and(shr(sub(220,mul(and(j,1),4)),mload(add(base,div(mul(j,9),2)))),0xfffffffff)
n:=and(or(n,shl(176,n)),0xf00000000000000000000000000000000000000000000ffffffff)
n:=and(or(n,shl(88,n)),0xffff0000000000000000000000ffff0000000000000000000000ffff)
n:=and(or(n,shl(44,n)),0xff00000000000ff00000000000ff00000000000ff00000000000ff)
n:=and(or(n,shl(22,n)),0xf000003c00000f000003c00000f000003c00000f000003c00000f)
let m:=and(n,ones)
let e0:=and(shr(1,n),ones)
let e1:=and(shr(2,n),ones)
let neg:=and(shr(3,n),ones)
let highpair:=and(e1,e0)
let mag:=add(and(n,0x7000001c000007000001c000007000001c000007000001c000007),add(and(e1,m),shl(1,add(highpair,and(highpair,m)))))
let weights:=sub(add(0xc000003000000c000003000000c000003000000c000003000000c,mag),shl(1,and(mag,mul(neg,67108863))))
let a:=sar(240,calldataload(add(xp,mul(j,2))))
sumx:=add(sumx,a)
weightsums:=add(weightsums,weights)
sums:=add(sums,mul(weights,add(a,32768)))
}
for {let r:=0} lt(r,9) {r:=add(r,1)} {
let s:=byte(0,mload(add(add(base,144),r)))
if or(lt(s,96),gt(s,160)){revert(0,0)}
let shift:=mul(r,26)
let value:=sub(sub(and(shr(shift,sums),67108863),shl(15,and(shr(shift,weightsums),67108863))),mul(12,sumx))
let slot:=add(add(result,32),mul(r,32))
mstore(slot,add(mload(slot),shl(sub(s,96),value)))
}
}}}
}