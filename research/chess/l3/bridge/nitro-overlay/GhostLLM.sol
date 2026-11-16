// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Experimental local debug-chain only: address 0xA12.
/// @dev Fixed TinyStories model is authenticated genesis input. No public upload
/// method. Calls are caller-scoped. Storage is metered; interpreter instruction
/// gas and a matching fraud-proof path remain release gates.
interface GhostLLM {
    function start(bytes32 job, uint32 token) external returns (
        uint64 generation, uint32 kernelStep, uint32 phase, uint32 position,
        uint32 bestToken, bytes32 checkpointSHA, bool done
    );
    function advance(bytes32 job, uint64 expectedGeneration, uint32 rows, uint32 chunks) external returns (
        uint64 generation, uint32 kernelStep, uint32 phase, uint32 position,
        uint32 bestToken, bytes32 checkpointSHA, bool done
    );
    function append(bytes32 job, uint64 expectedGeneration, uint32 token) external returns (
        uint64 generation, uint32 kernelStep, uint32 phase, uint32 position,
        uint32 bestToken, bytes32 checkpointSHA, bool done
    );
    function inspect(bytes32 job) external view returns (
        uint64 generation, uint32 kernelStep, uint32 phase, uint32 position,
        uint32 bestToken, bytes32 checkpointSHA, bool done
    );
    /// @return sha256I32LE SHA256 of all 50,257 little-endian signed-int32 logits.
    function logitsHash(bytes32 job) external view returns (bytes32 sha256I32LE);
}
