// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Local research kernel. Not a full TTM model or an authenticated model runtime.
/// @dev INT8 weights and INT32 activations, no scaling, bias or activation function.
///      With width <= 1024 the signed accumulator is bounded by 2**48.
contract Int8DotBenchmark {
    error InvalidDimensions();
    error InvalidCodeRange();

    function scalar(bytes calldata weights, int32[] calldata activations)
        external pure returns (int256 sum)
    {
        uint256 width = activations.length;
        if (width == 0 || width > 1024 || weights.length != width) revert InvalidDimensions();
        for (uint256 i; i < width; ++i) {
            sum += int256(int8(uint8(weights[i]))) * int256(activations[i]);
        }
    }

    function packed(bytes calldata weights, int32[] calldata activations)
        external pure returns (int256 sum)
    {
        uint256 width = activations.length;
        if (width == 0 || width > 1024 || weights.length != width) revert InvalidDimensions();
        assembly ("memory-safe") {
            for { let start := 0 } lt(start, width) { start := add(start, 32) } {
                let word := calldataload(add(weights.offset, start))
                let count := sub(width, start)
                if gt(count, 32) { count := 32 }
                let activationPtr := add(activations.offset, shl(5, start))
                for { let j := 0 } lt(j, count) { j := add(j, 1) } {
                    let w := signextend(0, byte(j, word))
                    let raw := calldataload(add(activationPtr, shl(5, j)))
                    let a := signextend(3, raw)
                    if iszero(eq(raw, a)) { revert(0, 0) }
                    sum := add(sum, mul(w, a))
                }
            }
        }
    }

    function scalarFromCode(address shard, uint256 offset, int32[] calldata activations)
        external view returns (int256 sum)
    {
        bytes memory weights = readRow(shard, offset, activations.length);
        for (uint256 i; i < activations.length; ++i) {
            sum += int256(int8(uint8(weights[i]))) * int256(activations[i]);
        }
    }

    function packedFromCode(address shard, uint256 offset, int32[] calldata activations)
        external view returns (int256 sum)
    {
        uint256 width = activations.length;
        bytes memory weights = readRow(shard, offset, width);
        assembly ("memory-safe") {
            for { let start := 0 } lt(start, width) { start := add(start, 32) } {
                let word := mload(add(add(weights, 32), start))
                let count := sub(width, start)
                if gt(count, 32) { count := 32 }
                let activationPtr := add(activations.offset, shl(5, start))
                for { let j := 0 } lt(j, count) { j := add(j, 1) } {
                    let w := signextend(0, byte(j, word))
                    let raw := calldataload(add(activationPtr, shl(5, j)))
                    let a := signextend(3, raw)
                    if iszero(eq(raw, a)) { revert(0, 0) }
                    sum := add(sum, mul(w, a))
                }
            }
        }
    }

    /// @dev The code identity is deliberately supplied by the benchmark harness.
    ///      A production inference engine must pin shard addresses/code hashes.
    function readRow(address shard, uint256 offset, uint256 width)
        private view returns (bytes memory weights)
    {
        if (width == 0 || width > 1024) revert InvalidDimensions();
        uint256 size = shard.code.length;
        if (offset > size || width > size - offset) revert InvalidCodeRange();
        weights = new bytes(width);
        assembly ("memory-safe") {
            extcodecopy(shard, add(weights, 32), offset, width)
        }
    }
}
