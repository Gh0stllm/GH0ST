// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Exact signed-polynomial dot product; no per-weight-group bias correction.
/// @dev Research kernel only. Valid only for the pinned F6B1 export and int16 inputs.
contract SixBitMul {
    error InvalidInput();
    function dot(address shard, bytes calldata x, uint256 rows, uint256 cols)
        external view returns (int256[] memory out) {
        if (rows==0 || rows>64 || cols==0 || cols>1024 || cols%64!=0 || x.length!=cols*2) revert InvalidInput();
        uint256 size=shard.code.length;
        if (size<17 || size>98304) revert InvalidInput();
        bytes memory w=new bytes(size-1);
        assembly ("memory-safe") { extcodecopy(shard,add(w,32),1,sub(size,1)) }
        uint256 g=rows*cols/64;
        uint256 bits=uint8(w[12])+uint8(w[13]);
        if (bytes4(w)!=0x46364231 || uint8(w[12])==0 || uint8(w[13])==0 || uint8(w[12])>16 || uint8(w[13])>16 || w.length!=16+(g*bits+7)/8+g*48) revert InvalidInput();
        uint256 declared;
        assembly ("memory-safe") { declared := and(shr(192,mload(add(w,32))),0xffffffff) }
        if (declared!=g) revert InvalidInput();
        out=new int256[](rows);
        // 9 words per 64 inputs: 8 packed vectors followed by the signed sum.
        uint256[] memory prepared=new uint256[](cols/64*9);
        assembly ("memory-safe") {
            function bf(u) -> v {
                let e := and(shr(7,u),255)
                let m := add(128,and(u,127))
                switch lt(e,110) case 1 { v := shr(sub(110,e),m) } default { v := shl(sub(e,110),m) }
                if and(u,32768) { v := sub(0,v) }
            }
            function affine(wp,gi) -> lo,step {
                let header := mload(wp)
                let hw := byte(13,header)
                let width := add(byte(12,header),hw)
                let b := mul(gi,width)
                let v := and(shr(sub(256,add(and(b,7),width)),mload(add(add(wp,16),shr(3,b)))),sub(shl(width,1),1))
                lo := bf(add(and(shr(176,header),65535),shr(hw,v)))
                let hi := bf(add(and(shr(160,header),65535),and(v,sub(shl(hw,1),1))))
                let d := sub(hi,lo)
                step := div(add(d,31),63)
                if iszero(lt(d,16515072)) {
                    let q := div(d,63)
                    let r := mod(d,63)
                    let radius := 1
                    if iszero(lt(q,524288)) { radius := 2 }
                    if iszero(lt(q,1048576)) { radius := 4 }
                    if and(iszero(lt(r,sub(32,radius))),iszero(gt(r,add(31,radius)))) { step := add(q,and(q,1)) }
                }
                if iszero(step) { step := 1 }
            }
            function wide(p) -> result {
                let v := shr(208,mload(p))
                result := and(mul(v,0x100000000000000000000000001),0xffffff00000000000000000000000000ffffff)
                result := and(mul(result,0x10000000000001),0xfff0000000000000fff0000000000000fff0000000000000fff)
                result := and(mul(result,0x4000001),0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)
            }
            function dot64(cp,pp) -> answer {
                let v := wide(cp)
                let total := mul(v,mload(pp))
                total := add(total,mul(wide(add(cp,6)),mload(add(pp,32))))
                total := add(total,mul(wide(add(cp,12)),mload(add(pp,64))))
                total := add(total,mul(wide(add(cp,18)),mload(add(pp,96))))
                total := add(total,mul(wide(add(cp,24)),mload(add(pp,128))))
                total := add(total,mul(wide(add(cp,30)),mload(add(pp,160))))
                total := add(total,mul(wide(add(cp,36)),mload(add(pp,192))))
                total := add(total,mul(wide(add(cp,42)),mload(add(pp,224))))
                answer := sar(224,add(total,0x80000000000000000000000000000000000000000000000000000000))
            }
            let pp := add(prepared,32)
            for { let gc := 0 } lt(gc,div(cols,64)) { gc := add(gc,1) } {
                let sumx := 0
                for { let b := 0 } lt(b,8) { b := add(b,1) } {
                    let v := xor(shr(128,calldataload(add(x.offset,add(mul(gc,128),mul(b,16))))),0x80008000800080008000800080008000)
                    v := and(or(v,shl(64,v)),0xffffffffffffffff0000000000000000ffffffffffffffff)
                    v := and(or(v,shl(32,v)),0xffffffff00000000ffffffff00000000ffffffff00000000ffffffff)
                    v := and(or(v,shl(16,v)),0xffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff)
                    mstore(add(pp,add(mul(gc,288),mul(b,32))),sub(v,0x800000008000000080000000800000008000000080000000800000008000))
                    sumx := add(sumx,sub(shr(224,mul(v,0x100000001000000010000000100000001000000010000000100000001)),262144))
                }
                mstore(add(pp,add(mul(gc,288),256)),sumx)
            }
            let wp := add(w,32)
            let cp := add(add(wp,16),div(add(mul(g,bits),7),8))
            let groupIndex := 0
            for { let row := 0 } lt(row,rows) { row := add(row,1) } {
                let total := 0
                for { let ap := pp } lt(ap,add(pp,mul(div(cols,64),288))) { ap := add(ap,288) } {
                    let lo,step := affine(wp,groupIndex)
                    total := add(total,add(mul(lo,mload(add(ap,256))),mul(step,dot64(cp,ap))))
                    cp := add(cp,48)
                    groupIndex := add(groupIndex,1)
                }
                mstore(add(add(out,32),mul(row,32)),total)
            }
        }
    }
}
