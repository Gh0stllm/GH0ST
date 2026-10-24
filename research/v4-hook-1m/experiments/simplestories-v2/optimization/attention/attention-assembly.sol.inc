    /// @dev Exact attention arithmetic for int32 query/key/value tensors.
    /// Products and sums fit int256; nonnegative table weights make the final
    /// weighted mean lie within the original int32 value range.
    function _attention(Work memory w, uint256 position, bytes memory tables) private pure {
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
