// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Local benchmark of exact Q24-weight x signed-int16 matrix products.
/// @dev NOT a Falcon engine, float32 inference, tokenizer, or production agent.
contract SixBitKernel {
    error InvalidInput();

    /// @param strategy 0: raw naive; 1: compact naive; 2: compact grouped;
    /// 3: compact eight-lane packed multiplication; 4: unrolled packed accumulation.
    /// @dev Shard is STOP + one complete benchmark matrix, not a global file.
    function dot(address shard, bytes calldata activations, uint256 rows,
                 uint256 cols, uint256 strategy) external view returns (int256[] memory out) {
        if (rows == 0 || rows > 64 || cols == 0 || cols > 1024 || cols % 64 != 0 ||
            activations.length != cols * 2 || strategy > 4) revert InvalidInput();
        uint256 size = shard.code.length;
        if (size < 17 || size > 98304) revert InvalidInput();
        bytes memory weights = new bytes(size - 1);
        assembly ("memory-safe") { extcodecopy(shard, add(weights,32), 1, sub(size,1)) }
        uint256 groups = rows * cols / 64;
        uint256 lw = uint8(weights[12]);uint256 hw = uint8(weights[13]);
        if (uint32(bytes4(weights)) != (strategy == 0 ? 0x46365231 : 0x46364231)) revert InvalidInput();
        if (strategy != 0 && (lw == 0 || hw == 0 || lw > 16 || hw > 16)) revert InvalidInput();
        uint256 metadata = strategy == 0 ? groups * 8 : (groups * (lw + hw) + 7) / 8;
        if (weights.length != 16 + metadata + groups * 48) revert InvalidInput();
        uint256 encodedGroups;
        assembly ("memory-safe") { encodedGroups := and(shr(192,mload(add(weights,32))),0xffffffff) }
        if (encodedGroups != groups) revert InvalidInput();
        bytes memory x = activations;
        out = new int256[](rows);
        // Reused across every output row. For scalar modes these remain unused.
        uint256[] memory packedX = new uint256[](strategy >= 3 ? cols / 8 : 0);
        int256[] memory sumsX = new int256[](strategy >= 3 ? cols / 64 : 0);
        assembly ("memory-safe") {
            function bfq(u) -> v {
                let e := and(shr(7,u),255)
                let m := add(128,and(u,127))
                switch lt(e,110)
                case 1 { v := shr(sub(110,e),m) }
                default { v := shl(sub(e,110),m) }
                if and(u,32768) { v := sub(0,v) }
            }
            // This specialized converter is valid for the pinned export:
            // exact float32 delta, 0 < delta < 63*2**21. No further rounding.
            function scale(d) -> s {
                let q := div(d,63)
                let r := mod(d,63)
                let radius := 0
                if iszero(lt(q,262144)) { radius := 1 }
                if iszero(lt(q,524288)) { radius := 2 }
                if iszero(lt(q,1048576)) { radius := 4 }
                s := div(add(d,31),63)
                if and(iszero(lt(r,sub(32,radius))),iszero(gt(r,add(31,radius)))) { s := add(q,and(q,1)) }
                if iszero(s) { s := 1 }
            }
            function widen6(v) -> w {
                w := and(or(v,shl(104,v)),0xffffff00000000000000000000000000ffffff)
                w := and(or(w,shl(52,w)),0xfff0000000000000fff0000000000000fff0000000000000fff)
                w := and(or(w,shl(26,w)),0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)
            }
            function widen16(v) -> w {
                w := and(or(v,shl(64,v)),0xffffffffffffffff0000000000000000ffffffffffffffff)
                w := and(or(w,shl(32,w)),0xffffffff00000000ffffffff00000000ffffffff00000000ffffffff)
                w := and(or(w,shl(16,w)),0xffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff)
            }
            let wp := add(weights,32)
            let xp := add(x,32)
            let pp := add(packedX,32)
            let sp := add(sumsX,32)
            let ones := 0x100000001000000010000000100000001000000010000000100000001
            let perRow := div(cols,64)
            if iszero(lt(strategy,3)) {
                for { let g := 0 } lt(g,perRow) { g := add(g,1) } {
                    let sumx := 0
                    for { let b := 0 } lt(b,8) { b := add(b,1) } {
                        let index := add(mul(g,8),b)
                        let raw := shr(128,mload(add(xp,mul(index,16))))
                        let px := widen16(xor(raw,0x80008000800080008000800080008000))
                        mstore(add(pp,mul(index,32)),px)
                        sumx := add(sumx,sub(shr(224,mul(px,ones)),262144))
                    }
                    mstore(add(sp,mul(g,32)),sumx)
                }
            }
            let head := mload(wp)
            let lb := and(shr(176,head),65535)
            let hb := and(shr(160,head),65535)
            let bits := add(lw,hw)
            let hmask := sub(shl(hw,1),1)
            let metaStart := add(wp,16)
            let codes := add(metaStart,metadata)
            for { let row := 0 } lt(row,rows) { row := add(row,1) } {
                let answer := 0
                for { let gc := 0 } lt(gc,perRow) { gc := add(gc,1) } {
                    let g := add(mul(row,perRow),gc)
                    let offset := 0
                    let step := 0
                    switch strategy
                    case 0 {
                        let v := shr(192,mload(add(metaStart,mul(g,8))))
                        offset := signextend(3,shr(32,v))
                        step := and(v,0xffffffff)
                    }
                    default {
                        let bitpos := mul(g,bits)
                        let v := and(shr(sub(256,add(and(bitpos,7),bits)),mload(add(metaStart,shr(3,bitpos)))),sub(shl(bits,1),1))
                        offset := bfq(add(lb,shr(hw,v)))
                        let upper := bfq(add(hb,and(v,hmask)))
                        step := scale(sub(upper,offset))
                    }
                    let cp := add(codes,mul(g,48))
                    let xg := add(xp,mul(gc,128))
                    switch strategy
                    case 3 {
                        let total := 0
                        let sumq := 0
                        let pg := add(pp,mul(gc,256))
                        // Eight independent lanes: coefficients never carry
                        // into adjacent 32-bit slots. 8*63*65535 < 2**25.
                        for { let b := 0 } lt(b,8) { b := add(b,1) } {
                            let pw := widen6(shr(208,mload(add(cp,mul(b,6)))))
                            total := add(total,shr(224,mul(pw,mload(add(pg,mul(b,32))))))
                            sumq := add(sumq,shr(224,mul(pw,ones)))
                        }
                        let dotq := sub(total,mul(sumq,32768))
                        answer := add(answer,add(mul(step,dotq),mul(offset,mload(add(sp,mul(gc,32))))))
                    }
                    case 4 {
                        let total := 0
                        let sumw := 0
                        let pg := add(pp,mul(gc,256))
                        let pw := widen6(shr(208,mload(cp)))
                        total := mul(pw,mload(pg)) sumw := pw
                        pw := widen6(shr(208,mload(add(cp,6))))
                        total := add(total,mul(pw,mload(add(pg,32)))) sumw := add(sumw,pw)
                        pw := widen6(shr(208,mload(add(cp,12))))
                        total := add(total,mul(pw,mload(add(pg,64)))) sumw := add(sumw,pw)
                        pw := widen6(shr(208,mload(add(cp,18))))
                        total := add(total,mul(pw,mload(add(pg,96)))) sumw := add(sumw,pw)
                        pw := widen6(shr(208,mload(add(cp,24))))
                        total := add(total,mul(pw,mload(add(pg,128)))) sumw := add(sumw,pw)
                        pw := widen6(shr(208,mload(add(cp,30))))
                        total := add(total,mul(pw,mload(add(pg,160)))) sumw := add(sumw,pw)
                        pw := widen6(shr(208,mload(add(cp,36))))
                        total := add(total,mul(pw,mload(add(pg,192)))) sumw := add(sumw,pw)
                        pw := widen6(shr(208,mload(add(cp,42))))
                        total := add(total,mul(pw,mload(add(pg,224)))) sumw := add(sumw,pw)
                        // All eight block-products accumulate before extraction.
                        // Every coefficient <= 64*63*65535 < 2**28 < 2**32.
                        let dotq := sub(shr(224,total),mul(shr(224,mul(sumw,ones)),32768))
                        answer := add(answer,add(mul(step,dotq),mul(offset,mload(add(sp,mul(gc,32))))))
                    }
                    default {
                        let dotq := 0
                        let sumx := 0
                        for { let b := 0 } lt(b,8) { b := add(b,1) } {
                            let packed := shr(208,mload(add(cp,mul(b,6))))
                            for { let k := 0 } lt(k,8) { k := add(k,1) } {
                                let q := and(shr(mul(k,6),packed),63)
                                let xv := signextend(1,shr(240,mload(add(xg,mul(add(mul(b,8),k),2)))))
                                switch strategy
                                case 2 { dotq := add(dotq,mul(q,xv)) sumx := add(sumx,xv) }
                                default { answer := add(answer,mul(add(offset,mul(step,q)),xv)) }
                            }
                        }
                        if eq(strategy,2) { answer := add(answer,add(mul(step,dotq),mul(offset,sumx))) }
                    }
                }
                mstore(add(add(out,32),mul(row,32)),answer)
            }
        }
    }
}
