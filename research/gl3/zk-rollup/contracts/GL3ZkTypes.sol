// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

library GL3ZkTypes {
    // All four canonical interpreter fields are bound, including inactive MEL fields.
    struct GlobalState {
        bytes32 blockHash;
        bytes32 sendRoot;
        bytes32 melStateHash;
        bytes32 melMessageHash;
        uint64 inboxPosition;
        uint64 positionInMessage;
    }

    // Static ABI: 23 words / 736 bytes. Uint64 values are ABI-left-padded.
    struct Statement {
        uint256 version;
        bytes32 domain;
        uint64 transitionIndex;
        bytes32 machineRoot;
        bytes32 executionProfileHash;
        GlobalState beforeState;
        GlobalState afterState;
        uint64 sequencerReadStart;
        uint64 sequencerReadEnd;
        bytes32 sequencerDataCommitment;
        uint64 delayedReadStart;
        uint64 delayedReadEnd;
        bytes32 delayedDataCommitment;
    }

    function hashState(GlobalState memory state) internal pure returns (bytes32) {
        // Coordinator equality key; deliberately distinct from Nitro's legacy hash.
        return keccak256(abi.encode(state));
    }

    function progresses(GlobalState memory beforeState, GlobalState memory afterState)
        internal pure returns (bool)
    {
        return afterState.inboxPosition > beforeState.inboxPosition ||
            (afterState.inboxPosition == beforeState.inboxPosition &&
             afterState.positionInMessage > beforeState.positionInMessage);
    }
}
