// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract SimpleStoriesV2Data {
    constructor(bytes memory payload) {
        bytes memory runtime = bytes.concat(hex"00", payload);
        assembly ("memory-safe") { return(add(runtime, 32), mload(runtime)) }
    }
}

/// @notice Local-only exact Q12 SimpleStories-V2-1.25M implementation using eight-way SWAR dots, tiled vocabulary and exact final-layer pruning.
/// @dev Every original weight, layer and vocabulary logit is retained. The exact original Q12 weights fit signed 12 bits and are biased into eight
///      32-bit lanes. Range-checked activations use a single multiply for eight products.
///      Out-of-range int32 activations use the exact scalar fallback. Row sums remove biases.
///      No input-range approximation, quantization change, dropped layer, or vocabulary filter.
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
    uint256 public constant WEIGHT_BYTES = 6258016;
    uint256 public constant TABLE_BYTES = 3080;
    uint256 private constant EMBED_BYTES = 1028864;
    uint256 private constant LAYER_BYTES = 760640;
    uint256 private constant HEAD_OFFSET = 4071680;
    uint256 private constant MATRIX_BUFFER_BYTES = 185504;
    uint256 private constant HEAD_ROW_BYTES = 544;
    uint256 private constant FINAL_NORM_OFFSET = 4071424;
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
        modelHash = keccak256(abi.encode("GH0ST_SIMPLESTORIES_V2_Q12_SWAR8_CTX16_V1", a, b));
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

    /// @dev Fast path: 8*4095*131071 < 2^32, so convolution lanes cannot carry.
    ///      Every input is checked. The scalar path preserves arbitrary int32 inputs.
    function _packInput(int32[] memory input, uint256 columns)
        private pure returns (uint256[] memory packed, int256 inputSum, bool fast)
    {
        uint256 groups = (columns + 7) / 8;
        packed = new uint256[](groups);
        fast = true;
        assembly ("memory-safe") {
            let src := add(input, 32)
            let dst := add(packed, 32)
            let cursor := 0
            for { let group := 0 } lt(group, groups) { group := add(group, 1) } {
                let word := 0
                for { let lane := 0 } lt(lane, 8) { lane := add(lane, 1) } {
                    let x := 0
                    if lt(cursor, columns) { x := signextend(3, mload(add(src, shl(5, cursor)))) }
                    inputSum := add(inputSum, x)
                    let biased := add(x, 65536)
                    if gt(biased, 131071) { fast := 0 }
                    word := or(word, shl(shl(5, sub(7, lane)), and(biased, 131071)))
                    cursor := add(cursor, 1)
                }
                mstore(add(dst, shl(5, group)), word)
            }
        }
    }

    function _dotPacked(bytes memory weights, uint256 byteOffset, uint256[] memory packed,
        int256 inputSum, uint256 paddedColumns, int32[] memory originalInput, bool fast)
        private pure returns (int256 sum)
    {
        assembly ("memory-safe") {
            let wp := add(add(weights, 32), byteOffset)
            let groups := mload(packed)
            switch fast
            case 1 {
                let xp := add(packed, 32)
                let end := add(xp, shl(5, groups))
                switch groups
                case 16 {
                    sum := add(sum, shr(224, mul(mload(wp), mload(xp))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 32)), mload(add(xp, 32)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 64)), mload(add(xp, 64)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 96)), mload(add(xp, 96)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 128)), mload(add(xp, 128)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 160)), mload(add(xp, 160)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 192)), mload(add(xp, 192)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 224)), mload(add(xp, 224)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 256)), mload(add(xp, 256)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 288)), mload(add(xp, 288)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 320)), mload(add(xp, 320)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 352)), mload(add(xp, 352)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 384)), mload(add(xp, 384)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 416)), mload(add(xp, 416)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 448)), mload(add(xp, 448)))))
                    sum := add(sum, shr(224, mul(mload(add(wp, 480)), mload(add(xp, 480)))))
                    wp := add(wp, 512)
                }
                default {
                    let bulkEnd := sub(end, 96)
                    for {} lt(xp, bulkEnd) { xp := add(xp, 128) wp := add(wp, 128) } {
                        sum := add(sum, shr(224, mul(mload(wp), mload(xp))))
                        sum := add(sum, shr(224, mul(mload(add(wp, 32)), mload(add(xp, 32)))))
                        sum := add(sum, shr(224, mul(mload(add(wp, 64)), mload(add(xp, 64)))))
                        sum := add(sum, shr(224, mul(mload(add(wp, 96)), mload(add(xp, 96)))))
                    }
                    for {} lt(xp, end) { xp := add(xp, 32) wp := add(wp, 32) } {
                        sum := add(sum, shr(224, mul(mload(wp), mload(xp))))
                    }
                }
                sum := sub(sub(sub(sum, shl(11, inputSum)), shl(16, mload(wp))), shl(27, paddedColumns))
            }
            default {
                let src := add(originalInput, 32)
                let columns := mload(originalInput)
                let cursor := 0
                for { let group := 0 } lt(group, groups) { group := add(group, 1) wp := add(wp, 32) } {
                    let word := mload(wp)
                    for { let lane := 0 } lt(lane, 8) { lane := add(lane, 1) } {
                        if lt(cursor, columns) {
                            let weight := sub(and(shr(shl(5, lane), word), 4095), 2048)
                            let value := signextend(3, mload(add(src, shl(5, cursor))))
                            sum := add(sum, mul(weight, value))
                        }
                        cursor := add(cursor, 1)
                    }
                }
            }
        }
    }

    function _linear(uint256 offset, uint256 rows, uint256 columns, int32[] memory input,
        int32[] memory output, bytes memory buffer) private view
    {
        uint256 groups = (columns + 7) / 8;
        uint256 rowBytes = (groups + 1) * 32;
        _fill(_weights, offset, rows * rowBytes, buffer);
        (uint256[] memory packed, int256 inputSum, bool fast) = _packInput(input, columns);
        uint256 paddedColumns = groups * 8;
        for (uint256 row; row < rows; ++row)
            output[row] = _checked(_dotPacked(buffer, row * rowBytes, packed, inputSum, paddedColumns, input, fast) / Q);
    }

    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        assembly ("memory-safe") {
            let v := x
            z := 1
            if shr(128, v) { v := shr(128, v) z := shl(64, z) }
            if shr(64, v) { v := shr(64, v) z := shl(32, z) }
            if shr(32, v) { v := shr(32, v) z := shl(16, z) }
            if shr(16, v) { v := shr(16, v) z := shl(8, z) }
            if shr(8, v) { v := shr(8, v) z := shl(4, z) }
            if shr(4, v) { v := shr(4, v) z := shl(2, z) }
            if shr(2, v) { z := shl(1, z) }
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            let q := div(x, z)
            if lt(q, z) { z := q }
        }
    }

    function _rms(int32[] memory input, uint256 inputOffset, bytes memory weights, uint256 weightOffset, int32[] memory output) private pure {
        uint256 squares;
        assembly ("memory-safe") {
            let p := add(add(input, 32), shl(5, inputOffset))
            let end := add(p, 4096)
            for {} lt(p, end) { p := add(p, 128) } {
                let a := signextend(3, mload(p))
                let b := signextend(3, mload(add(p, 32)))
                let c := signextend(3, mload(add(p, 64)))
                let d := signextend(3, mload(add(p, 96)))
                squares := add(squares, add(add(mul(a, a), mul(b, b)), add(mul(c, c), mul(d, d))))
            }
        }
        uint256 denominator = _sqrt(squares / 128 + 17);
        assembly ("memory-safe") {
            let p := add(add(input, 32), shl(5, inputOffset))
            let out := add(output, 32)
            let gamma := add(add(weights, 32), weightOffset)
            let end := add(p, 4096)
            for {} lt(p, end) { p := add(p, 32) out := add(out, 32) gamma := add(gamma, 2) } {
                let normal := sdiv(shl(12, signextend(3, mload(p))), denominator)
                let w := signextend(1, shr(240, mload(gamma)))
                mstore(out, sdiv(mul(normal, w), 4096))
            }
        }
        // For int32 input, epsilon17 gives denominator>=4. The normalized
        // magnitude is <57927; any int16 gamma keeps this result in int32.
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

    /// @dev Exact attention arithmetic for int32 query/key/value tensors.
    /// Products and sums fit int256; nonnegative table weights make the final
    /// weighted mean lie within the original int32 value range.
    function _attention(Work memory w, uint256 position, bytes memory tables) private pure {
        assembly ("memory-safe") {
            let queries := add(mload(add(w, 32)), 32)
            let keys := add(mload(add(w, 64)), 32)
            let values := add(mload(add(w, 96)), 32)
            let output := add(mload(add(w, 256)), 32)
            let probabilities := add(mload(add(w, 416)), 32)
            let exponents := add(add(tables, 32), 2052)
            let count := add(position, 1)
            for { let head := 0 } lt(head, 4) { head := add(head, 1) } {
                let q := add(queries, shl(5, add(shl(7, position), shl(5, head))))
                let kvHead := shl(5, shr(1, head))
                let maximum := shl(255, 1)
                for { let past := 0 } lt(past, count) { past := add(past, 1) } {
                    let k := add(keys, shl(5, add(shl(6, past), kvHead)))
                    let sum := 0
                    for { let j := 0 } lt(j, 1024) { j := add(j, 128) } {
                        sum := add(sum, mul(signextend(3, mload(add(q, j))), signextend(3, mload(add(k, j)))))
                        sum := add(sum, mul(signextend(3, mload(add(q, add(j, 32)))), signextend(3, mload(add(k, add(j, 32))))))
                        sum := add(sum, mul(signextend(3, mload(add(q, add(j, 64)))), signextend(3, mload(add(k, add(j, 64))))))
                        sum := add(sum, mul(signextend(3, mload(add(q, add(j, 96)))), signextend(3, mload(add(k, add(j, 96))))))
                    }
                    let score := sdiv(sum, 23170)
                    mstore(add(add(mload(add(w, 384)), 32), shl(5, past)), score)
                    if sgt(score, maximum) { maximum := score }
                }
                let denominator := 0
                for { let past := 0 } lt(past, count) { past := add(past, 1) } {
                    let distance := sub(maximum, mload(add(add(mload(add(w, 384)), 32), shl(5, past))))
                    let scaled := shl(4, distance)
                    let index := shr(12, scaled)
                    let probability := 0
                    if lt(index, 256) {
                        let remainder := and(scaled, 4095)
                        let at := add(exponents, shl(2, index))
                        let first := shr(224, mload(at))
                        let second := shr(224, mload(add(at, 4)))
                        probability := shr(12, add(mul(first, sub(4096, remainder)), mul(second, remainder)))
                    }
                    mstore(add(probabilities, shl(5, past)), probability)
                    denominator := add(denominator, probability)
                }
                // Solidity division-by-zero semantics are preserved even for a
                // malformed all-zero exponent table supplied to the local probe.
                if iszero(denominator) {
                    mstore(0, shl(224, 0x4e487b71))
                    mstore(4, 0x12)
                    revert(0, 36)
                }
                for { let j := 0 } lt(j, 32) { j := add(j, 1) } {
                    let sum := 0
                    for { let past := 0 } lt(past, count) { past := add(past, 1) } {
                        let value := signextend(3, mload(add(values, shl(5, add(add(shl(6, past), kvHead), j)))))
                        sum := add(sum, mul(mload(add(probabilities, shl(5, past))), value))
                    }
                    mstore(add(output, shl(5, add(shl(5, head), j))), sdiv(sum, denominator))
                }
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
        bytes memory matrixWeights = new bytes(MATRIX_BUFFER_BYTES);
        bytes memory tables = new bytes(TABLE_BYTES);
        _fill(_tables, 0, TABLE_BYTES, tables);
        for (uint256 t; t < length; ++t) {
            if (prompt[t] >= VOCABULARY) revert InvalidInput();
            _fill(_weights, uint256(prompt[t]) * HIDDEN * 2, HIDDEN * 2, matrixWeights);
            for (uint256 j; j < HIDDEN; ++j) w.hidden[t * HIDDEN + j] = int32(_i16(matrixWeights, j * 2));
        }
        for (uint256 layer; layer < LAYERS; ++layer) {
            uint256 layerOffset = EMBED_BYTES + layer * LAYER_BYTES;
            for (uint256 t; t < length; ++t) {
                _fill(_weights, layerOffset, HIDDEN * 2, matrixWeights);
                _rms(w.hidden, t * HIDDEN, matrixWeights, 0, w.norm);
                // Earlier final-layer query/output states cannot affect the last token.
                // Keys and values remain necessary for every causal prefix position.
                if (layer + 1 < LAYERS || t + 1 == length) {
                    _linear(layerOffset + 256, 128, 128, w.norm, w.qTemp, matrixWeights);
                    _rope(w.qTemp, w.query, t * 128, 4, t, tables);
                }
                _linear(layerOffset + 69888, 64, 128, w.norm, w.kTemp, matrixWeights);
                _linear(layerOffset + 104704, 64, 128, w.norm, w.vTemp, matrixWeights);
                _rope(w.kTemp, w.key, t * 64, 2, t, tables);
                for (uint256 j; j < 64; ++j) w.value[t * 64 + j] = w.vTemp[j];
            }
            for (uint256 t = layer + 1 == LAYERS ? length - 1 : 0; t < length; ++t) {
                _attention(w, t, tables);
                _linear(layerOffset + 139520, 128, 128, w.attention, w.projection, matrixWeights);
                for (uint256 j; j < HIDDEN; ++j) w.hidden[t * HIDDEN + j] = _checked(int256(w.hidden[t * HIDDEN + j]) + w.projection[j]);
                _fill(_weights, layerOffset + 209152, HIDDEN * 2, matrixWeights);
                _rms(w.hidden, t * HIDDEN, matrixWeights, 0, w.norm);
                _linear(layerOffset + 209408, 341, 128, w.norm, w.gate, matrixWeights);
                _linear(layerOffset + 394912, 341, 128, w.norm, w.up, matrixWeights);
                for (uint256 j; j < INTERMEDIATE; ++j) w.gate[j] = _checked(_silu(w.gate[j], tables) * int256(w.up[j]) / Q);
                _linear(layerOffset + 580416, 128, 341, w.gate, w.projection, matrixWeights);
                for (uint256 j; j < HIDDEN; ++j) w.hidden[t * HIDDEN + j] = _checked(int256(w.hidden[t * HIDDEN + j]) + w.projection[j]);
            }
        }
        _fill(_weights, FINAL_NORM_OFFSET, HIDDEN * 2, matrixWeights);
        _rms(w.hidden, (length - 1) * HIDDEN, matrixWeights, 0, w.norm);
        for (uint256 j; j < HIDDEN; ++j) lastHidden[j] = w.norm[j];
        (nextToken, logitHash) = _head(w.norm, matrixWeights);
    }

    function _head(int32[] memory norm, bytes memory matrixWeights)
        private view returns (uint16 nextToken, bytes32 logitHash)
    {
        int256[] memory logits = new int256[](VOCABULARY);
        int256 maximum = type(int256).min;
        (uint256[] memory packedHead, int256 headInputSum, bool headFast) = _packInput(norm, HIDDEN);
        for (uint256 first; first < VOCABULARY; first += 256) {
            uint256 count = VOCABULARY - first;
            if (count > 256) count = 256;
            _fill(_weights, HEAD_OFFSET + first * HEAD_ROW_BYTES, count * HEAD_ROW_BYTES, matrixWeights);
            for (uint256 local; local < count; ++local) {
                uint256 token = first + local;
                int256 logit = _checked(_dotPacked(matrixWeights, local * HEAD_ROW_BYTES,
                    packedHead, headInputSum, 128, norm, headFast) / Q);
                logits[token] = logit;
                if (logit > maximum) { maximum = logit; nextToken = uint16(token); }
            }
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
