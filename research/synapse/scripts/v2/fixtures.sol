// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Foreign dynamic-array expert implementations must never be admitted.
contract LocalHostileExpertV2 {
    address public beneficiary;
    uint96 public fee;
    bytes32 public spaceId;
    bytes32 public weightsHash;
    uint16 public hiddenSize;
    uint256 public calls;
    uint8 public immutable mode;
    constructor(address recipient, bytes32 space, uint16 width, uint8 behavior) {
        beneficiary = recipient;
        fee = 1 ether;
        spaceId = space;
        hiddenSize = width;
        weightsHash = keccak256("hostile v2 fixture");
        mode = behavior;
    }
    function forward(int256[] calldata hidden) external returns (int256[] memory) {
        if (mode == 0) revert("hostile expert");
        if (mode == 1) { assembly { return(0, 0x10000) } }
        calls++;
        return hidden;
    }
}
