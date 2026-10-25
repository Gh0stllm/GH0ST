// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {GPT2Dot8 as GPT2Dot} from "./GPT2Dot8.sol";

/// @notice A deterministic, bounded shard of the complete fixed-point GPT-2 small model.
/// @dev Model: 12 blocks, width 768, 12 attention heads, MLP width 3072,
/// vocabulary 50257, context 1024; all 124,439,808 learned parameters are used.
/// Inputs are host-tokenized GPT-2 token IDs. Immutable bytecode holds the model.
/// Each deployment is one controller-bound session. Layer KV stays on its owning chain.
/// Anyone may advance deterministic work; only the controller may supply authenticated inputs.
contract GPT2Shard {
    uint256 public constant WIDTH = 768;
    uint256 public constant VOCAB = 50257;
    uint256 public constant CONTEXT = 1024;
    uint256 private constant Q = 4096;
    uint256 private constant SCALE = 16777216;
    uint8 public constant COMPLETE = 12;
    uint8 public constant BOUNDARY = 13;
    bytes32 public constant CANONICAL_MODEL_ID = 0xd5fe104a83865bb22299096cafcfe77eb1642fff8ddf0047306b4801599b4107;
    address public immutable controller;
    uint8 public immutable firstLayer;
    uint8 public immutable endLayer;
    bool public immutable doesEmbedding;
    bool public immutable doesOutput;
    address public immutable manifest;
    bytes32 public immutable manifestCodeHash;
    bytes32 public immutable modelId;

    uint8 public phase;
    uint8 public layer;
    uint8 public head;
    uint32 public cursor;
    uint32 public position;
    uint32 public pendingToken;
    uint32 public stepNumber;
    uint32 public bestToken;
    int256 public bestLogit;
    bytes32 public stateCommitment;
    int256 private _scoreMax;
    uint256 private _denominator;
    int256[64] private _attentionAccumulator;
    // Eight signed int32 values per slot, little-endian within the slot.
    mapping(uint8 => mapping(uint256 => uint256)) private _vectors;
    // ((layer * 1024 + position) * 192) + side * 96 + packedWord.
    mapping(uint256 => uint256) private _kv;

    error Unauthorized();
    error WrongChain();
    error BadModel();
    error InvalidToken();
    error WrongPhase();
    error StaleStep();
    error InvalidWork();
    error ActivationOverflow();
    error InvalidConfiguration();
    error InvalidPosition();
    event Began(uint32 indexed position, uint32 inputToken, bytes32 inputCommitment, bytes32 commitment);
    event Advanced(uint32 indexed step, uint8 phase, uint8 layer, uint8 head, uint32 cursor, bytes32 commitment);
    event PhaseComplete(uint8 phase, uint8 layer, uint8 head, uint8 vectorId, bytes32 vectorHash);
    event Token(uint32 indexed position, uint32 token, int256 logit);
    event LogitChunk(uint32 start, uint32 count, bytes32 logitsHash);

    constructor(
        address root,
        bytes32 rootCodeHash,
        bytes32 modelId_,
        uint256 chainId_,
        uint8 firstLayer_,
        uint8 endLayer_,
        bool doesEmbedding_,
        bool doesOutput_,
        address controller_
    ) {
        if (block.chainid != chainId_) revert WrongChain();
        if (controller_ == address(0) || firstLayer_ > endLayer_ || endLayer_ > 12
            || (doesEmbedding_ && firstLayer_ != 0)
            || (doesOutput_ && endLayer_ != 12)
            || (firstLayer_ == endLayer_ && !(doesEmbedding_ && endLayer_ == 0))) {
            revert InvalidConfiguration();
        }
        if (root.code.length != 1 + 77 * 32 || root.codehash != rootCodeHash
            || modelId_ != CANONICAL_MODEL_ID) revert BadModel();
        controller = controller_;
        firstLayer = firstLayer_;
        endLayer = endLayer_;
        doesEmbedding = doesEmbedding_;
        doesOutput = doesOutput_;
        manifest = root;
        manifestCodeHash = rootCodeHash;
        modelId = modelId_;
        stateCommitment = keccak256(abi.encode(
            block.chainid, address(this), controller_, rootCodeHash, modelId_,
            firstLayer_, endLayer_, doesEmbedding_, doesOutput_
        ));
    }

    /// @notice Start the next authenticated token at this shard's fixed range.
    /// @dev A deployment handles one session; only its immutable controller chooses inputs.
    /// Hidden vectors are exactly 768 signed int32 values in big-endian wire order.
    function begin(uint32 tokenPosition, uint32 inputToken, bytes32 inputCommitment, bytes calldata hidden) external {
        if (msg.sender != controller) revert Unauthorized();
        if (phase != 0 && phase != BOUNDARY && phase != COMPLETE) revert WrongPhase();
        if (tokenPosition >= CONTEXT || (phase == 0 ? tokenPosition != 0 : tokenPosition != position + 1)) {
            revert InvalidPosition();
        }
        if (inputToken >= VOCAB) revert InvalidToken();
        if (doesEmbedding) {
            if (hidden.length != 0) revert InvalidWork();
        } else {
            if (hidden.length != WIDTH * 4) revert InvalidWork();
            // Decode each wire word to the existing little-endian eight-lane storage layout.
            for (uint256 wordIndex; wordIndex < WIDTH / 8; ++wordIndex) {
                uint256 wire;
                assembly ("memory-safe") { wire := calldataload(add(hidden.offset, mul(wordIndex, 32))) }
                uint256 packed;
                for (uint256 lane; lane < 8; ++lane) {
                    packed |= uint256(uint32(wire >> (224 - lane * 32))) << (lane * 32);
                }
                _vectors[0][wordIndex] = packed;
            }
        }
        position = tokenPosition;
        pendingToken = inputToken;
        layer = firstLayer;
        head = 0;
        cursor = 0;
        phase = doesEmbedding ? 1 : 2;
        stateCommitment = keccak256(abi.encode(
            stateCommitment, tokenPosition, inputToken, inputCommitment, keccak256(hidden)
        ));
        emit Began(tokenPosition, inputToken, inputCommitment, stateCommitment);
    }

    /// @notice Return only the residual vector at a completed shard boundary.
    function exportHidden() external view returns (bytes memory hidden) {
        if (phase != BOUNDARY) revert WrongPhase();
        hidden = new bytes(WIDTH * 4);
        for (uint256 wordIndex; wordIndex < WIDTH / 8; ++wordIndex) {
            uint256 packed = _vectors[0][wordIndex];
            uint256 wire;
            for (uint256 lane; lane < 8; ++lane) {
                wire |= uint256(uint32(packed >> (lane * 32))) << (224 - lane * 32);
            }
            assembly ("memory-safe") { mstore(add(add(hidden, 32), mul(wordIndex, 32)), wire) }
        }
    }

    /// @notice Execute at most 512 output rows or context positions, depending on phase.
    /// @dev A caller-supplied sequence number prevents accidentally replaying a transaction.
    /// Embedding and layer normalization each process exactly one width-768 vector.
    function advance(uint32 expectedStep, uint32 maxRows) public {
        if (expectedStep != stepNumber) revert StaleStep();
        if (maxRows == 0 || maxRows > 512) revert InvalidWork();
        uint8 oldPhase = phase;
        if (oldPhase == 0 || oldPhase == COMPLETE || oldPhase == BOUNDARY) revert WrongPhase();
        uint8 oldLayer = layer;
        uint8 oldHead = head;
        uint32 oldCursor = cursor;
        bytes32 workHash;
        if (oldPhase == 1) workHash = _embedding();
        else if (oldPhase == 2 || oldPhase == 7 || oldPhase == 10) workHash = _normalize(oldPhase);
        else if (oldPhase == 3 || oldPhase == 6 || oldPhase == 8 || oldPhase == 9 || oldPhase == 11) workHash = _linear(oldPhase, maxRows);
        else if (oldPhase == 4) workHash = _attentionScores(maxRows);
        else if (oldPhase == 5) workHash = _attentionValues(maxRows);
        else revert WrongPhase();
        ++stepNumber;
        stateCommitment = keccak256(abi.encode(stateCommitment, stepNumber, oldPhase, oldLayer, oldHead, oldCursor, phase, layer, head, cursor, workHash));
        emit Advanced(stepNumber, phase, layer, head, cursor, stateCommitment);
    }

    /// @notice Atomically execute a caller-preflighted sequence of inference chunks.
    /// @dev No partial gas bailout: any failed chunk reverts the entire batch.
    function advanceMany(uint32 expectedStep, uint32 maxRows, uint16 maxSteps) external {
        if (expectedStep != stepNumber) revert StaleStep();
        if (maxRows == 0 || maxRows > 512 || maxSteps == 0 || maxSteps > 64) revert InvalidWork();
        if (phase == 0 || phase == COMPLETE || phase == BOUNDARY) revert WrongPhase();
        while (maxSteps != 0 && phase != COMPLETE && phase != BOUNDARY) {
            --maxSteps;
            advance(stepNumber, maxRows);
        }
    }

    function checkpoint() external view returns (uint8, uint8, uint8, uint32, uint32, uint32, uint32, uint32, int256, bytes32) {
        return (phase, layer, head, cursor, position, pendingToken, stepNumber, bestToken, bestLogit, stateCommitment);
    }

    function readVector(uint8 id, uint256 startIndex, uint256 count) external view returns (int256[] memory result) {
        uint256 length = _vectorLength(id);
        if (startIndex > length || count > length - startIndex) revert InvalidWork();
        result = new int256[](count);
        for (uint256 i; i < count; ++i) result[i] = _readValue(id, startIndex + i);
    }

    function readKV(uint8 blockIndex, uint32 tokenPosition, bool value) external view returns (int256[] memory result) {
        if (blockIndex >= 12 || tokenPosition > position) revert InvalidWork();
        result = new int256[](WIDTH);
        uint256 base = (uint256(blockIndex) * CONTEXT + tokenPosition) * 192 + (value ? 96 : 0);
        for (uint256 i; i < 96; ++i) {
            uint256 packed = _kv[base + i];
            for (uint256 j; j < 8; ++j) result[i * 8 + j] = int256(int32(uint32(packed >> (32 * j))));
        }
    }

    function _vectorLength(uint8 id) private view returns (uint256) {
        if (id <= 1 || id == 3) return WIDTH;
        if (id == 2) return 2304;
        if (id == 4) return 3072;
        if (id == 5) return uint256(position) + 1;
        revert InvalidWork();
    }

    function _readValue(uint8 id, uint256 index) private view returns (int256 result) {
        assembly ("memory-safe") {
            mstore(0, id)
            mstore(32, _vectors.slot)
            let root := keccak256(0, 64)
            mstore(0, shr(3, index))
            mstore(32, root)
            result := signextend(3, shr(shl(5, and(index, 7)), sload(keccak256(0, 64))))
        }
    }

    function _loadVector(uint8 id, uint256 length) private view returns (int256[] memory result) {
        result = new int256[](length);
        assembly ("memory-safe") {
            mstore(0, id)
            mstore(32, _vectors.slot)
            let root := keccak256(0, 64)
            let at := add(result, 32)
            let end := add(at, shl(5, length))
            let slot := 0
            for { } iszero(gt(add(at, 256), end)) { at := add(at, 256) slot := add(slot, 1) } {
                mstore(0, slot)
                mstore(32, root)
                let packed := sload(keccak256(0, 64))
                mstore(at, signextend(3, packed))
                mstore(add(at, 32), signextend(3, shr(32, packed)))
                mstore(add(at, 64), signextend(3, shr(64, packed)))
                mstore(add(at, 96), signextend(3, shr(96, packed)))
                mstore(add(at, 128), signextend(3, shr(128, packed)))
                mstore(add(at, 160), signextend(3, shr(160, packed)))
                mstore(add(at, 192), signextend(3, shr(192, packed)))
                mstore(add(at, 224), signextend(3, shr(224, packed)))
            }
            if lt(at, end) {
                mstore(0, slot)
                mstore(32, root)
                let packed := sload(keccak256(0, 64))
                for {} lt(at, end) {at := add(at, 32) packed := shr(32, packed)} {mstore(at, signextend(3, packed))}
            }
        }
    }

    function _writeVector(uint8 id, uint256 startIndex, int256[] memory values) private {
        bool valid = true;
        assembly ("memory-safe") {
            mstore(0, id)
            mstore(32, _vectors.slot)
            let root := keccak256(0, 64)
            let at := add(values, 32)
            let end := add(at, shl(5, mload(values)))
            let index := startIndex
            for {} lt(at, end) {} {
                let slot := shr(3, index)
                let lane := and(index, 7)
                mstore(0, slot)
                mstore(32, root)
                let key := keccak256(0, 64)
                let packed := 0
                if or(lane, gt(add(at, 256), end)) { packed := sload(key) }
                for {} and(lt(lane, 8), lt(at, end)) {lane := add(lane, 1) at := add(at, 32) index := add(index, 1)} {
                    let value := mload(at)
                    if iszero(eq(value, signextend(3, value))) { valid := 0 }
                    let shift := shl(5, lane)
                    let mask := shl(shift, 0xffffffff)
                    packed := or(and(packed, not(mask)), shl(shift, and(value, 0xffffffff)))
                }
                sstore(key, packed)
            }
        }
        if (!valid) revert ActivationOverflow();
    }

    function _finish(uint8 completedPhase, uint8 vectorId) private returns (bytes32 digest) {
        int256[] memory output = _loadVector(vectorId, _vectorLength(vectorId));
        digest = keccak256(abi.encode(output));
        emit PhaseComplete(completedPhase, layer, head, vectorId, digest);
    }

    function _addressAt(address source, uint256 index) private view returns (address result) {
        assembly ("memory-safe") {
            let p := mload(0x40)
            extcodecopy(source, p, add(1, mul(index, 32)), 32)
            result := and(mload(p), 0xffffffffffffffffffffffffffffffffffffffff)
        }
        if (result == address(0)) revert BadModel();
    }

    function _row(uint256 tensor, uint256 rowIndex, uint256 rowBytes, uint256 rows) private view returns (bytes memory result) {
        if (tensor >= 77 || rowIndex >= rows || rowBytes == 0 || rowBytes > 24575) revert BadModel();
        address catalog = _addressAt(manifest, tensor);
        uint256 perShard = 24575 / rowBytes;
        uint256 shardIndex = rowIndex / perShard;
        uint256 shardCount = (rows + perShard - 1) / perShard;
        address source;
        if (shardCount > 767) {
            if (catalog.code.length != 1 + ((shardCount + 766) / 767) * 32) revert BadModel();
            uint256 pageIndex = shardIndex / 767;
            address page = _addressAt(catalog, pageIndex);
            uint256 pageLength = shardCount - pageIndex * 767;
            if (pageLength > 767) pageLength = 767;
            if (page.code.length != 1 + pageLength * 32) revert BadModel();
            source = _addressAt(page, shardIndex % 767);
        } else {
            if (catalog.code.length != 1 + shardCount * 32) revert BadModel();
            source = _addressAt(catalog, shardIndex);
        }
        uint256 shardRows = rows - shardIndex * perShard;
        if (shardRows > perShard) shardRows = perShard;
        if (source.code.length != 1 + shardRows * rowBytes) revert BadModel();
        uint256 offset = 1 + (rowIndex % perShard) * rowBytes;
        result = new bytes(rowBytes);
        assembly ("memory-safe") { extcodecopy(source, add(result, 32), offset, rowBytes) }
    }

    struct RowReader {
        address catalog;
        address source;
        address page;
        uint256 cachedShard;
        uint256 cachedPage;
        uint256 perShard;
        uint256 shardCount;
        uint256 rowBytes;
        uint256 rows;
        bytes buffer;
    }

    function _prepareRows(uint256 tensor, uint256 rows, uint256 rowBytes) private view returns (RowReader memory reader) {
        reader.catalog = _addressAt(manifest, tensor);
        reader.cachedShard = type(uint256).max;
        reader.cachedPage = type(uint256).max;
        reader.perShard = 24575 / rowBytes;
        reader.shardCount = (rows + reader.perShard - 1) / reader.perShard;
        reader.rowBytes = rowBytes;
        reader.rows = rows;
        reader.buffer = new bytes(rowBytes);
        uint256 entries = reader.shardCount > 767 ? (reader.shardCount + 766) / 767 : reader.shardCount;
        if (reader.catalog.code.length != 1 + entries * 32) revert BadModel();
    }

    function _nextRow(RowReader memory reader, uint256 rowIndex) private view returns (bytes memory buffer) {
        uint256 shardIndex = rowIndex / reader.perShard;
        if (shardIndex != reader.cachedShard) {
            address page = reader.catalog;
            uint256 addressIndex = shardIndex;
            if (reader.shardCount > 767) {
                uint256 pageIndex = shardIndex / 767;
                if (pageIndex != reader.cachedPage) {
                    reader.page = _addressAt(page, pageIndex);
                    reader.cachedPage = pageIndex;
                    uint256 pageLength = reader.shardCount - pageIndex * 767;
                    if (pageLength > 767) pageLength = 767;
                    if (reader.page.code.length != 1 + pageLength * 32) revert BadModel();
                }
                page = reader.page;
                addressIndex = shardIndex % 767;
            }
            reader.source = _addressAt(page, addressIndex);
            uint256 shardRows = reader.rows - shardIndex * reader.perShard;
            if (shardRows > reader.perShard) shardRows = reader.perShard;
            if (reader.source.code.length != 1 + shardRows * reader.rowBytes) revert BadModel();
            reader.cachedShard = shardIndex;
        }
        buffer = reader.buffer;
        address source = reader.source;
        uint256 length = reader.rowBytes;
        uint256 offset = 1 + (rowIndex % reader.perShard) * length;
        assembly ("memory-safe") {extcodecopy(source, add(buffer, 32), offset, length)}
    }

    function _i32(bytes memory data, uint256 offset) private pure returns (int256 result) {
        assembly ("memory-safe") { result := signextend(3, shr(224, mload(add(add(data, 32), offset)))) }
    }
    function _u32(bytes memory data, uint256 offset) private pure returns (uint256 result) {
        assembly ("memory-safe") { result := shr(224, mload(add(add(data, 32), offset))) }
    }

    function _embedding() private returns (bytes32 digest) {
        bytes memory embedding = _row(0, pendingToken, 772, VOCAB);
        bytes memory positional = _row(1, position, 3072, CONTEXT);
        int256 scale = int256(_u32(embedding, 0));
        int256[] memory output = new int256[](WIDTH);
        for (uint256 i; i < WIDTH; ++i) output[i] = int256(int8(uint8(embedding[4 + i]))) * scale / int256(Q) + _i32(positional, i * 4);
        _writeVector(0, 0, output);
        digest = _finish(1, 0);
        phase = endLayer == 0 ? BOUNDARY : 2;
    }

    function _sqrt(uint256 value) private pure returns (uint256 result) {
        if (value == 0) return 0;
        uint256 shifted = value;
        result = 1;
        if (shifted >> 128 > 0) { shifted >>= 128; result <<= 64; }
        if (shifted >> 64 > 0) { shifted >>= 64; result <<= 32; }
        if (shifted >> 32 > 0) { shifted >>= 32; result <<= 16; }
        if (shifted >> 16 > 0) { shifted >>= 16; result <<= 8; }
        if (shifted >> 8 > 0) { shifted >>= 8; result <<= 4; }
        if (shifted >> 4 > 0) { shifted >>= 4; result <<= 2; }
        if (shifted >> 2 > 0) result <<= 1;
        for (uint256 i; i < 8; ++i) result = (result + value / result) >> 1;
        uint256 rounded = value / result;
        if (rounded < result) result = rounded;
    }

    function _normalize(uint8 stage) private returns (bytes32 digest) {
        uint256 tensor = stage == 10 ? 2 : 3 + uint256(layer) * 6 + (stage == 7 ? 1 : 0);
        bytes memory coefficients = _row(tensor, 0, 6144, 1);
        int256[] memory input = _loadVector(0, WIDTH);
        int256 sum;
        for (uint256 i; i < WIDTH; ++i) sum += input[i];
        int256 mean = sum / int256(WIDTH);
        uint256 squared;
        for (uint256 i; i < WIDTH; ++i) { int256 d = input[i] - mean; squared += uint256(d * d); }
        int256 denominator = int256(_sqrt(squared / WIDTH + 168));
        int256[] memory output = new int256[](WIDTH);
        for (uint256 i; i < WIDTH; ++i) {
            int256 normalized = (input[i] - mean) * int256(Q) / denominator;
            output[i] = normalized * _i32(coefficients, i * 4) / int256(Q) + _i32(coefficients, (WIDTH + i) * 4);
        }
        _writeVector(1, 0, output);
        digest = _finish(stage, 1);
        cursor = 0;
        if (stage == 2) phase = 3;
        else if (stage == 7) phase = 8;
        else { phase = 11; bestToken = 0; bestLogit = type(int256).min; }
    }

    struct LinearState { uint256 rows; uint256 begin; uint256 count; uint8 outputId; }

    function _linear(uint8 stage, uint32 maximum) private returns (bytes32 digest) {
        LinearState memory job;
        job.rows = stage == 3 ? 2304 : stage == 8 ? 3072 : stage == 11 ? VOCAB : WIDTH;
        uint256 width = stage == 9 ? 3072 : WIDTH;
        uint256 tensor = stage == 11 ? 0 : 3 + uint256(layer) * 6 + (stage == 3 ? 2 : stage == 6 ? 3 : stage == 8 ? 4 : 5);
        uint8 inputId = stage == 6 ? 3 : stage == 9 ? 4 : 1;
        job.outputId = stage == 3 ? 2 : stage == 8 ? 4 : 0;
        job.begin = cursor;
        job.count = job.rows - job.begin;
        if (job.count > maximum) job.count = maximum;
        int256[] memory input = _loadVector(inputId, width);
        GPT2Dot.Prepared memory prepared = GPT2Dot.prepare(input);
        int256[] memory output = new int256[](job.count);
        bytes memory tanhTable;
        if (stage == 8) tanhTable = _row(76, 0, 4098, 1);
        RowReader memory reader = _prepareRows(tensor, job.rows, width + (stage == 11 ? 4 : 8));
        for (uint256 i; i < job.count; ++i) {
            bytes memory record = _nextRow(reader, job.begin + i);
            uint256 offset = stage == 11 ? 4 : 8;
            int256 value = GPT2Dot.dotPacked(record, offset, input, prepared) * int256(_u32(record, stage == 11 ? 0 : 4)) / int256(SCALE);
            if (stage != 11) value += _i32(record, 0);
            if (stage == 6 || stage == 9) value += _readValue(0, job.begin + i);
            if (stage == 8) value = _gelu(value, tanhTable);
            output[i] = value;
            if (stage == 11 && value > bestLogit) { bestLogit = value; bestToken = uint32(job.begin + i); }
        }
        digest = keccak256(abi.encode(output));
        if (stage == 11) emit LogitChunk(uint32(job.begin), uint32(job.count), digest);
        if (stage != 11) _writeVector(job.outputId, job.begin, output);
        if (stage == 3) _cacheQKV(job.begin, job.count);
        cursor = uint32(job.begin + job.count);
        if (cursor == job.rows) {
            if (stage != 11) digest = _finish(stage, job.outputId);
            cursor = 0;
            if (stage == 3) { head = 0; phase = 4; }
            else if (stage == 6) phase = 7;
            else if (stage == 8) phase = 9;
            else if (stage == 9) {
                ++layer;
                phase = layer == endLayer ? (doesOutput ? 10 : BOUNDARY) : 2;
            } else {
                phase = COMPLETE;
                emit Token(position, bestToken, bestLogit);
            }
        }
    }

    function _gelu(int256 x, bytes memory table) private pure returns (int256) {
        int256 x2 = x * x / int256(Q);
        int256 x3 = x2 * x / int256(Q);
        int256 inner = (x + x3 * 183 / int256(Q)) * 3268 / int256(Q);
        uint256 magnitude = uint256(inner < 0 ? -inner : inner);
        uint256 index = magnitude / 16;
        int256 value;
        if (index >= 2048) value = int256(Q);
        else {
            uint256 offset = index * 2;
            assembly ("memory-safe") { value := shr(240, mload(add(add(table, 32), offset))) }
        }
        if (inner < 0) value = -value;
        return x * (int256(Q) + value) / 8192;
    }

    function _cacheQKV(uint256 rangeStart, uint256 count) private {
        // QKV chunks can be arbitrarily aligned; copy each touched packed KV word.
        uint256 end = rangeStart + count;
        if (end <= WIDTH) return;
        if (rangeStart < WIDTH) rangeStart = WIDTH;
        uint256 first = rangeStart >> 3;
        uint256 last = (end - 1) >> 3;
        uint256 base = (uint256(layer) * CONTEXT + position) * 192;
        for (uint256 i = first; i <= last; ++i) _kv[base + i - 96] = _vectors[2][i];
    }

    function _loadHead(uint256 tokenPosition, bool value) private view returns (int256[] memory result) {
        result = new int256[](64);
        uint256 base = (uint256(layer) * CONTEXT + tokenPosition) * 192 + (value ? 96 : 0) + uint256(head) * 8;
        for (uint256 i; i < 8; ++i) {
            uint256 packed = _kv[base + i];
            for (uint256 j; j < 8; ++j) result[i * 8 + j] = int256(int32(uint32(packed >> (32 * j))));
        }
    }

    function _attentionScores(uint32 maximum) private returns (bytes32 digest) {
        uint256 rangeStart = cursor;
        uint256 end = rangeStart + maximum;
        if (end > uint256(position) + 1) end = uint256(position) + 1;
        int256[] memory query = new int256[](64);
        for (uint256 i; i < 64; ++i) query[i] = _readValue(2, uint256(head) * 64 + i);
        int256[] memory scores = new int256[](end - rangeStart);
        int256 maximumScore = rangeStart == 0 ? type(int256).min : _scoreMax;
        for (uint256 p = rangeStart; p < end; ++p) {
            int256[] memory key = _loadHead(p, false);
            int256 score;
            for (uint256 i; i < 64; ++i) score += query[i] * key[i];
            score /= 32768;
            scores[p - rangeStart] = score;
            if (score > maximumScore) maximumScore = score;
        }
        _scoreMax = maximumScore;
        _writeVector(5, rangeStart, scores);
        digest = keccak256(abi.encode(scores, maximumScore));
        cursor = uint32(end);
        if (end == uint256(position) + 1) { cursor = 0; phase = 5; }
    }

    function _attentionValues(uint32 maximum) private returns (bytes32 digest) {
        uint256 rangeStart = cursor;
        uint256 end = rangeStart + maximum;
        if (end > uint256(position) + 1) end = uint256(position) + 1;
        bytes memory table = _row(75, 0, 16388, 1);
        int256[] memory accumulator = new int256[](64);
        uint256 denominator;
        if (rangeStart != 0) {
            denominator = _denominator;
            for (uint256 i; i < 64; ++i) accumulator[i] = _attentionAccumulator[i];
        }
        for (uint256 p = rangeStart; p < end; ++p) {
            int256 diff = _scoreMax - _readValue(5, p);
            uint256 weight = uint256(diff) > 65536 ? 0 : _u32(table, uint256(diff) / 16 * 4);
            denominator += weight;
            if (weight != 0) {
                int256[] memory value = _loadHead(p, true);
                for (uint256 i; i < 64; ++i) accumulator[i] += int256(weight) * value[i];
            }
        }
        digest = keccak256(abi.encode(accumulator, denominator));
        cursor = uint32(end);
        if (end == uint256(position) + 1) {
            for (uint256 i; i < 64; ++i) accumulator[i] /= int256(denominator);
            _writeVector(3, uint256(head) * 64, accumulator);
            cursor = 0;
            if (head == 11) { digest = _finish(5, 3); phase = 6; }
            else { ++head; phase = 4; }
        } else {
            _denominator = denominator;
            for (uint256 i; i < 64; ++i) _attentionAccumulator[i] = accumulator[i];
        }
    }
}

