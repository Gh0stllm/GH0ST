// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import "./LfmBlock.sol";

/// @notice Six exact signed int4/int32 products per EVM multiplication.
/// @dev Bias coefficients into nonnegative values and pack in base 2^40.
///      Every convolution coefficient is < 6 * 15 * 2^32 < 2^39, so no
///      coefficient carries into its neighbour. Coefficient 5 occupies
///      bits 200..239 of the low 256-bit product; the mask discards the
///      partial coefficient 6 above it. The final 0, 2 or 4 inputs use
///      scalar products. Quantization and rounding match LfmBlock exactly.
contract LfmBlockSwar6 is LfmBlock {
    constructor(address[] memory data) LfmBlock(data) {}

    function _project(bytes memory x, bytes memory weights, uint256 rows, uint256 cols)
        internal pure override returns (bytes memory out)
    {
        uint256 groups = cols / 6;
        uint256[] memory packed = new uint256[](groups);
        uint256[] memory corrections = new uint256[](groups);
        assembly ("memory-safe") {
            let xp := add(x,32)
            let ap := add(packed,32)
            let cp := add(corrections,32)
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
                mstore(add(cp,offset),sub(0x1800000000,shl(3,add(add(add(a,b),add(c,d)),add(e,f)))))
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
                let cp := add(corrections,32)
                let wp := add(add(weights,36),mul(row,stride))
                for { let g := 0 } lt(g,groups) { g := add(g,1) } {
                    let q := xor(shr(232,mload(add(wp,mul(g,3)))),0x888888)
                    let bs := add(and(q,0x0f0f0f),and(shr(4,q),0x0f0f0f))
                    let bsum := add(add(and(bs,255),and(shr(8,bs),255)),shr(16,bs))
                    let bp := or(or(or(shl(200,and(shr(16,q),15)),shl(160,and(shr(20,q),15))),
                                    or(shl(120,and(shr(8,q),15)),shl(80,and(shr(12,q),15)))),
                                 or(shl(40,and(q,15)),and(shr(4,q),15)))
                    let offset := mul(g,32)
                    let products := and(shr(200,mul(mload(add(ap,offset)),bp)),0xffffffffff)
                    sum := add(sum,sub(add(products,mload(add(cp,offset))),shl(31,bsum)))
                }
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
