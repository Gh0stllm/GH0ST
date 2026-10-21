"""Generate specialized, inspectable packed four-bit matrix kernels."""
from pathlib import Path
from codec import CONFIGS
ROOT = Path(__file__).resolve().parent
NAMES = {'sym32_s8':'FourBitSym32', 'sym64_s12':'FourBitSym64',
         'affine64_s12z4':'FourBitAffine64', 'affine128_s12z4':'FourBitAffine128'}

for variant, (group, bits, affine) in CONFIGS.items():
    name=NAMES[variant]
    width=bits+4*affine
    vectors=group//8
    stride=(vectors+1)*32
    dilation=sum(1<<(56*j) for j in range(4))
    pairs=sum(255<<(64*j) for j in range(4))
    lanes=sum(15<<(32*j) for j in range(8))
    operations='\n'.join(f'''                {{
                    let v := shr(224,mload(add(cp,{4*j})))
                    v := and(mul(v,{hex(dilation)}),{hex(pairs)})
                    v := and(mul(v,0x10000001),{hex(lanes)})
                    total := add(total,mul(v,mload(add(pp,{32*j}))))
                }}''' for j in range(vectors))
    if affine:
        metadata='''let meta := shr(240,mload(add(add(wp,16),mul(gi,2))))
                    let scale := shr(4,meta)
                    let zero := and(meta,15)'''
    elif bits==8:
        metadata='''let scale := byte(0,mload(add(add(wp,16),gi)))
                    let zero := 8'''
    else:
        metadata='''let bitpos := mul(gi,12)
                    let scale := and(shr(sub(244,and(bitpos,7)),mload(add(add(wp,16),shr(3,bitpos)))),4095)
                    let zero := 8'''
    text=f'''// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {{WeightReader}} from "./WeightReader.sol";

/// @notice Exact matrix arithmetic for {variant}; signed int16 input, Q24 weights.
/// @dev No tokenization, attention, Mamba state or complete inference here.
contract {name} {{
    error InvalidInput();

    function dot(address shard, bytes calldata x, uint256 rows, uint256 cols)
        external view returns (int256[] memory) {{
        uint256 size=shard.code.length;
        if (size<17 || size>98304) revert InvalidInput();
        bytes memory w=new bytes(size-1);
        assembly ("memory-safe") {{ extcodecopy(shard,add(w,32),1,sub(size,1)) }}
        return compute(w,x,rows,cols);
    }}

    /// @notice Read a row tile from a full matrix spanning immutable data shards.
    /// @dev Pin the index and tensor descriptor in the eventual inference engine.
    /// Metadata must start on a byte boundary; all selected model shapes do so.
    function dotFile(address index, uint256 tensorOffset, bytes calldata x,
        uint256 firstRow, uint256 rows, uint256 cols) external view returns (int256[] memory) {{
        validateShape(x.length,rows,cols);
        bytes memory h=WeightReader.read(index,tensorOffset,16);
        uint256 declared;
        assembly ("memory-safe") {{ declared := and(shr(192,mload(add(h,32))),0xffffffff) }}
        uint256 groups=rows*cols/{group};
        uint256 first=firstRow*cols/{group};
        if (first>declared || groups>declared-first || (first*{width})%8!=0) revert InvalidInput();
        uint256 metaLength=(groups*{width}+7)/8;
        bytes memory meta=WeightReader.read(index,tensorOffset+16+(first*{width})/8,metaLength);
        bytes memory codes=WeightReader.read(index,tensorOffset+16+(declared*{width}+7)/8+first*{group//2},groups*{group//2});
        bytes memory w=new bytes(16+meta.length+codes.length);
        assembly ("memory-safe") {{
            let p := add(w,32)
            let header := mload(add(h,32))
            header := or(and(header,not(shl(192,0xffffffff))),shl(192,groups))
            mstore(p,header)
            mcopy(add(p,16),add(meta,32),mload(meta))
            mcopy(add(add(p,16),mload(meta)),add(codes,32),mload(codes))
        }}
        return compute(w,x,rows,cols);
    }}

    function validateShape(uint256 length,uint256 rows,uint256 cols) internal pure {{
        if (rows==0 || rows>256 || cols==0 || cols>1024 || cols%{group}!=0 || length!=cols*2) revert InvalidInput();
    }}

    function compute(bytes memory w,bytes calldata x,uint256 rows,uint256 cols)
        internal pure returns (int256[] memory out) {{
        validateShape(x.length,rows,cols);
        uint256 groups=rows*cols/{group};
        uint256 declared;
        uint256 unit;
        assembly ("memory-safe") {{
            declared := and(shr(192,mload(add(w,32))),0xffffffff)
            unit := and(shr(128,mload(add(w,32))),0xffffffff)
        }}
        if (w.length<16 || bytes4(w)!=0x47345131 || uint8(w[8])!={group} || uint8(w[9])!={bits} ||
            uint8(w[10])!={int(affine)} || w[11]!=0 || declared!=groups || unit==0 || unit>=1<<24 ||
            w.length!=16+(groups*{width}+7)/8+groups*{group//2}) revert InvalidInput();
        out=new int256[](rows);
        uint256[] memory prepared=new uint256[](cols/{group}*{vectors+1});
        assembly ("memory-safe") {{
            function dotGroup(cp,pp) -> answer {{
                let total := 0
{operations}
                answer := sar(224,add(total,0x80000000000000000000000000000000000000000000000000000000))
            }}
            let pp := add(prepared,32)
            for {{ let gc := 0 }} lt(gc,div(cols,{group})) {{ gc := add(gc,1) }} {{
                let sumx := 0
                for {{ let b := 0 }} lt(b,{vectors}) {{ b := add(b,1) }} {{
                    let v := xor(shr(128,calldataload(add(x.offset,add(mul(gc,{group*2}),mul(b,16))))),0x80008000800080008000800080008000)
                    v := and(or(v,shl(64,v)),0xffffffffffffffff0000000000000000ffffffffffffffff)
                    v := and(or(v,shl(32,v)),0xffffffff00000000ffffffff00000000ffffffff00000000ffffffff)
                    v := and(or(v,shl(16,v)),0xffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff)
                    mstore(add(pp,add(mul(gc,{stride}),mul(b,32))),sub(v,0x800000008000000080000000800000008000000080000000800000008000))
                    sumx := add(sumx,sub(shr(224,mul(v,0x100000001000000010000000100000001000000010000000100000001)),262144))
                }}
                mstore(add(pp,add(mul(gc,{stride}),{vectors*32})),sumx)
            }}
            let wp := add(w,32)
            let cp := add(add(wp,16),div(add(mul(groups,{width}),7),8))
            let gi := 0
            for {{ let row := 0 }} lt(row,rows) {{ row := add(row,1) }} {{
                let total := 0
                for {{ let ap := pp }} lt(ap,add(pp,mul(div(cols,{group}),{stride}))) {{ ap := add(ap,{stride}) }} {{
                    {metadata}
                    total := add(total,mul(scale,sub(dotGroup(cp,ap),mul(zero,mload(add(ap,{vectors*32}))))))
                    cp := add(cp,{group//2})
                    gi := add(gi,1)
                }}
                mstore(add(add(out,32),mul(row,32)),mul(total,unit))
            }}
        }}
    }}
}}
'''
    (ROOT/(name+'.sol')).write_text(text)
