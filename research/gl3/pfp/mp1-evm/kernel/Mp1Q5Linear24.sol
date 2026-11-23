// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Faster exact signed Q5 dot tiles for Q16.16 inputs in [-128, 128).
/// @dev Shares the raw ABI with Mp1Q5Linear. Wider inputs must use the wide kernel.
contract Mp1Q5Linear24 {
    error InvalidTile();
    error OutsideSigned24();

    /// @param activations Signed int32 little-endian, token-major, 192 features per token.
    /// @param shard Immutable packed weight code for the selected groups.
    /// @param codeOffset Offset of the first group, including the STOP prefix if present.
    /// @param codeStride Distance in bytes between the starts of successive output rows.
    /// @param width Number of features per group, fixed at 192.
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
        uint256 tokens = activations.length / 768;
        if (width != 192 || tokens == 0 || tokens > 269 || tokens * 768 != activations.length
            || outputs == 0 || outputs > 768 || tokens * 192 * outputs > 1_800_000 || codeStride < 120) {
            revert InvalidTile();
        }
        uint256 weightBytes = (uint256(outputs) - 1) * codeStride + 120;
        if (uint256(codeOffset) + weightBytes > shard.code.length) revert InvalidTile();
        uint256 resultBytes = tokens * outputs * 8;
        values = new bytes(resultBytes + 24);
        bytes4 outsideSigned24 = OutsideSigned24.selector;

        assembly ("memory-safe") {
            function widenWeights(word) -> lanes {
                let codes := or(or(byte(0, word), shl(8, byte(1, word))),
                    or(shl(16, byte(2, word)), or(shl(24, byte(3, word)), shl(32, byte(4, word)))))
                let spread := or(and(codes, 0xfffff), shl(128, shr(20, codes)))
                spread := and(or(spread, shl(54, spread)),
                    0x3ff00000000000003ff00000000000003ff00000000000003ff)
                lanes := and(or(spread, shl(27, spread)),
                    0x1f0000001f0000001f0000001f0000001f0000001f0000001f0000001f)
            }

            function packActivations(word, errorSelector) -> lanes {
                let bytesReversed := or(and(shl(8, word), 0xff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00),
                    and(shr(8, word), 0x00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff))
                bytesReversed := or(and(shl(16, bytesReversed), 0xffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000),
                    and(shr(16, bytesReversed), 0x0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff))
                // All eight discarded high bytes must be valid signed-24 extension.
                let signMask := 0x0080000000800000008000000080000000800000008000000080000000800000
                let highMask := 0xff000000ff000000ff000000ff000000ff000000ff000000ff000000ff000000
                if iszero(eq(and(bytesReversed, highMask), mul(and(bytesReversed, signMask), 510))) {
                    mstore(0, errorSelector)
                    revert(0, 4)
                }
                // Rebase signed values to unsigned 24 bits, kept in reverse slot order.
                lanes := xor(and(bytesReversed, not(highMask)), signMask)
            }

            function center(a, b) -> value {
                // Eight unsigned 24-by-5-bit products total at most 4,160,749,320,
                // so no convolution coefficient carries into the next 32-bit lane.
                value := shr(224, mul(a, b))
            }

            function littleEndian64(value) -> out {
                value := and(value, 0xffffffffffffffff)
                value := or(and(shl(8, value), 0xff00ff00ff00ff00), and(shr(8, value), 0x00ff00ff00ff00ff))
                value := or(and(shl(16, value), 0xffff0000ffff0000), and(shr(16, value), 0x0000ffff0000ffff))
                out := or(and(shl(32, value), 0xffffffff00000000), shr(32, value))
            }

            let ones := 0x100000001000000010000000100000001000000010000000100000001
            let weights := mload(0x40)
            let sums := add(weights, and(add(weightBytes, 63), not(31)))
            let activ := add(sums, shl(5, tokens))
            let expandedWeights := add(activ, mul(tokens, 768))
            let expandedEnd := add(expandedWeights, 768)
            mstore(0x40, expandedEnd)
            extcodecopy(shard, weights, codeOffset, weightBytes)

            for { let token := 0 } lt(token, tokens) { token := add(token, 1) } {
                let start := mul(token, 768)
                let source := add(activations.offset, start)
                let dest := add(activ, start)
                let sum := 0
                for { let offset := 0 } lt(offset, 768) { offset := add(offset, 32) } {
                    let packed := packActivations(calldataload(add(source, offset)), outsideSigned24)
                    mstore(add(dest, offset), packed)
                    sum := add(sum, center(packed, ones))
                }
                mstore(add(sums, shl(5, token)), shl(4, sum))
            }

            let destination := add(values, 32)
            for { let row := 0 } lt(row, outputs) { row := add(row, 1) } {
                let source := add(weights, mul(row, codeStride))
                let sum := 0
                for { let group := 0 } lt(group, 24) { group := add(group, 1) } {
                    let packed := widenWeights(mload(add(source, mul(group, 5))))
                    sum := add(sum, center(packed, ones))
                    mstore(add(expandedWeights, shl(5, group)), packed)
                }
                // Remove the unsigned shifts in X and W using precomputed row sums.
                let correction := shl(23, sub(shl(4, 192), sum))
                for { let token := 0 } lt(token, tokens) { token := add(token, 1) } {
                    let input := add(activ, mul(token, 768))
                    let acc := 0
                    for { let weight := expandedWeights } lt(weight, expandedEnd) { weight := add(weight, 128) } {
                        let first := center(mload(weight), mload(input))
                        let second := center(mload(add(weight, 32)), mload(add(input, 32)))
                        let third := center(mload(add(weight, 64)), mload(add(input, 64)))
                        let fourth := center(mload(add(weight, 96)), mload(add(input, 96)))
                        acc := add(acc, add(add(first, second), add(third, fourth)))
                        input := add(input, 128)
                    }
                    let value := sub(add(acc, correction), mload(add(sums, shl(5, token))))
                    mstore(destination, shl(192, littleEndian64(value)))
                    destination := add(destination, 8)
                }
            }
            mstore(values, resultBytes)
        }
    }

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
