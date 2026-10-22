// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
/// @notice Eight-lane synthetic research tile, not full GPT-OSS inference.
/// @dev Exactly 8 rows, <=180 groups, 32 int16 inputs per group, scales [96,160].
///      Per-lane biased product sum <=32*24*65535 <2**26; 32-bit lane fields cannot carry.
///      Per-row scaled signed accumulation <2**96 within the supported domain.
contract LaneMxfp4 {
function tile(bytes calldata frames,bytes calldata x) external pure returns(int256[] memory result){
require(frames.length%136==0);uint256 groups=frames.length/136;
require(groups<=180&&x.length==groups*64);result=new int256[](8);
assembly ("memory-safe"){let frameStart:=frames.offset 
let ones:=0x100000001000000010000000100000001000000010000000100000001
for {let g:=0} lt(g,groups) {g:=add(g,1)} {
let base:=add(frameStart,mul(g,136))
let xp:=add(x.offset,mul(g,64))
let sums:=0
let weightsums:=0
let sumx:=0
for {let j:=0} lt(j,32) {j:=add(j,1)} {
let n:=shr(224,calldataload(add(base,mul(j,4))))
n:=and(or(n,shl(112,n)),0xffff0000000000000000000000000000ffff)
n:=and(or(n,shl(56,n)),0xff00000000000000ff00000000000000ff00000000000000ff)
n:=and(or(n,shl(28,n)),0xf0000000f0000000f0000000f0000000f0000000f0000000f0000000f)
let m:=and(n,ones)
let e0:=and(shr(1,n),ones)
let e1:=and(shr(2,n),ones)
let neg:=and(shr(3,n),ones)
let b0:=and(m,xor(e1,ones))
let b1:=or(and(xor(e1,ones),e0),and(and(e1,xor(e0,ones)),m))
let b2:=and(e1,or(xor(e0,ones),m))
let b3:=and(e1,e0)
let mag:=or(or(b0,shl(1,b1)),or(shl(2,b2),shl(3,b3)))
let weights:=sub(add(0xc0000000c0000000c0000000c0000000c0000000c0000000c0000000c,mag),shl(1,and(mag,mul(neg,0xffffffff))))
let a:=sar(240,calldataload(add(xp,mul(j,2))))
sumx:=add(sumx,a)
weightsums:=add(weightsums,weights)
sums:=add(sums,mul(weights,add(a,32768)))
}
for {let r:=0} lt(r,8) {r:=add(r,1)} {
let s:=byte(0,calldataload(add(add(base,128),r)))
if or(lt(s,96),gt(s,160)){revert(0,0)}
let shift:=mul(r,32)
let value:=sub(sub(and(shr(shift,sums),0xffffffff),shl(15,and(shr(shift,weightsums),0xffffffff))),mul(12,sumx))
let slot:=add(add(result,32),shift)
mstore(slot,add(mload(slot),shl(sub(s,96),value)))
}
}}}
function tileCode(address store,bytes32 expectedHash,uint256 groups,bytes calldata x) external view returns(int256[] memory result){
require(groups<=180&&x.length==groups*64&&store.codehash==expectedHash&&expectedHash!=bytes32(0));
bytes memory data=store.code;require(data.length==groups*136+1&&data[0]==bytes1(0));
result=new int256[](8);
assembly ("memory-safe"){let frameStart:=add(data,33) 
let ones:=0x100000001000000010000000100000001000000010000000100000001
for {let g:=0} lt(g,groups) {g:=add(g,1)} {
let base:=add(frameStart,mul(g,136))
let xp:=add(x.offset,mul(g,64))
let sums:=0
let weightsums:=0
let sumx:=0
for {let j:=0} lt(j,32) {j:=add(j,1)} {
let n:=shr(224,mload(add(base,mul(j,4))))
n:=and(or(n,shl(112,n)),0xffff0000000000000000000000000000ffff)
n:=and(or(n,shl(56,n)),0xff00000000000000ff00000000000000ff00000000000000ff)
n:=and(or(n,shl(28,n)),0xf0000000f0000000f0000000f0000000f0000000f0000000f0000000f)
let m:=and(n,ones)
let e0:=and(shr(1,n),ones)
let e1:=and(shr(2,n),ones)
let neg:=and(shr(3,n),ones)
let b0:=and(m,xor(e1,ones))
let b1:=or(and(xor(e1,ones),e0),and(and(e1,xor(e0,ones)),m))
let b2:=and(e1,or(xor(e0,ones),m))
let b3:=and(e1,e0)
let mag:=or(or(b0,shl(1,b1)),or(shl(2,b2),shl(3,b3)))
let weights:=sub(add(0xc0000000c0000000c0000000c0000000c0000000c0000000c0000000c,mag),shl(1,and(mag,mul(neg,0xffffffff))))
let a:=sar(240,calldataload(add(xp,mul(j,2))))
sumx:=add(sumx,a)
weightsums:=add(weightsums,weights)
sums:=add(sums,mul(weights,add(a,32768)))
}
for {let r:=0} lt(r,8) {r:=add(r,1)} {
let s:=byte(0,mload(add(add(base,128),r)))
if or(lt(s,96),gt(s,160)){revert(0,0)}
let shift:=mul(r,32)
let value:=sub(sub(and(shr(shift,sums),0xffffffff),shl(15,and(shr(shift,weightsums),0xffffffff))),mul(12,sumx))
let slot:=add(add(result,32),shift)
mstore(slot,add(mload(slot),shl(sub(s,96),value)))
}
}}}
}