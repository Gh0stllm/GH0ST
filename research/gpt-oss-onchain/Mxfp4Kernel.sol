// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Research microkernel, NOT a GPT-OSS inference contract.
/// @dev Exact Q32 dyadic MXFP4 dot product for synthetic signed-int16 activations.
///      Scale domain [96,160]; out-of-domain inputs revert, never silently clamp.
contract Mxfp4Kernel {
    function value2(uint256 n) internal pure returns (int256) {
        uint256 a = n & 7;
        int256 v = a == 0 ? int256(0) : a == 1 ? int256(1) : a == 2 ? int256(2)
            : a == 3 ? int256(3) : a == 4 ? int256(4) : a == 5 ? int256(6)
            : a == 6 ? int256(8) : int256(12);
        return n < 8 ? v : -v;
    }

    function baseline(bytes calldata w, bytes calldata scales, int16[] calldata x)
        external pure returns (int256 result)
    {
        require(w.length % 16 == 0 && scales.length == w.length / 16 && x.length == w.length * 2);
        for (uint256 g; g < scales.length; ++g) {
            uint256 scale = uint8(scales[g]);
            require(scale >= 96 && scale <= 160);
            int256 dot;
            for (uint256 j; j < 32; ++j) {
                uint256 b = uint8(w[g * 16 + j / 2]);
                uint256 nibble = (b >> ((j % 2) * 4)) & 15;
                dot += value2(nibble) * int256(x[g * 32 + j]);
            }
            result += dot * int256(uint256(1) << (scale - 96));
        }
    }

    /// @notice Control: same packed operands/ABI as optimized path, high-level decoder.
    function packedControl(bytes calldata w, bytes calldata scales, bytes calldata x)
        external pure returns (int256 result)
    {
        require(w.length % 16 == 0 && scales.length == w.length / 16 && x.length == w.length * 4);
        for (uint256 g; g < scales.length; ++g) {
            uint256 scale = uint8(scales[g]);
            require(scale >= 96 && scale <= 160);
            int256 dot;
            for (uint256 j; j < 32; ++j) {
                uint256 b = uint8(w[g * 16 + j / 2]);
                uint256 nibble = (b >> ((j % 2) * 4)) & 15;
                uint256 p = 2 * (g * 32 + j);
                int16 a = int16(uint16(uint8(x[p])) * 256 + uint16(uint8(x[p + 1])));
                dot += value2(nibble) * int256(a);
            }
            result += dot * int256(uint256(1) << (scale - 96));
        }
    }

    /// @dev Same arithmetic; decode one byte as two FP4 values, byte lookup,
    ///      load sign-extended packed int16 operands directly from calldata.
    function packed(bytes calldata w, bytes calldata scales, bytes calldata x)
        external pure returns (int256 result)
    {
        require(w.length % 16 == 0 && scales.length == w.length / 16 && x.length == w.length * 4);
        for (uint256 g; g < scales.length; ++g) {
            uint256 scale = uint8(scales[g]);
            require(scale >= 96 && scale <= 160);
            int256 dot;
            assembly ("memory-safe") {
                // signed int8 table of twice the exact E2M1 values.
                let lut := 0x000102030406080c00fffefdfcfaf8f400000000000000000000000000000000
                let wp := add(w.offset, mul(g, 16))
                let xp := add(x.offset, mul(g, 64))
                for { let j := 0 } lt(j, 16) { j := add(j, 1) } {
                    let b := byte(0, calldataload(add(wp, j)))
                    let a := calldataload(add(xp, mul(j, 4)))
                    let v0 := signextend(0, byte(and(b, 15), lut))
                    let v1 := signextend(0, byte(shr(4, b), lut))
                    let x0 := signextend(1, shr(240, a))
                    let x1 := signextend(1, and(shr(224, a), 65535))
                    dot := add(dot, add(mul(v0, x0), mul(v1, x1)))
                }
            }
            // Bounds: <= 12*32768*32 per block, scaled by <= 2**64;
            // Solidity checked sum prevents overflow across arbitrarily many blocks.
            result += dot * int256(uint256(1) << (scale - 96));
        }
    }
}
