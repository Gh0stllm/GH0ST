// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract SimpleStoriesV2Data {
    constructor(bytes memory payload) {
        bytes memory runtime = bytes.concat(hex"00", payload);
        assembly ("memory-safe") { return(add(runtime, 32), mload(runtime)) }
    }
}

/// @notice Local research port of every SimpleStories-V2-1.25M Llama layer.
/// @dev Q12 weights/activations; exact equations and packing are in protocol.json.
///      This performs all RMS norms, GQA attention, RoPE, SwiGLU and vocabulary logits.
contract SimpleStoriesV2Model {
    uint256 public constant PARAMETERS = 1235968;
    uint256 public constant VOCABULARY = 4019;
    uint256 public constant HIDDEN = 128;
    uint256 public constant LAYERS = 4;
    uint256 public constant INTERMEDIATE = 341;
    uint256 public constant MAX_CONTEXT = 16;
    uint256 public constant MAX_NEW_TOKENS = 4;
    uint16 public constant EOS_TOKEN = 1;
    uint256 public constant CHUNK_BYTES = 24000;
    uint256 public constant WEIGHT_BYTES = 2471936;
    uint256 public constant TABLE_BYTES = 3080;
    uint256 private constant EMBED_BYTES = 1028864;
    uint256 private constant LAYER_BYTES = 360704;
    uint256 private constant FINAL_NORM_OFFSET = 2471680;
    int256 private constant Q = 4096;
    address[] private _weights;
    address[] private _tables;
    bytes32 public immutable modelHash;
    error InvalidModel();
    error InvalidInput();
    error ArithmeticRange();

    struct Work {
        int32[] hidden;
        int32[] query;
        int32[] key;
        int32[] value;
        int32[] norm;
        int32[] qTemp;
        int32[] kTemp;
        int32[] vTemp;
        int32[] attention;
        int32[] projection;
        int32[] gate;
        int32[] up;
        int256[] scores;
        uint256[] probabilities;
    }

    constructor(address[] memory weights, address[] memory tables) {
        bytes32 a = _pin(weights, WEIGHT_BYTES, _weights);
        bytes32 b = _pin(tables, TABLE_BYTES, _tables);
        modelHash = keccak256(abi.encode("GH0ST_SIMPLESTORIES_V2_Q12_CTX16_V1", a, b));
    }

    function _pin(address[] memory sources, uint256 total, address[] storage target) private returns (bytes32 commitment) {
        if (sources.length != (total + CHUNK_BYTES - 1) / CHUNK_BYTES) revert InvalidModel();
        for (uint256 i; i < sources.length; ++i) {
            uint256 size = total - i * CHUNK_BYTES;
            if (size > CHUNK_BYTES) size = CHUNK_BYTES;
            if (sources[i].code.length != size + 1) revert InvalidModel();
            commitment = keccak256(abi.encode(commitment, sources[i].codehash));
            target.push(sources[i]);
        }
    }

    function _fill(address[] storage shards, uint256 offset, uint256 length, bytes memory output) private view {
        if (output.length < length) revert InvalidInput();
        uint256 copied;
        while (copied < length) {
            uint256 at = offset + copied;
            uint256 within = at % CHUNK_BYTES;
            uint256 count = CHUNK_BYTES - within;
            if (count > length - copied) count = length - copied;
            address source = shards[at / CHUNK_BYTES];
            assembly ("memory-safe") { extcodecopy(source, add(add(output, 32), copied), add(within, 1), count) }
            copied += count;
        }
    }

    function _i16(bytes memory data, uint256 byteOffset) private pure returns (int256 value) {
        assembly ("memory-safe") { value := signextend(1, shr(240, mload(add(add(data, 32), byteOffset)))) }
    }

    function _u32(bytes memory data, uint256 byteOffset) private pure returns (uint256 value) {
        assembly ("memory-safe") { value := shr(224, mload(add(add(data, 32), byteOffset))) }
    }

    function _checked(int256 value) private pure returns (int32) {
        if (value < type(int32).min || value > type(int32).max) revert ArithmeticRange();
        return int32(value);
    }

    function _dot(bytes memory weights, uint256 byteOffset, int32[] memory input, uint256 columns) private pure returns (int256 sum) {
        assembly ("memory-safe") {
            let weightsPtr := add(add(weights, 32), byteOffset)
            let inputPtr := add(input, 32)
            for { let i := 0 } lt(i, columns) { i := add(i, 1) } {
                let w := signextend(1, shr(240, mload(add(weightsPtr, shl(1, i)))))
                let x := signextend(3, mload(add(inputPtr, shl(5, i))))
                sum := add(sum, mul(w, x))
            }
        }
    }

    function _linear(bytes memory weights, uint256 offset, uint256 rows, uint256 columns, int32[] memory input, int32[] memory output) private pure {
        for (uint256 row; row < rows; ++row) output[row] = _checked(_dot(weights, offset + row * columns * 2, input, columns) / Q);
    }

    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x + 1) / 2;
        while (y < z) { z = y; y = (x / y + y) / 2; }
    }

    function _rms(int32[] memory input, uint256 inputOffset, bytes memory weights, uint256 weightOffset, int32[] memory output) private pure {
        uint256 squares;
        for (uint256 i; i < HIDDEN; ++i) { int256 x = input[inputOffset + i]; squares += uint256(x * x); }
        int256 denominator = int256(_sqrt(squares / HIDDEN + 17));
        for (uint256 i; i < HIDDEN; ++i) {
            int256 normalized = int256(input[inputOffset + i]) * Q / denominator;
            output[i] = _checked(normalized * _i16(weights, weightOffset + i * 2) / Q);
        }
    }

    function _rope(int32[] memory input, int32[] memory output, uint256 outputOffset, uint256 heads, uint256 position, bytes memory tables) private pure {
        for (uint256 head; head < heads; ++head) {
            for (uint256 j; j < 16; ++j) {
                int256 c = _i16(tables, (position * 16 + j) * 2);
                int256 s = _i16(tables, 512 + (position * 16 + j) * 2);
                int256 first = input[head * 32 + j];
                int256 second = input[head * 32 + j + 16];
                output[outputOffset + head * 32 + j] = _checked((first * c - second * s) / Q);
                output[outputOffset + head * 32 + j + 16] = _checked((second * c + first * s) / Q);
            }
        }
    }

    function _table(bytes memory tables, uint256 offset, uint256 distance, uint256 endpoint) private pure returns (uint256) {
        uint256 scaled = distance * 16;
        uint256 index = scaled / uint256(Q);
        if (index >= 256) return endpoint;
        uint256 remainder = scaled % uint256(Q);
        return (_u32(tables, offset + index * 4) * (uint256(Q) - remainder)
            + _u32(tables, offset + (index + 1) * 4) * remainder) / uint256(Q);
    }

    function _silu(int256 x, bytes memory tables) private pure returns (int256) {
        uint256 probability = _table(tables, 1024, uint256(x < 0 ? -x : x), 65536);
        if (x < 0) probability = 65536 - probability;
        return x * int256(probability) / 65536;
    }

    function _attention(Work memory w, uint256 position, bytes memory tables) private pure {
        for (uint256 head; head < 4; ++head) {
            int256 maximum = type(int256).min;
            for (uint256 past; past <= position; ++past) {
                int256 sum;
                uint256 qOffset = position * HIDDEN + head * 32;
                uint256 kOffset = past * 64 + (head / 2) * 32;
                for (uint256 j; j < 32; ++j) sum += int256(w.query[qOffset + j]) * int256(w.key[kOffset + j]);
                int256 score = sum / 23170;
                w.scores[past] = score;
                if (score > maximum) maximum = score;
            }
            uint256 denominator;
            for (uint256 past; past <= position; ++past) {
                uint256 probability = _table(tables, 2052, uint256(maximum - w.scores[past]), 0);
                w.probabilities[past] = probability;
                denominator += probability;
            }
            for (uint256 j; j < 32; ++j) {
                int256 sum;
                for (uint256 past; past <= position; ++past)
                    sum += int256(w.probabilities[past]) * int256(w.value[past * 64 + (head / 2) * 32 + j]);
                w.attention[head * 32 + j] = _checked(sum / int256(denominator));
            }
        }
    }

    function _newWork(uint256 length) private pure returns (Work memory w) {
        w.hidden = new int32[](length * HIDDEN);
        w.query = new int32[](length * HIDDEN);
        w.key = new int32[](length * 64);
        w.value = new int32[](length * 64);
        w.norm = new int32[](HIDDEN); w.qTemp = new int32[](HIDDEN);
        w.kTemp = new int32[](64); w.vTemp = new int32[](64);
        w.attention = new int32[](HIDDEN); w.projection = new int32[](HIDDEN);
        w.gate = new int32[](INTERMEDIATE); w.up = new int32[](INTERMEDIATE);
        w.scores = new int256[](length); w.probabilities = new uint256[](length);
    }

    function _forward(uint16[] memory prompt) private view returns (uint16 nextToken, int32[128] memory lastHidden, bytes32 logitHash) {
        uint256 length = prompt.length;
        if (length == 0 || length > MAX_CONTEXT) revert InvalidInput();
        Work memory w = _newWork(length);
        bytes memory row = new bytes(HIDDEN * 2);
        bytes memory layerWeights = new bytes(LAYER_BYTES);
        bytes memory tables = new bytes(TABLE_BYTES);
        _fill(_tables, 0, TABLE_BYTES, tables);
        for (uint256 t; t < length; ++t) {
            if (prompt[t] >= VOCABULARY) revert InvalidInput();
            _fill(_weights, uint256(prompt[t]) * HIDDEN * 2, HIDDEN * 2, row);
            for (uint256 j; j < HIDDEN; ++j) w.hidden[t * HIDDEN + j] = int32(_i16(row, j * 2));
        }
        for (uint256 layer; layer < LAYERS; ++layer) {
            _fill(_weights, EMBED_BYTES + layer * LAYER_BYTES, LAYER_BYTES, layerWeights);
            for (uint256 t; t < length; ++t) {
                _rms(w.hidden, t * HIDDEN, layerWeights, 0, w.norm);
                _linear(layerWeights, 256, 128, 128, w.norm, w.qTemp);
                _linear(layerWeights, 33024, 64, 128, w.norm, w.kTemp);
                _linear(layerWeights, 49408, 64, 128, w.norm, w.vTemp);
                _rope(w.qTemp, w.query, t * 128, 4, t, tables);
                _rope(w.kTemp, w.key, t * 64, 2, t, tables);
                for (uint256 j; j < 64; ++j) w.value[t * 64 + j] = w.vTemp[j];
            }
            for (uint256 t; t < length; ++t) {
                _attention(w, t, tables);
                _linear(layerWeights, 65792, 128, 128, w.attention, w.projection);
                for (uint256 j; j < HIDDEN; ++j) w.hidden[t * HIDDEN + j] = _checked(int256(w.hidden[t * HIDDEN + j]) + w.projection[j]);
                _rms(w.hidden, t * HIDDEN, layerWeights, 98560, w.norm);
                _linear(layerWeights, 98816, 341, 128, w.norm, w.gate);
                _linear(layerWeights, 186112, 341, 128, w.norm, w.up);
                for (uint256 j; j < INTERMEDIATE; ++j) w.gate[j] = _checked(_silu(w.gate[j], tables) * int256(w.up[j]) / Q);
                _linear(layerWeights, 273408, 128, 341, w.gate, w.projection);
                for (uint256 j; j < HIDDEN; ++j) w.hidden[t * HIDDEN + j] = _checked(int256(w.hidden[t * HIDDEN + j]) + w.projection[j]);
            }
        }
        _fill(_weights, FINAL_NORM_OFFSET, HIDDEN * 2, row);
        _rms(w.hidden, (length - 1) * HIDDEN, row, 0, w.norm);
        for (uint256 j; j < HIDDEN; ++j) lastHidden[j] = w.norm[j];
        int256[] memory logits = new int256[](VOCABULARY);
        int256 maximum = type(int256).min;
        for (uint256 token; token < VOCABULARY; ++token) {
            _fill(_weights, token * HIDDEN * 2, HIDDEN * 2, row);
            int256 logit = _checked(_dot(row, 0, w.norm, HIDDEN) / Q);
            logits[token] = logit;
            if (logit > maximum) { maximum = logit; nextToken = uint16(token); }
        }
        logitHash = keccak256(abi.encode(logits));
    }

    function forward(uint16[] calldata prompt) external view returns (uint16 nextToken, int32[128] memory lastHidden, bytes32 logitHash) {
        return _forward(prompt);
    }

    function inspect(uint16[] calldata prompt) external view returns (uint16 nextToken, int32[128] memory lastHidden, bytes32 logitHash) {
        return _forward(prompt);
    }

    function generate(uint16[] calldata prompt, uint8 maximumNewTokens) external view returns (uint16[] memory tokens, bool ended, bytes32 lastLogitHash) {
        if (prompt.length == 0 || maximumNewTokens == 0 || maximumNewTokens > MAX_NEW_TOKENS
            || prompt.length + maximumNewTokens - 1 > MAX_CONTEXT) revert InvalidInput();
        tokens = new uint16[](maximumNewTokens);
        for (uint256 i; i < maximumNewTokens; ++i) {
            uint16[] memory context = new uint16[](prompt.length + i);
            for (uint256 j; j < prompt.length; ++j) context[j] = prompt[j];
            for (uint256 j; j < i; ++j) context[prompt.length + j] = tokens[j];
            (uint16 next,, bytes32 hash) = _forward(context);
            tokens[i] = next; lastLogitHash = hash;
            if (next == EOS_TOKEN) {
                ended = true;
                assembly ("memory-safe") { mstore(tokens, add(i, 1)) }
                break;
            }
        }
    }
}
