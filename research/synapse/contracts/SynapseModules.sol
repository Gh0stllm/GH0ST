// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev STOP-prefixed bytecode storage follows the existing AttoData weight-shard pattern.
contract SynapseData {
    constructor(bytes memory payload) {
        bytes memory runtime = bytes.concat(hex"00", payload);
        assembly ("memory-safe") { return(add(runtime, 32), mload(runtime)) }
    }
}

/// @notice The v1 neural ABI uses eight Q8 activations and signed big-endian int16 weights.
abstract contract SynapseKernel {
    address public beneficiary;
    uint96 public fee;
    address public data;
    bytes32 public dataCodeHash;
    int256 internal constant SCALE = 256;
    int256 internal constant ACTIVATION_MAX = 32767;

    error InvalidModule();
    error InvalidActivation();

    constructor(address recipient, uint96 price, bytes memory packed) {
        if (recipient == address(0)) revert InvalidModule();
        beneficiary = recipient;
        fee = price;
        data = address(new SynapseData(packed));
        dataCodeHash = data.codehash;
    }

    function weightsHash() public view virtual returns (bytes32);

    function _load(uint256 length) internal view returns (bytes memory packed) {
        address source = data;
        if (source.codehash != dataCodeHash || source.code.length != length + 1) revert InvalidModule();
        packed = new bytes(length);
        assembly ("memory-safe") { extcodecopy(source, add(packed, 32), 1, length) }
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

    function _check(int256[8] memory activation) internal pure {
        for (uint256 i; i < 8; ++i) {
            if (activation[i] < 0 || activation[i] > ACTIVATION_MAX) revert InvalidActivation();
        }
    }
}

/// @notice Shared positional embeddings and language-model head. Constructor state has no mutators.
contract SynapseBackbone is SynapseKernel {
    uint16 public vocabulary;

    constructor(address recipient, uint96 price, uint16 words, bytes memory packed)
        SynapseKernel(recipient, price, packed)
    {
        if (words == 0 || words > 32 || packed.length != uint256(words) * 50) revert InvalidModule();
        vocabulary = words;
    }

    function _weights() private view returns (bytes memory) {
        if (vocabulary == 0 || vocabulary > 32) revert InvalidModule();
        return _load(uint256(vocabulary) * 50);
    }

    function weightsHash() public view override returns (bytes32) {
        return keccak256(_weights());
    }

    function spaceId() external view returns (bytes32) {
        return keccak256(abi.encode("GH0ST_SYNAPSE_Q8_CTX2_WIDTH8_MEAN2_V1", vocabulary, weightsHash()));
    }

    function encode(uint16[2] calldata context) external view returns (int256[8] memory hidden) {
        bytes memory packed = _weights();
        if (context[0] >= vocabulary || context[1] >= vocabulary) revert InvalidActivation();
        for (uint256 i; i < 8; ++i) {
            hidden[i] = _activate(_weight(packed, uint256(context[0]) * 8 + i)
                + _weight(packed, uint256(vocabulary) * 8 + uint256(context[1]) * 8 + i));
        }
    }

    function project(int256[8] calldata hidden) external view returns (int256[] memory logits) {
        _check(hidden);
        bytes memory packed = _weights();
        uint256 head = uint256(vocabulary) * 16;
        uint256 bias = head + uint256(vocabulary) * 8;
        logits = new int256[](vocabulary);
        for (uint256 word; word < vocabulary; ++word) {
            int256 sum;
            for (uint256 i; i < 8; ++i) sum += _weight(packed, head + word * 8 + i) * hidden[i];
            logits[word] = sum / SCALE + _weight(packed, bias + word);
        }
    }
}

/// @notice A separately published trained expert for one backbone's representation space.
contract SynapseExpert is SynapseKernel {
    bytes32 public spaceId;

    constructor(address recipient, uint96 price, bytes32 space, bytes memory packed)
        SynapseKernel(recipient, price, packed)
    {
        if (space == bytes32(0) || packed.length != 144) revert InvalidModule();
        spaceId = space;
    }

    function weightsHash() public view override returns (bytes32) {
        return keccak256(_load(144));
    }

    function forward(int256[8] calldata hidden) external view returns (int256[8] memory output) {
        _check(hidden);
        bytes memory packed = _load(144);
        for (uint256 row; row < 8; ++row) {
            int256 sum;
            for (uint256 column; column < 8; ++column) {
                sum += _weight(packed, row * 8 + column) * hidden[column];
            }
            output[row] = _activate(sum / SCALE + _weight(packed, 64 + row));
        }
    }
}
