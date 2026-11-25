// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Exact signed int16 × signed int8 benchmark with word-wide lane expansion.
/// @dev Reverse the eight bytes of each stored weight group. No weight values change.
contract PackedLinearFast {
    error InvalidTile();

    function dotTile(bytes calldata input, address weights, uint256 width, uint256 outputs)
        public view returns (bytes memory result)
    {
        if (width == 0 || width > 4096 || width % 32 != 0 || outputs == 0 || outputs > 768) revert InvalidTile();
        uint256 tokens = input.length / (2 * width);
        if (tokens == 0 || tokens > 256 || tokens * width * 2 != input.length
            || tokens * width * outputs > 4_194_304 || weights.code.length != width * outputs + 1) revert InvalidTile();
        uint256 length = tokens * outputs * 8;
        result = new bytes(length + 24);
        assembly ("memory-safe") {
            function product(lhs, rhs) -> value { value := shr(224, mul(lhs, rhs)) }
            function expandInput(word) -> lanes {
                let x := shr(128, word)
                x := and(or(x, shl(64, x)), 0xffffffffffffffff0000000000000000ffffffffffffffff)
                x := and(or(x, shl(32, x)), 0xffffffff00000000ffffffff00000000ffffffff00000000ffffffff)
                x := and(or(x, shl(16, x)), 0xffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff)
                lanes := xor(x, 0x800000008000000080000000800000008000000080000000800000008000)
            }
            function expandWeights(word) -> lanes {
                let x := shr(192, word)
                x := and(or(x, shl(96, x)), 0xffffffff000000000000000000000000ffffffff)
                x := and(or(x, shl(48, x)), 0xffff000000000000ffff000000000000ffff000000000000ffff)
                x := and(or(x, shl(24, x)), 0xff000000ff000000ff000000ff000000ff000000ff000000ff000000ff)
                lanes := xor(x, 0x8000000080000000800000008000000080000000800000008000000080)
            }
            // Reversing one operand aligns eight products. A batch of 32
            // packed products still fits each 32-bit coefficient because
            // 32 × 8 × 65535 × 255 < 2^32.
            let ones := 0x100000001000000010000000100000001000000010000000100000001
            let work := mload(0x40)
            let groups := div(width, 8)
            let rowBytes := shl(5, groups)
            let sums := add(work, mul(rowBytes, tokens))
            let matrix := add(sums, shl(5, tokens))
            let raw := add(matrix, rowBytes)
            mstore(0x40, add(raw, add(mul(outputs, width), 32)))
            extcodecopy(weights, raw, 1, mul(outputs, width))
            for { let i := 0 } lt(i, tokens) { i := add(i, 1) } {
                let source := add(input.offset, mul(i, shl(1, width)))
                let start := add(work, mul(i, rowBytes))
                let sum := 0
                for { let j := 0 } lt(j, groups) { j := add(j, 1) } {
                    let lanes := expandInput(calldataload(add(source, shl(4, j))))
                    sum := add(sum, product(lanes, ones))
                    mstore(add(start, shl(5, j)), lanes)
                }
                mstore(add(sums, shl(5, i)), shl(7, sum))
            }

            let out := add(result, 32)
            for { let row := 0 } lt(row, outputs) { row := add(row, 1) } {
                let start := add(raw, mul(row, width))
                let sum := 0
                for { let j := 0 } lt(j, groups) { j := add(j, 1) } {
                    let lanes := expandWeights(mload(add(start, shl(3, j))))
                    sum := add(sum, product(lanes, ones))
                    mstore(add(matrix, shl(5, j)), lanes)
                }
                let correction := shl(15, sub(shl(7, width), sum))
                for { let i := 0 } lt(i, tokens) { i := add(i, 1) } {
                    let a := add(work, mul(i, rowBytes))
                    let acc := 0
                    for { let w := matrix } lt(w, raw) {} {
                        let end := add(w, 1024)
                        if gt(end, raw) { end := raw }
                        let packedSum := 0
                        for {} lt(w, end) { w := add(w, 128) } {
                            let p0 := mul(mload(a), mload(w))
                            let p1 := mul(mload(add(a, 32)), mload(add(w, 32)))
                            let p2 := mul(mload(add(a, 64)), mload(add(w, 64)))
                            let p3 := mul(mload(add(a, 96)), mload(add(w, 96)))
                            packedSum := add(packedSum, add(add(p0, p1), add(p2, p3)))
                            a := add(a, 128)
                        }
                        acc := add(acc, shr(224, packedSum))
                    }
                    let signedDot := sub(add(acc, correction), mload(add(sums, shl(5, i))))
                    mstore(out, shl(192, and(signedDot, 0xffffffffffffffff)))
                    out := add(out, 8)
                }
            }
            mstore(result, length)
        }
    }

    function measure(bytes calldata input, address weights, uint256 width, uint256 outputs)
        external view returns (bytes memory values, uint256 executionGas)
    {
        uint256 before = gasleft();
        values = dotTile(input, weights, width, outputs);
        executionGas = before - gasleft();
    }
}
