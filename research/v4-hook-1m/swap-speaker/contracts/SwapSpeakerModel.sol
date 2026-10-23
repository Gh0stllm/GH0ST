// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Immutable model-data runtime. STOP prevents executing weight bytes.
contract SpeakerData {
    constructor(bytes memory payload) {
        bytes memory runtime = bytes.concat(hex"00", payload);
        assembly ("memory-safe") { return(add(runtime, 32), mload(runtime)) }
    }
}

/// @notice Complete integer recurrent word model. No sentence lookup table.
/// @dev Q1024 signed int16 weights; 12 embedding dimensions; 24 hidden neurons;
///      six swap features; one vocabulary word per step. All state is caller supplied.
contract SwapSpeakerModel {
    uint256 public constant HIDDEN = 24;
    uint256 public constant EMBEDDING = 12;
    int256 private constant SCALE = 1024;
    uint16 public immutable vocabularySize;
    uint256 public immutable parameterCount;
    uint256 public immutable weightBytes;
    address public immutable modelData;
    bytes32 public immutable modelHash;
    bytes32 public immutable dataCodeHash;

    error InvalidModel();
    error InvalidInput();

    constructor(uint16 size, bytes memory weights, bytes memory vocabulary) {
        if (size < 2 || size > 256) revert InvalidModel();
        uint256 count = uint256(size) * 37 + 1044;
        if (weights.length != count * 2 || vocabulary.length != uint256(size) * 32
            || weights.length + vocabulary.length + 1 > 24576) revert InvalidModel();
        for (uint256 row; row < size; ++row) {
            bool ended;
            for (uint256 j; j < 32; ++j) {
                uint8 c = uint8(vocabulary[row * 32 + j]);
                if (c == 0) { ended = true; continue; }
                if (ended) revert InvalidModel();
                if (c == 46) {
                    if (j == 0 || (j != 31 && vocabulary[row * 32 + j + 1] != 0)) revert InvalidModel();
                } else if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) revert InvalidModel();
            }
            if (vocabulary[row * 32] == 0) revert InvalidModel();
        }
        vocabularySize = size;
        parameterCount = count;
        weightBytes = weights.length;
        bytes memory payload = bytes.concat(weights, vocabulary);
        modelData = address(new SpeakerData(payload));
        dataCodeHash = keccak256(bytes.concat(hex"00", payload));
        modelHash = keccak256(abi.encode("GH0ST_SWAP_SPEAKER_V1", size, keccak256(weights), keccak256(vocabulary)));
    }

    function step(uint16 previous, int16[24] calldata state, int32[6] calldata features)
        external view returns (uint16 token, bytes32 word, bool terminal, int16[24] memory nextState)
    {
        int256[] memory scores;
        (token, nextState, scores) = _infer(previous, state, features);
        (word, terminal) = vocabularyWord(token);
    }

    function inspect(uint16 previous, int16[24] calldata state, int32[6] calldata features)
        external view returns (uint16 token, int16[24] memory nextState, int256[] memory scores)
    {
        return _infer(previous, state, features);
    }

    function vocabularyWord(uint16 token) public view returns (bytes32 word, bool terminal) {
        if (token >= vocabularySize) revert InvalidInput();
        address source = modelData;
        uint256 offset = 1 + weightBytes + uint256(token) * 32;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            extcodecopy(source, ptr, offset, 32)
            word := mload(ptr)
        }
        for (uint256 i; i < 32 && word[i] != 0; ++i) terminal = word[i] == bytes1(".");
    }

    function _weight(bytes memory data, uint256 index) private pure returns (int256 value) {
        assembly ("memory-safe") {
            value := signextend(1, shr(240, mload(add(add(data, 32), shl(1, index)))))
        }
    }

    function _infer(uint16 previous, int16[24] calldata state, int32[6] calldata features)
        private view returns (uint16 token, int16[24] memory nextState, int256[] memory scores)
    {
        if (previous > vocabularySize) revert InvalidInput();
        for (uint256 i; i < 24; ++i) if (state[i] < 0 || state[i] > 8192) revert InvalidInput();
        for (uint256 i; i < 6; ++i) if (features[i] < -4096 || features[i] > 4096) revert InvalidInput();
        bytes memory data = new bytes(weightBytes);
        address source = modelData;
        uint256 length = weightBytes;
        assembly ("memory-safe") { extcodecopy(source, add(data, 32), 1, length) }
        uint256 inputOffset = (uint256(vocabularySize) + 1) * 12;
        uint256 recurrentOffset = inputOffset + 288;
        uint256 featureOffset = recurrentOffset + 576;
        uint256 biasOffset = featureOffset + 144;
        uint256 outputOffset = biasOffset + 24;
        uint256 outputBiasOffset = outputOffset + uint256(vocabularySize) * 24;
        for (uint256 row; row < 24; ++row) {
            int256 sum = _weight(data, biasOffset + row) * SCALE;
            for (uint256 j; j < 12; ++j) {
                sum += _weight(data, inputOffset + row * 12 + j) * _weight(data, uint256(previous) * 12 + j);
            }
            for (uint256 j; j < 24; ++j) sum += _weight(data, recurrentOffset + row * 24 + j) * int256(state[j]);
            for (uint256 j; j < 6; ++j) sum += _weight(data, featureOffset + row * 6 + j) * int256(features[j]);
            sum /= SCALE;
            nextState[row] = int16(sum <= 0 ? int256(0) : sum >= 8192 ? int256(8192) : sum);
        }
        scores = new int256[](vocabularySize);
        int256 best = type(int256).min;
        for (uint256 row; row < vocabularySize; ++row) {
            int256 sum = _weight(data, outputBiasOffset + row) * SCALE;
            for (uint256 j; j < 24; ++j) sum += _weight(data, outputOffset + row * 24 + j) * int256(nextState[j]);
            sum /= SCALE;
            scores[row] = sum;
            if (sum > best) { best = sum; token = uint16(row); }
        }
    }
}
