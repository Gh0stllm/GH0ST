// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract DenseKernelProbe {int256 private constant Q=4096; error ArithmeticRange();
    function _checked(int256 value) private pure returns (int32) {
        if (value < type(int32).min || value > type(int32).max) revert ArithmeticRange();
        return int32(value);
    }

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
                switch groups
                case 16 {
                    sum := add(sum, shr(224, mul(mload(wp), mload(xp))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 32)), mload(add(xp, 32)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 64)), mload(add(xp, 64)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 96)), mload(add(xp, 96)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 128)), mload(add(xp, 128)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 160)), mload(add(xp, 160)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 192)), mload(add(xp, 192)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 224)), mload(add(xp, 224)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 256)), mload(add(xp, 256)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 288)), mload(add(xp, 288)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 320)), mload(add(xp, 320)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 352)), mload(add(xp, 352)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 384)), mload(add(xp, 384)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 416)), mload(add(xp, 416)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 448)), mload(add(xp, 448)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 480)), mload(add(xp, 480)))))
                    wp := add(wp, 512)
                }
                default {
                    let bulkEnd := sub(end, 96)
                    for {} lt(xp, bulkEnd) { xp := add(xp, 128) wp := add(wp, 128) } {
                        sum := add(sum, shr(224, mul(mload(wp), mload(xp))))
                        sum := add(sum, shr(224, mul(mload(add(wp, 32)), mload(add(xp, 32)))))
                        sum := add(sum, shr(224, mul(mload(add(wp, 64)), mload(add(xp, 64)))))
                        sum := add(sum, shr(224, mul(mload(add(wp, 96)), mload(add(xp, 96)))))
                    }
                    for {} lt(xp, end) { xp := add(xp, 32) wp := add(wp, 32) } {
                        sum := add(sum, shr(224, mul(mload(wp), mload(xp))))
                    }
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

    // Exact row reduction in one assembly loop; no per-row ABI, checked-index, or type conversion overhead.
    function _matrixRows(bytes memory buffer, uint256 rows, uint256 columns,
        int32[] memory input, uint256 outputPointer) private pure
    {
        (uint256[] memory packed, int256 inputSum, bool fast) = _packInput(input, columns);
        uint256 groups = (columns + 7) / 8;
        uint256 rowBytes = (groups + 1) * 32;
        if (!fast) {
            for (uint256 row; row < rows; ++row) {
                int256 value = _checked(_dotPacked(buffer, row * rowBytes, packed, inputSum, groups * 8, input, false) / Q);
                assembly ("memory-safe") { mstore(add(outputPointer, shl(5, row)), value) }
            }
            return;
        }
        bool bad;
        assembly ("memory-safe") {
            let wp := add(buffer, 32)
            let xp := add(packed, 32)
            let outputEnd := add(outputPointer, shl(5, rows))
            let correction := add(shl(11, inputSum), shl(27, mul(groups, 8)))
            for {} lt(outputPointer, outputEnd) { outputPointer := add(outputPointer, 32) wp := add(wp, rowBytes) } {
                let sum := 0
                switch groups
                case 16 {
                    sum := add(sum, shr(224, mul(mload(wp), mload(xp))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 32)), mload(add(xp, 32)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 64)), mload(add(xp, 64)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 96)), mload(add(xp, 96)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 128)), mload(add(xp, 128)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 160)), mload(add(xp, 160)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 192)), mload(add(xp, 192)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 224)), mload(add(xp, 224)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 256)), mload(add(xp, 256)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 288)), mload(add(xp, 288)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 320)), mload(add(xp, 320)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 352)), mload(add(xp, 352)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 384)), mload(add(xp, 384)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 416)), mload(add(xp, 416)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 448)), mload(add(xp, 448)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 480)), mload(add(xp, 480)))))
                }
                default {
                    let w := wp
                    let x := xp
                    let end := add(xp, shl(5, groups))
                    let bulkEnd := sub(end, 96)
                    for {} lt(x, bulkEnd) { x := add(x, 128) w := add(w, 128) } {
                        sum := add(sum, shr(224, mul(mload(w), mload(x))))
                        sum := add(sum, shr(224, mul(mload(add(w, 32)), mload(add(x, 32)))))
                        sum := add(sum, shr(224, mul(mload(add(w, 64)), mload(add(x, 64)))))
                        sum := add(sum, shr(224, mul(mload(add(w, 96)), mload(add(x, 96)))))
                    }
                    for {} lt(x, end) { x := add(x, 32) w := add(w, 32) } {
                        sum := add(sum, shr(224, mul(mload(w), mload(x))))
                    }
                }
                sum := sdiv(sub(sub(sum, correction), shl(16, mload(add(wp, shl(5, groups))))), 4096)
                if or(slt(sum, sub(0, 2147483648)), sgt(sum, 2147483647)) { bad := 1 }
                mstore(outputPointer, sum)
            }
        }
        if (bad) revert ArithmeticRange();
    }


function optimized(bytes memory weights,uint256 rows,uint256 columns,int32[] memory input) external pure returns(int32[] memory output){
 output=new int32[](rows);uint256 ptr;assembly {ptr:=add(output,32)} _matrixRows(weights,rows,columns,input,ptr);
}
function baseline(bytes memory weights,uint256 rows,uint256 columns,int32[] memory input) external pure returns(int32[] memory output){
 output=new int32[](rows);(uint256[] memory packed,int256 inputSum,bool fast)=_packInput(input,columns);
 uint256 groups=(columns+7)/8;uint256 stride=(groups+1)*32;
 for(uint256 row;row<rows;++row)output[row]=_checked(_dotPacked(weights,row*stride,packed,inputSum,groups*8,input,fast)/Q);
}
}
