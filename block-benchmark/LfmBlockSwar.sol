// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import "./LfmBlock.sol";

/// @notice Four exact signed int4/int32 products per EVM multiplication.
/// @dev Bias inputs into nonnegative coefficients, use base-2^64 polynomial
///      packing, extract coefficient 3, then remove bias terms. Every product
///      coefficient is < 4 * 15 * 2^32 < 2^38, so lanes cannot carry into one
///      another. The low 256-bit product contains coefficient 3 exactly.
contract LfmBlockSwar is LfmBlock {
    constructor(address[] memory data) LfmBlock(data) {}

    function _project(bytes memory x, bytes memory weights, uint256 rows, uint256 cols)
        internal pure override returns (bytes memory out)
    {
        uint256 groups = cols / 4;
        uint256[] memory packed = new uint256[](groups);
        uint256[] memory corrections = new uint256[](groups);
        assembly ("memory-safe") {
            let xp := add(x,32)
            let ap := add(packed,32)
            let cp := add(corrections,32)
            for { let g := 0 } lt(g,groups) { g := add(g,1) } {
                let word := mload(add(xp,mul(g,16)))
                let a := xor(shr(224,word),0x80000000)
                let b := xor(and(shr(192,word),0xffffffff),0x80000000)
                let c := xor(and(shr(160,word),0xffffffff),0x80000000)
                let d := xor(and(shr(128,word),0xffffffff),0x80000000)
                let offset := mul(g,32)
                mstore(add(ap,offset),or(or(a,shl(64,b)),or(shl(128,c),shl(192,d))))
                mstore(add(cp,offset),sub(0x1000000000,shl(3,add(add(a,b),add(c,d)))))
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
                    let q := xor(shr(240,mload(add(wp,mul(g,2)))),0x8888)
                    let bs := add(and(q,0x0f0f),and(shr(4,q),0x0f0f))
                    let bsum := add(and(bs,255),shr(8,bs))
                    let bp := or(or(shl(192,and(shr(8,q),15)),shl(128,and(shr(12,q),15))),
                                 or(shl(64,and(q,15)),and(shr(4,q),15)))
                    let offset := mul(g,32)
                    let products := shr(192,mul(mload(add(ap,offset)),bp))
                    sum := add(sum,sub(add(products,mload(add(cp,offset))),shl(31,bsum)))
                }
            }
            _put(out,row,sum * scale / 16777216);
        }
    }
}
