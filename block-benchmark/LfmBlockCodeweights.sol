// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import "./LfmBlockOptimized.sol";

/// @notice Exact projections with immutable, straight-line EVM weight programs.
/// @dev Eleven immutable code books bind 4192 program addresses and code hashes.
///      Each projection prepares its activations inside the engine, then calls
///      the bound programs with STATICCALL. Only constant weights are compiled
///      offline. All input-dependent arithmetic still executes in the EVM.
contract LfmBlockCodeweights is LfmBlockOptimized {
    error InvalidProgram();
    address[11] public programBooks;
    bytes32 public immutable programsHash;

    constructor(address[] memory data, address[] memory books) LfmBlockOptimized(data) {
        if (books.length != 11) revert InvalidInput();
        bytes32[] memory hashes = new bytes32[](11);
        for (uint256 i; i < 11; ++i) {
            uint256 expected = 1 + 52 * (i == 10 ? 192 : 400);
            if (books[i].code.length != expected) revert InvalidProgram();
            programBooks[i] = books[i];
            hashes[i] = books[i].codehash;
        }
        programsHash = keccak256(abi.encode(hashes));
    }

    function compiledProbe(uint256 index, bytes memory x) external view returns (bytes memory) {
        if (index >= 352 || x.length != (index < 288 ? 4096 : 10240)) revert InvalidInput();
        return _projectAt(index,x,index < 288 ? 32 : 16,index < 288 ? 1024 : 2560);
    }

    function _projectAt(uint256 index, bytes memory x, uint256 rows, uint256 cols)
        internal view override returns (bytes memory out)
    {
        uint256 groups = (cols + 4) / 5;
        bytes memory input = new bytes((groups + 1) * 32);
        assembly ("memory-safe") {
            let xp := add(x,32)
            let ap := add(input,64)
            let correction := 0
            for { let g := 0 } lt(g,groups) { g := add(g,1) } {
                let word := mload(add(xp,mul(g,20)))
                let a := xor(shr(224,word),0x80000000)
                let b := xor(and(shr(192,word),0xffffffff),0x80000000)
                let c := xor(and(shr(160,word),0xffffffff),0x80000000)
                let d := xor(and(shr(128,word),0xffffffff),0x80000000)
                let e := xor(and(shr(96,word),0xffffffff),0x80000000)
                // Both supported column counts have remainder 0 or 4 mod 5.
                if iszero(lt(add(mul(g,5),4),cols)) { e := 0x80000000 }
                mstore(add(ap,mul(g,32)),or(or(or(a,shl(48,b)),or(shl(96,c),shl(144,d))),shl(192,e)))
                correction := add(correction,sub(0x1400000000,shl(3,add(add(add(a,b),add(c,d)),e))))
            }
            mstore(add(input,32),correction)
        }
        uint256 first = index < 288 ? index * 11 : 3168 + (index - 288) * 16;
        uint256 count = index < 288 ? 11 : 16;
        uint256 chunk = index < 288 ? 3 : 1;
        out = new bytes(rows * 4);
        bytes memory record = new bytes(64);
        for (uint256 i; i < count; ++i) {
            uint256 program = first + i;
            address book = programBooks[program / 400];
            uint256 offset = 1 + (program % 400) * 52;
            address target;
            bytes32 expected;
            assembly ("memory-safe") {
                extcodecopy(book,add(record,32),offset,52)
                target := shr(96,mload(add(record,32)))
                expected := mload(add(record,52))
            }
            if (target.codehash != expected) revert InvalidProgram();
            uint256 row = i * chunk;
            uint256 returned = (rows - row < chunk ? rows - row : chunk) * 4;
            bool success;
            uint256 size;
            assembly ("memory-safe") {
                success := staticcall(gas(),target,add(input,32),mload(input),add(add(out,32),mul(row,4)),returned)
                size := returndatasize()
            }
            if (!success || size != returned) revert InvalidProgram();
        }
    }
}
