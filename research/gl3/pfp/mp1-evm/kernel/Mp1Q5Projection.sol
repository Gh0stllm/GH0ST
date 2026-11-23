// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IMp1Q5Linear {
    function linearRaw(
        bytes calldata activations,
        address shard,
        uint32 codeOffset,
        uint16 codeStride,
        uint16 width,
        uint16 outputs
    ) external view returns (bytes memory);
}

/// @notice Scaled Q16.16 projection with authentic M-P1 Q5 weights and biases.
/// @dev A future model registry must pin the kernel, layouts, and shard code hashes.
contract Mp1Q5Projection {
    uint256 private constant GROUP_WIDTH = 192;
    uint256 private constant PACKED_GROUP = 120;
    int256 private constant Q24 = 1 << 24;

    error InvalidProjection();
    error ProjectionOverflow();

    struct WeightView {
        address shard;
        uint32 weightsOffset;
        uint32 scalesOffset;
        uint32 biasOffset;
        uint16 width;
        uint16 outputs;
    }

    /// @param activation Signed Q16.16 int32 little-endian, token-major.
    /// @param layout Aligned weight rows, binary16 scale groups, and Float32 biases in shard code.
    /// @return result Signed Q16.16 int32 little-endian, output-major.
    function project(bytes calldata activation, IMp1Q5Linear kernel, WeightView calldata layout)
        public view returns (bytes memory result)
    {
        uint256 width = layout.width;
        uint256 outputs = layout.outputs;
        if (width == 0 || width > 768 || width % GROUP_WIDTH != 0 || outputs == 0 || outputs > 768) {
            revert InvalidProjection();
        }
        uint256 tokens = activation.length / (width * 4);
        if (tokens == 0 || tokens > 269 || tokens * width * 4 != activation.length || tokens * width * outputs > 1_000_000) {
            revert InvalidProjection();
        }
        uint256 groups = width / GROUP_WIDTH;
        uint256 stride = groups * PACKED_GROUP;
        uint256 scaleBytes = groups * outputs * 2;
        uint256 biasBytes = outputs * 4;
        address shard = layout.shard;
        uint256 codeLength = shard.code.length;
        if (uint256(layout.weightsOffset) + outputs * stride > codeLength
            || uint256(layout.scalesOffset) + scaleBytes > codeLength
            || uint256(layout.biasOffset) + biasBytes > codeLength) revert InvalidProjection();

        // The padding keeps unaligned word reads inside allocated payloads.
        bytes memory scales = _copy(shard, layout.scalesOffset, scaleBytes);
        bytes memory biases = _copy(shard, layout.biasOffset, biasBytes);
        int256[] memory totals = new int256[](tokens * outputs);
        bytes memory stripe = new bytes(tokens * GROUP_WIDTH * 4);

        for (uint256 group = 0; group < groups; ++group) {
            assembly ("memory-safe") {
                let dest := add(stripe, 32)
                let source := add(activation.offset, mul(group, 768))
                let end := add(dest, mul(tokens, 768))
                for { } lt(dest, end) { dest := add(dest, 768) } {
                    calldatacopy(dest, source, 768)
                    source := add(source, shl(2, width))
                }
            }
            bytes memory dots = kernel.linearRaw(stripe, shard, layout.weightsOffset + uint32(group * PACKED_GROUP),
                uint16(stride), uint16(GROUP_WIDTH), uint16(outputs));
            if (dots.length != totals.length * 8) revert InvalidProjection();
            // Ethers ABI returns a padded byte string. Reading an 8-byte item right
            // aligned in the preceding word avoids extending beyond the allocation.
            for (uint256 row = 0; row < outputs; ++row) {
                int256 scale = _halfQ24(scales, (row * groups + group) * 2);
                for (uint256 token = 0; token < tokens; ++token) {
                    uint256 index = row * tokens + token;
                    totals[index] += _readI64(dots, index * 8) * scale;
                }
            }
        }

        result = new bytes(totals.length * 4);
        for (uint256 row = 0; row < outputs; ++row) {
            int256 bias = _floatQ16(biases, row * 4);
            for (uint256 token = 0; token < tokens; ++token) {
                uint256 index = row * tokens + token;
                // Solidity signed division truncates toward zero, once after all Q24 groups.
                int256 y = bias + totals[index] / Q24;
                if (y < type(int32).min || y > type(int32).max) revert ProjectionOverflow();
                _writeI32(result, index * 4, y);
            }
        }
    }

    function measure(
        bytes calldata activation, IMp1Q5Linear kernel, WeightView calldata layout
    ) external view returns (bytes memory result, uint256 executionGas) {
        uint256 before = gasleft();
        result = project(activation, kernel, layout);
        executionGas = before - gasleft();
    }

    function _copy(address shard, uint256 offset, uint256 size) private view returns (bytes memory data) {
        data = new bytes(size + 28);
        assembly ("memory-safe") { extcodecopy(shard, add(data, 32), offset, size) }
    }

    function _halfQ24(bytes memory scales, uint256 at) private pure returns (int256) {
        uint256 bits;
        assembly ("memory-safe") {
            let word := mload(add(add(scales, 32), at))
            bits := or(byte(0, word), shl(8, byte(1, word)))
        }
        uint256 exponent = (bits >> 10) & 31;
        if (exponent == 31) revert InvalidProjection();
        uint256 fraction = bits & 1023;
        uint256 fixedValue = exponent == 0 ? fraction : (1024 + fraction) << (exponent - 1);
        return (bits & 0x8000) != 0 ? -int256(fixedValue) : int256(fixedValue);
    }

    function _floatQ16(bytes memory biases, uint256 at) private pure returns (int256) {
        uint256 bits;
        assembly ("memory-safe") {
            let word := mload(add(add(biases, 32), at))
            bits := or(or(byte(0, word), shl(8, byte(1, word))),
                or(shl(16, byte(2, word)), shl(24, byte(3, word))))
        }
        uint256 exponent = (bits >> 23) & 255;
        if (exponent == 255) revert InvalidProjection();
        // Subnormals and values strictly below half one Q16.16 tick round to zero.
        if (exponent < 110) return 0;
        uint256 mantissa = (bits & 0x7fffff) | 0x800000;
        uint256 magnitude;
        if (exponent >= 134) {
            magnitude = mantissa << (exponent - 134);
        } else {
            uint256 shift = 134 - exponent;
            magnitude = mantissa >> shift;
            uint256 halfway = 1 << (shift - 1);
            uint256 remainder = mantissa & ((1 << shift) - 1);
            if (remainder > halfway || (remainder == halfway && (magnitude & 1) == 1)) ++magnitude;
        }
        int256 value = (bits & 0x80000000) != 0 ? -int256(magnitude) : int256(magnitude);
        if (value < type(int32).min || value > type(int32).max) revert ProjectionOverflow();
        return value;
    }

    function _readI64(bytes memory source, uint256 at) private pure returns (int256 value) {
        assembly ("memory-safe") {
            // The target bytes are the last eight of this word, including at offset zero.
            let raw := and(mload(add(add(source, 8), at)), 0xffffffffffffffff)
            raw := or(and(shl(8, raw), 0xff00ff00ff00ff00), and(shr(8, raw), 0x00ff00ff00ff00ff))
            raw := or(and(shl(16, raw), 0xffff0000ffff0000), and(shr(16, raw), 0x0000ffff0000ffff))
            raw := or(and(shl(32, raw), 0xffffffff00000000), shr(32, raw))
            value := signextend(7, raw)
        }
    }

    function _writeI32(bytes memory result, uint256 at, int256 value) private pure {
        assembly ("memory-safe") {
            let dest := add(add(result, 32), at)
            mstore8(dest, value)
            mstore8(add(dest, 1), shr(8, value))
            mstore8(add(dest, 2), shr(16, value))
            mstore8(add(dest, 3), shr(24, value))
        }
    }
}
