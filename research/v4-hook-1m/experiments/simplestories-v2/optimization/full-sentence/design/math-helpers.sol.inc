    /// @dev Exact split-half Q12 RoPE. Rejects int32 overflow like the reference.
    function _rope(int32[] memory input, int32[] memory output, uint256 outputOffset,
        uint256 heads, uint256 position, bytes memory tables) private pure
    {
        assembly ("memory-safe") {
            let source := add(input, 32)
            let destination := add(add(output, 32), shl(5, outputOffset))
            let cosine := add(add(tables, 32), shl(5, position))
            let sine := add(cosine, 512)
            for { let head := 0 } lt(head, heads) { head := add(head, 1) } {
                let start := shl(10, head)
                for { let j := 0 } lt(j, 16) { j := add(j, 1) } {
                    let at := add(start, shl(5, j))
                    let first := signextend(3, mload(add(source, at)))
                    let second := signextend(3, mload(add(source, add(at, 512))))
                    let c := signextend(1, shr(240, mload(add(cosine, shl(1, j)))))
                    let s := signextend(1, shr(240, mload(add(sine, shl(1, j)))))
                    let a := sdiv(sub(mul(first, c), mul(second, s)), 4096)
                    let b := sdiv(add(mul(second, c), mul(first, s)), 4096)
                    if or(gt(add(a, 0x80000000), 0xffffffff), gt(add(b, 0x80000000), 0xffffffff)) {
                        mstore(0, shl(224, 0x6b6b0562))
                        revert(0, 4)
                    }
                    mstore(add(destination, at), a)
                    mstore(add(destination, add(at, 512)), b)
                }
            }
        }
    }

    /// @dev Performs exactly trunc(SiLU(gate[i])*up[i]/4096), in place.
    function _siluMultiply(int32[] memory gate, int32[] memory up, bytes memory tables) private pure {
        assembly ("memory-safe") {
            let g := add(gate, 32)
            let u := add(up, 32)
            let end := add(g, shl(5, mload(gate)))
            let sigmoid := add(add(tables, 32), 1024)
            for {} lt(g, end) { g := add(g, 32) u := add(u, 32) } {
                let x := signextend(3, mload(g))
                let magnitude := x
                if slt(x, 0) { magnitude := sub(0, x) }
                let index := shr(8, magnitude)
                let probability := 65536
                if lt(index, 256) {
                    let remainder := and(magnitude, 255)
                    let at := add(sigmoid, shl(2, index))
                    let first := shr(224, mload(at))
                    let second := shr(224, mload(add(at, 4)))
                    probability := shr(8, add(mul(first, sub(256, remainder)), mul(second, remainder)))
                }
                if slt(x, 0) { probability := sub(65536, probability) }
                let activated := sdiv(mul(x, probability), 65536)
                let result := sdiv(mul(activated, signextend(3, mload(u))), 4096)
                if gt(add(result, 0x80000000), 0xffffffff) {
                    mstore(0, shl(224, 0x6b6b0562))
                    revert(0, 4)
                }
                mstore(g, result)
            }
        }
    }

    /// @dev The residual sum retains the original checked int32 semantics.
    function _addResidual(int32[] memory hidden, uint256 offset, int32[] memory projection) private pure {
        assembly ("memory-safe") {
            let h := add(add(hidden, 32), shl(5, offset))
            let p := add(projection, 32)
            let end := add(p, 4096)
            for {} lt(p, end) { p := add(p, 32) h := add(h, 32) } {
                let result := add(signextend(3, mload(h)), signextend(3, mload(p)))
                if gt(add(result, 0x80000000), 0xffffffff) {
                    mstore(0, shl(224, 0x6b6b0562))
                    revert(0, 4)
                }
                mstore(h, result)
            }
        }
    }

    /// @dev Scratch arrays only; per-layer cache arrays are allocated separately.
    function _newCachedScratch(uint256 capacity) private pure returns (Work memory w) {
        w.hidden = new int32[](128);
        w.query = new int32[](capacity * 128);
        w.norm = new int32[](128); w.qTemp = new int32[](128);
        w.kTemp = new int32[](64); w.vTemp = new int32[](64);
        w.attention = new int32[](128); w.projection = new int32[](128);
        w.gate = new int32[](341); w.up = new int32[](341);
        w.scores = new int256[](capacity); w.probabilities = new uint256[](capacity);
    }
