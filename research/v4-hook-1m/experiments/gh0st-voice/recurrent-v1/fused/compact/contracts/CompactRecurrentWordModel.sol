// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract CompactRecurrentWordModelData {
    constructor(bytes memory payload) {
        bytes memory runtime = bytes.concat(hex"00", payload);
        assembly ("memory-safe") { return(add(runtime, 32), mload(runtime)) }
    }
}

/// @notice Compiled from a 4,492,256-parameter recurrent word model.
/// @dev Stores compact direct and derived tensors; each step evaluates a conditional
///      word-tree path rather than all vocabulary rows. No sentence templates.
contract CompactRecurrentWordModel {
    uint16 public constant VOCABULARY = 8192;
    uint256 public constant SOURCE_MODEL_PARAMETERS = 4492256;
    uint256 public constant DIRECT_ORIGINAL_SCALARS = 2250621;
    uint256 public constant DERIVED_INPUT_SCALARS = 2171145;
    uint256 public constant HIDDEN = 265;
    uint256 public constant MAX_WORDS = 16;
    uint256 public constant TEMPERATURE_Q10 = 256;
    // round(65536 * sigmoid(i / 16)) - 32768, i=0..256. All inference uses integer lookup.
    bytes private constant SIGMOID_DELTA = hex"0000040007fd0bf70feb13d717b91b901f59231426bf2a582ddf315134ae37f63b273e404142442c46fd49b64c564edd514d53a355e2580a5a1a5c135df65fc4617c632064b0662d679768f06a376b6e6c956dac6eb56fb0709e717f7254731e73dc7490753a75da7672770177887807787f78f0795b79bf7a1e7a777acb7b1b7b657bab7bee7c2c7c667c9d7cd17d027d307d5b7d847daa7dce7df07e0f7e2d7e497e647e7d7e947eaa7ebf7ed27ee47ef57f057f147f237f307f3d7f487f547f5e7f687f717f7a7f827f897f917f977f9e7fa47fa97fae7fb37fb87fbc7fc07fc47fc87fcb7fce7fd17fd47fd77fd97fdc7fde7fe07fe27fe47fe57fe77fe97fea7feb7fed7fee7fef7ff07ff17ff27ff37ff37ff47ff57ff67ff67ff77ff77ff87ff87ff97ff97ffa7ffa7ffa7ffb7ffb7ffb7ffc7ffc7ffc7ffc7ffd7ffd7ffd7ffd7ffd7ffe7ffe7ffe7ffe7ffe7ffe7ffe7ffe7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff80008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000";
    uint256 public constant CHUNK_BYTES = 24000;
    uint256 public constant CORE_BYTES = 143630;
    uint256 public constant NODE_BYTES = 4357612;
    uint256 public constant VOCABULARY_BYTES = 262144;
    uint256 public constant FUSED_BYTES = 10855725;
    address[] private _fused;
    address[] private _core;
    bytes32 public immutable modelHash;
    address[] private _nodes;
    address[] private _vocabulary;

    error InvalidModel();
    error InvalidInput();

    constructor(address[] memory core_, address[] memory nodes, address[] memory vocabulary, address[] memory fused) {
        if (block.chainid != 31337) revert InvalidModel();
        bytes32 a = _pin(core_, CORE_BYTES, _core);
        bytes32 c = _pin(nodes, NODE_BYTES, _nodes);
        bytes32 d = _pin(vocabulary, VOCABULARY_BYTES, _vocabulary);
        bytes32 e = _pin(fused, FUSED_BYTES, _fused);
        modelHash = keccak256(abi.encode("GH0ST_RECURRENT_WORD_H265_Q10_COMPACT_LOCAL_V1", a, c, d, e));
    }

    function _pin(address[] memory sources, uint256 total, address[] storage destination)
        private returns (bytes32 commitment)
    {
        if (sources.length != (total + CHUNK_BYTES - 1) / CHUNK_BYTES) revert InvalidModel();
        for (uint256 i; i < sources.length; ++i) {
            uint256 length = total - i * CHUNK_BYTES;
            if (length > CHUNK_BYTES) length = CHUNK_BYTES;
            if (sources[i].code.length != length + 1) revert InvalidModel();
            commitment = keccak256(abi.encode(commitment, sources[i].codehash));
            destination.push(sources[i]);
        }
    }

    /// @dev Reads a requested byte range across 24,000-byte code shards. Leading STOP is skipped.
    function _read(address[] storage sources, uint256 offset, uint256 length) private view returns (bytes memory data) {
        data = new bytes(length);
        uint256 copied;
        while (copied < length) {
            uint256 at = offset + copied;
            uint256 within = at % CHUNK_BYTES;
            uint256 take = CHUNK_BYTES - within;
            if (take > length - copied) take = length - copied;
            address source = sources[at / CHUNK_BYTES];
            assembly ("memory-safe") { extcodecopy(source, add(add(data, 32), copied), add(within, 1), take) }
            copied += take;
        }
    }

    function _weight(bytes memory data, uint256 index) private pure returns (int256 value) {
        assembly ("memory-safe") { value := signextend(1, shr(240, mload(add(add(data, 32), shl(1, index))))) }
    }

    // Bounds follow from canonical int16 weights, hidden clamp and input checks.
    // Accumulators are below 2**40; arithmetic is intentionally signed int256.
    function _dotH(bytes memory data, uint256 offset, int16[265] memory vector) private pure returns (int256 sum) {
        assembly ("memory-safe") {
            let ptr := add(add(data, 32), shl(1, offset))
            for { let i := 0 } lt(i, 265) { i := add(i, 1) } {
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

    function _validate(uint16 previous, int16[265] memory state, int32[6] memory features) private pure {
        if (previous > VOCABULARY) revert InvalidInput();
        for (uint256 i; i < HIDDEN; ++i) if (state[i] < 0 || state[i] > 8192) revert InvalidInput();
        for (uint256 i; i < 6; ++i) if (features[i] < -4096 || features[i] > 4096) revert InvalidInput();
    }

    function _rightProbability(int256 score, bytes memory table, uint256 temperatureQ10) private pure returns (uint32) {
        uint256 magnitude = uint256(score < 0 ? -score : score);
        uint256 index = (magnitude * 1024 / temperatureQ10 + 32) / 64;
        if (index > 256) index = 256;
        uint32 delta = (uint32(uint8(table[index * 2])) << 8) | uint32(uint8(table[index * 2 + 1]));
        return score >= 0 ? 32768 + delta : 32768 - delta;
    }

    function rightProbability(int256 score) external pure returns (uint32) {
        return _rightProbability(score, SIGMOID_DELTA, TEMPERATURE_Q10);
    }

    function _step(bytes memory weights, uint16 previous, int16[265] memory state, int32[6] memory features,
        bool sampled, uint256 randomBits, uint256 temperatureQ10)
        private view returns (uint16 token, int16[265] memory next, int256[13] memory scores)
    {
        bytes memory row = _read(_fused, uint256(previous) * HIDDEN * 5, HIDDEN * 5);
        for (uint256 i; i < HIDDEN; ++i) {
            int256 sum;
            assembly ("memory-safe") { sum := signextend(4, shr(216, mload(add(add(row, 32), mul(i, 5))))) }
            sum += _dotH(weights, i * HIDDEN, state);
            sum += _dot6(weights, 70225 + i * 6, features);
            sum /= 1024;
            next[i] = int16(sum <= 0 ? int256(0) : sum >= 8192 ? int256(8192) : sum);
        }
        uint256 node;
        bytes memory table;
        if (sampled) table = SIGMOID_DELTA;
        for (uint256 depth; depth < 13; ++depth) {
            bytes memory classifier = _read(_nodes, node * (HIDDEN + 1) * 2, (HIDDEN + 1) * 2);
            int256 score = (_dotH(classifier, 0, next) + _weight(classifier, HIDDEN) * 1024) / 1024;
            scores[depth] = score;
            bool right = sampled ? uint16(randomBits >> (depth * 16)) < _rightProbability(score, table, temperatureQ10) : score > 0;
            node = node * 2 + 1 + (right ? 1 : 0);
        }
        token = uint16(node - 8191);
    }

    function word(uint16 token) public view returns (bytes32 value, uint8 length, bool terminal) {
        if (token >= VOCABULARY) revert InvalidInput();
        uint256 offset = uint256(token) * 32;
        bytes memory data = _read(_vocabulary, offset, 32);
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

    function inspect(uint16 previous, int16[265] memory state, int32[6] memory features)
        external view returns (uint16 token, int16[265] memory next, int256[13] memory scores)
    {
        _validate(previous, state, features);
        return _step(_read(_core, 0, CORE_BYTES), previous, state, features, false, 0, TEMPERATURE_Q10);
    }

    function inspectSampled(uint16 previous, int16[265] memory state, int32[6] memory features, bytes32 seed, uint256 wordIndex)
        external view returns (uint16 token, int16[265] memory next, int256[13] memory scores)
    {
        _validate(previous, state, features);
        return _step(_read(_core, 0, CORE_BYTES), previous, state, features, true,
            uint256(keccak256(abi.encode(seed, wordIndex))), TEMPERATURE_Q10);
    }

    /// @notice Exactly one learned word; no forced punctuation or context reset.
    /// @dev wordIndex is the monotonic per-pool sample counter. The seed is creative variation, not secure randomness.
    function stepSampled(uint16 previous, int16[265] memory state, int32[6] memory features,
        bytes32 seed, uint256 wordIndex, uint16 temperatureQ10)
        external view returns (uint16 token, int16[265] memory next, int256[13] memory scores,
            string memory text, bool terminal)
    {
        _validate(previous, state, features);
        if (temperatureQ10 < 64 || temperatureQ10 > 4096) revert InvalidInput();
        (token, next, scores) = _step(_read(_core, 0, CORE_BYTES), previous, state, features, true,
            uint256(keccak256(abi.encode(seed, wordIndex))), temperatureQ10);
        (bytes32 value, uint8 size, bool ended) = word(token);
        bytes memory output = new bytes(size);
        for (uint256 j; j < size; ++j) output[j] = value[j];
        return (token, next, scores, string(output), ended);
    }

    function generate(uint16 previous, int16[265] memory state, int32[6] memory features, uint8 maximumWords)
        external view returns (uint16 nextPrevious, int16[265] memory nextState, uint16[] memory tokens, string memory text, bool endedNaturally)
    {
        return _generate(previous, state, features, maximumWords, false, bytes32(0));
    }

    /// @notice Seeded Bernoulli traversal of the model's learned binary probabilities.
    /// @dev Seed is deterministic creative variation, not secure or unbiased randomness.
    function generateSampled(uint16 previous, int16[265] memory state, int32[6] memory features, uint8 maximumWords, bytes32 seed)
        external view returns (uint16 nextPrevious, int16[265] memory nextState, uint16[] memory tokens, string memory text, bool endedNaturally)
    {
        return _generate(previous, state, features, maximumWords, true, seed);
    }

    function _generate(uint16 previous, int16[265] memory state, int32[6] memory features, uint8 maximumWords,
        bool sampled, bytes32 seed)
        private view returns (uint16 nextPrevious, int16[265] memory nextState, uint16[] memory tokens, string memory text, bool endedNaturally)
    {
        _validate(previous, state, features);
        if (maximumWords == 0 || maximumWords > MAX_WORDS) revert InvalidInput();
        bytes memory weights = _read(_core, 0, CORE_BYTES);
        bytes memory output = new bytes(uint256(maximumWords) * 33 + 1);
        tokens = new uint16[](maximumWords);
        uint256 length;
        uint256 count;
        nextPrevious = previous;
        nextState = state;
        for (uint256 i; i < maximumWords; ++i) {
            uint256 randomBits = sampled ? uint256(keccak256(abi.encode(seed, i))) : 0;
            (uint16 token, int16[265] memory hidden,) = _step(weights, nextPrevious, nextState, features, sampled, randomBits, TEMPERATURE_Q10);
            (bytes32 value, uint8 size, bool terminal) = word(token);
            if (i != 0) output[length++] = bytes1(" ");
            for (uint256 j; j < size; ++j) output[length++] = value[j];
            tokens[count++] = token;
            nextPrevious = token;
            nextState = hidden;
            if (terminal) { endedNaturally = true; break; }
        }
        assembly ("memory-safe") { mstore(output, length) mstore(tokens, count) }
        text = string(output);
    }
}
