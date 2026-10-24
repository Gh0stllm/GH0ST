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

    function _fastRows128(uint256 wp, uint256 rows, uint256 xp, int256 correction, uint256 outputPointer) private pure {
        bool bad;
        assembly ("memory-safe") {
            let end := add(outputPointer, shl(5, rows))
            for {} lt(outputPointer, end) { outputPointer := add(outputPointer, 32) wp := add(wp, 544) } {
                let sum := 0
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
                sum := sdiv(sub(sub(sum, correction), shl(16, mload(add(wp, 512)))), 4096)
                if or(slt(sum, sub(0, 2147483648)), sgt(sum, 2147483647)) { bad := 1 }
                mstore(outputPointer, sum)
            }
        }
        if (bad) revert ArithmeticRange();
    }

    function _fastRows341(uint256 wp, uint256 rows, uint256 xp, int256 correction, uint256 outputPointer) private pure {
        bool bad;
        assembly ("memory-safe") {
            let end := add(outputPointer, shl(5, rows))
            for {} lt(outputPointer, end) { outputPointer := add(outputPointer, 32) wp := add(wp, 1408) } {
                let sum := 0
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
                sum := add(sum, shr(224, mul(mload(add(wp, 512)), mload(add(xp, 512)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 544)), mload(add(xp, 544)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 576)), mload(add(xp, 576)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 608)), mload(add(xp, 608)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 640)), mload(add(xp, 640)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 672)), mload(add(xp, 672)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 704)), mload(add(xp, 704)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 736)), mload(add(xp, 736)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 768)), mload(add(xp, 768)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 800)), mload(add(xp, 800)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 832)), mload(add(xp, 832)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 864)), mload(add(xp, 864)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 896)), mload(add(xp, 896)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 928)), mload(add(xp, 928)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 960)), mload(add(xp, 960)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 992)), mload(add(xp, 992)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 1024)), mload(add(xp, 1024)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 1056)), mload(add(xp, 1056)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 1088)), mload(add(xp, 1088)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 1120)), mload(add(xp, 1120)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 1152)), mload(add(xp, 1152)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 1184)), mload(add(xp, 1184)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 1216)), mload(add(xp, 1216)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 1248)), mload(add(xp, 1248)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 1280)), mload(add(xp, 1280)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 1312)), mload(add(xp, 1312)))))
                sum := add(sum, shr(224, mul(mload(add(wp, 1344)), mload(add(xp, 1344)))))
                sum := sdiv(sub(sub(sum, correction), shl(16, mload(add(wp, 1376)))), 4096)
                if or(slt(sum, sub(0, 2147483648)), sgt(sum, 2147483647)) { bad := 1 }
                mstore(outputPointer, sum)
            }
        }
        if (bad) revert ArithmeticRange();
    }

    function _matrixRows(bytes memory buffer, uint256 rows, uint256 columns,
        int32[] memory input, uint256 outputPointer) private pure
    {
        (uint256[] memory packed, int256 inputSum, bool fast) = _packInput(input, columns);
        uint256 groups = (columns + 7) / 8;
        if (fast && (columns == 128 || columns == 341)) {
            uint256 wp; uint256 xp; int256 correction;
            assembly ("memory-safe") {
                wp := add(buffer, 32)
                xp := add(packed, 32)
                correction := add(shl(11, inputSum), shl(27, mul(groups, 8)))
            }
            // A dynamic internal function pointer keeps the compact row kernel out of its callers' large live stacks.
            function(uint256,uint256,uint256,int256,uint256) internal pure execute =
                columns == 128 ? _fastRows128 : _fastRows341;
            execute(wp, rows, xp, correction, outputPointer);
            return;
        }
        uint256 rowBytes = (groups + 1) * 32;
        for (uint256 row; row < rows; ++row) {
            int256 value = _checked(_dotPacked(buffer, row * rowBytes, packed, inputSum, groups * 8, input, fast) / Q);
            assembly ("memory-safe") { mstore(add(outputPointer, shl(5, row)), value) }
        }
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
