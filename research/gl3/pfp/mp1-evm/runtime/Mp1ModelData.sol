// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Random-access immutable storage for the exact 2,976,901-byte Q5 model package.
contract Mp1ModelData {
    error WrongModel();
    error ModelRange();

    uint256 public constant PACKAGE_BYTES = 2_976_901;
    uint256 public constant BYTES_PER_SHARD = 98_303;
    uint256 public constant SHARDS = 31;
    bytes32 public constant MODEL_SHA256 = hex"14b714ef8c016b1a321becfa5397d18d9011878e03d46a00eda1cdf68e6491a1";
    bytes32 public constant SHARD_CODE_ROOT = hex"d3e66deebd2a3bf99562fcb23c0b7d67686f350422eaacca81fbab0d911f696c";

    address[31] private parts;

    constructor(address[] memory shards) {
        if (shards.length != SHARDS) revert WrongModel();
        bytes32[31] memory hashes;
        for (uint256 i; i < SHARDS; ++i) {
            address shard = shards[i];
            uint256 payload = i == SHARDS - 1 ? PACKAGE_BYTES - i * BYTES_PER_SHARD : BYTES_PER_SHARD;
            if (shard.code.length != payload + 1) revert WrongModel();
            hashes[i] = shard.codehash;
            parts[i] = shard;
        }
        if (keccak256(abi.encodePacked(hashes)) != SHARD_CODE_ROOT) revert WrongModel();
    }

    function shardAddress(uint256 index) external view returns (address) {
        return parts[index];
    }

    /// @notice Read bytes across shard boundaries. The leading STOP is skipped.
    function read(uint256 offset, uint256 length) external view returns (bytes memory data) {
        if (offset > PACKAGE_BYTES || length > PACKAGE_BYTES - offset) revert ModelRange();
        data = new bytes(length);
        uint256 written;
        while (written < length) {
            uint256 shardIndex = offset / BYTES_PER_SHARD;
            uint256 inShard = offset % BYTES_PER_SHARD;
            uint256 available = BYTES_PER_SHARD - inShard;
            uint256 remaining = length - written;
            uint256 count = available < remaining ? available : remaining;
            address shard = parts[shardIndex];
            assembly ("memory-safe") {
                extcodecopy(shard, add(add(data, 32), written), add(1, inShard), count)
            }
            offset += count;
            written += count;
        }
    }
}
