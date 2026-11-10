// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SynapseData} from "../SynapseModules.sol";

/// @notice Bounded Q8 neural modules with immutable code shards and a shared tensor format.
abstract contract SynapseKernelV2 {
    uint256 internal constant SHARD_BYTES = 24000;
    uint256 internal constant MAX_WEIGHT_BYTES = 44000;
    int256 internal constant SCALE = 256;
    int256 internal constant ACTIVATION_MAX = 32767;
    address public beneficiary;
    uint96 public fee;
    uint16 public hiddenSize;
    address[] public data;
    bytes32[] public dataCodeHashes;

    error InvalidModule();
    error InvalidActivation();

    constructor(address recipient, uint96 price, uint16 width, bytes memory packed) {
        if (recipient == address(0) || width == 0 || width > 32
            || packed.length == 0 || packed.length > MAX_WEIGHT_BYTES) revert InvalidModule();
        beneficiary = recipient;
        fee = price;
        hiddenSize = width;
        for (uint256 offset; offset < packed.length; offset += SHARD_BYTES) {
            uint256 count = packed.length - offset;
            if (count > SHARD_BYTES) count = SHARD_BYTES;
            bytes memory shard = new bytes(count);
            assembly ("memory-safe") {
                for { let i := 0 } lt(i, count) { i := add(i, 32) } {
                    mstore(add(add(shard, 32), i), mload(add(add(packed, 32), add(offset, i))))
                }
            }
            address source = address(new SynapseData(shard));
            data.push(source);
            dataCodeHashes.push(source.codehash);
        }
    }

    function _width() internal view returns (uint256 width) {
        width = hiddenSize;
        if (width == 0 || width > 32) revert InvalidModule();
    }

    function _load(uint256 length) internal view returns (bytes memory packed) {
        if (length == 0 || length > MAX_WEIGHT_BYTES
            || data.length != (length + SHARD_BYTES - 1) / SHARD_BYTES
            || dataCodeHashes.length != data.length) revert InvalidModule();
        packed = new bytes(length);
        for (uint256 i; i < data.length; ++i) {
            uint256 offset = i * SHARD_BYTES;
            uint256 count = length - offset;
            if (count > SHARD_BYTES) count = SHARD_BYTES;
            address source = data[i];
            if (source.codehash != dataCodeHashes[i] || source.code.length != count + 1) revert InvalidModule();
            assembly ("memory-safe") { extcodecopy(source, add(add(packed, 32), offset), 1, count) }
        }
    }

    function _weight(bytes memory packed, uint256 index) internal pure returns (int256 value) {
        assembly ("memory-safe") {
            value := signextend(1, shr(240, mload(add(add(packed, 32), mul(index, 2)))))
        }
    }

    function _activate(int256 value) internal pure returns (int256) {
        if (value < 0) return 0;
        if (value > ACTIVATION_MAX) return ACTIVATION_MAX;
        return value;
    }

    function _check(int256[] memory activation) internal view {
        if (activation.length != _width()) revert InvalidActivation();
        for (uint256 i; i < activation.length; ++i) {
            if (activation[i] < 0 || activation[i] > ACTIVATION_MAX) revert InvalidActivation();
        }
    }

    function _dot(bytes memory packed, uint256 offset, int256[] memory input)
        internal pure returns (int256 sum)
    {
        // Inputs and signed int16 weights are bounded before reaching this kernel.
        assembly ("memory-safe") {
            let weights := add(add(packed, 32), mul(offset, 2))
            let values := add(input, 32)
            for { let i := 0 } lt(i, mload(input)) { i := add(i, 1) } {
                let weight := signextend(1, shr(240, mload(add(weights, mul(i, 2)))))
                sum := add(sum, mul(weight, mload(add(values, mul(i, 32)))))
            }
        }
    }
}

contract SynapseBackboneV2 is SynapseKernelV2 {
    uint16 public vocabulary;
    uint16 public contextSize;

    constructor(address recipient, uint96 price, uint16 words, uint16 context, uint16 width, bytes memory packed)
        SynapseKernelV2(recipient, price, width, packed)
    {
        if (words == 0 || words > 256 || context == 0 || context > 8
            || packed.length != (uint256(context + 1) * words * width + words) * 2) revert InvalidModule();
        vocabulary = words;
        contextSize = context;
    }

    function _weights() private view returns (bytes memory) {
        uint256 width = _width();
        if (vocabulary == 0 || vocabulary > 256 || contextSize == 0 || contextSize > 8) revert InvalidModule();
        return _load((uint256(contextSize + 1) * vocabulary * width + vocabulary) * 2);
    }

    function weightsHash() public view returns (bytes32) {
        return keccak256(_weights());
    }

    function spaceId() external view returns (bytes32) {
        return keccak256(abi.encode("GH0ST_SYNAPSE_Q8_MEAN2_V2", vocabulary, contextSize, hiddenSize, weightsHash()));
    }

    function encode(uint16[] calldata context) external view returns (int256[] memory hidden) {
        bytes memory packed = _weights();
        if (context.length != contextSize) revert InvalidActivation();
        uint256 width = _width();
        hidden = new int256[](width);
        for (uint256 position; position < contextSize; ++position) {
            if (context[position] >= vocabulary) revert InvalidActivation();
            uint256 row = (position * vocabulary + context[position]) * width;
            for (uint256 i; i < width; ++i) hidden[i] += _weight(packed, row + i);
        }
        for (uint256 i; i < width; ++i) hidden[i] = _activate(hidden[i]);
    }

    function project(int256[] calldata hidden) external view returns (int256[] memory logits) {
        int256[] memory input = hidden;
        _check(input);
        bytes memory packed = _weights();
        uint256 width = _width();
        uint256 head = uint256(contextSize) * vocabulary * width;
        uint256 bias = head + uint256(vocabulary) * width;
        logits = new int256[](vocabulary);
        for (uint256 word; word < vocabulary; ++word) {
            logits[word] = _dot(packed, head + word * width, input) / SCALE + _weight(packed, bias + word);
        }
    }
}

contract SynapseExpertV2 is SynapseKernelV2 {
    bytes32 public spaceId;

    constructor(address recipient, uint96 price, bytes32 space, uint16 width, bytes memory packed)
        SynapseKernelV2(recipient, price, width, packed)
    {
        if (space == bytes32(0) || packed.length != uint256(width) * (width + 1) * 2) revert InvalidModule();
        spaceId = space;
    }

    function weightsHash() public view returns (bytes32) {
        uint256 width = _width();
        return keccak256(_load(width * (width + 1) * 2));
    }

    function forward(int256[] calldata hidden) external view returns (int256[] memory output) {
        int256[] memory input = hidden;
        _check(input);
        uint256 width = _width();
        bytes memory packed = _load(width * (width + 1) * 2);
        output = new int256[](width);
        for (uint256 row; row < width; ++row) {
            output[row] = _activate(_dot(packed, row * width, input) / SCALE + _weight(packed, width * width + row));
        }
    }
}
