// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Exact arithmetic for the gh0st-s0ul-integer-v1 inference format.
/// @dev All metadata conversion is offline. No floating point, host results,
///      caller-supplied logits or approximate host arithmetic is used here.
library S0ULMath {
    int256 internal constant LIMIT = 1048575;
    uint256 internal constant ONE = 16384;
    uint256 internal constant SCALE = 16777216;
    uint256 internal constant LUT_ENTRIES = 4097;

    error InvalidDimensions();
    error InvalidNumericValue();
    error InvalidEncoding();

    /// @notice Read one signed, little-endian INT64 without changing its value.
    function readLE(bytes memory data, uint256 offset) internal pure returns (int256 result) {
        if (offset > data.length || data.length - offset < 8) revert InvalidEncoding();
        assembly ("memory-safe") {
            let word := mload(add(add(data, 32), offset))
            let value := byte(0, word)
            value := or(value, shl(8, byte(1, word)))
            value := or(value, shl(16, byte(2, word)))
            value := or(value, shl(24, byte(3, word)))
            value := or(value, shl(32, byte(4, word)))
            value := or(value, shl(40, byte(5, word)))
            value := or(value, shl(48, byte(6, word)))
            value := or(value, shl(56, byte(7, word)))
            result := signextend(7, value)
        }
    }

    /// @notice Nearest signed integer; exact halfway cases round away from zero.
    function roundDiv(int256 value, uint256 denominator) internal pure returns (int256) {
        if (denominator == 0 || value == type(int256).min) revert InvalidNumericValue();
        uint256 absolute = uint256(value < 0 ? -value : value);
        uint256 quotient = absolute / denominator;
        uint256 remainder = absolute % denominator;
        if (remainder >= denominator / 2 + denominator % 2) ++quotient;
        return value < 0 ? -int256(quotient) : int256(quotient);
    }

    /// @return result Q14 value clipped to the specified v1 activation range.
    /// @return saturated One exactly when clipping changed the supplied value.
    function clip(int256 value) internal pure returns (int32 result, uint256 saturated) {
        if (value > LIMIT) return (int32(LIMIT), 1);
        if (value < -LIMIT) return (int32(-LIMIT), 1);
        return (int32(value), 0);
    }

    function _bounded(int32[] memory values) private pure {
        for (uint256 i; i < values.length; ++i) {
            int256 value = values[i];
            if (value > LIMIT || value < -LIMIT) revert InvalidNumericValue();
        }
    }

    /// @notice INT8 row-major matrix multiplication and Q24 requantization.
    /// @dev The inference scheduler may pass any contiguous group of rows.
    function linear(bytes memory weights, bytes memory scales, int32[] memory x)
        internal pure returns (int32[] memory output, uint256 saturated)
    {
        uint256 width = x.length;
        if (width == 0 || width > 640 || weights.length == 0 || weights.length % width != 0)
            revert InvalidDimensions();
        uint256 rows = weights.length / width;
        if (rows > 640 || scales.length != rows * 8) revert InvalidDimensions();
        _bounded(x);
        output = new int32[](rows);
        for (uint256 row; row < rows; ++row) {
            int256 scale = readLE(scales, row * 8);
            if (scale < 1 || scale > int256(SCALE)) revert InvalidNumericValue();
            int256 dot;
            uint256 badWeight;
            assembly ("memory-safe") {
                let source := add(add(weights, 32), mul(row, width))
                let input := add(x, 32)
                let end := add(source, width)
                for { } lt(source, end) { source := add(source, 1) input := add(input, 32) } {
                    let weight := signextend(0, byte(0, mload(source)))
                    badWeight := or(badWeight, eq(weight, sub(0, 128)))
                    dot := add(dot, mul(weight, mload(input)))
                }
            }
            if (badWeight != 0) revert InvalidNumericValue();
            uint256 count;
            (output[row], count) = clip(roundDiv(dot * scale, SCALE));
            saturated += count;
        }
    }

    /// @notice floor(sqrt(value)), including the exact zero boundary.
    function sqrt(uint256 value) internal pure returns (uint256 result) {
        if (value == 0) return 0;
        uint256 x = value;
        uint256 exponent;
        if (x >> 128 != 0) { x >>= 128; exponent += 128; }
        if (x >> 64 != 0) { x >>= 64; exponent += 64; }
        if (x >> 32 != 0) { x >>= 32; exponent += 32; }
        if (x >> 16 != 0) { x >>= 16; exponent += 16; }
        if (x >> 8 != 0) { x >>= 8; exponent += 8; }
        if (x >> 4 != 0) { x >>= 4; exponent += 4; }
        if (x >> 2 != 0) { x >>= 2; exponent += 2; }
        if (x >> 1 != 0) exponent += 1;
        result = uint256(1) << (exponent / 2);
        // Seven Newton steps suffice for a 256-bit input with this initial seed.
        unchecked {
            for (uint256 i; i < 7; ++i) result = (result + value / result) / 2;
            uint256 other = value / result;
            if (other < result) result = other;
        }
    }

    /// @notice Integer RMSNorm, preserving both specified rounding boundaries.
    function norm(int32[] memory x, bytes memory gains, uint256 epsQ28)
        internal pure returns (int32[] memory output, uint256 saturated)
    {
        uint256 width = x.length;
        if (width == 0 || width > 640 || gains.length != width * 8) revert InvalidDimensions();
        if (epsQ28 == 0 || epsQ28 > (uint256(1) << 28)) revert InvalidNumericValue();
        _bounded(x);
        uint256 squares;
        for (uint256 i; i < width; ++i) {
            int256 value = x[i];
            squares += uint256(value * value);
        }
        uint256 root = sqrt(squares / width + epsQ28);
        output = new int32[](width);
        for (uint256 i; i < width; ++i) {
            int256 gain = readLE(gains, i * 8);
            if (gain > LIMIT || gain < -LIMIT) revert InvalidNumericValue();
            int256 normalized = roundDiv(int256(x[i]) * int256(ONE), root);
            uint256 count;
            (output[i], count) = clip(roundDiv(normalized * gain, ONE));
            saturated += count;
        }
    }

    /// @notice Adjacent-pair RoPE for one position, using one shared head table row.
    function rope(int32[] memory x, bytes memory cosRow, bytes memory sinRow, uint256 heads)
        internal pure returns (int32[] memory output, uint256 saturated)
    {
        if (x.length == 0 || x.length > 128 || heads == 0 || heads > 4 || x.length % heads != 0)
            revert InvalidDimensions();
        uint256 width = x.length / heads;
        if (width % 2 != 0 || cosRow.length != width / 2 * 8 || sinRow.length != cosRow.length)
            revert InvalidDimensions();
        _bounded(x);
        output = new int32[](x.length);
        for (uint256 head; head < heads; ++head) {
            for (uint256 pair; pair < width / 2; ++pair) {
                int256 cosine = readLE(cosRow, pair * 8);
                int256 sine = readLE(sinRow, pair * 8);
                if (cosine > int256(ONE) || cosine < -int256(ONE) || sine > int256(ONE) || sine < -int256(ONE))
                    revert InvalidNumericValue();
                uint256 index = head * width + pair * 2;
                int256 a = x[index];
                int256 b = x[index + 1];
                uint256 count;
                (output[index], count) = clip(roundDiv(a * cosine - b * sine, ONE));
                saturated += count;
                (output[index + 1], count) = clip(roundDiv(a * sine + b * cosine, ONE));
                saturated += count;
            }
        }
    }

    function _attentionScores(int32[] memory query, int32[] memory keys, uint256 positions, uint256 scale)
        private pure returns (int256[] memory scores, int256 maximum)
    {
        uint256 width = query.length;
        scores = new int256[](positions);
        maximum = type(int256).min;
        for (uint256 position; position < positions; ++position) {
            int256 dot;
            assembly ("memory-safe") {
                let q := add(query, 32)
                let k := add(add(keys, 32), mul(mul(position, width), 32))
                let end := add(q, mul(width, 32))
                for { } lt(q, end) { q := add(q, 32) k := add(k, 32) } {
                    dot := add(dot, mul(mload(q), mload(k)))
                }
            }
            int256 score = roundDiv(dot * int256(scale), uint256(1) << 28);
            scores[position] = score;
            if (score > maximum) maximum = score;
        }
    }

    /// @notice Complete causal attention for one head and the current position.
    /// @dev keys/values contain only positions 0..current, not future positions.
    function attentionHead(int32[] memory query, int32[] memory keys, int32[] memory values,
                           bytes memory lut, uint256 attentionScaleQ14)
        internal pure returns (int32[] memory output)
    {
        uint256 width = query.length;
        if (width == 0 || width > 128 || keys.length == 0 || keys.length % width != 0 || values.length != keys.length)
            revert InvalidDimensions();
        uint256 positions = keys.length / width;
        if (positions > 128 || lut.length != LUT_ENTRIES * 8) revert InvalidDimensions();
        if (attentionScaleQ14 == 0 || attentionScaleQ14 > ONE || readLE(lut, 0) != int256(SCALE))
            revert InvalidNumericValue();
        _bounded(query);
        _bounded(keys);
        _bounded(values);
        (int256[] memory scores, int256 maximum) = _attentionScores(query, keys, positions, attentionScaleQ14);
        int256[] memory weights = new int256[](positions);
        uint256 denominator;
        for (uint256 position; position < positions; ++position) {
            uint256 distance = uint256(maximum - scores[position]);
            if (distance > 16 * ONE) distance = 16 * ONE;
            uint256 index = distance / 64;
            uint256 fraction = distance % 64;
            int256 left = readLE(lut, index * 8);
            int256 right = readLE(lut, (index == LUT_ENTRIES - 1 ? index : index + 1) * 8);
            if (left <= 0 || left > int256(SCALE) || right <= 0 || right > left) revert InvalidNumericValue();
            int256 weight = roundDiv(left * int256(64 - fraction) + right * int256(fraction), 64);
            weights[position] = weight;
            denominator += uint256(weight);
        }
        output = new int32[](width);
        for (uint256 channel; channel < width; ++channel) {
            int256 sum;
            for (uint256 position; position < positions; ++position)
                sum += weights[position] * int256(values[position * width + channel]);
            // Positive softmax weights make this a convex combination of
            // bounded input values, so no additional v1 saturation is applied.
            output[channel] = int32(roundDiv(sum, denominator));
        }
    }
}
