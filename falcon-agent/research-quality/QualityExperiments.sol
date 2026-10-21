// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// Research components, NOT a complete LLM, tokenizer, or agent engine.
contract Top7Decoder {
    bytes32 public last;
    function decode(bytes calldata blob) public pure returns (bytes memory out) {
        require(blob.length >= 15, "header");
        uint256 n;
        uint256 ne;
        assembly ("memory-safe") {
            n := shr(224, calldataload(blob.offset))
            ne := shr(224, calldataload(add(blob.offset, 11)))
        }
        require(n > 0 && n <= 4096, "count");
        require(blob.length == 15+n+(3*n+7)/8+ne, "length");
        out = new bytes(n*2);
        uint256 consumed;
        assembly ("memory-safe") {
            let sm := add(blob.offset, 15)
            let codes := add(sm, n)
            let escapes := add(codes, div(add(mul(n,3),7),8))
            let dest := add(out,32)
            for { let i := 0 } lt(i,n) { i := add(i,1) } {
                let b := mul(i,3)
                let c := and(shr(sub(253,and(b,7)),calldataload(add(codes,shr(3,b)))),7)
                let exponent := byte(0,calldataload(add(add(blob.offset,4),c)))
                if eq(c,7) {
                    if iszero(lt(consumed,ne)) { revert(0,0) }
                    exponent := byte(0,calldataload(add(escapes,consumed)))
                    consumed := add(consumed,1)
                }
                let s := byte(0,calldataload(add(sm,i)))
                let word := or(or(shl(8,and(s,128)),shl(7,exponent)),and(s,127))
                mstore8(add(dest,mul(i,2)),word)
                mstore8(add(add(dest,mul(i,2)),1),shr(8,word))
            }
        }
        require(consumed == ne, "escapes");
    }
    function commit(bytes calldata blob) external { last = keccak256(decode(blob)); }
    function commitStored(address source, uint256 offset, uint256 length) external {
        require(length<=8192 && offset+length+1<=source.code.length,"span");
        bytes memory blob=new bytes(length);
        assembly ("memory-safe") { extcodecopy(source,add(blob,32),add(offset,1),length) }
        last=keccak256(this.decode(blob));
    }
}

/// Authenticates externally supplied weights, then computes one exact BF16/int16
/// dot product. This changes the self-contained-weight requirement. It is NOT
/// full BF16 inference: activations are int16, and the exact sum is Q128-scaled.
contract AuthenticatedWeights {
    bytes32 public immutable root;
    uint256 public immutable totalBytes;
    uint256 public immutable depth;
    int256 public last;
    constructor(bytes32 r, uint256 total) {
        require(total > 0 && total <= type(uint32).max);
        root=r; totalBytes=total;
        uint256 leaves=(total+4095)/4096;
        uint256 d; uint256 size=1;
        while(size<leaves) { size*=2; ++d; }
        depth=d;
    }
    function verify(uint32 index, bytes calldata data, bytes32[] calldata proof) public view {
        uint256 offset=uint256(index)*4096;
        require(offset<totalBytes, "index");
        uint256 expected=totalBytes-offset;
        if(expected>4096) expected=4096;
        require(data.length==expected && proof.length==depth, "length");
        bytes32 h=keccak256(abi.encodePacked(bytes1(0),index,uint32(data.length),data));
        uint256 pos=index;
        for(uint256 i=0;i<proof.length;++i) {
            h=pos&1==0 ? keccak256(abi.encodePacked(bytes1(0x01),h,proof[i]))
                       : keccak256(abi.encodePacked(bytes1(0x01),proof[i],h));
            pos>>=1;
        }
        require(h==root,"proof");
    }
    function dot(uint32 index, bytes calldata data, bytes32[] calldata proof, bytes calldata activations) public view returns(int256 sum) {
        verify(index,data,proof);
        require(data.length%2==0 && activations.length==data.length,"activations");
        for(uint256 i=0;i<data.length;i+=2) {
            uint256 w=uint8(data[i]) | (uint256(uint8(data[i+1]))<<8);
            uint256 magnitude=w&32767;
            if(magnitude==0) continue;
            uint256 e=(w>>7)&255;
            // Exact Q128 conversion for this measured range. Reject unsupported
            // subnormal/extreme values instead of silently clipping/rounding.
            require(e>=6 && e<=200,"range");
            int256 value=int256((128+(w&127))<<(e-6));
            if(w&32768!=0) value=-value;
            int16 x=int16(uint16(uint8(activations[i])) | (uint16(uint8(activations[i+1]))<<8));
            sum+=value*int256(x);
        }
    }
    function commitDot(uint32 index, bytes calldata data, bytes32[] calldata proof, bytes calldata activations) external {
        last=dot(index,data,proof,activations);
    }
}

contract GenesisReader {
    function digest(address base, uint256 start, uint256 count) external view returns(bytes32 h) {
        require(count<=128);
        for(uint256 i=0;i<count;++i) {
            address target=address(uint160(base)+uint160(start+i));
            h=keccak256(abi.encodePacked(h,target.codehash));
        }
    }
    function read(address target, uint256 offset, uint256 length) external view returns(bytes memory data) {
        require(length<=8192 && offset+length+1<=target.code.length);
        data=new bytes(length);
        assembly ("memory-safe") { extcodecopy(target,add(data,32),add(offset,1),length) }
    }
}
