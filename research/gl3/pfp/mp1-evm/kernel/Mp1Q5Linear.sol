// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Exact signed integer linear tile for the M-P1 Q5 weight encoding.
/// @dev This primitive returns raw integer sums. The caller applies each group's scale and bias.
contract Mp1Q5Linear {
    error InvalidTile();

    /// @param activations Signed int32 little-endian rows, ordered by token then feature.
    /// @param shard Data contract containing the original packed weight bytes.
    /// @param codeOffset Offset of the first weight byte, including any code prefix.
    /// @param codeStride Distance in bytes between the starts of successive output rows.
    /// @param width Features per activation row, a multiple of eight.
    /// @param outputs Rows of packed weights to evaluate.
    /// @return values Signed int64 little-endian sums, ordered by output feature then token.
    function linearRaw(
        bytes calldata activations,
        address shard,
        uint32 codeOffset,
        uint16 codeStride,
        uint16 width,
        uint16 outputs
    ) public view returns (bytes memory values) {
        if (width < 8 || width > 768 || width % 8 != 0 || outputs == 0 || outputs > 768) {
            revert InvalidTile();
        }
        uint256 rowBytes = uint256(width) * 4;
        uint256 tokens = activations.length / rowBytes;
        if (tokens == 0 || tokens > 269 || tokens * rowBytes != activations.length || tokens * width * outputs > 1_000_000) {
            revert InvalidTile();
        }
        uint256 packedWidth = uint256(width) * 5 / 8;
        uint256 weightBytes = (uint256(outputs) - 1) * codeStride + packedWidth;
        if (codeStride < packedWidth || uint256(codeOffset) + weightBytes > shard.code.length) {
            revert InvalidTile();
        }
        uint256 resultBytes = tokens * outputs * 8;
        // Allow the final 32-byte write to extend 24 bytes past the packed output.
        values = new bytes(resultBytes + 24);

        assembly ("memory-safe") {
            function widenWeights(word, half) -> lanes {
                // Select four of eight little-endian five-bit codes from five bytes.
                let codes := or(or(byte(0, word), shl(8, byte(1, word))),
                    or(shl(16, byte(2, word)), or(shl(24, byte(3, word)), shl(32, byte(4, word)))))
                codes := and(shr(mul(20, half), codes), 0xfffff)
                let spread := or(and(codes, 0x3ff), shl(128, shr(10, codes)))
                lanes := and(or(spread, shl(59, spread)),
                    0x1f000000000000001f000000000000001f000000000000001f)
            }

            function widenActivations(word) -> lanes {
                // Reverse bytes within each little-endian 32-bit value and flip its sign bit.
                let codes := shr(128, word)
                codes := or(and(shl(8, codes), 0xff00ff00ff00ff00ff00ff00ff00ff00),
                    and(shr(8, codes), 0x00ff00ff00ff00ff00ff00ff00ff00ff))
                codes := or(and(shl(16, codes), 0xffff0000ffff0000ffff0000ffff0000),
                    and(shr(16, codes), 0x0000ffff0000ffff0000ffff0000ffff))
                codes := xor(codes, 0x80000000800000008000000080000000)
                let spread := or(and(codes, 0xffffffffffffffff), shl(128, shr(64, codes)))
                lanes := and(or(spread, shl(32, spread)),
                    0xffffffff00000000ffffffff00000000ffffffff00000000ffffffff)
            }

            function center(a, b) -> value {
                // This coefficient sums four products of unsigned 32- and 5-bit values.
                // All convolution coefficients are below 2^39 and cannot carry between lanes.
                value := shr(192, mul(a, b))
            }

            function littleEndian64(value) -> out {
                value := and(value, 0xffffffffffffffff)
                value := or(and(shl(8, value), 0xff00ff00ff00ff00), and(shr(8, value), 0x00ff00ff00ff00ff))
                value := or(and(shl(16, value), 0xffff0000ffff0000), and(shr(16, value), 0x0000ffff0000ffff))
                out := or(and(shl(32, value), 0xffffffff00000000), shr(32, value))
            }

            let ones := 0x1000000000000000100000000000000010000000000000001
            let blocks := shr(2, width)
            let expandedRowBytes := shl(5, blocks)
            let tokenSpan := shl(5, tokens)
            let weights := mload(0x40)
            let sums := add(weights, and(add(weightBytes, 63), not(31)))
            let activ := add(sums, tokenSpan)
            let expandedWeights := add(activ, mul(tokens, expandedRowBytes))
            let expandedEnd := add(expandedWeights, expandedRowBytes)
            mstore(0x40, expandedEnd)
            extcodecopy(shard, weights, codeOffset, weightBytes)

            // Expand each activation block once, then reuse it across all output weights.
            for { let token := 0 } lt(token, tokens) { token := add(token, 1) } {
                let tokenOffset := shl(5, token)
                let source := add(activations.offset, mul(token, rowBytes))
                let destination := add(activ, mul(token, expandedRowBytes))
                let sum := 0
                for { let group := 0 } lt(group, blocks) { group := add(group, 1) } {
                    let packed := widenActivations(calldataload(add(source, shl(4, group))))
                    mstore(add(destination, shl(5, group)), packed)
                    sum := add(sum, center(packed, ones))
                }
                // With X = x + 2^31 and W = w + 16, remove 16 sum(X) here.
                mstore(add(sums, tokenOffset), shl(4, sum))
            }

            let destination := add(values, 32)
            for { let row := 0 } lt(row, outputs) { row := add(row, 1) } {
                let source := add(weights, mul(row, codeStride))
                let sum := 0
                for { let group := 0 } lt(group, blocks) { group := add(group, 1) } {
                    let packed := widenWeights(mload(add(source, mul(shr(1, group), 5))), and(group, 1))
                    sum := add(sum, center(packed, ones))
                    mstore(add(expandedWeights, shl(5, group)), packed)
                }
                // Remove 2^31 sum(W), then add width * 2^31 * 16.
                let correction := shl(31, sub(shl(4, width), sum))
                for { let token := 0 } lt(token, tokens) { token := add(token, 1) } {
                    let input := add(activ, mul(token, expandedRowBytes))
                    let acc := 0
                    for { let weight := expandedWeights } lt(weight, expandedEnd) { weight := add(weight, 32) } {
                        acc := add(acc, center(mload(weight), mload(input)))
                        input := add(input, 32)
                    }
                    let value := sub(add(acc, correction), mload(add(sums, shl(5, token))))
                    mstore(destination, shl(192, littleEndian64(value)))
                    destination := add(destination, 8)
                }
            }
            mstore(values, resultBytes)
        }
    }

    /// @notice Internal-call measurement with the same kernel and integer result.
    function measure(
        bytes calldata activations,
        address shard,
        uint32 codeOffset,
        uint16 codeStride,
        uint16 width,
        uint16 outputs
    ) external view returns (bytes memory values, uint256 executionGas) {
        uint256 before = gasleft();
        values = linearRaw(activations, shard, codeOffset, codeStride, width, outputs);
        executionGas = before - gasleft();
    }
}
