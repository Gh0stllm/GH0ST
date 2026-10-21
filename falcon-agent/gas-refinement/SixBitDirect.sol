// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Exact signed-polynomial dot product; no per-weight-group bias correction.
/// @dev Research kernel only. Valid only for the pinned F6B1 export and int16 inputs.
contract SixBitDirect {
    error InvalidInput();
    function dot(address shard, bytes calldata x, uint256 rows, uint256 cols)
        external view returns (int256[] memory out) {
        if (rows==0 || rows>64 || cols==0 || cols>1024 || cols%64!=0 || x.length!=cols*2) revert InvalidInput();
        uint256 size=shard.code.length;
        if (size<17 || size>98304) revert InvalidInput();
        bytes memory w=new bytes(size-1);
        assembly ("memory-safe") { extcodecopy(shard,add(w,32),1,sub(size,1)) }
        uint256 g=rows*cols/64;
        uint256 bits=uint8(w[12])*8;
        if (bytes4(w)!=0x46364431 || (uint8(w[12])!=4 && uint8(w[12])!=5) || w.length!=16+g*uint8(w[12])+g*48) revert InvalidInput();
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
                let stride := byte(12,header)
                let v := shr(sub(256,mul(stride,8)),mload(add(add(wp,16),mul(gi,stride))))
                lo := bf(add(and(shr(176,header),65535),shr(21,v)))
                step := and(v,2097151)
            }
            function wide(p) -> result {
                let v := shr(208,mload(p))
                result := and(mul(v,0x100000000000000000000000001),0xffffff00000000000000000000000000ffffff)
                result := and(mul(result,0x10000000000001),0xfff0000000000000fff0000000000000fff0000000000000fff)
                result := and(mul(result,0x4000001),0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)
            }
            function dot64(cp,pp) -> answer {
                let total := 0
                {
                    let v := shr(208,mload(add(cp,0)))
                    v := and(mul(v,0x100000000000000000000000001),0xffffff00000000000000000000000000ffffff)
                    v := and(mul(v,0x10000000000001),0xfff0000000000000fff0000000000000fff0000000000000fff)
                    v := and(mul(v,0x4000001),0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)
                    total := add(total,mul(v,mload(add(pp,0))))
                }
                {
                    let v := shr(208,mload(add(cp,6)))
                    v := and(mul(v,0x100000000000000000000000001),0xffffff00000000000000000000000000ffffff)
                    v := and(mul(v,0x10000000000001),0xfff0000000000000fff0000000000000fff0000000000000fff)
                    v := and(mul(v,0x4000001),0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)
                    total := add(total,mul(v,mload(add(pp,32))))
                }
                {
                    let v := shr(208,mload(add(cp,12)))
                    v := and(mul(v,0x100000000000000000000000001),0xffffff00000000000000000000000000ffffff)
                    v := and(mul(v,0x10000000000001),0xfff0000000000000fff0000000000000fff0000000000000fff)
                    v := and(mul(v,0x4000001),0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)
                    total := add(total,mul(v,mload(add(pp,64))))
                }
                {
                    let v := shr(208,mload(add(cp,18)))
                    v := and(mul(v,0x100000000000000000000000001),0xffffff00000000000000000000000000ffffff)
                    v := and(mul(v,0x10000000000001),0xfff0000000000000fff0000000000000fff0000000000000fff)
                    v := and(mul(v,0x4000001),0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)
                    total := add(total,mul(v,mload(add(pp,96))))
                }
                {
                    let v := shr(208,mload(add(cp,24)))
                    v := and(mul(v,0x100000000000000000000000001),0xffffff00000000000000000000000000ffffff)
                    v := and(mul(v,0x10000000000001),0xfff0000000000000fff0000000000000fff0000000000000fff)
                    v := and(mul(v,0x4000001),0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)
                    total := add(total,mul(v,mload(add(pp,128))))
                }
                {
                    let v := shr(208,mload(add(cp,30)))
                    v := and(mul(v,0x100000000000000000000000001),0xffffff00000000000000000000000000ffffff)
                    v := and(mul(v,0x10000000000001),0xfff0000000000000fff0000000000000fff0000000000000fff)
                    v := and(mul(v,0x4000001),0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)
                    total := add(total,mul(v,mload(add(pp,160))))
                }
                {
                    let v := shr(208,mload(add(cp,36)))
                    v := and(mul(v,0x100000000000000000000000001),0xffffff00000000000000000000000000ffffff)
                    v := and(mul(v,0x10000000000001),0xfff0000000000000fff0000000000000fff0000000000000fff)
                    v := and(mul(v,0x4000001),0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)
                    total := add(total,mul(v,mload(add(pp,192))))
                }
                {
                    let v := shr(208,mload(add(cp,42)))
                    v := and(mul(v,0x100000000000000000000000001),0xffffff00000000000000000000000000ffffff)
                    v := and(mul(v,0x10000000000001),0xfff0000000000000fff0000000000000fff0000000000000fff)
                    v := and(mul(v,0x4000001),0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)
                    total := add(total,mul(v,mload(add(pp,224))))
                }
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
