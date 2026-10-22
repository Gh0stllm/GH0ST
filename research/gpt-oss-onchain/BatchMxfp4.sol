// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
/// @notice Research matrix-vector kernel; synthetic tests only.
/// @dev Rows <=64; groups <=4096. Q32 dyadic arithmetic, int16 inputs, scales [96,160].
contract BatchMxfp4 {
function matvec(bytes calldata w,bytes calldata scales,bytes calldata x,uint256 rows) external pure returns(int256[] memory result){
require(rows>0&&rows<=64&&x.length%64==0);
uint256 groups=x.length/64;
require(groups<=4096&&scales.length==rows*groups&&w.length==scales.length*16);
result=new int256[](rows);
assembly ("memory-safe") {let lut:=0x000102030406080c00fffefdfcfaf8f400000000000000000000000000000000
for {let r:=0} lt(r,rows) {r:=add(r,1)} {let sum:=0
for {let g:=0} lt(g,groups) {g:=add(g,1)} {let index:=add(mul(r,groups),g)
let s:=byte(0,calldataload(add(scales.offset,index)))
if or(lt(s,96),gt(s,160)){revert(0,0)}
let wp:=add(w.offset,mul(index,16))
let xp:=add(x.offset,mul(g,64))
let dot:=0
for {let p:=0} lt(p,2) {p:=add(p,1)} { let ww:=calldataload(add(wp,mul(p,8)))
 let xx:=calldataload(add(xp,mul(p,32)))
  { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 }
sum:=add(sum,shl(sub(s,96),dot))}
mstore(add(add(result,32),mul(r,32)),sum)}}}

/// @dev Immutable code data starts with STOP, then [16 packed bytes, 1 scale] per group.
function matvecCode(address weightStore,bytes32 expectedHash,uint256 groups,uint256 rows,bytes calldata x) external view returns(int256[] memory result){
require(rows>0&&rows<=64&&groups<=4096&&x.length==groups*64);
require(weightStore.codehash==expectedHash&&expectedHash!=bytes32(0));
bytes memory data=weightStore.code;
require(data.length==rows*groups*17+1&&data[0]==bytes1(0));
result=new int256[](rows);
assembly ("memory-safe") {let lut:=0x000102030406080c00fffefdfcfaf8f400000000000000000000000000000000
for {let r:=0} lt(r,rows) {r:=add(r,1)} {let sum:=0
for {let g:=0} lt(g,groups) {g:=add(g,1)} {let index:=add(mul(r,groups),g)
let wp:=add(add(data,33),mul(index,17))
let s:=byte(0,mload(add(wp,16)))
if or(lt(s,96),gt(s,160)){revert(0,0)}
let xp:=add(x.offset,mul(g,64))
let dot:=0
for {let p:=0} lt(p,2) {p:=add(p,1)} { let ww:=mload(add(wp,mul(p,8)))
 let xx:=calldataload(add(xp,mul(p,32)))
  { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 { let b := byte(0,ww)
 dot := add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,xx)),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
 ww := shl(8,ww)
 xx := shl(32,xx) }
 }
sum:=add(sum,shl(sub(s,96),dot))}
mstore(add(add(result,32),mul(r,32)),sum)}}}
}
