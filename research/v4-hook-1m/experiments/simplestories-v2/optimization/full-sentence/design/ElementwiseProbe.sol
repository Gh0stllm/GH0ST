// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract ElementwiseProbe {
int256 constant Q=4096;error ArithmeticRange();
function _checked(int256 value) private pure returns (int32) {
        if (value < type(int32).min || value > type(int32).max) revert ArithmeticRange();
        return int32(value);
    }
function _u32(bytes memory data, uint256 byteOffset) private pure returns (uint256 value) {
        assembly ("memory-safe") { value := shr(224, mload(add(add(data, 32), byteOffset))) }
    }
function _i16(bytes memory data, uint256 byteOffset) private pure returns (int256 value) {
        assembly ("memory-safe") { value := signextend(1, shr(240, mload(add(add(data, 32), byteOffset)))) }
    }
function _table(bytes memory tables, uint256 offset, uint256 distance, uint256 endpoint) private pure returns (uint256) {
        uint256 scaled = distance * 16;
        uint256 index = scaled / uint256(Q);
        if (index >= 256) return endpoint;
        uint256 remainder = scaled % uint256(Q);
        return (_u32(tables, offset + index * 4) * (uint256(Q) - remainder)
            + _u32(tables, offset + (index + 1) * 4) * remainder) / uint256(Q);
    }
function _silu(int256 x, bytes memory tables) private pure returns (int256) {
        uint256 probability = _table(tables, 1024, uint256(x < 0 ? -x : x), 65536);
        if (x < 0) probability = 65536 - probability;
        return x * int256(probability) / 65536;
    }
function _ropeOld(int32[] memory input, int32[] memory output, uint256 outputOffset, uint256 heads, uint256 position, bytes memory tables) private pure {
        for (uint256 head; head < heads; ++head) {
            for (uint256 j; j < 16; ++j) {
                int256 c = _i16(tables, (position * 16 + j) * 2);
                int256 s = _i16(tables, 512 + (position * 16 + j) * 2);
                int256 first = input[head * 32 + j];
                int256 second = input[head * 32 + j + 16];
                output[outputOffset + head * 32 + j] = _checked((first * c - second * s) / Q);
                output[outputOffset + head * 32 + j + 16] = _checked((second * c + first * s) / Q);
            }
        }
    }
function _ropeNew(int32[] memory input, int32[] memory output, uint256 outputOffset,
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
function rope(bool opt,int32[] memory x,uint256 heads,uint256 pos,bytes memory tables)external view returns(int32[] memory y,uint256 gas){require(x.length==heads*32&&pos<16);y=new int32[](x.length+3);uint256 beforeGas=gasleft();if(opt)_ropeNew(x,y,3,heads,pos,tables);else _ropeOld(x,y,3,heads,pos,tables);gas=beforeGas-gasleft();}
function silu(bool opt,int32[] memory g,int32[] memory u,bytes memory tables)external view returns(int32[] memory,uint256 gas){require(g.length==u.length);uint256 beforeGas=gasleft();if(opt)_siluMultiply(g,u,tables);else for(uint256 j;j<g.length;j++)g[j]=_checked(_silu(g[j],tables)*int256(u[j])/Q);gas=beforeGas-gasleft();return(g,gas);}
function residual(bool opt,int32[] memory h,int32[] memory p)external view returns(int32[] memory,uint256 gas){require(h.length==131&&p.length==128);uint256 beforeGas=gasleft();if(opt)_addResidual(h,3,p);else for(uint256 j;j<128;j++)h[j+3]=_checked(int256(h[j+3])+p[j]);gas=beforeGas-gasleft();return(h,gas);}
}