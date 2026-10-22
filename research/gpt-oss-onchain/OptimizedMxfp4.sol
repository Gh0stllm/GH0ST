// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
/// @notice Synthetic-fixture research kernel; no full-model inference.
/// @dev Signed-int16 operands; exact Q32 dyadic arithmetic, scales [96,160], <=4096 groups.
contract OptimizedMxfp4 {
function packed(bytes calldata w,bytes calldata scales,bytes calldata x) external pure returns(int256 result) {
require(w.length%16==0 && scales.length==w.length/16 && x.length==w.length*4 && scales.length<=4096);
assembly ("memory-safe") {
let lut:=0x000102030406080c00fffefdfcfaf8f400000000000000000000000000000000
for {let g:=0} lt(g,scales.length) {g:=add(g,1)} {
let s:=byte(0,calldataload(add(scales.offset,g)))
if or(lt(s,96),gt(s,160)) {revert(0,0)}
let wp:=add(w.offset,mul(g,16))
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
result:=add(result,shl(sub(s,96),dot))
}
}
}
}
