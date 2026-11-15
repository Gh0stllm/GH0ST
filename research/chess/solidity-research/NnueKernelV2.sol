// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.30;
import "./NnueKernel.sol";

/// @notice Same dense component and weights; reuse packed inputs across output rows.
/// @dev No board features, PSQT, chess search or game adjudication is implemented.
contract NnueDenseKernelV2 is NnueDenseKernel {
    constructor(address data) NnueDenseKernel(data,true) {}
    function evaluateV2(bytes calldata transformed) external view returns(int256 output) {
        require(transformed.length==1024);
        bytes memory model=new bytes(weightBytes);
        address data=weights;
        assembly ("memory-safe") { extcodecopy(data,add(model,32),1,mload(model)) }
        bytes memory input=transformed;
        bytes memory concat=new bytes(128);
        int256[] memory fc0=_affine(model,0,input,1024,32);
        _act(fc0,concat,0,7);
        int256[] memory fc1=_affine(model,88192,concat,64,32);
        _act(fc1,concat,64,6);
        int256[] memory fc2=_affine(model,94464,concat,128,1);
        output=(fc2[0]+fc0[30]-fc0[31])*9600/16384;
    }
    function _act(int256[] memory input,bytes memory output,uint256 start,uint256 shift) private pure {
        assembly ("memory-safe") {
            let p:=add(input,32)
            let q:=add(add(output,32),start)
            for { let i:=0 } lt(i,32) { i:=add(i,1) } {
                let x:=mload(add(p,shl(5,i)))
                let sq:=shr(add(add(shift,shift),7),mul(x,x))
                if gt(sq,127) { sq:=127 }
                let relu:=sar(shift,x)
                if slt(relu,0) { relu:=0 }
                if sgt(relu,127) { relu:=127 }
                mstore8(add(q,i),sq)
                mstore8(add(add(q,32),i),relu)
            }
        }
    }
    function _affine(bytes memory model,uint256 offset,bytes memory input,uint256 nIn,uint256 nOut)
        private pure returns(int256[] memory out) {
        uint256 groups=(nIn+11)/12;
        uint256[] memory xs=new uint256[](groups);
        out=new int256[](nOut);
        assembly ("memory-safe") {
            let p:=add(input,32)
            let xbase:=add(xs,32)
            let total:=0
            for { let g:=0 } lt(g,groups) { g:=add(g,1) } {
                let x:=0
                for { let lane:=0 } lt(lane,12) { lane:=add(lane,1) } {
                    let idx:=add(mul(g,12),lane)
                    let v:=0
                    if lt(idx,nIn) { v:=byte(0,mload(add(p,idx))) }
                    x:=or(x,shl(mul(lane,20),v))
                    total:=add(total,v)
                }
                mstore(add(xbase,shl(5,g)),x)
            }
            let m:=add(add(model,32),offset)
            let w:=add(m,shl(2,nOut))
            let outbase:=add(out,32)
            let stride:=shl(5,nOut)
            let adjust:=shl(7,total)
            for { let j:=0 } lt(j,nOut) { j:=add(j,1) } {
                let c:=sub(signextend(3,shr(224,mload(add(m,shl(2,j))))),adjust)
                let xp:=xbase
                let wp:=add(w,shl(5,j))
                for { let g:=0 } lt(g,groups) { g:=add(g,1) } {
                    let x:=mload(xp)
                    if x { c:=add(c,and(shr(220,mul(x,mload(wp))),0xfffff)) }
                    xp:=add(xp,32)
                    wp:=add(wp,stride)
                }
                mstore(add(outbase,shl(5,j)),c)
            }
        }
    }
}
