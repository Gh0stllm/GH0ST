// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.30;

/// @notice Exact-integer SF19 dense-component microbenchmarks. Not a chess engine.
/// @dev Real pretrained weights; input vectors here are already transformed.
/// Complete board-feature extraction, PSQT, move generation and search are absent.
contract NnueDenseKernel {
    address public immutable weights;
    uint256 public immutable weightBytes;
    bool public immutable packed;
    constructor(address data, bool isPacked) {
        require(data.code.length == (isPacked ? 94821 : 35205));
        weights = data; packed = isPacked;
        weightBytes = data.code.length - 1;
    }

    function evaluate(bytes calldata transformed) external view returns (int256 output) {
        require(transformed.length == 1024);
        bytes memory model = new bytes(weightBytes);
        address data = weights;
        assembly ("memory-safe") { extcodecopy(data,add(model,32),1,mload(model)) }
        bytes memory input = transformed;
        int256[] memory fc0;
        int256[] memory fc1;
        int256[] memory fc2;
        bytes memory concat = new bytes(128);
        if (packed) {
            fc0 = _packed(model,0,input,1024,32);
            _activate(fc0,concat,0,7);
            fc1 = _packed(model,88192,concat,64,32);
            _activate(fc1,concat,64,6);
            fc2 = _packed(model,94464,concat,128,1);
        } else {
            fc0 = _scalar(model,0,input,1024,32);
            _activate(fc0,concat,0,7);
            fc1 = _scalar(model,32896,concat,64,32);
            _activate(fc1,concat,64,6);
            fc2 = _scalar(model,35072,concat,128,1);
        }
        output = (fc2[0] + fc0[30] - fc0[31]) * 9600 / 16384;
    }

    function _activate(int256[] memory input, bytes memory output,uint256 start,uint256 shift) private pure {
        assembly ("memory-safe") {
            let p := add(input,32)
            let q := add(add(output,32),start)
            for { let i := 0 } lt(i,32) { i := add(i,1) } {
                let x := mload(add(p,shl(5,i)))
                let sq := shr(add(add(shift,shift),7),mul(x,x))
                if gt(sq,127) { sq := 127 }
                let relu := sar(shift,x)
                if slt(relu,0) { relu := 0 }
                if sgt(relu,127) { relu := 127 }
                mstore8(add(q,i),sq)
                mstore8(add(add(q,32),i),relu)
            }
        }
    }
    function _scalar(bytes memory model,uint256 offset,bytes memory input,uint256 nIn,uint256 nOut)
        private pure returns(int256[] memory out) {
        out = new int256[](nOut);
        assembly ("memory-safe") {
            let m := add(add(model,32),offset)
            let w := add(m,shl(2,nOut))
            let p := add(input,32)
            let q := add(out,32)
            for { let j := 0 } lt(j,nOut) { j := add(j,1) } {
                mstore(add(q,shl(5,j)),signextend(3,shr(224,mload(add(m,shl(2,j))))))
            }
            for { let i := 0 } lt(i,nIn) { i := add(i,1) } {
                let x := byte(0,mload(add(p,i)))
                if x {
                    for { let j := 0 } lt(j,nOut) { j := add(j,1) } {
                        let y := signextend(0,byte(0,mload(add(add(w,mul(j,nIn)),i))))
                        let dest := add(q,shl(5,j))
                        mstore(dest,add(mload(dest),mul(x,y)))
                    }
                }
            }
        }
    }
    function _packed(bytes memory model,uint256 offset,bytes memory input,uint256 nIn,uint256 nOut)
        private pure returns(int256[] memory out) {
        out = new int256[](nOut);
        assembly ("memory-safe") {
            let m := add(add(model,32),offset)
            let w := add(m,shl(2,nOut))
            let p := add(input,32)
            let q := add(out,32)
            for { let j := 0 } lt(j,nOut) { j := add(j,1) } {
                mstore(add(q,shl(5,j)),signextend(3,shr(224,mload(add(m,shl(2,j))))))
            }
            let groups := div(add(nIn,11),12)
            for { let g := 0 } lt(g,groups) { g := add(g,1) } {
                let x := 0
                let sum := 0
                for { let lane := 0 } lt(lane,12) { lane := add(lane,1) } {
                    let idx := add(mul(g,12),lane)
                    let v := 0
                    if lt(idx,nIn) { v := byte(0,mload(add(p,idx))) }
                    x := or(x,shl(mul(lane,20),v))
                    sum := add(sum,v)
                }
                if x {
                    for { let j := 0 } lt(j,nOut) { j := add(j,1) } {
                        let weight := mload(add(w,shl(5,add(mul(g,nOut),j))))
                        let dot := sub(and(shr(220,mul(x,weight)),0xfffff),shl(7,sum))
                        let dest := add(q,shl(5,j))
                        mstore(dest,add(mload(dest),dot))
                    }
                }
            }
        }
    }
}

/// @notice One 1024-lane int16 accumulator update from real PSQ weights.
/// @dev Big-endian fixture encoding; arithmetic wraps as int16. Not feature extraction.
contract NnueAccumulatorKernel {
    address public immutable rows;
    constructor(address data) { rows = data; }
    function updateRow(uint256 row,bool subtract) external view returns(bytes memory output) {
        require(row < 4);
        address data = rows;
        output = new bytes(2048);
        bytes memory weight = new bytes(2048);
        assembly ("memory-safe") {
            extcodecopy(data,add(output,32),1,2048)
            extcodecopy(data,add(weight,32),add(2049,mul(row,2048)),2048)
            let q := add(output,32)
            let w := add(weight,32)
            for { let i := 0 } lt(i,2048) { i := add(i,2) } {
                let a := shr(240,mload(add(q,i)))
                let b := shr(240,mload(add(w,i)))
                let v := add(a,b)
                if subtract { v := sub(a,b) }
                mstore8(add(q,i),shr(8,v))
                mstore8(add(add(q,i),1),v)
            }
        }
    }
    /// @notice Sixteen independent wrapping int16 additions in one256-bit word.
    /// No inter-lane carry: each low15 sum stays strictly below2^16.
    function addWords(uint256 a,uint256 b,bool subtract) public pure returns(uint256 r) {
        assembly ("memory-safe") {
            let low := 0x7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff
            let high := 0x8000800080008000800080008000800080008000800080008000800080008000
            switch subtract
            case 0 { r := xor(add(and(a,low),and(b,low)),and(xor(a,b),high)) }
            default {
                let ones := 0x0001000100010001000100010001000100010001000100010001000100010001
                r := xor(add(add(and(a,low),and(not(b),low)),ones),and(not(xor(a,b)),high))
            }
        }
    }
    function updateRowPacked(uint256 row,bool subtract) external view returns(bytes memory output) {
        require(row < 4);
        address data = rows;
        output = new bytes(2048);
        bytes memory weight = new bytes(2048);
        assembly ("memory-safe") {
            extcodecopy(data,add(output,32),1,2048)
            extcodecopy(data,add(weight,32),add(2049,mul(row,2048)),2048)
        }
        for(uint256 i=0;i<2048;i+=32) {
            uint256 a;
            uint256 b;
            assembly ("memory-safe") { a := mload(add(add(output,32),i)) b := mload(add(add(weight,32),i)) }
            uint256 r=addWords(a,b,subtract);
            assembly ("memory-safe") { mstore(add(add(output,32),i),r) }
        }
    }
}
