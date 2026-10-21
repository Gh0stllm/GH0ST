// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {S0ULTypes, IS0ULModel} from "./S0ULTypes.sol";

/// @notice Immutable typed layout and code-hash pins for an integer-v1 model.
/// @dev Pins integrity of a selected bundle; does not establish training quality.
contract S0ULModel is IS0ULModel {
    S0ULTypes.Config private _config;
    address[] private _shards;
    bytes32[] private _runtimeHashes;
    uint256[] private _offsets;
    uint256[] private _lengths;

    uint32 public immutable shardBytes;
    uint256 public immutable payloadLength;
    bytes32 public immutable manifestHash;
    bytes32 public immutable override sourceCheckpoint;
    bytes32 public immutable override modelId;

    error InvalidConfiguration();
    error InvalidShard();
    error InvalidTensorRange();

    constructor(
        S0ULTypes.Config memory cfg,
        bytes32 sourceCheckpoint_,
        bytes32 manifestHash_,
        address[] memory shards_,
        bytes32[] memory runtimeHashes_,
        uint32 shardBytes_
    ) {
        uint256 d = cfg.dim;
        if (
            cfg.vocabSize == 0 || cfg.vocabSize > 512 || d == 0 || d > 128 ||
            cfg.layers == 0 || cfg.layers > 4 || cfg.heads == 0 || cfg.heads > 4 ||
            d % cfg.heads != 0 || (d / cfg.heads) % 2 != 0 ||
            cfg.hiddenDim == 0 || cfg.hiddenDim > 640 ||
            cfg.maxSeqLen == 0 || cfg.maxSeqLen > 128 ||
            cfg.epsQ28 == 0 || cfg.epsQ28 > (1 << 28) ||
            cfg.attentionScaleQ14 == 0 || cfg.attentionScaleQ14 > (1 << 14) ||
            shardBytes_ == 0 || shardBytes_ > 23_000 || manifestHash_ == bytes32(0)
        ) revert InvalidConfiguration();
        _config = cfg;
        shardBytes = shardBytes_;
        sourceCheckpoint = sourceCheckpoint_;
        manifestHash = manifestHash_;

        _addTensor(uint256(cfg.vocabSize) * d);
        _addTensor(uint256(cfg.vocabSize) * 8);
        for (uint256 layer; layer < cfg.layers; ++layer) {
            _addTensor(d * 8); // attention RMSNorm
            for (uint256 matrix; matrix < 4; ++matrix) {
                _addTensor(d * d); // q, k, v, o weights
                _addTensor(d * 8); // corresponding per-row Q24 scales
            }
            _addTensor(d * 8); // FFN RMSNorm
            _addTensor(uint256(cfg.hiddenDim) * d);
            _addTensor(uint256(cfg.hiddenDim) * 8);
            _addTensor(d * uint256(cfg.hiddenDim));
            _addTensor(d * 8);
        }
        _addTensor(d * 8); // final RMSNorm
        uint256 ropeBytes = uint256(cfg.maxSeqLen) * (d / cfg.heads / 2) * 8;
        _addTensor(ropeBytes);
        _addTensor(ropeBytes);
        _addTensor(4097 * 8); // monotonic Q24 exponential table
        uint256 total = _offsets[_offsets.length - 1] + _lengths[_lengths.length - 1];
        payloadLength = total;

        if (shards_.length != (total + shardBytes_ - 1) / shardBytes_ ||
            runtimeHashes_.length != shards_.length) revert InvalidShard();
        for (uint256 i; i < shards_.length; ++i) {
            address shard = shards_[i];
            uint256 expected = total - i * shardBytes_;
            if (expected > shardBytes_) expected = shardBytes_;
            if (shard.code.length != expected + 1 || shard.codehash != runtimeHashes_[i]) revert InvalidShard();
            uint256 first;
            assembly ("memory-safe") {
                let scratch := mload(0x40)
                extcodecopy(shard, scratch, 0, 1)
                first := byte(0, mload(scratch))
            }
            if (first != 0) revert InvalidShard();
            _shards.push(shard);
            _runtimeHashes.push(runtimeHashes_[i]);
        }
        modelId = keccak256(abi.encode(cfg, sourceCheckpoint_, manifestHash_, shards_, runtimeHashes_, shardBytes_, total));
    }

    function _addTensor(uint256 length) private {
        uint256 count = _offsets.length;
        _offsets.push(count == 0 ? 0 : _offsets[count - 1] + _lengths[count - 1]);
        _lengths.push(length);
    }

    function configuration() external view override returns (S0ULTypes.Config memory) { return _config; }
    function tensorCount() external view returns (uint256) { return _offsets.length; }
    function shardCount() external view returns (uint256) { return _shards.length; }
    function tensorInfo(uint256 tensor) external view returns (uint256 offset, uint256 length) {
        if (tensor >= _offsets.length) revert InvalidTensorRange();
        return (_offsets[tensor], _lengths[tensor]);
    }
    function shardInfo(uint256 index) external view returns (address shard, bytes32 runtimeHash) {
        if (index >= _shards.length) revert InvalidShard();
        return (_shards[index], _runtimeHashes[index]);
    }

    function readTensor(uint256 tensor, uint256 offset, uint256 length)
        external view override returns (bytes memory result)
    {
        if (tensor >= _offsets.length || offset > _lengths[tensor] || length > _lengths[tensor] - offset) {
            revert InvalidTensorRange();
        }
        result = new bytes(length);
        uint256 absolute = _offsets[tensor] + offset;
        uint256 written;
        while (written < length) {
            uint256 index = absolute / shardBytes;
            uint256 within = absolute % shardBytes;
            uint256 count = shardBytes - within;
            if (count > length - written) count = length - written;
            address shard = _shards[index];
            if (shard.codehash != _runtimeHashes[index]) revert InvalidShard();
            assembly ("memory-safe") {
                extcodecopy(shard, add(add(result, 32), written), add(within, 1), count)
            }
            written += count;
            absolute += count;
        }
    }
}
