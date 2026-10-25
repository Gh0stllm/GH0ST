// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Exact signed INT8 dot products. The packed path requires signed INT32 inputs.
/// @dev No weight pruning, clipping or requantization occurs in either path.
library GPT2Dot8 {
    error InvalidDotInput();
    struct Prepared { uint256[] lanes; int256[] sums; bool narrow; }

    function dot(bytes memory row, uint256 offset, int256[] memory x) internal pure returns (int256 acc) {
        if (offset > row.length || row.length-offset < x.length) revert InvalidDotInput();
        assembly ("memory-safe") {
            let rp := add(add(row,32),offset)
            let xp := add(x,32)
            let end := add(xp,mul(and(mload(x),not(31)),32))
            for {} lt(xp,end) {xp:=add(xp,1024) rp:=add(rp,32)} {
                let w := mload(rp)
                for {let k:=0} lt(k,32) {k:=add(k,4) w:=shl(32,w)} {
                    let at:=add(xp,mul(k,32))
                    acc:=add(acc,mul(signextend(0,byte(0,w)),mload(at)))
                    acc:=add(acc,mul(signextend(0,byte(1,w)),mload(add(at,32))))
                    acc:=add(acc,mul(signextend(0,byte(2,w)),mload(add(at,64))))
                    acc:=add(acc,mul(signextend(0,byte(3,w)),mload(add(at,96))))
                }
            }
            let last := add(add(x,32),mul(mload(x),32))
            for {} lt(xp,last) {xp:=add(xp,32) rp:=add(rp,1)} {
                acc := add(acc,mul(signextend(0,byte(0,mload(rp))),mload(xp)))
            }
        }
    }

    function prepare(int256[] memory x) internal pure returns (Prepared memory p) {
        bool narrow=true;
        assembly ("memory-safe") {
            let xp:=add(x,32)
            let end:=add(xp,mul(mload(x),32))
            for {} lt(xp,end) {xp:=add(xp,32)} {
                let v:=mload(xp)
                if iszero(eq(sar(20,v),sar(255,v))) {narrow:=0}
            }
        }
        if(narrow) return _prepare8(x);
        uint256 groups=x.length/5;
        p.lanes=new uint256[](groups);
        p.sums=new int256[](groups);
        // Bias maps the complete signed INT32 domain into unsigned 32 bits.
        // Each lane coefficient is <5*255*(2**32-1)<2**43, below 2**48.
        bool valid=true;
        assembly ("memory-safe") {
            let xp:=add(x,32)
            let lp:=add(mload(p),32)
            let sp:=add(mload(add(p,32)),32)
            let end:=add(lp,mul(groups,32))
            for {} lt(lp,end) {lp:=add(lp,32) sp:=add(sp,32) xp:=add(xp,160)} {
                let a:=mload(xp)
                let b:=mload(add(xp,32))
                let c:=mload(add(xp,64))
                let d:=mload(add(xp,96))
                let e:=mload(add(xp,128))
                if or(or(xor(signextend(3,a),a),xor(signextend(3,b),b)),or(xor(signextend(3,c),c),or(xor(signextend(3,d),d),xor(signextend(3,e),e)))) {valid:=0}
                mstore(lp,or(or(add(a,2147483648),shl(48,add(b,2147483648))),or(shl(96,add(c,2147483648)),or(shl(144,add(d,2147483648)),shl(192,add(e,2147483648))))))
                mstore(sp,add(add(a,b),add(c,add(d,e))))
            }
            let last:=add(add(x,32),mul(mload(x),32))
            for {} lt(xp,last) {xp:=add(xp,32)} {let value:=mload(xp) if xor(signextend(3,value),value) {valid:=0}}
        }
        if(!valid) revert InvalidDotInput();
    }

    function dotPacked(bytes memory row,uint256 offset,int256[] memory x,Prepared memory p)
        internal pure returns(int256 acc)
    {
        if(p.narrow) return _dot8(row,offset,x,p);
        uint256 groups=x.length/5;
        if(offset>row.length || row.length-offset<x.length || p.lanes.length!=groups || p.sums.length!=groups) revert InvalidDotInput();
        assembly ("memory-safe") {
            let rp:=add(add(row,32),offset)
            let lp:=add(mload(p),32)
            let sp:=add(mload(add(p,32)),32)
            let end:=add(lp,mul(groups,32))
            for {} lt(lp,end) {lp:=add(lp,32) sp:=add(sp,32) rp:=add(rp,5)} {
                // Five bytes become five 48-bit lanes with one multiply and mask.
                // The source byte order is reversed relative to prepared x lanes.
                let biased:=xor(shr(216,mload(rp)),0x8080808080)
                let w:=and(mul(biased,0x10000000001000000000100000000010000000001),0xff0000000000ff0000000000ff0000000000ff0000000000ff)
                let coefficient:=and(shr(192,mul(w,mload(lp))),0xffffffffffff)
                let sumWeights:=and(shr(192,mul(w,0x1000000000001000000000001000000000001000000000001)),0xffffffffffff)
                acc:=add(acc,sub(sub(coefficient,shl(7,mload(sp))),shl(31,sumWeights)))
            }
            let xp:=add(add(x,32),mul(mul(groups,5),32))
            let last:=add(add(x,32),mul(mload(x),32))
            for {} lt(xp,last) {xp:=add(xp,32) rp:=add(rp,1)} {
                acc:=add(acc,mul(signextend(0,byte(0,mload(rp))),mload(xp)))
            }
        }
    }

    /// @dev Complete signed INT21 domain maps to unsigned21 bits.
    /// 8*255*(2**21-1)=4,278,188,040 < 2**32, so no coefficient can carry.
    function _prepare8(int256[] memory x) private pure returns(Prepared memory p) {
        uint256 groups=x.length/8;
        p.lanes=new uint256[](groups);p.sums=new int256[](groups);p.narrow=true;
        assembly ("memory-safe") {
            let xp:=add(x,32)
            let lp:=add(mload(p),32)
            let sp:=add(mload(add(p,32)),32)
            let end:=add(lp,mul(groups,32))
            for {} lt(lp,end) {lp:=add(lp,32) sp:=add(sp,32) xp:=add(xp,256)} {
                let packed:=0
                let sum:=0
                for {let j:=0} lt(j,8) {j:=add(j,1)} {
                    let v:=mload(add(xp,mul(j,32)))
                    packed:=or(packed,shl(mul(j,32),add(v,1048576)))
                    sum:=add(sum,v)
                }
                mstore(lp,packed) mstore(sp,sum)
            }
        }
    }
    function _dot8(bytes memory row,uint256 offset,int256[] memory x,Prepared memory p)
        private pure returns(int256 acc)
    {
        uint256 groups=x.length/8;
        if(offset>row.length || row.length-offset<x.length || p.lanes.length!=groups || p.sums.length!=groups) revert InvalidDotInput();
        assembly ("memory-safe") {
            let rp:=add(add(row,32),offset)
            let lp:=add(mload(p),32)
            let sp:=add(mload(add(p,32)),32)
            let end:=add(lp,mul(groups,32))
            for {} lt(lp,end) {lp:=add(lp,32) sp:=add(sp,32) rp:=add(rp,8)} {
                let w:=xor(shr(192,mload(rp)),0x8080808080808080)
                w:=and(or(w,shl(96,w)),0xffffffff000000000000000000000000ffffffff)
                w:=and(or(w,shl(48,w)),0xffff000000000000ffff000000000000ffff000000000000ffff)
                w:=and(or(w,shl(24,w)),0xff000000ff000000ff000000ff000000ff000000ff000000ff000000ff)
                let coefficient:=shr(224,mul(w,mload(lp)))
                let sumWeights:=shr(224,mul(w,0x100000001000000010000000100000001000000010000000100000001))
                acc:=add(acc,sub(sub(coefficient,shl(7,mload(sp))),shl(20,sumWeights)))
            }
            let xp:=add(add(x,32),mul(mul(groups,8),32))
            let last:=add(add(x,32),mul(mload(x),32))
            for {} lt(xp,last) {xp:=add(xp,32) rp:=add(rp,1)} {
                acc:=add(acc,mul(signextend(0,byte(0,mload(rp))),mload(xp)))
            }
        }
    }
}

