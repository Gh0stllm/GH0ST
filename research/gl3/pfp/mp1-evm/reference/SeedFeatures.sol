// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Reproduce the M-P1 integer reference noise and positional features.
/// @dev All returned scalars are signed Q16.16 int32 words in little-endian order.
contract SeedFeatures {
    error InvalidRange();
    error ValueOutOfRange();

    uint256 private constant Q32 = 1 << 32;
    int256 private constant PI = 13493037705;
    int256 private constant TWO_PI = 26986075409;
    int256 private constant HALF_PI = 6746518852;
    int256 private constant CORDIC_GAIN = 2608131496;
    int256 private constant LN2 = 2977044472;
    int256 private constant LN_TINY = -118674332048;
    bytes private constant ANGLES = hex"c90fdaa276b19c163eb6ebf21fd5ba9b0ffaaddc07ff556f03ffeaab01fffd5500ffffab007ffff5003fffff002000000010000000080000000400000002000000010000000080000000400000002000000010000000080000000400000002000000010000000080000000400000002000000010000000080000000400000002";
    bytes private constant SPATIAL_FREQ = hex"000000010000000000000000d34db04e00000000ae692834000000008ff599e10000000076d31dd800000000621410ee0000000050f44d890000000042d1ed240000000037274d9e000000002d8621c70000000025935e89000000001f03de1f000000001999999a0000000015215e6e000000001170ea6c000000000e655c30000000000be1e9620000000009cece7e0000000008186e270000000006ae97b7000000000583ee2900000000048d69c70000000003c1efdb000000000319fc9d00000000028f5c2900000000021cefd80000000001be7dd8000000000170893800000000013030f00000000000fb14a60000000000cf3e370000000000ab0f2c00000000008d316b0000000000748a94000000000060319600000000004f6610000000000041893700000000003617fc00000000002ca62f000000000024da8600000000001e6b4b0000000000191baa000000000014b96c0000000000111b1e00000000000e1e8b00000000000ba7750000000000099e8f000000000007f09b";
    bytes private constant TIME_FREQ = hex"000000010000000000000000e8949b9b00000000d34db04e00000000bff9112100000000ae692834000000009e748b3d000000008ff599e10000000082ca24f20000000076d31dd8000000006bf44d5300000000621410ee00000000591b1e8f0000000050f44d8900000000498c64b60000000042d1ed24000000003cb508e30000000037274d9e00000000321ba296000000002d8621c700000000295bfbd40000000025935e890000000022235db6000000001f03de1f000000001c2d8263000000001999999a0000000017420f900000000015215e6e00000000133281b6000000001170ea6c000000000fd87453000000000e655c30000000000d1436e5000000000be1e962000000000acba1550000000009cece7e0000000008e91ca80000000008186e2700000000075ad6df0000000006ae97b70000000006121a7d000000000583ee29000000000502c37500000000048d69c7000000000422cc620000000003c1efdb000000000369efc5000000000319fc9d0000000002d159d700000000028f5c2900000000025367f500000000021cefd80000000001eb735f0000000001be7dd8000000000195a53b000000000170893800000000014ed24a00000000013030f00000000001145cef0000000000fb14a60000000000e41c770000000000cf3e370000000000bc48b00000000000ab0f2c00000000009b690d00000000008d316b00000000008046bf0000000000748a94000000000069e13d000000000060319600000000005764c700000000004f66100000000000482295000000000041893700000000003b8a6500000000003617fc000000000031252300000000002ca62f0000000000289086000000000024da860000000000217b6e00000000001e6b4b00000000001ba2e50000000000191baa000000000016cfa6000000000014b96c000000000012d4120000000000111b1e00000000000f8a8100000000000e1e8b00000000000cd3e000000000000ba77500000000000a96860000000000099e8f000000000008bd47000000000007f09b00000000000736a9";

    /// @notice Return all 1,024 noise elements for the exact nonzero uint32 seed.
    function noise(uint32 seed) external pure returns (bytes memory output) {
        if (seed == 0) revert InvalidRange();
        output = new bytes(4096);
        bytes memory angles = ANGLES;
        for (uint256 i; i < 512; ++i) {
            uint32 u;
            uint32 v;
            (seed, u) = _random(seed);
            (seed, v) = _random(seed);
            int256 radius = int256(_isqrt(uint256(-2 * _logUniform(u)) << 32));
            int256 angle = (int256(uint256(v)) * TWO_PI) >> 32;
            (int256 cos, int256 sin) = _sincos(angle, angles);
            _writeI32(output, 8 * i, (radius * cos) / (1 << 48));
            _writeI32(output, 8 * i + 4, (radius * sin) / (1 << 48));
        }
    }

    /// @notice Return the sine and cosine inputs to the learned timestep MLP.
    function timeFeatures(uint8 step) external pure returns (bytes memory output) {
        if (step >= 16) revert InvalidRange();
        bytes memory angles = ANGLES;
        bytes memory freq = TIME_FREQ;
        uint256 tick = 300 - uint256(step) * 19;
        output = new bytes(768);
        for (uint256 i; i < 96; ++i) {
            int256 angle = int256((_read64(freq, i * 8) * 1000 * tick) / 300);
            (int256 cos, int256 sin) = _sincos(angle, angles);
            _writeI32(output, i * 4, sin / 65536);
            _writeI32(output, (96 + i) * 4, cos / 65536);
        }
    }

    /// @notice Return a block of image position rows, ordered by row-major pixel index.
    function spatialFeatures(uint16 first, uint16 count) external pure returns (bytes memory output) {
        if (count == 0 || uint256(first) + count > 256) revert InvalidRange();
        bytes memory angles = ANGLES;
        bytes memory freq = SPATIAL_FREQ;
        bytes memory axis = new bytes(16 * 384);
        for (uint256 coordinate; coordinate < 16; ++coordinate) {
            for (uint256 i; i < 48; ++i) {
                int256 angle = int256(coordinate * _read64(freq, i * 8));
                (int256 cos, int256 sin) = _sincos(angle, angles);
                uint256 offset = coordinate * 384 + i * 4;
                _writeI32(axis, offset, sin / 65536);
                _writeI32(axis, offset + 192, cos / 65536);
            }
        }
        output = new bytes(uint256(count) * 768);
        for (uint256 i; i < count; ++i) {
            uint256 pixel = uint256(first) + i;
            uint256 rowOffset = (pixel >> 4) * 384;
            uint256 colOffset = (pixel & 15) * 384;
            uint256 dest = i * 768;
            assembly ("memory-safe") {
                let data := add(axis, 32)
                let target := add(add(output, 32), dest)
                for { let word := 0 } lt(word, 384) { word := add(word, 32) } {
                    mstore(add(target, word), mload(add(add(data, rowOffset), word)))
                    mstore(add(add(target, 384), word), mload(add(add(data, colOffset), word)))
                }
            }
        }
    }

    function _random(uint32 seed) private pure returns (uint32, uint32) {
        unchecked {
            seed += 0x6D2B79F5;
            uint32 t = (seed ^ (seed >> 15)) * (1 | seed);
            t ^= t + ((t ^ (t >> 7)) * (61 | t));
            return (seed, t ^ (t >> 14));
        }
    }

    function _logUniform(uint32 u) private pure returns (int256) {
        if (u == 0) return LN_TINY;
        uint256 bit = _msb(u);
        uint256 mantissa = uint256(u) << (32 - bit);
        uint256 factor = ((mantissa - Q32) << 32) / (mantissa + Q32);
        uint256 factor2 = (factor * factor) >> 32;
        uint256 total = factor;
        uint256 term = factor;
        for (uint256 i = 1; i < 20; ++i) {
            term = (term * factor2) >> 32;
            total += term / (2 * i + 1);
        }
        return int256(2 * total) + (int256(bit) - 32) * LN2;
    }

    function _sincos(int256 angle, bytes memory angles) private pure returns (int256 x, int256 y) {
        int256 z = (angle + PI) % TWO_PI;
        if (z < 0) z += TWO_PI;
        z -= PI;
        int256 sign = 1;
        if (z > HALF_PI) {
            z = PI - z;
            sign = -1;
        }
        if (z < -HALF_PI) {
            z = -PI - z;
            sign = -1;
        }
        x = CORDIC_GAIN;
        unchecked {
            // All values after angle normalization are within a few Q32 units.
            for (uint256 i; i < 32; ++i) {
                int256 angleI;
                assembly ("memory-safe") {
                    angleI := shr(224, mload(add(add(angles, 32), shl(2, i))))
                }
                if (z >= 0) {
                    (x, y) = (x - (y >> i), y + (x >> i));
                    z -= angleI;
                } else {
                    (x, y) = (x + (y >> i), y - (x >> i));
                    z += angleI;
                }
            }
            x *= sign;
        }
    }

    function _isqrt(uint256 n) private pure returns (uint256) {
        if (n == 0) return 0;
        uint256 x = 1 << ((_msb(n) >> 1) + 1);
        while (true) {
            uint256 y = (x + n / x) >> 1;
            if (y >= x) return x;
            x = y;
        }
        return x;
    }

    function _msb(uint256 n) private pure returns (uint256 index) {
        if (n >> 128 != 0) { n >>= 128; index += 128; }
        if (n >> 64 != 0) { n >>= 64; index += 64; }
        if (n >> 32 != 0) { n >>= 32; index += 32; }
        if (n >> 16 != 0) { n >>= 16; index += 16; }
        if (n >> 8 != 0) { n >>= 8; index += 8; }
        if (n >> 4 != 0) { n >>= 4; index += 4; }
        if (n >> 2 != 0) { n >>= 2; index += 2; }
        if (n >> 1 != 0) index += 1;
    }

    function _read64(bytes memory input, uint256 offset) private pure returns (uint256 value) {
        assembly ("memory-safe") {
            value := shr(192, mload(add(add(input, 32), offset)))
        }
    }

    function _writeI32(bytes memory output, uint256 offset, int256 value) private pure {
        if (value < type(int32).min || value > type(int32).max) revert ValueOutOfRange();
        assembly ("memory-safe") {
            let dest := add(add(output, 32), offset)
            mstore8(dest, value)
            mstore8(add(dest, 1), shr(8, value))
            mstore8(add(dest, 2), shr(16, value))
            mstore8(add(dest, 3), shr(24, value))
        }
    }
}
