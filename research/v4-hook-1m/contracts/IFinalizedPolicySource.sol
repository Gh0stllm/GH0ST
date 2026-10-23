// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Integration boundary for a future authenticated inference engine.
/// @dev This interface proves nothing about model execution. A source must itself
///      establish inference authenticity before its output can be called verified.
///      The repository's test source is publisher-attested and is NOT such an engine.
interface IFinalizedPolicySource {
    // All fields occupy full ABI words so a consumer can safely decode a bounded
    // fixed-size response before validating ranges, without bool/uint truncation.
    struct Policy {
        bytes32 poolId;
        bytes32 modelHash;
        bytes32 snapshotHash;
        bytes32 inputHash;
        uint256 nonce;
        uint256 snapshotId;
        uint256 notBefore;
        uint256 expiresAt;
        uint256 lpFee;
        uint256 finalized;
    }

    function latestPolicy(bytes32 poolId) external view returns (Policy memory);
}
