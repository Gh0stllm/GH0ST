// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Controller-facing interface for a deterministic on-chain GPT-2 shard.
interface IGPT2Shard {
    function controller() external view returns (address);
    function modelId() external view returns (bytes32);
    function firstLayer() external view returns (uint8);
    function endLayer() external view returns (uint8);
    function doesEmbedding() external view returns (bool);
    function doesOutput() external view returns (bool);
    function phase() external view returns (uint8);
    function position() external view returns (uint32);
    function pendingToken() external view returns (uint32);
    function bestToken() external view returns (uint32);
    function bestLogit() external view returns (int256);
    function stateCommitment() external view returns (bytes32);
    function begin(uint32 tokenPosition, uint32 inputToken, bytes32 inputCommitment, bytes calldata hidden) external;
    function exportHidden() external view returns (bytes memory);
}
