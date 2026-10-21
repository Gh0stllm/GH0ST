// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Index runtime: STOP | G4IX | uint32 payloadLimit | uint64 fileBytes |
/// bytes32 fileSHA256 | packed 20-byte shard addresses. All integers big endian.
/// The caller must pin the audited index address; this library does not establish
/// model identity or hash the complete file during each read.
library WeightReader {
    error InvalidIndex();
    error OutOfBounds();
    function read(address index, uint256 offset, uint256 length) internal view returns (bytes memory out) {
        bytes32 header;
        assembly ("memory-safe") {
            let p := mload(0x40)
            extcodecopy(index,p,1,16)
            header := mload(p)
        }
        uint256 payload = uint32(uint256(header)>>192);
        uint256 size = uint64(uint256(header)>>128);
        if (bytes4(header)!=0x47344958 || payload==0 || payload>98303 || size==0 ||
            index.code.length!=49+20*((size+payload-1)/payload)) revert InvalidIndex();
        if (offset>size || length>size-offset) revert OutOfBounds();
        out = new bytes(length);
        uint256 done;
        while (done<length) {
            uint256 pos=offset+done;
            uint256 shardNumber=pos/payload;
            uint256 within=pos%payload;
            uint256 shardBytes=size-shardNumber*payload;
            if (shardBytes>payload) shardBytes=payload;
            uint256 count=shardBytes-within;
            if (count>length-done) count=length-done;
            address shard;
            assembly ("memory-safe") {
                let p := mload(0x40)
                extcodecopy(index,p,add(49,mul(shardNumber,20)),20)
                shard := shr(96,mload(p))
            }
            if (shard.code.length!=shardBytes+1) revert InvalidIndex();
            assembly ("memory-safe") { extcodecopy(shard,add(add(out,32),done),add(within,1),count) }
            done+=count;
        }
    }
}
