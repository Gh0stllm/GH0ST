// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract Swar8KernelProbe {
    /// @dev Fast path: 8*4095*131071 < 2^32, so convolution lanes cannot carry.
    ///      Every input is checked. The scalar path preserves arbitrary int32 inputs.
    function _packInput(int32[] memory input, uint256 columns)
        private pure returns (uint256[] memory packed, int256 inputSum, bool fast)
    {
        uint256 groups = (columns + 7) / 8;
        packed = new uint256[](groups);
        fast = true;
        assembly ("memory-safe") {
            let src := add(input, 32)
            let dst := add(packed, 32)
            let cursor := 0
            for { let group := 0 } lt(group, groups) { group := add(group, 1) } {
                let word := 0
                for { let lane := 0 } lt(lane, 8) { lane := add(lane, 1) } {
                    let x := 0
                    if lt(cursor, columns) { x := signextend(3, mload(add(src, shl(5, cursor)))) }
                    inputSum := add(inputSum, x)
                    let biased := add(x, 65536)
                    if gt(biased, 131071) { fast := 0 }
                    word := or(word, shl(shl(5, sub(7, lane)), and(biased, 131071)))
                    cursor := add(cursor, 1)
                }
                mstore(add(dst, shl(5, group)), word)
            }
        }
    }

    function _dotPacked(bytes memory weights, uint256 byteOffset, uint256[] memory packed,
        int256 inputSum, uint256 paddedColumns, int32[] memory originalInput, bool fast)
        private pure returns (int256 sum)
    {
        assembly ("memory-safe") {
            let wp := add(add(weights, 32), byteOffset)
            let groups := mload(packed)
            switch fast
            case 1 {
                let xp := add(packed, 32)
                let end := add(xp, shl(5, groups))
                for {} lt(xp, end) { xp := add(xp, 32) wp := add(wp, 32) } {
                    sum := add(sum, shr(224, mul(mload(wp), mload(xp))))
                }
                sum := sub(sub(sub(sum, shl(11, inputSum)), shl(16, mload(wp))), shl(27, paddedColumns))
            }
            default {
                let src := add(originalInput, 32)
                let columns := mload(originalInput)
                let cursor := 0
                for { let group := 0 } lt(group, groups) { group := add(group, 1) wp := add(wp, 32) } {
                    let word := mload(wp)
                    for { let lane := 0 } lt(lane, 8) { lane := add(lane, 1) } {
                        if lt(cursor, columns) {
                            let weight := sub(and(shr(shl(5, lane), word), 4095), 2048)
                            let value := signextend(3, mload(add(src, shl(5, cursor))))
                            sum := add(sum, mul(weight, value))
                        }
                        cursor := add(cursor, 1)
                    }
                }
            }
        }
    }


function dot(bytes memory weights, int32[] memory input) external pure returns (int256 result, bool fast) {
  (uint256[] memory packed, int256 inputSum, bool isFast) = _packInput(input,input.length);
  result = _dotPacked(weights, 0, packed, inputSum, ((input.length+7)/8)*8, input,isFast);
  fast=isFast;
}
}
