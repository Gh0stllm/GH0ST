// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract LocalAttentionProbe {
int256 private constant Q = 4096;
uint256 private constant HIDDEN = 128;
error ArithmeticRange();
struct Work {
        int32[] hidden;
        int32[] query;
        int32[] key;
        int32[] value;
        int32[] norm;
        int32[] qTemp;
        int32[] kTemp;
        int32[] vTemp;
        int32[] attention;
        int32[] projection;
        int32[] gate;
        int32[] up;
        int256[] scores;
        uint256[] probabilities;
    }
function _u32(bytes memory data, uint256 byteOffset) private pure returns (uint256 value) {
        assembly ("memory-safe") { value := shr(224, mload(add(add(data, 32), byteOffset))) }
    }
function _checked(int256 value) private pure returns (int32) {
        if (value < type(int32).min || value > type(int32).max) revert ArithmeticRange();
        return int32(value);
    }
function _table(bytes memory tables, uint256 offset, uint256 distance, uint256 endpoint) private pure returns (uint256) {
        uint256 scaled = distance * 16;
        uint256 index = scaled / uint256(Q);
        if (index >= 256) return endpoint;
        uint256 remainder = scaled % uint256(Q);
        return (_u32(tables, offset + index * 4) * (uint256(Q) - remainder)
            + _u32(tables, offset + (index + 1) * 4) * remainder) / uint256(Q);
    }
function _attentionOld(Work memory w, uint256 position, bytes memory tables) private pure {
        for (uint256 head; head < 4; ++head) {
            int256 maximum = type(int256).min;
            for (uint256 past; past <= position; ++past) {
                int256 sum;
                uint256 qOffset = position * HIDDEN + head * 32;
                uint256 kOffset = past * 64 + (head / 2) * 32;
                for (uint256 j; j < 32; ++j) sum += int256(w.query[qOffset + j]) * int256(w.key[kOffset + j]);
                int256 score = sum / 23170;
                w.scores[past] = score;
                if (score > maximum) maximum = score;
            }
            uint256 denominator;
            for (uint256 past; past <= position; ++past) {
                uint256 probability = _table(tables, 2052, uint256(maximum - w.scores[past]), 0);
                w.probabilities[past] = probability;
                denominator += probability;
            }
            for (uint256 j; j < 32; ++j) {
                int256 sum;
                for (uint256 past; past <= position; ++past)
                    sum += int256(w.probabilities[past]) * int256(w.value[past * 64 + (head / 2) * 32 + j]);
                w.attention[head * 32 + j] = _checked(sum / int256(denominator));
            }
        }
    }
    /// @dev Exact attention arithmetic for int32 query/key/value tensors.
    /// Products and sums fit int256; nonnegative table weights make the final
    /// weighted mean lie within the original int32 value range.
    function _attentionNew(Work memory w, uint256 position, bytes memory tables) private pure {
        assembly ("memory-safe") {
            let queries := add(mload(add(w, 32)), 32)
            let keys := add(mload(add(w, 64)), 32)
            let values := add(mload(add(w, 96)), 32)
            let output := add(mload(add(w, 256)), 32)
            let scores := add(mload(add(w, 384)), 32)
            let probabilities := add(mload(add(w, 416)), 32)
            let exponents := add(add(tables, 32), 2052)
            let count := add(position, 1)
            for { let head := 0 } lt(head, 4) { head := add(head, 1) } {
                let q := add(queries, shl(5, add(shl(7, position), shl(5, head))))
                let kvHead := shl(5, shr(1, head))
                let maximum := shl(255, 1)
                for { let past := 0 } lt(past, count) { past := add(past, 1) } {
                    let k := add(keys, shl(5, add(shl(6, past), kvHead)))
                    let sum := 0
                    for { let j := 0 } lt(j, 1024) { j := add(j, 128) } {
                        sum := add(sum, mul(signextend(3, mload(add(q, j))), signextend(3, mload(add(k, j)))))
                        sum := add(sum, mul(signextend(3, mload(add(q, add(j, 32)))), signextend(3, mload(add(k, add(j, 32))))))
                        sum := add(sum, mul(signextend(3, mload(add(q, add(j, 64)))), signextend(3, mload(add(k, add(j, 64))))))
                        sum := add(sum, mul(signextend(3, mload(add(q, add(j, 96)))), signextend(3, mload(add(k, add(j, 96))))))
                    }
                    let score := sdiv(sum, 23170)
                    mstore(add(scores, shl(5, past)), score)
                    if sgt(score, maximum) { maximum := score }
                }
                let denominator := 0
                for { let past := 0 } lt(past, count) { past := add(past, 1) } {
                    let distance := sub(maximum, mload(add(scores, shl(5, past))))
                    let scaled := shl(4, distance)
                    let index := shr(12, scaled)
                    let probability := 0
                    if lt(index, 256) {
                        let remainder := and(scaled, 4095)
                        let at := add(exponents, shl(2, index))
                        let first := shr(224, mload(at))
                        let second := shr(224, mload(add(at, 4)))
                        probability := shr(12, add(mul(first, sub(4096, remainder)), mul(second, remainder)))
                    }
                    mstore(add(probabilities, shl(5, past)), probability)
                    denominator := add(denominator, probability)
                }
                // Solidity division-by-zero semantics are preserved even for a
                // malformed all-zero exponent table supplied to the local probe.
                if iszero(denominator) {
                    mstore(0, shl(224, 0x4e487b71))
                    mstore(4, 0x12)
                    revert(0, 36)
                }
                for { let j := 0 } lt(j, 32) { j := add(j, 1) } {
                    let sum := 0
                    for { let past := 0 } lt(past, count) { past := add(past, 1) } {
                        let value := signextend(3, mload(add(values, shl(5, add(add(shl(6, past), kvHead), j)))))
                        sum := add(sum, mul(mload(add(probabilities, shl(5, past))), value))
                    }
                    mstore(add(output, shl(5, add(shl(5, head), j))), sdiv(sum, denominator))
                }
            }
        }
    }

function evaluate(bool optimized, int32[] memory query, int32[] memory key, int32[] memory value,
uint256 position, bytes memory tables) external view returns (int32[] memory output, uint256 measuredGas) {
require(position < 16 && query.length == (position+1)*128 && key.length == (position+1)*64 && value.length == key.length);
require(tables.length == 3080);
Work memory w;
w.query = query; w.key = key; w.value = value;
w.attention = new int32[](128); w.scores = new int256[](position+1); w.probabilities = new uint256[](position+1);
uint256 beforeGas = gasleft();
if (optimized) _attentionNew(w, position, tables); else _attentionOld(w, position, tables);
measuredGas = beforeGas - gasleft();
output = w.attention;
}
}