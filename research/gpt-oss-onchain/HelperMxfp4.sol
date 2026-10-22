// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract OptimizedMxfp4 {function packed(bytes calldata w,bytes calldata scales,bytes calldata x) external pure returns(int256 result) {require(w.length%16==0&&scales.length==w.length/16&&x.length==w.length*4&&scales.length<=4096);
assembly ("memory-safe") {function dot8(ww,xx)->dot { let lut:=0x000102030406080c00fffefdfcfaf8f400000000000000000000000000000000

{let b:=byte(0,ww)
dot:=add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,shl(0,xx))),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(16,xx)))))
}
{let b:=byte(1,ww)
dot:=add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,shl(32,xx))),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(48,xx)))))
}
{let b:=byte(2,ww)
dot:=add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,shl(64,xx))),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(80,xx)))))
}
{let b:=byte(3,ww)
dot:=add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,shl(96,xx))),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(112,xx)))))
}
{let b:=byte(4,ww)
dot:=add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,shl(128,xx))),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(144,xx)))))
}
{let b:=byte(5,ww)
dot:=add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,shl(160,xx))),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(176,xx)))))
}
{let b:=byte(6,ww)
dot:=add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,shl(192,xx))),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(208,xx)))))
}
{let b:=byte(7,ww)
dot:=add(dot,add(mul(signextend(0,byte(and(b,15),lut)),sar(240,shl(224,xx))),mul(signextend(0,byte(shr(4,b),lut)),sar(240,shl(240,xx)))))
}


}
for {let g:=0} lt(g,scales.length) {g:=add(g,1)} {let s:=byte(0,calldataload(add(scales.offset,g)))
if or(lt(s,96),gt(s,160)) {revert(0,0)}
let wp:=add(w.offset,mul(g,16))
let xp:=add(x.offset,mul(g,64))
let dot:=add(dot8(calldataload(wp),calldataload(xp)),dot8(calldataload(add(wp,8)),calldataload(add(xp,32))))
result:=add(result,shl(sub(s,96),dot))}}}}