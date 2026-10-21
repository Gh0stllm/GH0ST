// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import "./LfmBlock.sol";

/// @notice Exact int4/int32 dot products using five 48-bit coefficient lanes.
/// @dev Summation stays packed across the entire row. For cols <= 2560, every
///      accumulated coefficient is < 2560 * 15 * 2^32 < 2^48, so even the
///      lower coefficients cannot carry into the selected coefficient 4.
///      EVM modulo-2^256 multiplication/addition preserves bits 192..239.
///      Two five-input groups share one five-byte weight read. Remainders
///      use scalar arithmetic. Original weight files and rounding are retained.
contract LfmBlockWide5U4 is LfmBlock {
    constructor(address[] memory data) LfmBlock(data) {}

    function _project(bytes memory x, bytes memory weights, uint256 rows, uint256 cols)
        internal pure override returns (bytes memory out)
    {
        uint256 pairs = cols / 10;
        uint256[] memory packed = new uint256[](pairs * 2);
        int256 correction;
        assembly ("memory-safe") {
            let xp := add(x,32)
            let ap := add(packed,32)
            for { let g := 0 } lt(g,mul(pairs,2)) { g := add(g,1) } {
                let word := mload(add(xp,mul(g,20)))
                let a := xor(shr(224,word),0x80000000)
                let b := xor(and(shr(192,word),0xffffffff),0x80000000)
                let c := xor(and(shr(160,word),0xffffffff),0x80000000)
                let d := xor(and(shr(128,word),0xffffffff),0x80000000)
                let e := xor(and(shr(96,word),0xffffffff),0x80000000)
                mstore(add(ap,mul(g,32)),or(or(or(a,shl(48,b)),or(shl(96,c),shl(144,d))),shl(192,e)))
                correction := add(correction,sub(0x1400000000,shl(3,add(add(add(a,b),add(c,d)),e))))
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
                let accum := 0
                let g := 0
                for { } lt(add(g,3),pairs) { g := add(g,4) } {
                    {
                    let q := xor(shr(216,mload(add(wp,add(mul(g,5),0)))),0x8888888888)
                    q := or(shl(4,and(q,0x0f0f0f0f0f)),and(shr(4,q),0x0f0f0f0f0f))
                    let bp := and(mul(shr(20,q),0x100000000001000000000010000000000100000000001),0xf00000000000f00000000000f00000000000f00000000000f)
                    let bq := and(mul(and(q,0xfffff),0x100000000001000000000010000000000100000000001),0xf00000000000f00000000000f00000000000f00000000000f)
                    bpackedSum := add(bpackedSum,add(bp,bq))
                    accum := add(accum,add(mul(mload(add(ap,add(mul(g,64),0))),bp),mul(mload(add(ap,add(add(mul(g,64),0),32))),bq)))
                    }
                    {
                    let q := xor(shr(216,mload(add(wp,add(mul(g,5),5)))),0x8888888888)
                    q := or(shl(4,and(q,0x0f0f0f0f0f)),and(shr(4,q),0x0f0f0f0f0f))
                    let bp := and(mul(shr(20,q),0x100000000001000000000010000000000100000000001),0xf00000000000f00000000000f00000000000f00000000000f)
                    let bq := and(mul(and(q,0xfffff),0x100000000001000000000010000000000100000000001),0xf00000000000f00000000000f00000000000f00000000000f)
                    bpackedSum := add(bpackedSum,add(bp,bq))
                    accum := add(accum,add(mul(mload(add(ap,add(mul(g,64),64))),bp),mul(mload(add(ap,add(add(mul(g,64),64),32))),bq)))
                    }
                    {
                    let q := xor(shr(216,mload(add(wp,add(mul(g,5),10)))),0x8888888888)
                    q := or(shl(4,and(q,0x0f0f0f0f0f)),and(shr(4,q),0x0f0f0f0f0f))
                    let bp := and(mul(shr(20,q),0x100000000001000000000010000000000100000000001),0xf00000000000f00000000000f00000000000f00000000000f)
                    let bq := and(mul(and(q,0xfffff),0x100000000001000000000010000000000100000000001),0xf00000000000f00000000000f00000000000f00000000000f)
                    bpackedSum := add(bpackedSum,add(bp,bq))
                    accum := add(accum,add(mul(mload(add(ap,add(mul(g,64),128))),bp),mul(mload(add(ap,add(add(mul(g,64),128),32))),bq)))
                    }
                    {
                    let q := xor(shr(216,mload(add(wp,add(mul(g,5),15)))),0x8888888888)
                    q := or(shl(4,and(q,0x0f0f0f0f0f)),and(shr(4,q),0x0f0f0f0f0f))
                    let bp := and(mul(shr(20,q),0x100000000001000000000010000000000100000000001),0xf00000000000f00000000000f00000000000f00000000000f)
                    let bq := and(mul(and(q,0xfffff),0x100000000001000000000010000000000100000000001),0xf00000000000f00000000000f00000000000f00000000000f)
                    bpackedSum := add(bpackedSum,add(bp,bq))
                    accum := add(accum,add(mul(mload(add(ap,add(mul(g,64),192))),bp),mul(mload(add(ap,add(add(mul(g,64),192),32))),bq)))
                    }
                }
                for { } lt(g,pairs) { g := add(g,1) } {
                    let q := xor(shr(216,mload(add(wp,mul(g,5)))),0x8888888888)
                    q := or(shl(4,and(q,0x0f0f0f0f0f)),and(shr(4,q),0x0f0f0f0f0f))
                    let bp := and(mul(shr(20,q),0x100000000001000000000010000000000100000000001),0xf00000000000f00000000000f00000000000f00000000000f)
                    let bq := and(mul(and(q,0xfffff),0x100000000001000000000010000000000100000000001),0xf00000000000f00000000000f00000000000f00000000000f)
                    bpackedSum := add(bpackedSum,add(bp,bq))
                    accum := add(accum,add(mul(mload(add(ap,mul(g,64))),bp),mul(mload(add(ap,add(mul(g,64),32))),bq)))
                }
                sum := sub(add(and(shr(192,accum),0xffffffffffff),correction),shl(31,mod(bpackedSum,0xffffffffffff)))
                for { let j := mul(pairs,10) } lt(j,cols) { j := add(j,1) } {
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
