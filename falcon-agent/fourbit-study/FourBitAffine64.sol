// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {WeightReader} from "./WeightReader.sol";

/// @notice Exact matrix arithmetic for affine64_s12z4; signed int16 input, Q24 weights.
/// @dev No tokenization, attention, Mamba state or complete inference here.
contract FourBitAffine64 {
    error InvalidInput();

    function dot(address shard, bytes calldata x, uint256 rows, uint256 cols)
        external view returns (int256[] memory) {
        uint256 size=shard.code.length;
        if (size<17 || size>98304) revert InvalidInput();
        bytes memory w=new bytes(size-1);
        assembly ("memory-safe") { extcodecopy(shard,add(w,32),1,sub(size,1)) }
        return compute(w,x,rows,cols);
    }

    /// @notice Read a row tile from a full matrix spanning immutable data shards.
    /// @dev Pin the index and tensor descriptor in the eventual inference engine.
    /// Metadata must start on a byte boundary; all selected model shapes do so.
    function dotFile(address index, uint256 tensorOffset, bytes calldata x,
        uint256 firstRow, uint256 rows, uint256 cols) external view returns (int256[] memory) {
        validateShape(x.length,rows,cols);
        bytes memory h=WeightReader.read(index,tensorOffset,16);
        uint256 declared;
        assembly ("memory-safe") { declared := and(shr(192,mload(add(h,32))),0xffffffff) }
        uint256 groups=rows*cols/64;
        uint256 first=firstRow*cols/64;
        if (first>declared || groups>declared-first || (first*16)%8!=0) revert InvalidInput();
        uint256 metaLength=(groups*16+7)/8;
        bytes memory meta=WeightReader.read(index,tensorOffset+16+(first*16)/8,metaLength);
        bytes memory codes=WeightReader.read(index,tensorOffset+16+(declared*16+7)/8+first*32,groups*32);
        bytes memory w=new bytes(16+meta.length+codes.length);
        assembly ("memory-safe") {
            let p := add(w,32)
            let header := mload(add(h,32))
            header := or(and(header,not(shl(192,0xffffffff))),shl(192,groups))
            mstore(p,header)
            mcopy(add(p,16),add(meta,32),mload(meta))
            mcopy(add(add(p,16),mload(meta)),add(codes,32),mload(codes))
        }
        return compute(w,x,rows,cols);
    }

    function validateShape(uint256 length,uint256 rows,uint256 cols) internal pure {
        if (rows==0 || rows>256 || cols==0 || cols>1024 || cols%64!=0 || length!=cols*2) revert InvalidInput();
    }

    function compute(bytes memory w,bytes calldata x,uint256 rows,uint256 cols)
        internal pure returns (int256[] memory out) {
        validateShape(x.length,rows,cols);
        uint256 groups=rows*cols/64;
        uint256 declared;
        uint256 unit;
        assembly ("memory-safe") {
            declared := and(shr(192,mload(add(w,32))),0xffffffff)
            unit := and(shr(128,mload(add(w,32))),0xffffffff)
        }
        if (w.length<16 || bytes4(w)!=0x47345131 || uint8(w[8])!=64 || uint8(w[9])!=12 ||
            uint8(w[10])!=1 || w[11]!=0 || declared!=groups || unit==0 || unit>=1<<24 ||
            w.length!=16+(groups*16+7)/8+groups*32) revert InvalidInput();
        out=new int256[](rows);
        uint256[] memory prepared=new uint256[](cols/64*9);
        assembly ("memory-safe") {
            function dotGroup(cp,pp) -> answer {
                let total := 0
                {
                    let v := shr(224,mload(add(cp,0)))
                    v := and(mul(v,0x1000000000000010000000000000100000000000001),0xff00000000000000ff00000000000000ff00000000000000ff)
                    v := and(mul(v,0x10000001),0xf0000000f0000000f0000000f0000000f0000000f0000000f0000000f)
                    total := add(total,mul(v,mload(add(pp,0))))
                }
                {
                    let v := shr(224,mload(add(cp,4)))
                    v := and(mul(v,0x1000000000000010000000000000100000000000001),0xff00000000000000ff00000000000000ff00000000000000ff)
                    v := and(mul(v,0x10000001),0xf0000000f0000000f0000000f0000000f0000000f0000000f0000000f)
                    total := add(total,mul(v,mload(add(pp,32))))
                }
                {
                    let v := shr(224,mload(add(cp,8)))
                    v := and(mul(v,0x1000000000000010000000000000100000000000001),0xff00000000000000ff00000000000000ff00000000000000ff)
                    v := and(mul(v,0x10000001),0xf0000000f0000000f0000000f0000000f0000000f0000000f0000000f)
                    total := add(total,mul(v,mload(add(pp,64))))
                }
                {
                    let v := shr(224,mload(add(cp,12)))
                    v := and(mul(v,0x1000000000000010000000000000100000000000001),0xff00000000000000ff00000000000000ff00000000000000ff)
                    v := and(mul(v,0x10000001),0xf0000000f0000000f0000000f0000000f0000000f0000000f0000000f)
                    total := add(total,mul(v,mload(add(pp,96))))
                }
                {
                    let v := shr(224,mload(add(cp,16)))
                    v := and(mul(v,0x1000000000000010000000000000100000000000001),0xff00000000000000ff00000000000000ff00000000000000ff)
                    v := and(mul(v,0x10000001),0xf0000000f0000000f0000000f0000000f0000000f0000000f0000000f)
                    total := add(total,mul(v,mload(add(pp,128))))
                }
                {
                    let v := shr(224,mload(add(cp,20)))
                    v := and(mul(v,0x1000000000000010000000000000100000000000001),0xff00000000000000ff00000000000000ff00000000000000ff)
                    v := and(mul(v,0x10000001),0xf0000000f0000000f0000000f0000000f0000000f0000000f0000000f)
                    total := add(total,mul(v,mload(add(pp,160))))
                }
                {
                    let v := shr(224,mload(add(cp,24)))
                    v := and(mul(v,0x1000000000000010000000000000100000000000001),0xff00000000000000ff00000000000000ff00000000000000ff)
                    v := and(mul(v,0x10000001),0xf0000000f0000000f0000000f0000000f0000000f0000000f0000000f)
                    total := add(total,mul(v,mload(add(pp,192))))
                }
                {
                    let v := shr(224,mload(add(cp,28)))
                    v := and(mul(v,0x1000000000000010000000000000100000000000001),0xff00000000000000ff00000000000000ff00000000000000ff)
                    v := and(mul(v,0x10000001),0xf0000000f0000000f0000000f0000000f0000000f0000000f0000000f)
                    total := add(total,mul(v,mload(add(pp,224))))
                }
                answer := sar(224,add(total,0x80000000000000000000000000000000000000000000000000000000))
            }
            let pp := add(prepared,32)
            for { let gc := 0 } lt(gc,div(cols,64)) { gc := add(gc,1) } {
                let sumx := 0
                for { let b := 0 } lt(b,8) { b := add(b,1) } {
                    let v := xor(shr(128,calldataload(add(x.offset,add(mul(gc,128),mul(b,16))))),0x80008000800080008000800080008000)
                    v := and(or(v,shl(64,v)),0xffffffffffffffff0000000000000000ffffffffffffffff)
                    v := and(or(v,shl(32,v)),0xffffffff00000000ffffffff00000000ffffffff00000000ffffffff)
                    v := and(or(v,shl(16,v)),0xffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff)
                    mstore(add(pp,add(mul(gc,288),mul(b,32))),sub(v,0x800000008000000080000000800000008000000080000000800000008000))
                    sumx := add(sumx,sub(shr(224,mul(v,0x100000001000000010000000100000001000000010000000100000001)),262144))
                }
                mstore(add(pp,add(mul(gc,288),256)),sumx)
            }
            let wp := add(w,32)
            let cp := add(add(wp,16),div(add(mul(groups,16),7),8))
            let gi := 0
            for { let row := 0 } lt(row,rows) { row := add(row,1) } {
                let total := 0
                for { let ap := pp } lt(ap,add(pp,mul(div(cols,64),288))) { ap := add(ap,288) } {
                    let meta := shr(240,mload(add(add(wp,16),mul(gi,2))))
                    let scale := shr(4,meta)
                    let zero := and(meta,15)
                    total := add(total,mul(scale,sub(dotGroup(cp,ap),mul(zero,mload(add(ap,256))))))
                    cp := add(cp,32)
                    gi := add(gi,1)
                }
                mstore(add(add(out,32),mul(row,32)),mul(total,unit))
            }
        }
    }
}
