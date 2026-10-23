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
    uint256 public constant TEMPERATURE_Q10 = 256;
    // round(65536 * sigmoid(i / 16)) - 32768, i=0..256. All inference uses integer lookup.
    bytes private constant SIGMOID_DELTA = hex"0000040007fd0bf70feb13d717b91b901f59231426bf2a582ddf315134ae37f63b273e404142442c46fd49b64c564edd514d53a355e2580a5a1a5c135df65fc4617c632064b0662d679768f06a376b6e6c956dac6eb56fb0709e717f7254731e73dc7490753a75da7672770177887807787f78f0795b79bf7a1e7a777acb7b1b7b657bab7bee7c2c7c667c9d7cd17d027d307d5b7d847daa7dce7df07e0f7e2d7e497e647e7d7e947eaa7ebf7ed27ee47ef57f057f147f237f307f3d7f487f547f5e7f687f717f7a7f827f897f917f977f9e7fa47fa97fae7fb37fb87fbc7fc07fc47fc87fcb7fce7fd17fd47fd77fd97fdc7fde7fe07fe27fe47fe57fe77fe97fea7feb7fed7fee7fef7ff07ff17ff27ff37ff37ff47ff57ff67ff67ff77ff77ff87ff87ff97ff97ffa7ffa7ffa7ffb7ffb7ffb7ffc7ffc7ffc7ffc7ffd7ffd7ffd7ffd7ffd7ffe7ffe7ffe7ffe7ffe7ffe7ffe7ffe7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff80008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000";
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
        modelHash = keccak256(abi.encode("GH0ST_SENTENCE_SPEAKER_535K_SAMPLED_T256_V2", core_.codehash, a, b, c));
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

    function _rightProbability(int256 score, bytes memory table) private pure returns (uint32) {
        uint256 magnitude = uint256(score < 0 ? -score : score);
        uint256 index = (magnitude * 1024 / TEMPERATURE_Q10 + 32) / 64;
        if (index > 256) index = 256;
        uint32 delta = (uint32(uint8(table[index * 2])) << 8) | uint32(uint8(table[index * 2 + 1]));
        return score >= 0 ? 32768 + delta : 32768 - delta;
    }

    function rightProbability(int256 score) external pure returns (uint32) {
        return _rightProbability(score, SIGMOID_DELTA);
    }

    function _step(bytes memory weights, uint16 previous, int16[32] memory state, int32[6] memory features,
        bool sampled, uint256 randomBits)
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
        bytes memory table;
        if (sampled) table = SIGMOID_DELTA;
        for (uint256 depth; depth < 13; ++depth) {
            uint256 offset = node * 66;
            bytes memory classifier = _copy(_nodes[offset / 23760], 1 + offset % 23760, 66);
            int256 score = (_dot32(classifier, 0, next) + _weight(classifier, 32) * 1024) / 1024;
            scores[depth] = score;
            bool right = sampled ? uint16(randomBits >> (depth * 16)) < _rightProbability(score, table) : score > 0;
            node = node * 2 + 1 + (right ? 1 : 0);
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
        return _step(_copy(core, 1, 4544), previous, state, features, false, 0);
    }

    function inspectSampled(uint16 previous, int16[32] memory state, int32[6] memory features, bytes32 seed, uint256 wordIndex)
        external view returns (uint16 token, int16[32] memory next, int256[13] memory scores)
    {
        _validate(previous, state, features);
        return _step(_copy(core, 1, 4544), previous, state, features, true,
            uint256(keccak256(abi.encode(seed, wordIndex))));
    }

    function generate(uint16 previous, int16[32] memory state, int32[6] memory features, uint8 maximumWords)
        external view returns (uint16 nextPrevious, int16[32] memory nextState, uint16[] memory tokens, string memory text, bool endedNaturally)
    {
        return _generate(previous, state, features, maximumWords, false, bytes32(0));
    }

    /// @notice Seeded Bernoulli traversal of the model's learned binary probabilities.
    /// @dev Seed is deterministic creative variation, not secure or unbiased randomness.
    function generateSampled(uint16 previous, int16[32] memory state, int32[6] memory features, uint8 maximumWords, bytes32 seed)
        external view returns (uint16 nextPrevious, int16[32] memory nextState, uint16[] memory tokens, string memory text, bool endedNaturally)
    {
        return _generate(previous, state, features, maximumWords, true, seed);
    }

    function _generate(uint16 previous, int16[32] memory state, int32[6] memory features, uint8 maximumWords,
        bool sampled, bytes32 seed)
        private view returns (uint16 nextPrevious, int16[32] memory nextState, uint16[] memory tokens, string memory text, bool endedNaturally)
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
            uint256 randomBits = sampled ? uint256(keccak256(abi.encode(seed, i))) : 0;
            (uint16 token, int16[32] memory hidden,) = _step(weights, nextPrevious, nextState, features, sampled, randomBits);
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
