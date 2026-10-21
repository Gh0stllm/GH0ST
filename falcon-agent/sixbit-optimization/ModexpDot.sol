// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Experimental Kronecker-substitution dot product via one MODEXP square.
/// @dev Tests a known arithmetic technique, not a claim of algorithmic novelty.
contract ModexpDot {
    /// @notice Identical input/output, native-EVM comparator for the precompile.
    function packedDot(address shard,bytes calldata x) external view returns (int256 answer) {
        require(shard.code.length==49 && x.length==128,"dimensions");
        bytes memory q=new bytes(48);
        assembly ("memory-safe") {
            let qp := add(q,32)
            extcodecopy(shard,qp,1,48)
            let total := 0
            let sumw := 0
            for { let b := 0 } lt(b,8) { b := add(b,1) } {
                let v := shr(208,mload(add(qp,mul(b,6))))
                v := and(or(v,shl(104,v)),0xffffff00000000000000000000000000ffffff)
                v := and(or(v,shl(52,v)),0xfff0000000000000fff0000000000000fff0000000000000fff)
                v := and(or(v,shl(26,v)),0x3f0000003f0000003f0000003f0000003f0000003f0000003f0000003f)
                let u := xor(shr(128,calldataload(add(x.offset,mul(b,16)))),0x80008000800080008000800080008000)
                u := and(or(u,shl(64,u)),0xffffffffffffffff0000000000000000ffffffffffffffff)
                u := and(or(u,shl(32,u)),0xffffffff00000000ffffffff00000000ffffffff00000000ffffffff)
                u := and(or(u,shl(16,u)),0xffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff)
                total := add(total,mul(u,v)) sumw := add(sumw,v)
            }
            answer := sub(shr(224,total),shl(15,shr(224,mul(sumw,0x100000001000000010000000100000001000000010000000100000001))))
        }
    }
    function dot(address shard,bytes calldata x) external view returns (int256 answer) {
        require(shard.code.length==49 && x.length==128,"dimensions");
        bytes memory q=new bytes(48);
        bytes memory input=new bytes(1122);
        bytes memory result=new bytes(513);
        assembly ("memory-safe") {
            let qp := add(q,32)
            extcodecopy(shard,qp,1,48)
            let p := add(input,32)
            mstore(p,512) mstore(add(p,32),1) mstore(add(p,64),513)
            let base := add(p,96)
            let sumq := 0
            for { let j := 0 } lt(j,64) { j := add(j,1) } {
                let xu := xor(shr(240,calldataload(add(x.offset,mul(j,2)))),32768)
                mstore(add(base,mul(j,4)),shl(224,xu))
            }
            for { let j := 0 } lt(j,64) { j := add(j,1) } {
                let i := sub(63,j)
                let c := and(shr(mul(and(i,7),6),shr(208,mload(add(qp,mul(shr(3,i),6))))),63)
                mstore(add(add(base,256),mul(j,4)),shl(224,c))
                sumq := add(sumq,c)
            }
            // B=A+X*2**2048. The coefficient of 2**4064 in B**2
            // is exactly 2*dot(q,x+32768); A**2 ends below it, X**2 above it.
            mstore8(add(p,608),2) mstore8(add(p,609),1)
            if iszero(staticcall(gas(),5,p,1122,add(result,32),513)) { revert(0,0) }
            let twice := shr(224,mload(add(result,33)))
            answer := sub(shr(1,twice),mul(sumq,32768))
        }
    }
}
