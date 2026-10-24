// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract SimpleStoriesV2Data {
    constructor(bytes memory payload) {
        bytes memory runtime = bytes.concat(hex"00", payload);
        assembly ("memory-safe") { return(add(runtime, 32), mload(runtime)) }
    }
}

/// @notice Local exact Q12 continuous-story prototype with append-only numerical KV chunks.
/// @dev Actual emitted tokens condition later swaps. Pending terminal tokens are preserved.
/// RoPE tables cover 128 positions; before overflow the model explicitly recomputes
/// a short context from the last three actual tokens. No words or punctuation are inserted.
/// @dev The constructor computes the fixed prompt once with the actual model. Its cache
/// contains only numerical per-layer keys/values and all vocabulary logits, never text
/// or output phrases. Permissionless prepareBranch computes a selected first token's
/// numerical cache on chain. Generation samples the first two outputs from these
/// states, then performs fresh full-model steps for positions two onward.
/// @dev Numerical inference and trained weights match the published codeweights-v2 model.
/// Sampling changes decoding only; capped output may be incomplete and is not a sentence.
/// @dev Every original weight, layer and vocabulary logit is retained. The exact original Q12 weights fit signed 12 bits and are biased into eight
///      32-bit lanes. Range-checked activations use a single multiply for eight products.
///      Out-of-range int32 activations use the exact scalar fallback. Row sums remove biases.
///      No input-range approximation, quantization change, dropped layer, or vocabulary filter.
contract SimpleStoriesV2ContinuityModel {
    uint256 public constant PARAMETERS = 1235968;
    uint256 public constant VOCABULARY = 4019;
    uint256 public constant HIDDEN = 128;
    uint256 public constant LAYERS = 4;
    uint256 public constant INTERMEDIATE = 341;
    uint256 public constant MAX_CONTEXT = 128;
    uint256 public constant MAX_NEW_TOKENS = 2;
    uint16 public constant EOS_TOKEN = 1;
    uint256 public constant CHUNK_BYTES = 24000;
    uint256 public constant WEIGHT_BYTES = 6258016;
    uint256 public constant TABLE_BYTES = 10248;
    uint256 private constant EMBED_BYTES = 1028864;
    uint256 private constant LAYER_BYTES = 760640;
    uint256 private constant HEAD_OFFSET = 4071680;
    uint256 private constant MATRIX_BUFFER_BYTES = 185504;
    uint256 private constant HEAD_ROW_BYTES = 544;
    uint256 private constant FINAL_NORM_OFFSET = 4071424;
    int256 private constant Q = 4096;
    address[] private _weights;
    address[] private _tables;
    address[] private _tiles;
    bytes32 public immutable modelHash;
    uint16 public immutable initialPromptToken;
    struct Chunk { address source; bytes32 codeHash; }
    struct Story {
        bytes32 contextHash;
        uint64 generated;
        uint64 epoch;
        uint48 tail;
        uint16 processed;
        uint16 pending;
        uint8 tailLength;
        uint64 activeStart;
        bool started;
        Chunk[] chunks;
    }
    struct Run {
        CachedWork state;
        uint16[] tokens;
        bytes payload;
        bytes32 lastLogitHash;
        bytes32 nextContextHash;
        uint64 generated;
        uint64 epoch;
        uint48 tail;
        uint16 processed;
        uint16 pending;
        uint16 fromPosition;
        uint8 tailLength;
        bool endedEos;
        bool endedSentence;
        bool refreshed;
    }
    mapping(bytes32 => Story) private _stories;
    error StaleContext();
    event StoryAdvanced(address indexed owner,bytes32 indexed storyId,bytes32 indexed contextHash,
        address chunk,uint64 generated,uint64 epoch,uint16[] tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash,bool refreshed);
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

    constructor(address[] memory weights, address[] memory tables, address[] memory tiles, uint16 promptToken_) {
        bytes32 a = _pin(weights, WEIGHT_BYTES, _weights);
        bytes32 b = _pin(tables, TABLE_BYTES, _tables);
        if (a != 0x39cbe626c4d73462be6de195674cdd209984295166afe41f183810b838e4f4e1 || b != 0x5222a4fab183ec984c4dd86f9c92b13aea737827dc334a007de4f806fdf42b40) revert InvalidModel();
        bytes32 c = _pinTiles(tiles);
        if (promptToken_ >= VOCABULARY) revert InvalidInput();
        initialPromptToken = promptToken_;
        modelHash = keccak256(abi.encode("GH0ST_SIMPLESTORIES_V2_Q12_CONTINUITY128_V1", a, b, c, promptToken_));
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

    // Exact row reduction in one assembly loop; no per-row ABI, checked-index, or type conversion overhead.
    function _matrixRows(bytes memory buffer, uint256 rows, uint256 columns,
        int32[] memory input, uint256 outputPointer) private pure
    {
        (uint256[] memory packed, int256 inputSum, bool fast) = _packInput(input, columns);
        uint256 groups = (columns + 7) / 8;
        uint256 rowBytes = (groups + 1) * 32;
        if (!fast) {
            for (uint256 row; row < rows; ++row) {
                int256 value = _checked(_dotPacked(buffer, row * rowBytes, packed, inputSum, groups * 8, input, false) / Q);
                assembly ("memory-safe") { mstore(add(outputPointer, shl(5, row)), value) }
            }
            return;
        }
        bool bad;
        assembly ("memory-safe") {
            let wp := add(buffer, 32)
            let xp := add(packed, 32)
            let outputEnd := add(outputPointer, shl(5, rows))
            let correction := add(shl(11, inputSum), shl(27, mul(groups, 8)))
            for {} lt(outputPointer, outputEnd) { outputPointer := add(outputPointer, 32) wp := add(wp, rowBytes) } {
                let sum := 0
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
                }
                default {
                    let w := wp
                    let x := xp
                    let end := add(xp, shl(5, groups))
                    let bulkEnd := sub(end, 96)
                    for {} lt(x, bulkEnd) { x := add(x, 128) w := add(w, 128) } {
                        sum := add(sum, shr(224, mul(mload(w), mload(x))))
                        sum := add(sum, shr(224, mul(mload(add(w, 32)), mload(add(x, 32)))))
                        sum := add(sum, shr(224, mul(mload(add(w, 64)), mload(add(x, 64)))))
                        sum := add(sum, shr(224, mul(mload(add(w, 96)), mload(add(x, 96)))))
                    }
                    for {} lt(x, end) { x := add(x, 32) w := add(w, 32) } {
                        sum := add(sum, shr(224, mul(mload(w), mload(x))))
                    }
                }
                sum := sdiv(sub(sub(sum, correction), shl(16, mload(add(wp, shl(5, groups))))), 4096)
                if or(slt(sum, sub(0, 2147483648)), sgt(sum, 2147483647)) { bad := 1 }
                mstore(outputPointer, sum)
            }
        }
        if (bad) revert ArithmeticRange();
    }

    function _linearFallback(uint256 offset, uint256 rows, uint256 columns, int32[] memory input,
        int32[] memory output, bytes memory buffer) private view
    {
        uint256 rowBytes = ((columns + 7) / 8 + 1) * 32;
        if (buffer.length < MATRIX_BUFFER_BYTES) buffer = new bytes(MATRIX_BUFFER_BYTES);
        _fill(_weights, offset, rows * rowBytes, buffer);
        uint256 outputPointer;
        assembly ("memory-safe") { outputPointer := add(output, 32) }
        _matrixRows(buffer, rows, columns, input, outputPointer);
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

    function _rope(int32[] memory input, int32[] memory output, uint256 outputOffset,
        uint256 heads, uint256 position, bytes memory tables) private pure
    {
        assembly ("memory-safe") {
            let source := add(input, 32)
            let destination := add(add(output, 32), shl(5, outputOffset))
            let cosine := add(add(tables, 32), shl(5, position))
            let sine := add(cosine, 4096)
            for { let head := 0 } lt(head, heads) { head := add(head, 1) } {
                let start := shl(10, head)
                for { let j := 0 } lt(j, 16) { j := add(j, 1) } {
                    let at := add(start, shl(5, j))
                    let first := signextend(3, mload(add(source, at)))
                    let second := signextend(3, mload(add(source, add(at, 512))))
                    let c := signextend(1, shr(240, mload(add(cosine, shl(1, j)))))
                    let s := signextend(1, shr(240, mload(add(sine, shl(1, j)))))
                    let a := sdiv(sub(mul(first, c), mul(second, s)), 4096)
                    let b := sdiv(add(mul(second, c), mul(first, s)), 4096)
                    if or(gt(add(a, 0x80000000), 0xffffffff), gt(add(b, 0x80000000), 0xffffffff)) {
                        mstore(0, shl(224, 0x6b6b0562))
                        revert(0, 4)
                    }
                    mstore(add(destination, at), a)
                    mstore(add(destination, add(at, 512)), b)
                }
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
        uint256 probability = _table(tables, 8192, uint256(x < 0 ? -x : x), 65536);
        if (x < 0) probability = 65536 - probability;
        return x * int256(probability) / 65536;
    }

    /// @dev Exact attention arithmetic for int32 query/key/value tensors.
    /// Products and sums fit int256; nonnegative table weights make the final
    /// weighted mean lie within the original int32 value range.
    function _attention(Work memory w, uint256 position, bytes memory tables) private pure {
        // A single causal key has probability one. Preserve malformed-table
        // zero-denominator behavior, then return the exact GQA value vector.
        if (position == 0) {
            if (_u32(tables, 9220) == 0) {
                assembly ("memory-safe") {
                    mstore(0, shl(224, 0x4e487b71))
                    mstore(4, 0x12)
                    revert(0, 36)
                }
            }
            assembly ("memory-safe") {
                let values := add(mload(add(w, 96)), 32)
                let output := add(mload(add(w, 256)), 32)
                for { let head := 0 } lt(head, 4) { head := add(head, 1) } {
                    let src := add(values, shl(10, shr(1, head)))
                    let dst := add(output, shl(10, head))
                    for { let j := 0 } lt(j, 1024) { j := add(j, 32) } {
                        mstore(add(dst, j), signextend(3, mload(add(src, j))))
                    }
                }
            }
            return;
        }

        assembly ("memory-safe") {
            let queries := add(mload(add(w, 32)), 32)
            let keys := add(mload(add(w, 64)), 32)
            let values := add(mload(add(w, 96)), 32)
            let output := add(mload(add(w, 256)), 32)
            let probabilities := add(mload(add(w, 416)), 32)
            let exponents := add(add(tables, 32), 9220)
            let count := add(position, 1)
            for { let head := 0 } lt(head, 4) { head := add(head, 1) } {
                let q := add(queries, shl(10, head))
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
                _linear(layerOffset + 256, 128, 128, w.norm, w.qTemp, matrixWeights);
                _linear(layerOffset + 69888, 64, 128, w.norm, w.kTemp, matrixWeights);
                _linear(layerOffset + 104704, 64, 128, w.norm, w.vTemp, matrixWeights);
                _rope(w.qTemp, w.query, t * 128, 4, t, tables);
                _rope(w.kTemp, w.key, t * 64, 2, t, tables);
                for (uint256 j; j < 64; ++j) w.value[t * 64 + j] = w.vTemp[j];
            }
            for (uint256 t; t < length; ++t) {
                _attention(w, t, tables);
                _linear(layerOffset + 139520, 128, 128, w.attention, w.projection, matrixWeights);
                _addResidual(w.hidden, t * HIDDEN, w.projection);
                _fill(_weights, layerOffset + 209152, HIDDEN * 2, matrixWeights);
                _rms(w.hidden, t * HIDDEN, matrixWeights, 0, w.norm);
                _linear(layerOffset + 209408, 341, 128, w.norm, w.gate, matrixWeights);
                _linear(layerOffset + 394912, 341, 128, w.norm, w.up, matrixWeights);
                _siluMultiply(w.gate, w.up, tables);
                _linear(layerOffset + 580416, 128, 341, w.gate, w.projection, matrixWeights);
                _addResidual(w.hidden, t * HIDDEN, w.projection);
            }
        }
        _fill(_weights, FINAL_NORM_OFFSET, HIDDEN * 2, matrixWeights);
        _rms(w.hidden, (length - 1) * HIDDEN, matrixWeights, 0, w.norm);
        for (uint256 j; j < HIDDEN; ++j) lastHidden[j] = w.norm[j];
        (nextToken, logitHash) = _head(w.norm, matrixWeights);
    }

    function _newLogits() private pure returns (int256[] memory logits) {
        assembly ("memory-safe") {
            let start := mload(0x40)
            mstore(start, 32)
            logits := add(start, 32)
            mstore(logits, 4019)
            mstore(0x40, add(start, 128672))
        }
    }

    function _head(int32[] memory norm, bytes memory matrixWeights)
        private view returns (uint16 nextToken, bytes32 logitHash)
    {
        return _headWithScratch(norm, matrixWeights, _newLogits());
    }

    function _headFallback(int32[] memory norm, bytes memory matrixWeights, int256[] memory logits)
        private view returns (uint16 nextToken, bytes32 logitHash)
    {
        if (matrixWeights.length < MATRIX_BUFFER_BYTES) matrixWeights = new bytes(MATRIX_BUFFER_BYTES);
        for (uint256 first; first < VOCABULARY; first += 256) {
            uint256 count = VOCABULARY - first;
            if (count > 256) count = 256;
            _fill(_weights, HEAD_OFFSET + first * HEAD_ROW_BYTES, count * HEAD_ROW_BYTES, matrixWeights);
            uint256 outputPointer;
            assembly ("memory-safe") { outputPointer := add(add(logits, 32), shl(5, first)) }
            _matrixRows(matrixWeights, count, 128, norm, outputPointer);
        }
        assembly ("memory-safe") {
            let maximum := shl(255, 1)
            let ptr := add(logits, 32)
            for { let token := 0 } lt(token, 4019) { token := add(token, 1) ptr := add(ptr, 32) } {
                let value := mload(ptr)
                if sgt(value, maximum) { maximum := value nextToken := token }
            }
            logitHash := keccak256(sub(logits, 32), 128672)
        }
    }






    struct CachedWork {
        Work work;
        int32[][] keys;
        int32[][] values;
        bytes matrixWeights;
        bytes tables;
        int256[] logits;
        uint256 packedInputPointer;
        uint256[] packedInput;
        int256 packedInputSum;
        bool packedInputFast;
    }

    /// @dev Appends one position. Past per-layer keys and values are immutable
    /// because all attention is causal. Prefix-only positions need no final
    /// layer query/attention/MLP; their keys and values remain required.
    function _appendToken(CachedWork memory state, uint16 token, uint256 position, bool readout)
        private view returns (uint16 nextToken, bytes32 logitHash)
    {
        if (token >= VOCABULARY) revert InvalidInput();
        Work memory w = state.work;
        bytes memory matrixWeights = state.matrixWeights;
        bytes memory tables = state.tables;
        _fill(_weights, uint256(token) * HIDDEN * 2, HIDDEN * 2, matrixWeights);
        for (uint256 j; j < HIDDEN; ++j) w.hidden[j] = int32(_i16(matrixWeights, j * 2));
        for (uint256 layer; layer < LAYERS; ++layer) {
            w.key = state.keys[layer];
            w.value = state.values[layer];
            uint256 layerOffset = EMBED_BYTES + layer * LAYER_BYTES;
            bool completeLayer = readout || layer + 1 < LAYERS;
            _fill(_weights, layerOffset, HIDDEN * 2, matrixWeights);
            _rms(w.hidden, 0, matrixWeights, 0, w.norm);
            state.packedInputPointer = 0;
            if (completeLayer && position != 0) {
                _linearCached(state, layerOffset + 256, 128, 128, w.norm, w.qTemp, matrixWeights);
                _rope(w.qTemp, w.query, 0, 4, position, tables);
            }
            _linearCached(state, layerOffset + 69888, 64, 128, w.norm, w.kTemp, matrixWeights);
            _linearCached(state, layerOffset + 104704, 64, 128, w.norm, w.vTemp, matrixWeights);
            _rope(w.kTemp, w.key, position * 64, 2, position, tables);
            for (uint256 j; j < 64; ++j) w.value[position * 64 + j] = w.vTemp[j];
            if (completeLayer) {
                _attention(w, position, tables);
                _linearCached(state, layerOffset + 139520, 128, 128, w.attention, w.projection, matrixWeights);
                _addResidual(w.hidden, 0, w.projection);
                _fill(_weights, layerOffset + 209152, HIDDEN * 2, matrixWeights);
                _rms(w.hidden, 0, matrixWeights, 0, w.norm);
            state.packedInputPointer = 0;
                _linearCached(state, layerOffset + 209408, 341, 128, w.norm, w.gate, matrixWeights);
                _linearCached(state, layerOffset + 394912, 341, 128, w.norm, w.up, matrixWeights);
                _siluMultiply(w.gate, w.up, tables);
                _linearCached(state, layerOffset + 580416, 128, 341, w.gate, w.projection, matrixWeights);
                _addResidual(w.hidden, 0, w.projection);
            }
        }
        if (readout) {
            _fill(_weights, FINAL_NORM_OFFSET, HIDDEN * 2, matrixWeights);
            _rms(w.hidden, 0, matrixWeights, 0, w.norm);
            state.packedInputPointer = 0;
            logitHash = _headLogitsOnly(w.norm, matrixWeights, state.logits);
        }
    }

    /// @notice Same greedy token sequence as full-prefix recomputation; KV is
    /// reused only inside this call. No persistent state or external cache.

function _siluMultiply(int32[] memory gate, int32[] memory up, bytes memory tables) private pure {
        assembly ("memory-safe") {
            let g := add(gate, 32)
            let u := add(up, 32)
            let end := add(g, shl(5, mload(gate)))
            let sigmoid := add(add(tables, 32), 8192)
            for {} lt(g, end) { g := add(g, 32) u := add(u, 32) } {
                let x := signextend(3, mload(g))
                let magnitude := x
                if slt(x, 0) { magnitude := sub(0, x) }
                let index := shr(8, magnitude)
                let probability := 65536
                if lt(index, 256) {
                    let remainder := and(magnitude, 255)
                    let at := add(sigmoid, shl(2, index))
                    let first := shr(224, mload(at))
                    let second := shr(224, mload(add(at, 4)))
                    probability := shr(8, add(mul(first, sub(256, remainder)), mul(second, remainder)))
                }
                if slt(x, 0) { probability := sub(65536, probability) }
                let activated := sdiv(mul(x, probability), 65536)
                let result := sdiv(mul(activated, signextend(3, mload(u))), 4096)
                if gt(add(result, 0x80000000), 0xffffffff) {
                    mstore(0, shl(224, 0x6b6b0562))
                    revert(0, 4)
                }
                mstore(g, result)
            }
        }
    }

function _addResidual(int32[] memory hidden, uint256 offset, int32[] memory projection) private pure {
        assembly ("memory-safe") {
            let h := add(add(hidden, 32), shl(5, offset))
            let p := add(projection, 32)
            let end := add(p, 4096)
            for {} lt(p, end) { p := add(p, 32) h := add(h, 32) } {
                let result := add(signextend(3, mload(h)), signextend(3, mload(p)))
                if gt(add(result, 0x80000000), 0xffffffff) {
                    mstore(0, shl(224, 0x6b6b0562))
                    revert(0, 4)
                }
                mstore(h, result)
            }
        }
    }

function _newCachedScratch(uint256 capacity) private pure returns (Work memory w) {
        w.hidden = new int32[](128);
        w.query = new int32[](128);
        w.norm = new int32[](128); w.qTemp = new int32[](128);
        w.kTemp = new int32[](64); w.vTemp = new int32[](64);
        w.attention = new int32[](128); w.projection = new int32[](128);
        w.gate = new int32[](341); w.up = new int32[](341);
        w.scores = new int256[](capacity); w.probabilities = new uint256[](capacity);
    }
    /// @notice Stops only on a naturally predicted native . ! ? token or EOS.
    /// @dev The cap is a resource limit, not a sentence-completion signal.



    function _pinTiles(address[] memory sources) private returns (bytes32 commitment) {
        if (sources.length != 282) revert InvalidModel();
        for (uint256 i; i < sources.length; ++i) {
            if (sources[i].code.length == 0 || sources[i].code.length > 24000) revert InvalidModel();
            commitment = keccak256(abi.encode(commitment, sources[i].codehash));
            _tiles.push(sources[i]);
        }
        if (commitment != 0x12677213f35fafa47dd7ba36ada796d0cff9f67a3a3dd58a2330348da10295ed) revert InvalidModel();
    }
    function _tileRange(uint256 offset) private pure returns (uint256 first, uint256 count) {
        if (offset == 1029120) return (0, 4);
        if (offset == 1098752) return (4, 2);
        if (offset == 1133568) return (6, 2);
        if (offset == 1168384) return (8, 4);
        if (offset == 1238272) return (12, 10);
        if (offset == 1423776) return (22, 10);
        if (offset == 1609280) return (32, 10);
        if (offset == 1789760) return (42, 4);
        if (offset == 1859392) return (46, 2);
        if (offset == 1894208) return (48, 2);
        if (offset == 1929024) return (50, 4);
        if (offset == 1998912) return (54, 10);
        if (offset == 2184416) return (64, 10);
        if (offset == 2369920) return (74, 10);
        if (offset == 2550400) return (84, 4);
        if (offset == 2620032) return (88, 2);
        if (offset == 2654848) return (90, 2);
        if (offset == 2689664) return (92, 4);
        if (offset == 2759552) return (96, 10);
        if (offset == 2945056) return (106, 10);
        if (offset == 3130560) return (116, 10);
        if (offset == 3311040) return (126, 4);
        if (offset == 3380672) return (130, 2);
        if (offset == 3415488) return (132, 2);
        if (offset == 3450304) return (134, 4);
        if (offset == 3520192) return (138, 10);
        if (offset == 3705696) return (148, 10);
        if (offset == 3891200) return (158, 10);
        if (offset == 4071680) return (168, 114);
        revert InvalidInput();
    }
    function _tileRowCount(uint256 index) private pure returns (uint256) {
        if (index < 32) return (uint256(0x1524232424242423232313242324242423242424142424241c241c2415232424) >> ((index % 32) * 8)) & 255;
        if (index < 64) return (uint256(0x13242424232424232424142424241d231d23142424240b0d0d0d0d0d0d0d0d0d) >> ((index % 32) * 8)) & 255;
        if (index < 96) return (uint256(0x142424241c241c24142424240b0d0d0d0d0d0d0d0d0d13242424242324242423) >> ((index % 32) * 8)) & 255;
        if (index < 128) return (uint256(0x23240b0d0d0d0d0d0d0d0d0d1624232324242323232412242424232424242424) >> ((index % 32) * 8)) & 255;
        if (index < 160) return (uint256(0x0d0d1424242424242323232415242324232424232423172323231c241c241524) >> ((index % 32) * 8)) & 255;
        if (index < 192) return (uint256(0x2323242324242323242423232423232423242424242424230b0d0d0d0d0d0d0d) >> ((index % 32) * 8)) & 255;
        if (index < 224) return (uint256(0x2323232323242324232423242424242324232324232424232323232324242323) >> ((index % 32) * 8)) & 255;
        if (index < 256) return (uint256(0x2323232323232324242323232323232323232423232324232323232323232323) >> ((index % 32) * 8)) & 255;
        if (index < 288) return (uint256(0x0000000000001f23232323242423232323232323232323232323232423232323) >> ((index % 32) * 8)) & 255;
        revert InvalidInput();
    }
    function _executeTiles(uint256 offset, uint256 rows, uint256[] memory packed,
        int256 inputSum, uint256 outputPointer) private view
    {
        (uint256 first, uint256 count) = _tileRange(offset);
        uint256 groups = packed.length;
        bytes memory payload = new bytes((groups + 1) * 32);
        assembly ("memory-safe") {
            mcopy(add(payload, 32), add(packed, 32), shl(5, groups))
            let correction := add(shl(11, inputSum), shl(27, mul(groups, 8)))
            mstore(add(add(payload, 32), shl(5, groups)), correction)
        }
        for (uint256 i; i < count; ++i) {
            uint256 currentRows = _tileRowCount(first + i);
            if (currentRows > rows) revert InvalidModel();
            uint256 size = currentRows * 32;
            address target = _tiles[first + i];
            bool ok;
            assembly ("memory-safe") {
                ok := staticcall(gas(), target, add(payload, 32), mload(payload), outputPointer, size)
                if iszero(eq(returndatasize(), size)) { ok := 0 }
            }
            if (!ok) revert InvalidModel();
            outputPointer += size;
            rows -= currentRows;
        }
        if (rows != 0) revert InvalidModel();
    }
    function _linear(uint256 offset, uint256 rows, uint256 columns, int32[] memory input,
        int32[] memory output, bytes memory buffer) private view
    {
        (uint256[] memory packed, int256 inputSum, bool fast) = _packInput(input, columns);
        if (!fast) { _linearFallback(offset, rows, columns, input, output, buffer); return; }
        uint256 pointer;
        assembly ("memory-safe") { pointer := add(output, 32) }
        _executeTiles(offset, rows, packed, inputSum, pointer);
    }
    /// @dev Reuse a packing only while the caller has not changed its vector.
    /// The caller invalidates after every RMS write. Pointer changes also invalidate
    /// when switching to attention or SwiGLU vectors.
    function _linearCached(CachedWork memory state, uint256 offset, uint256 rows, uint256 columns,
        int32[] memory input, int32[] memory output, bytes memory buffer) private view
    {
        uint256 inputPointer;
        assembly ("memory-safe") { inputPointer := input }
        if (state.packedInputPointer != inputPointer) {
            (state.packedInput, state.packedInputSum, state.packedInputFast) = _packInput(input, columns);
            state.packedInputPointer = inputPointer;
        }
        if (!state.packedInputFast) { _linearFallback(offset, rows, columns, input, output, buffer); return; }
        uint256 pointer;
        assembly ("memory-safe") { pointer := add(output, 32) }
        _executeTiles(offset, rows, state.packedInput, state.packedInputSum, pointer);
    }

    function _headWithScratch(int32[] memory norm, bytes memory matrixWeights, int256[] memory logits)
        private view returns (uint16 nextToken, bytes32 logitHash)
    {
        (uint256[] memory packed, int256 inputSum, bool fast) = _packInput(norm, 128);
        if (!fast) return _headFallback(norm, matrixWeights, logits);
        uint256 pointer;
        assembly ("memory-safe") { pointer := add(logits, 32) }
        _executeTiles(HEAD_OFFSET, VOCABULARY, packed, inputSum, pointer);
        assembly ("memory-safe") {
            let maximum := shl(255, 1)
            let ptr := add(logits, 32)
            for { let token := 0 } lt(token, 4019) { token := add(token, 1) ptr := add(ptr, 32) } {
                let value := mload(ptr)
                if sgt(value, maximum) { maximum := value nextToken := token }
            }
            logitHash := keccak256(sub(logits, 32), 128672)
        }
    }


    /// @notice Seeded top-k decoding from all computed vocabulary logits.
    /// @dev Temperature is in thousandths. A terminal is never inserted. An
    /// incomplete result is explicitly returned as incomplete. Different seeds
    /// do not guarantee different text and the caller supplies all entropy.


    function _sampleLogits(int256[] memory logits, bytes memory tables, bytes32 seed,
        uint256 step, uint256 topK, uint256 temperatureMilli) private pure returns (uint16 token)
    {
        (int256[] memory best, uint16[] memory ids) = _topCandidates(logits, topK);
        uint256[] memory weights = new uint256[](topK);
        uint256 total;
        for (uint256 i; i < topK; ++i) {
            uint256 distance = uint256(best[0] - best[i]) * 1000 / temperatureMilli;
            weights[i] = _table(tables, 9220, distance, 0);
            total += weights[i];
        }
        // The best candidate has distance zero, whose pinned table weight is
        // nonzero; assert this invariant rather than silently changing decoding.
        if (total == 0) revert InvalidModel();
        uint256 draw = uint256(keccak256(abi.encode("GH0ST_SAMPLE_STEP_V1", seed, step))) % total;
        for (uint256 i; i < topK; ++i) {
            if (draw < weights[i]) return ids[i];
            draw -= weights[i];
        }
        revert InvalidModel();
    }


    function _headLogitsOnly(int32[] memory norm, bytes memory matrixWeights, int256[] memory logits)
        private view returns (bytes32 logitHash)
    {
        (uint256[] memory packed, int256 inputSum, bool fast) = _packInput(norm, 128);
        if (!fast) { (, logitHash) = _headFallback(norm, matrixWeights, logits); return logitHash; }
        uint256 pointer;
        assembly ("memory-safe") { pointer := add(logits, 32) }
        _executeTiles(HEAD_OFFSET, VOCABULARY, packed, inputSum, pointer);
        assembly ("memory-safe") { logitHash := keccak256(sub(logits, 32), 128672) }
    }

    function _cachedState(uint256 capacity) private view returns (CachedWork memory state) {
        state.work = _newCachedScratch(capacity);
        state.keys = new int32[][](LAYERS);
        state.values = new int32[][](LAYERS);
        for (uint256 layer; layer < LAYERS; ++layer) {
            state.keys[layer] = new int32[](capacity * 64);
            state.values[layer] = new int32[](capacity * 64);
        }
        state.matrixWeights = new bytes(HIDDEN * 2);
        state.tables = new bytes(TABLE_BYTES);
        state.logits = _newLogits();
        _fill(_tables, 0, TABLE_BYTES, state.tables);
    }

    /// @dev Extra allocated guard bytes keep overlapping four-byte writes within
    /// owned memory; only CACHE_BYTES are deployed into the immutable data child.







    /// @notice The packed, signed-int32 KV/logit payload computed by this constructor.









    /// @notice Samples up to five tokens, reusing the immutable one-token prompt prefill.
    /// @dev No output phrase is cached. Every token after the second runs a fresh
    /// full-model step. Only naturally sampled EOS/.!? stops generation.


    function _topCandidates(int256[] memory logits, uint256 topK) private pure
        returns (int256[] memory best, uint16[] memory ids)
    {
        best = new int256[](topK);
        ids = new uint16[](topK);
        // Exact top-k via a worst-first heap. The final heap sort restores
        // descending score / ascending token-id order used by the reference.
        assembly ("memory-safe") {
            function worse(a, ai, b, bi) -> yes {
                yes := or(slt(a, b), and(eq(a, b), gt(ai, bi)))
            }
            function down(scores, indices, count, at) {
                for { } 1 { } {
                    let left := add(shl(1, at), 1)
                    if iszero(lt(left, count)) { break }
                    let child := left
                    let right := add(left, 1)
                    if lt(right, count) {
                        let rp := shl(5, right)
                        let lp := shl(5, left)
                        if worse(mload(add(scores, rp)), mload(add(indices, rp)), mload(add(scores, lp)), mload(add(indices, lp))) { child := right }
                    }
                    let cp := shl(5, child)
                    let ap := shl(5, at)
                    let current := mload(add(scores, ap))
                    let currentId := mload(add(indices, ap))
                    if iszero(worse(mload(add(scores, cp)), mload(add(indices, cp)), current, currentId)) { break }
                    mstore(add(scores, ap), mload(add(scores, cp)))
                    mstore(add(indices, ap), mload(add(indices, cp)))
                    mstore(add(scores, cp), current)
                    mstore(add(indices, cp), currentId)
                    at := child
                }
            }
            let scores := add(best, 32)
            let indices := add(ids, 32)
            let source := add(logits, 32)
            for { let i := 0 } lt(i, topK) { i := add(i, 1) } {
                let at := shl(5, i)
                let tokenId := add(i, 1)
                mstore(add(scores, at), mload(add(source, shl(5, tokenId))))
                mstore(add(indices, at), tokenId)
            }
            for { let i := shr(1, topK) } gt(i, 0) { } {
                i := sub(i, 1)
                down(scores, indices, topK, i)
            }
            for { let tokenId := add(topK, 1) } lt(tokenId, 4019) { tokenId := add(tokenId, 1) } {
                let value := mload(add(source, shl(5, tokenId)))
                // Incoming ids are increasing, so equal scores cannot displace the root.
                if sgt(value, mload(scores)) {
                    mstore(scores, value)
                    mstore(indices, tokenId)
                    down(scores, indices, topK, 0)
                }
            }
            for { let count := topK } gt(count, 1) { } {
                count := sub(count, 1)
                let at := shl(5, count)
                let score := mload(scores)
                let tokenId := mload(indices)
                mstore(scores, mload(add(scores, at)))
                mstore(indices, mload(add(indices, at)))
                mstore(add(scores, at), score)
                mstore(add(indices, at), tokenId)
                down(scores, indices, count, 0)
            }
        }
    }

    /// @notice Top-k initial tokens in the exact order used by the sampler.


    /// @notice Permissionless on-chain computation of a two-position numerical cache.
    /// @dev No sentence or selected output is stored. An existing cache is immutable.




    function _storyKey(address owner, bytes32 storyId) private pure returns (bytes32) {
        return keccak256(abi.encode(owner, storyId));
    }

    function storyState(address owner, bytes32 storyId) external view returns (bytes32 contextHash,
        uint16 processed,uint16 pending,uint64 generated,uint64 epoch,uint64 activeStart,
        uint256 chunkCount,uint48 tail,uint8 tailLength)
    {
        Story storage s = _stories[_storyKey(owner, storyId)];
        return (s.contextHash,s.processed,s.pending,s.generated,s.epoch,s.activeStart,s.chunks.length,s.tail,s.tailLength);
    }

    function storyChunk(address owner,bytes32 storyId,uint256 index) external view returns (address,bytes32) {
        Chunk storage c = _stories[_storyKey(owner,storyId)].chunks[index];
        return (c.source,c.codeHash);
    }

    function _unpackWords(bytes memory payload,uint256 offset,int32[] memory output,uint256 outputOffset,uint256 count) private pure {
        assembly ("memory-safe") {
            let src := add(add(payload,32),offset)
            let dst := add(add(output,32),shl(5,outputOffset))
            for { let j := 0 } lt(j,count) { j := add(j,1) } {
                mstore(add(dst,shl(5,j)),signextend(3,shr(224,mload(add(src,shl(2,j))))))
            }
        }
    }

    function _loadStory(Story storage story,CachedWork memory state) private view {
        uint256 expected;
        for(uint256 i=story.activeStart;i<story.chunks.length;++i){
            Chunk storage entry=story.chunks[i];address source=entry.source;
            uint256 size=source.code.length;
            if(size<5||size>24576||source.codehash!=entry.codeHash)revert InvalidModel();
            bytes memory payload=new bytes(size-1);
            assembly ("memory-safe") { extcodecopy(source,add(payload,32),1,sub(size,1)) }
            uint256 start=(uint256(uint8(payload[0]))<<8)|uint8(payload[1]);
            uint256 count=uint8(payload[2]);
            if(uint8(payload[3])!=1||start!=expected||count==0||start+count>story.processed||payload.length!=4+count*2048)revert InvalidModel();
            for(uint256 layer;layer<LAYERS;++layer){
                uint256 offset=4+layer*count*512;
                _unpackWords(payload,offset,state.keys[layer],start*64,count*64);
                _unpackWords(payload,offset+count*256,state.values[layer],start*64,count*64);
            }
            expected=start+count;
        }
        if(expected!=story.processed)revert InvalidModel();
    }

    function _packWords(bytes memory payload,uint256 offset,int32[] memory values,uint256 inputOffset,uint256 count) private pure {
        assembly ("memory-safe") {
            let src := add(add(values,32),shl(5,inputOffset))
            let dst := add(add(payload,32),offset)
            for { let j := 0 } lt(j,count) { j := add(j,1) } {
                mstore(add(dst,shl(2,j)),shl(224,and(mload(add(src,shl(5,j))),0xffffffff)))
            }
        }
    }

    function _packNewPositions(CachedWork memory state,uint256 start,uint256 count) private pure returns(bytes memory payload){
        if(count==0||count>4||start+count>MAX_CONTEXT)revert InvalidInput();
        uint256 size=4+count*2048;
        payload=new bytes(size+32);
        assembly ("memory-safe") { mstore(payload,size) }
        payload[0]=bytes1(uint8(start>>8));payload[1]=bytes1(uint8(start));
        payload[2]=bytes1(uint8(count));payload[3]=0x01;
        for(uint256 layer;layer<LAYERS;++layer){
            uint256 offset=4+layer*count*512;
            _packWords(payload,offset,state.keys[layer],start*64,count*64);
            _packWords(payload,offset+count*256,state.values[layer],start*64,count*64);
        }
    }

    function _runStory(Story storage story,uint8 maxNew,bytes32 seed,uint8 topK,uint16 temperature) private view returns(Run memory r){
        if(maxNew==0||maxNew>MAX_NEW_TOKENS||topK==0||topK>64||temperature<100||temperature>2000)revert InvalidInput();
        r.processed=story.processed;r.generated=story.generated;r.epoch=story.epoch;
        r.pending=story.started?story.pending:initialPromptToken;
        r.tail=story.started?story.tail:uint48(initialPromptToken);
        r.tailLength=story.started?story.tailLength:1;
        r.refreshed=uint256(r.processed)+maxNew>MAX_CONTEXT;
        uint256 capacity=r.refreshed?uint256(r.tailLength)-1+maxNew:uint256(r.processed)+maxNew;
        r.state=_cachedState(capacity);
        if(r.refreshed){
            ++r.epoch;r.processed=0;
            for(uint256 j;j+1<r.tailLength;++j){
                uint16 token=uint16(r.tail>>(16*(uint256(r.tailLength)-1-j)));
                _appendToken(r.state,token,j,false);++r.processed;
            }
            r.fromPosition=0;
        }else{
            if(story.started)_loadStory(story,r.state);
            r.fromPosition=r.processed;
        }
        r.tokens=new uint16[](maxNew);
        for(uint256 i;i<maxNew;++i){
            (,r.lastLogitHash)=_appendToken(r.state,r.pending,r.processed,true);
            ++r.processed;
            uint16 next=_sampleLogits(r.state.logits,r.state.tables,seed,r.generated,topK,temperature);
            ++r.generated;r.tokens[i]=next;r.pending=next;
            r.tail=(r.tail<<16)|uint48(next);if(r.tailLength<3)++r.tailLength;
            r.endedEos=next==EOS_TOKEN;r.endedSentence=next==2||next==15||next==30;
            if(r.endedEos||r.endedSentence){
                uint16[] memory tokens=r.tokens;
                assembly ("memory-safe") { mstore(tokens,add(i,1)) }
                break;
            }
        }
        r.payload=_packNewPositions(r.state,r.fromPosition,uint256(r.processed)-r.fromPosition);
        bytes32 runtimeHash=keccak256(bytes.concat(hex"00",r.payload));
        r.nextContextHash=keccak256(abi.encode("GH0ST_CONTINUITY_STATE_V1",story.contextHash,runtimeHash,
            r.processed,r.pending,r.generated,r.epoch,r.tail,r.tailLength));
    }

    function preview(bytes32 storyId,uint8 maxNew,bytes32 seed,uint8 topK,uint16 temperature) external view
        returns(uint16[] memory tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash,bytes32 nextContextHash,bool refreshed)
    {
        return _preview(msg.sender,storyId,maxNew,seed,topK,temperature);
    }

    function previewFor(address owner,bytes32 storyId,uint8 maxNew,bytes32 seed,uint8 topK,uint16 temperature) external view
        returns(uint16[] memory tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash,bytes32 nextContextHash,bool refreshed)
    {
        return _preview(owner,storyId,maxNew,seed,topK,temperature);
    }

    function _preview(address owner,bytes32 storyId,uint8 maxNew,bytes32 seed,uint8 topK,uint16 temperature) private view
        returns(uint16[] memory tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash,bytes32 nextContextHash,bool refreshed)
    {
        Run memory r=_runStory(_stories[_storyKey(owner,storyId)],maxNew,seed,topK,temperature);
        return(r.tokens,r.endedEos,r.endedSentence,r.lastLogitHash,r.nextContextHash,r.refreshed);
    }

    function advanceStory(bytes32 storyId,bytes32 expectedContextHash,uint8 maxNew,bytes32 seed,uint8 topK,uint16 temperature) external
        returns(uint16[] memory tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash,bytes32 nextContextHash,bool refreshed)
    {
        bytes32 key=_storyKey(msg.sender,storyId);Story storage story=_stories[key];
        if(story.contextHash!=expectedContextHash)revert StaleContext();
        Run memory r=_runStory(story,maxNew,seed,topK,temperature);
        address child=address(new SimpleStoriesV2Data{salt:keccak256(abi.encode(key,r.nextContextHash))}(r.payload));
        bytes32 codeHash=child.codehash;
        if(codeHash!=keccak256(bytes.concat(hex"00",r.payload)))revert InvalidModel();
        if(r.refreshed)story.activeStart=uint64(story.chunks.length);
        story.chunks.push(Chunk(child,codeHash));
        story.contextHash=r.nextContextHash;story.processed=r.processed;story.pending=r.pending;
        story.generated=r.generated;story.epoch=r.epoch;story.tail=r.tail;story.tailLength=r.tailLength;story.started=true;
        emit StoryAdvanced(msg.sender,storyId,r.nextContextHash,child,r.generated,r.epoch,r.tokens,
            r.endedEos,r.endedSentence,r.lastLogitHash,r.refreshed);
        return(r.tokens,r.endedEos,r.endedSentence,r.lastLogitHash,r.nextContextHash,r.refreshed);
    }
}
