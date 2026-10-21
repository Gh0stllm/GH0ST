// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import "./LfmBlock.sol";

/// @notice Exact six-lane dot products with multiplication-based nibble spreading.
/// @dev Bias corrections are accumulated once per row. Unsigned 40-bit lanes
///      cannot carry between coefficients within a six-term product. Summed
///      weight lanes remain below 2^40 for at most 2560 input columns.
contract LfmBlockFast6U16 is LfmBlock {
    constructor(address[] memory data) LfmBlock(data) {}

    function _project(bytes memory x, bytes memory weights, uint256 rows, uint256 cols)
        internal pure override returns (bytes memory out)
    {
        uint256 groups = cols / 6;
        uint256[] memory packed = new uint256[](groups);
        int256 correction;
        assembly ("memory-safe") {
            let xp := add(x,32)
            let ap := add(packed,32)
            for { let g := 0 } lt(g,groups) { g := add(g,1) } {
                let word := mload(add(xp,mul(g,24)))
                let a := xor(shr(224,word),0x80000000)
                let b := xor(and(shr(192,word),0xffffffff),0x80000000)
                let c := xor(and(shr(160,word),0xffffffff),0x80000000)
                let d := xor(and(shr(128,word),0xffffffff),0x80000000)
                let e := xor(and(shr(96,word),0xffffffff),0x80000000)
                let f := xor(and(shr(64,word),0xffffffff),0x80000000)
                let offset := mul(g,32)
                mstore(add(ap,offset),or(or(or(a,shl(40,b)),or(shl(80,c),shl(120,d))),or(shl(160,e),shl(200,f))))
                correction := add(correction,sub(0x1800000000,shl(3,add(add(add(a,b),add(c,d)),add(e,f)))))
            }
        }
        out = new bytes(rows * 4);
        for (uint256 row; row < rows; ++row) {
            uint256 stride = cols / 2 + 4;
            int256 scale;
            assembly ("memory-safe") {
                scale := signextend(3,shr(224,mload(add(add(weights,32),mul(row,stride)))))
            }
            if (scale <= 0) revert InvalidInput();
            int256 sum;
            assembly ("memory-safe") {
                let ap := add(packed,32)
                    let wp := add(add(weights,36),mul(row,stride))
                let bpackedSum := 0
                let g := 0
                for { } lt(add(g,15),groups) { g := add(g,16) } {
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),0)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),0))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),3)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),32))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),6)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),64))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),9)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),96))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),12)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),128))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),15)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),160))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),18)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),192))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),21)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),224))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),24)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),256))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),27)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),288))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),30)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),320))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),33)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),352))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),36)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),384))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),39)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),416))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),42)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),448))),bp)),0xffffffffff))
                    }
                    {
                        let q := xor(shr(232,mload(add(wp,add(mul(g,3),45)))),0x888888)
                        q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                        let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),0xf000000000f000000000f000000000f000000000f000000000f)
                        bpackedSum := add(bpackedSum,bp)
                        sum := add(sum,and(shr(200,mul(mload(add(ap,add(mul(g,32),480))),bp)),0xffffffffff))
                    }
                }
                for { } lt(g,groups) { g := add(g,1) } {
                    let q := xor(shr(232,mload(add(wp,mul(g,3)))),0x888888)
                    q := or(shl(4,and(q,0x0f0f0f)),and(shr(4,q),0x0f0f0f))
                    let bp := and(mul(q,0x1000000001000000001000000001000000001000000001),
                                  0xf000000000f000000000f000000000f000000000f000000000f)
                    bpackedSum := add(bpackedSum,bp)
                    sum := add(sum,and(shr(200,mul(mload(add(ap,mul(g,32))),bp)),0xffffffffff))
                }
                sum := sub(add(sum,correction),shl(31,mod(bpackedSum,0xffffffffff)))
                for { let j := mul(groups,6) } lt(j,cols) { j := add(j,1) } {
                    let q := byte(0,mload(add(wp,shr(1,j))))
                    let nibble := and(shr(mul(and(j,1),4),q),15)
                    let weight := sub(xor(nibble,8),8)
                    let value := signextend(3,shr(224,mload(add(add(x,32),mul(j,4)))))
                    sum := add(sum,mul(value,weight))
                }
            }
            _put(out,row,sum * scale / 16777216);
        }
    }
}
