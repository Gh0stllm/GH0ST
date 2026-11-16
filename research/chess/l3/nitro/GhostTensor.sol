// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
/// @notice Experimental ABI; address0xA11 is NOT deployed or registered.
interface IGhostTensor {
    function registerModel(bytes calldata weights) external returns (bytes32 root);
    function begin(bytes32 job, bytes32 model, bytes calldata input) external;
    function step(bytes32 job, uint32 maxMacs) external returns (bool done, int64 sum, uint32 cursor);
    function result(bytes32 job) external view returns (bool done, int64 sum, uint32 cursor);
}
