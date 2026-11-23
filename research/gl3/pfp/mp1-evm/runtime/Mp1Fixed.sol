// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Fixed-point operations for the pinned M-P1 Q5 inference graph.
/// @dev Tensors are signed int32 little-endian values at Q16.16.
contract Mp1Fixed {
    error InvalidShape();
    error ActivationOverflow();

    int256 private constant Q16 = 65536;
    int256 private constant Q24 = 16777216;
    uint256 private constant ROW_BYTES = 48 * 4;
    uint256 private constant MAX_TOKENS = 269;
    // Q24 samples of 2^(-i/256) for i=0..256.
    bytes private constant EXP_TABLE = hex"0100000000ff4ecb00fe9e1100fdedd200fd3e0c00fc8ec000fbdfed00fb319400fa83b300f9d64a00f9295a00f87ce100f7d0df00f7255500f67a4100f5cfa400f5257d00f47bcc00f3d29000f329c900f2817700f1d99a00f1323100f08b3b00efe4ba00ef3eab00ee991000edf3e700ed4f3000ecaaec00ec071900eb63b700eac0c700ea1e4700e97c3800e8da9900e8396a00e798ab00e6f85b00e6587900e5b90700e51a0300e47b6d00e3dd4400e33f8900e2a23c00e2055b00e168e700e0ccdf00e0314300df961300defb4e00de60f500ddc70600dd2d8200dc946800dbfbb800db637100dacb9400da342100d99d1600d9067300d8703900d7da6700d744fd00d6affa00d61b5e00d5872900d4f35b00d45ff300d3ccf100d33a5400d2a81e00d2164c00d184df00d0f3d700d0633400cfd2f400cf431900ceb3a100ce248c00cd95da00cd078c00cc799f00cbec1500cb5eed00cad22600ca45c100c9b9be00c92e1b00c8a2d800c817f700c78d7500c7035300c6799100c5f02e00c5672a00c4de8500c4563f00c3ce5700c346cd00c2bfa100c238d200c1b26100c12c4d00c0a69500c0213b00bf9c3c00bf179a00be935300be0f6800bd8bd800bd08a400bc85ca00bc034a00bb812600baff5b00ba7dea00b9fcd200b97c1400b8fbaf00b87ba300b7fbf000b77c9500b6fd9200b67ee700b6009400b5829800b504f300b487a600b40aaf00b38e0e00b311c400b295d000b21a3200b19ee900b123f600b0a95700b02f0e00afb51900af3b7900aec22d00ae493400add09000ad583f00ace04100ac689700abf13f00ab7a3a00ab038700aa8d2600aa171800a9a15b00a92bef00a8b6d500a8420c00a7cd9400a7596c00a6e59500a6720e00a5fed700a58bef00a5195800a4a70f00a4351600a3c36b00a3520f00a2e10200a2704300a1ffd200a18faf00a11fd900a0b05100a04116009fd228009f6387009ef532009e872a009e196e009dabfe009d3eda009cd201009c6573009bf931009b8d3a009b218d009ab62b009a4b130099e046009975c200990b880098a197009837f00097ce920097657d0096fcb10096942d00962bf20095c3ff00955c530094f4f000948dd4009426ff0093c07200935a2b0092f42c00928e72009229000091c3d300915eed0090fa4d009095f2009031dc008fce0c008f6a81008f073b008ea43a008e417d008ddf04008d7cd0008d1adf008cb933008c57ca008bf6a4008b95c2008b3523008ad4c6008a74ad008a14d50089b541008955ee0088f6dd0088980f008839810087db3500877d2b00871f620086c1d9008664910086078a0085aac300854e3d0084f1f6008495f000843a290083dea100838359008328500082cd87008272fc008218af0081bea1008164d200810b410080b1ed008058d800800000";

    function readI32(bytes calldata tensor, uint256 index) private pure returns (int256 v) {
        assembly ("memory-safe") {
            let word := shr(224, calldataload(add(tensor.offset, shl(2, index))))
            v := signextend(3, or(
                or(shr(24, word), and(shr(8, word), 0xff00)),
                or(and(shl(8, word), 0xff0000), shl(24, and(word, 0xff)))
            ))
        }
    }

    function writeI32(bytes memory tensor, uint256 index, int256 value) private pure {
        if (value < type(int32).min || value > type(int32).max) revert ActivationOverflow();
        assembly ("memory-safe") {
            let pos := add(add(tensor, 32), shl(2, index))
            mstore8(pos, value)
            mstore8(add(pos, 1), shr(8, value))
            mstore8(add(pos, 2), shr(16, value))
            mstore8(add(pos, 3), shr(24, value))
        }
    }

    function sqrtFloor(uint256 value) private pure returns (uint256) {
        if (value == 0) return 0;
        uint256 high = value;
        uint256 x = 1;
        if (high >= 1 << 128) { high >>= 128; x <<= 64; }
        if (high >= 1 << 64) { high >>= 64; x <<= 32; }
        if (high >= 1 << 32) { high >>= 32; x <<= 16; }
        if (high >= 1 << 16) { high >>= 16; x <<= 8; }
        if (high >= 1 << 8) { high >>= 8; x <<= 4; }
        if (high >= 1 << 4) { high >>= 4; x <<= 2; }
        if (high >= 1 << 2) x <<= 1;
        unchecked {
            for (uint256 i; i < 7; ++i) x = (x + value / x) >> 1;
            uint256 other = value / x;
            return x < other ? x : other;
        }
    }

    function tableValue(bytes memory table, uint256 index) private pure returns (uint256 value) {
        assembly ("memory-safe") {
            value := shr(224, mload(add(add(table, 32), shl(2, index))))
        }
    }

    function expNeg(bytes memory table, uint256 xQ16) private pure returns (uint256) {
        uint256 scaled = xQ16 * 94548 / uint256(Q16);
        uint256 shift = scaled >> 16;
        if (shift >= 25) return 0;
        uint256 index = (scaled >> 8) & 255;
        uint256 remainder = scaled & 255;
        uint256 fraction = tableValue(table, index) * (256 - remainder)
            + tableValue(table, index + 1) * remainder;
        return (fraction >> 8) >> shift;
    }

    function normalize(bytes calldata input, bytes calldata gain, bytes calldata bias)
        external pure returns (bytes memory output)
    {
        uint256 size = input.length;
        if (size == 0 || size > 192 * 4 || size % 4 != 0 || gain.length != size || bias.length != size) {
            revert InvalidShape();
        }
        uint256 count = size / 4;
        int256 mean;
        for (uint256 i; i < count; ++i) mean += readI32(input, i);
        mean /= int256(count);
        uint256 variance;
        for (uint256 i; i < count; ++i) {
            int256 delta = readI32(input, i) - mean;
            variance += uint256(delta * delta);
        }
        int256 sigma = int256(sqrtFloor(variance / count + 42950));
        output = new bytes(size);
        for (uint256 i; i < count; ++i) {
            int256 delta = readI32(input, i) - mean;
            writeI32(output, i, delta * readI32(gain, i) / sigma + readI32(bias, i));
        }
    }

    function silu(bytes calldata input) external pure returns (bytes memory output) {
        if (input.length == 0 || input.length > 192 * 4 || input.length % 4 != 0) revert InvalidShape();
        output = new bytes(input.length);
        bytes memory table = EXP_TABLE;
        for (uint256 i; i < input.length / 4; ++i) {
            int256 x = readI32(input, i);
            int256 exp = int256(expNeg(table, uint256(x >= 0 ? x : -x)));
            writeI32(output, i, x * (x >= 0 ? Q24 : exp) / (Q24 + exp));
        }
    }

    // At most 48 products of two signed 32-bit inputs fit in the wide accumulator.
    function dotRow(int256[48] memory queryWords, bytes calldata input, uint256 row)
        private pure returns (int256 dot)
    {
        assembly ("memory-safe") {
            function readWord(offset) -> value {
                let w := shr(224, calldataload(offset))
                value := signextend(3, or(or(shr(24, w), and(shr(8, w), 0xff00)),
                    or(and(shl(8, w), 0xff0000), shl(24, and(w, 0xff)))))
            }
            let begin := add(input.offset, mul(row, 192))
            for { let c := 0 } lt(c, 48) { c := add(c, 1) } {
                dot := add(dot, mul(mload(add(queryWords, shl(5, c))), readWord(add(begin, shl(2, c)))))
            }
        }
    }

    // Q24 weights and up to 269 signed 32-bit values stay in int256 range.
    function accumulateRow(int256[48] memory sums, bytes calldata input, uint256 row, int256 weight) private pure {
        assembly ("memory-safe") {
            function readWord(offset) -> value {
                let w := shr(224, calldataload(offset))
                value := signextend(3, or(or(shr(24, w), and(shr(8, w), 0xff00)),
                    or(and(shl(8, w), 0xff0000), shl(24, and(w, 0xff)))))
            }
            let begin := add(input.offset, mul(row, 192))
            for { let c := 0 } lt(c, 48) { c := add(c, 1) } {
                let out := add(sums, shl(5, c))
                mstore(out, add(mload(out), mul(weight, readWord(add(begin, shl(2, c))))))
            }
        }
    }

    /// @notice Compute one query against a complete attention head.
    function attention(bytes calldata query, bytes calldata keys, bytes calldata values)
        external pure returns (bytes memory output)
    {
        if (query.length != ROW_BYTES) revert InvalidShape();
        validateAttentionData(keys,values);
        return attentionRow(query,keys,values);
    }

    /// @notice Evaluate up to four queries while transmitting the head's keys and values once.
    function attentionBatch(bytes calldata queries, bytes calldata keys, bytes calldata values)
        external pure returns (bytes memory output)
    {
        if (queries.length == 0 || queries.length > 4 * ROW_BYTES || queries.length % ROW_BYTES != 0) {
            revert InvalidShape();
        }
        validateAttentionData(keys,values);
        output = new bytes(queries.length);
        for (uint256 offset; offset < queries.length; offset += ROW_BYTES) {
            bytes memory row = attentionRow(queries[offset:offset + ROW_BYTES],keys,values);
            assembly ("memory-safe") {
                let start := add(add(output, 32), offset)
                for { let word := 0 } lt(word, 192) { word := add(word, 32) } {
                    mstore(add(start, word), mload(add(add(row, 32), word)))
                }
            }
        }
    }

    function validateAttentionData(bytes calldata keys, bytes calldata values) private pure {
        if (keys.length == 0 || keys.length != values.length || keys.length % ROW_BYTES != 0
            || keys.length > MAX_TOKENS * ROW_BYTES) revert InvalidShape();
    }

    function attentionRow(bytes calldata query, bytes calldata keys, bytes calldata values)
        private pure returns (bytes memory output)
    {
        uint256 tokens = keys.length / ROW_BYTES;
        int256[] memory scores = new int256[](tokens);
        int256[48] memory queryWords;
        for (uint256 c; c < 48; ++c) queryWords[c] = readI32(query, c);
        int256 maxScore = type(int256).min;
        for (uint256 j; j < tokens; ++j) {
            int256 score = (dotRow(queryWords, keys, j) / Q16) * 2421583 / Q24;
            scores[j] = score;
            if (score > maxScore) maxScore = score;
        }

        bytes memory table = EXP_TABLE;
        int256 totalWeight;
        int256[48] memory sums;
        for (uint256 j; j < tokens; ++j) {
            int256 weight = int256(expNeg(table, uint256(maxScore - scores[j])));
            totalWeight += weight;
            if (weight != 0) accumulateRow(sums, values, j, weight);
        }
        output = new bytes(ROW_BYTES);
        for (uint256 c; c < 48; ++c) writeI32(output, c, sums[c] / totalWeight);
    }

    /// @notice Apply fixed 1.5 guidance and one of the 16 publisher Euler steps.
    function euler(bytes calldata latent, bytes calldata conditional, bytes calldata unconditional, uint8 step)
        external pure returns (bytes memory output)
    {
        uint256 size = latent.length;
        if (step >= 16 || size == 0 || size > 4096 || size % 4 != 0
            || conditional.length != size || unconditional.length != size) revert InvalidShape();
        int256 t = 300 - 19 * int256(uint256(step));
        int256 next = step == 15 ? int256(0) : t - 19;
        output = new bytes(size);
        for (uint256 i; i < size / 4; ++i) {
            int256 prediction = (3 * readI32(conditional, i) - readI32(unconditional, i)) / 2;
            int256 z = (next * readI32(latent, i) + (t - next) * prediction) / t;
            writeI32(output, i, z);
        }
    }
}
