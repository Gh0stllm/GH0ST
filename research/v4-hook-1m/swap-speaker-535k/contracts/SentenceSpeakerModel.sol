// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract SentenceModelData {
    constructor(bytes memory payload) {
        bytes memory runtime = bytes.concat(hex"00", payload);
        assembly ("memory-safe") { return(add(runtime, 32), mload(runtime)) }
    }
}

/// @notice 534,751-parameter recurrent word model with a learned binary decoder.
/// @dev All parameters are stored onchain; each step evaluates a conditional
///      word-tree path rather than all vocabulary rows. No sentence templates.
contract SentenceSpeakerModel {
    uint16 public constant VOCABULARY = 8192;
    uint256 public constant PARAMETERS = 534751;
    uint256 public constant HIDDEN = 32;
    uint256 public constant MAX_WORDS = 16;
    address public immutable core;
    bytes32 public immutable modelHash;
    address[] private _embeddings;
    address[] private _nodes;
    address[] private _vocabulary;

    error InvalidModel();
    error InvalidInput();

    constructor(address core_, address[] memory embeddings, address[] memory nodes, address[] memory vocabulary) {
        if (core_.code.length != 4545) revert InvalidModel();
        core = core_;
        bytes32 a = _pin(embeddings, 524352, 24000, _embeddings);
        bytes32 b = _pin(nodes, 540606, 23760, _nodes);
        bytes32 c = _pin(vocabulary, 262144, 24000, _vocabulary);
        modelHash = keccak256(abi.encode("GH0ST_SENTENCE_SPEAKER_535K_V1", core_.codehash, a, b, c));
    }

    function _pin(address[] memory sources, uint256 total, uint256 chunk, address[] storage destination)
        private returns (bytes32 commitment)
    {
        if (sources.length != (total + chunk - 1) / chunk) revert InvalidModel();
        for (uint256 i; i < sources.length; ++i) {
            uint256 length = total - i * chunk;
            if (length > chunk) length = chunk;
            if (sources[i].code.length != length + 1) revert InvalidModel();
            commitment = keccak256(abi.encode(commitment, sources[i].codehash));
            destination.push(sources[i]);
        }
    }

    function _copy(address source, uint256 offset, uint256 length) private view returns (bytes memory data) {
        data = new bytes(length);
        assembly ("memory-safe") { extcodecopy(source, add(data, 32), offset, length) }
    }

    function _weight(bytes memory data, uint256 index) private pure returns (int256 value) {
        assembly ("memory-safe") { value := signextend(1, shr(240, mload(add(add(data, 32), shl(1, index))))) }
    }

    // Bounds follow from canonical int16 weights, hidden clamp and input checks.
    // Accumulators are below 2**40; arithmetic is intentionally signed int256.
    function _dot32(bytes memory data, uint256 offset, int16[32] memory vector) private pure returns (int256 sum) {
        assembly ("memory-safe") {
            let ptr := add(add(data, 32), shl(1, offset))
            for { let i := 0 } lt(i, 32) { i := add(i, 1) } {
                let w := signextend(1, shr(240, mload(add(ptr, shl(1, i)))))
                sum := add(sum, mul(w, signextend(1, mload(add(vector, shl(5, i))))))
            }
        }
    }

    function _dot6(bytes memory data, uint256 offset, int32[6] memory vector) private pure returns (int256 sum) {
        assembly ("memory-safe") {
            let ptr := add(add(data, 32), shl(1, offset))
            for { let i := 0 } lt(i, 6) { i := add(i, 1) } {
                let w := signextend(1, shr(240, mload(add(ptr, shl(1, i)))))
                sum := add(sum, mul(w, signextend(3, mload(add(vector, shl(5, i))))))
            }
        }
    }

    function _validate(uint16 previous, int16[32] memory state, int32[6] memory features) private pure {
        if (previous > VOCABULARY) revert InvalidInput();
        for (uint256 i; i < 32; ++i) if (state[i] < 0 || state[i] > 8192) revert InvalidInput();
        for (uint256 i; i < 6; ++i) if (features[i] < -4096 || features[i] > 4096) revert InvalidInput();
    }

    function _step(bytes memory weights, uint16 previous, int16[32] memory state, int32[6] memory features)
        private view returns (uint16 token, int16[32] memory next, int256[13] memory scores)
    {
        uint256 byteOffset = uint256(previous) * 64;
        bytes memory row = _copy(_embeddings[byteOffset / 24000], 1 + byteOffset % 24000, 64);
        int16[32] memory embedding;
        for (uint256 i; i < 32; ++i) embedding[i] = int16(_weight(row, i));
        for (uint256 i; i < 32; ++i) {
            int256 sum = _weight(weights, 2240 + i) * 1024;
            sum += _dot32(weights, i * 32, embedding);
            sum += _dot32(weights, 1024 + i * 32, state);
            sum += _dot6(weights, 2048 + i * 6, features);
            sum /= 1024;
            next[i] = int16(sum <= 0 ? int256(0) : sum >= 8192 ? int256(8192) : sum);
        }
        uint256 node;
        for (uint256 depth; depth < 13; ++depth) {
            uint256 offset = node * 66;
            bytes memory classifier = _copy(_nodes[offset / 23760], 1 + offset % 23760, 66);
            int256 score = (_dot32(classifier, 0, next) + _weight(classifier, 32) * 1024) / 1024;
            scores[depth] = score;
            node = node * 2 + 1 + (score > 0 ? 1 : 0);
        }
        token = uint16(node - 8191);
    }

    function word(uint16 token) public view returns (bytes32 value, uint8 length, bool terminal) {
        if (token >= VOCABULARY) revert InvalidInput();
        uint256 offset = uint256(token) * 32;
        bytes memory data = _copy(_vocabulary[offset / 24000], 1 + offset % 24000, 32);
        assembly ("memory-safe") { value := mload(add(data, 32)) }
        for (uint256 i; i < 32 && value[i] != 0; ++i) {
            uint8 c = uint8(value[i]);
            bool punctuation = c == 46 || c == 33 || c == 63;
            if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c == 39 && i > 0) || (punctuation && i > 0))) revert InvalidModel();
            if (punctuation && i != 31 && value[i + 1] != 0) revert InvalidModel();
            length += 1;
            terminal = punctuation;
        }
        if (length == 0) revert InvalidModel();
    }

    function inspect(uint16 previous, int16[32] memory state, int32[6] memory features)
        external view returns (uint16 token, int16[32] memory next, int256[13] memory scores)
    {
        _validate(previous, state, features);
        return _step(_copy(core, 1, 4544), previous, state, features);
    }

    function generate(uint16 previous, int16[32] memory state, int32[6] memory features, uint8 maximumWords)
        external view returns (uint16 nextPrevious, int16[32] memory nextState, uint16[] memory tokens, string memory text, bool endedNaturally)
    {
        _validate(previous, state, features);
        if (maximumWords == 0 || maximumWords > MAX_WORDS) revert InvalidInput();
        bytes memory weights = _copy(core, 1, 4544);
        bytes memory output = new bytes(uint256(maximumWords) * 33 + 1);
        tokens = new uint16[](maximumWords);
        uint256 length;
        uint256 count;
        nextPrevious = previous;
        nextState = state;
        for (uint256 i; i < maximumWords; ++i) {
            (uint16 token, int16[32] memory hidden,) = _step(weights, nextPrevious, nextState, features);
            (bytes32 value, uint8 size, bool terminal) = word(token);
            if (i != 0) output[length++] = bytes1(" ");
            for (uint256 j; j < size; ++j) output[length++] = value[j];
            tokens[count++] = token;
            nextPrevious = token;
            nextState = hidden;
            if (terminal) { endedNaturally = true; break; }
        }
        if (!endedNaturally) output[length++] = bytes1(".");
        assembly ("memory-safe") { mstore(output, length) mstore(tokens, count) }
        text = string(output);
    }
}
