// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Storage-format experiments only. Caller access is intentionally unrestricted.
/// @dev A 16-bit payload can represent int16 or raw BF16 bits. No float arithmetic is provided.
contract VectorStateControl {
    int256[] private state;
    constructor(uint256 count) { require(count <= 4096); state = new int256[](count); }
    function set(bytes calldata data) external {
        require(data.length == state.length * 2);
        for(uint256 i; i<state.length; ++i) {
            uint16 bits = uint16(uint8(data[2*i])) * 256 + uint16(uint8(data[2*i+1]));
            state[i] = int256(int16(bits));
        }
    }
    function digest() external view returns(bytes32) {
        bytes memory out = new bytes(state.length * 2);
        for(uint256 i; i<state.length; ++i) {
            uint16 bits = uint16(int16(state[i]));
            out[2*i] = bytes1(uint8(bits >> 8)); out[2*i+1] = bytes1(uint8(bits));
        }
        return keccak256(out);
    }
}

/// @dev Packs sixteen existing 16-bit values into each 256-bit storage slot.
///      This does not losslessly compress arbitrary int256/Q32 values.
contract PackedVectorState {
    uint256 private immutable count;
    uint256[] private state;
    constructor(uint256 size) { require(size <= 4096); count = size; state = new uint256[]((size+15)/16); }
    function set(bytes calldata data) external {
        require(data.length == count * 2);
        for(uint256 i; i<state.length; ++i) {
            uint256 word;
            assembly ("memory-safe") { word := calldataload(add(data.offset,mul(i,32))) }
            if(i+1 == state.length && data.length%32 != 0) {
                word &= type(uint256).max << ((32-data.length%32)*8);
            }
            state[i] = word;
        }
    }
    function digest() external view returns(bytes32) {
        bytes memory out = new bytes(count * 2);
        for(uint256 i; i<state.length; ++i) {
            uint256 word = state[i];
            assembly ("memory-safe") { mstore(add(add(out,32),mul(i,32)),word) }
        }
        return keccak256(out);
    }
}
