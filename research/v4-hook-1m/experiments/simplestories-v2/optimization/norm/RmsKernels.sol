// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract RmsKernels {
    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        assembly ("memory-safe") {
            let v := x
            z := 1
            if shr(128, v) { v := shr(128, v) z := shl(64, z) }
            if shr(64, v) { v := shr(64, v) z := shl(32, z) }
            if shr(32, v) { v := shr(32, v) z := shl(16, z) }
            if shr(16, v) { v := shr(16, v) z := shl(8, z) }
            if shr(8, v) { v := shr(8, v) z := shl(4, z) }
            if shr(4, v) { v := shr(4, v) z := shl(2, z) }
            if shr(2, v) { z := shl(1, z) }
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            let q := div(x, z)
            if lt(q, z) { z := q }
        }
    }

    function _rms(int32[] memory input, uint256 inputOffset, bytes memory weights, uint256 weightOffset, int32[] memory output) private pure {
        uint256 squares;
        assembly ("memory-safe") {
            let p := add(add(input, 32), shl(5, inputOffset))
            let end := add(p, 4096)
            for {} lt(p, end) { p := add(p, 128) } {
                let a := signextend(3, mload(p))
                let b := signextend(3, mload(add(p, 32)))
                let c := signextend(3, mload(add(p, 64)))
                let d := signextend(3, mload(add(p, 96)))
                squares := add(squares, add(add(mul(a, a), mul(b, b)), add(mul(c, c), mul(d, d))))
            }
        }
        uint256 denominator = _sqrt(squares / 128 + 17);
        assembly ("memory-safe") {
            let p := add(add(input, 32), shl(5, inputOffset))
            let out := add(output, 32)
            let gamma := add(add(weights, 32), weightOffset)
            let end := add(p, 4096)
            for {} lt(p, end) { p := add(p, 32) out := add(out, 32) gamma := add(gamma, 2) } {
                let normal := sdiv(shl(12, signextend(3, mload(p))), denominator)
                let w := signextend(1, shr(240, mload(gamma)))
                mstore(out, sdiv(mul(normal, w), 4096))
            }
        }
        // For int32 input, epsilon17 gives denominator>=4. The normalized
        // magnitude is <57927; any int16 gamma keeps this result in int32.
    }

    function fast(int32[] memory input, uint256 offset, bytes memory weights, uint256 weightOffset) external pure returns (int32[] memory out) {
        require(input.length >= offset + 128 && weights.length >= weightOffset + 256);
        out = new int32[](128);
        _rms(input, offset, weights, weightOffset, out);
    }

    function slow(int32[] memory input, uint256 offset, bytes memory weights, uint256 weightOffset) external pure returns (int32[] memory out) {
        require(input.length >= offset + 128 && weights.length >= weightOffset + 256);
        uint256 squares;
        for (uint256 i; i < 128; ++i) { int256 x = input[offset + i]; squares += uint256(x * x); }
        uint256 value = squares / 128 + 17;
        uint256 z = value;
        uint256 y = (value + 1) / 2;
        while (y < z) { z = y; y = (value / y + y) / 2; }
        out = new int32[](128);
        for (uint256 i; i < 128; ++i) {
            int256 w;
            uint256 at = weightOffset + i * 2;
            assembly ("memory-safe") { w := signextend(1, shr(240, mload(add(add(weights, 32), at)))) }
            int256 normalized = int256(input[offset + i]) * 4096 / int256(z);
            int256 result = normalized * w / 4096;
            require(result >= type(int32).min && result <= type(int32).max);
            out[i] = int32(result);
        }
    }
}
