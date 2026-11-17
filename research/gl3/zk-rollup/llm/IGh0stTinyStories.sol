// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Exact existing TinyStories INT8/Q12 model; no external inference oracle.
/// `packedLogits` contains all 50,257 signed little-endian int32 values.
/// Each call reconstructs the complete prompt/KV, including all eight layers.
interface IGh0stTinyStories {
    function modelInfo() external view returns (bytes32 modelSHA256, uint32 parameters, uint32 modelBytes, uint32 context, uint32 vocabulary, uint32 layers, bytes32 arithmeticID);
    function registerPage(uint32 index, address immutableCodePage) external;
    function infer(uint256 expectedNonce, uint32[] calldata prompt) external returns (uint32 nextToken, bytes32 logitsSHA256, bytes32 checkpointSHA256, bytes memory packedLogits);
    function result(address caller) external view returns (uint256 nextNonce, uint32 nextToken, bytes32 logitsSHA256, bytes32 checkpointSHA256, bytes32 promptSHA256);
}
