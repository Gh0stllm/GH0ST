// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Benchmark only: packed signed int4 weights x signed int16 activations.
/// @dev Not a complete LFM layer, inference engine, or authorized action executor.
contract Int4Kernel {
    error InvalidDimensions();
    error InvalidDataLength();

    bytes32 public resultHash;
    uint256 public runs;

    function dotCalldata(bytes calldata weights, bytes calldata activations,
                         uint256 rows, uint256 cols)
        external pure returns (int256[] memory)
    {
        return _dot(weights, activations, rows, cols);
    }

    function dotFromCode(address shard, bytes calldata activations,
                         uint256 rows, uint256 cols)
        public view returns (int256[] memory)
    {
        _dimensions(rows, cols);
        uint256 count = (rows * cols + 1) / 2;
        if (shard.code.length != count + 1) revert InvalidDataLength();
        bytes memory weights = new bytes(count);
        assembly ("memory-safe") {
            extcodecopy(shard, add(weights, 32), 1, count)
        }
        return _dot(weights, activations, rows, cols);
    }

    /// @notice Stores a commitment for state-write gas measurement only.
    /// @dev Unrestricted benchmark endpoint. No assets or production permissions.
    function computeAndStore(address shard, bytes calldata activations,
                             uint256 rows, uint256 cols)
        external returns (bytes32 digest)
    {
        digest = keccak256(abi.encode(dotFromCode(shard, activations, rows, cols)));
        resultHash = digest;
        runs += 1;
    }

    function _dimensions(uint256 rows, uint256 cols) private pure {
        if (rows == 0 || rows > 8 || cols == 0 || cols > 1024)
            revert InvalidDimensions();
    }

    function _dot(bytes memory weights, bytes memory activations,
                  uint256 rows, uint256 cols)
        private pure returns (int256[] memory output)
    {
        _dimensions(rows, cols);
        if (weights.length != (rows * cols + 1) / 2 || activations.length != 2 * cols)
            revert InvalidDataLength();
        output = new int256[](rows);
        // Low nibble comes first; activations are little-endian two's complement.
        // |sum| <= 1024 * 8 * 32768 = 268435456, safely inside int256.
        assembly ("memory-safe") {
            let wp := add(weights, 32)
            let xp := add(activations, 32)
            let op := add(output, 32)
            for { let row := 0 } lt(row, rows) { row := add(row, 1) } {
                let sum := 0
                let base := mul(row, cols)
                for { let col := 0 } lt(col, cols) { col := add(col, 1) } {
                    let i := add(base, col)
                    let packed := byte(0, mload(add(wp, shr(1, i))))
                    let nibble := and(shr(mul(and(i, 1), 4), packed), 15)
                    let w := sub(xor(nibble, 8), 8)
                    let word := mload(add(xp, mul(col, 2)))
                    let raw := or(byte(0, word), shl(8, byte(1, word)))
                    sum := add(sum, mul(w, signextend(1, raw)))
                }
                mstore(add(op, mul(row, 32)), sum)
            }
        }
    }
}

/// @notice Immutable bytecode data shard: STOP prefix followed by packed weights.
contract WeightShard {
    constructor(bytes memory data) {
        bytes memory runtime = abi.encodePacked(hex"00", data);
        assembly ("memory-safe") { return(add(runtime, 32), mload(runtime)) }
    }
}
