// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {S0ULTypes, IS0ULModel, IS0ULTokenizer} from "./S0ULTypes.sol";
import {S0ULMath} from "./S0ULMath.sol";
import {S0ULTokenizer} from "./S0ULTokenizer.sol";

/// @notice Complete, resumable integer transformer inference. No action execution.
/// @dev Requests pin one immutable model. Permissionless continuation only pays
///      for deterministic work; it never supplies hidden states or predictions.
contract S0ULInference {
    enum Phase {
        None, Embed, AttnNorm, Q, K, V, RoPEQ, RoPEKCache, Attend, O,
        AttnResidual, FFNUp, FFNDown, FFNResidual, FinalNorm, Logits,
        Select, Done, Cancelled
    }

    struct Status {
        address owner;
        Phase phase;
        uint16 position;
        uint16 layer;
        uint16 row;
        uint16 head;
        uint16 promptLength;
        uint16 maxNewTokens;
        uint16 generated;
        uint256 saturationCount;
        bool done;
        bool cancelled;
        bool logitsReady;
    }

    struct Request {
        Status state;
        uint16[] ids;
        int32[] x;
        int32[] u;
        int32[] q;
        int32[] k;
        int32[] v;
        int32[] a;
        int32[] h;
        int32[] y;
        int32[] scores;
    }

    struct KVCache {
        int32[] keys;
        int32[] values;
    }

    uint256 public constant MAX_ROWS = 128;
    uint256 public constant MAX_NEW_TOKENS = 32;
    bytes32 public constant TOKENIZER_DOMAIN_SHA256 =
        0x7de4830b9e32e5884d2ee9776fdae6c8c1b42a9278342ae22d7105b039e9a726;

    IS0ULModel public immutable model;
    IS0ULTokenizer public immutable tokenizer;
    bytes32 public immutable modelId;
    S0ULTypes.Config private _config;
    uint256 public nextRequestId = 1;
    mapping(uint256 => Request) private _requests;
    mapping(uint256 => mapping(uint256 => KVCache)) private _cache;

    error InvalidConfiguration();
    error InvalidRequest();
    error UnknownRequest();
    error TerminalRequest();
    error NotOwner();
    error InvalidBudget();
    error InvalidModelValue();
    error InconsistentState();
    error TextUnavailable();

    event Begun(uint256 indexed requestId, address indexed owner, bytes32 indexed modelId,
                bytes32 requestHash, uint256 promptLength, uint256 maxNewTokens);
    event Advanced(uint256 indexed requestId, Phase nextPhase, uint256 position,
                   uint256 layer, uint256 row, uint256 head, uint256 saturationCount);
    event TokenGenerated(uint256 indexed requestId, uint256 outputIndex, uint16 tokenId);
    event Completed(uint256 indexed requestId, uint256 generated, bool endedWithEOS,
                    uint256 saturationCount);
    event RequestCancelled(uint256 indexed requestId);

    constructor(IS0ULModel model_, IS0ULTokenizer tokenizer_) {
        if (address(model_).code.length == 0) revert InvalidConfiguration();
        S0ULTypes.Config memory cfg = model_.configuration();
        if (cfg.vocabSize <= 2 || cfg.vocabSize > 512 || cfg.dim == 0 || cfg.dim > 128 ||
            cfg.layers == 0 || cfg.layers > 4 || cfg.heads == 0 || cfg.heads > 4 ||
            cfg.dim % cfg.heads != 0 || (cfg.dim / cfg.heads) % 2 != 0 ||
            cfg.hiddenDim == 0 || cfg.hiddenDim > 640 || cfg.maxSeqLen == 0 ||
            cfg.maxSeqLen > 128 || cfg.epsQ28 == 0 || cfg.epsQ28 > (1 << 28) ||
            cfg.attentionScaleQ14 == 0 || cfg.attentionScaleQ14 > (1 << 14)) {
            revert InvalidConfiguration();
        }
        if (address(tokenizer_) != address(0)) {
            if (cfg.vocabSize != 512 || address(tokenizer_).code.length == 0 ||
                address(tokenizer_).codehash != keccak256(type(S0ULTokenizer).runtimeCode) ||
                tokenizer_.domainSha256() != TOKENIZER_DOMAIN_SHA256) revert InvalidConfiguration();
        }
        model = model_;
        tokenizer = tokenizer_;
        modelId = model_.modelId();
        _config = cfg;
    }

    function configuration() external view returns (S0ULTypes.Config memory) { return _config; }

    function begin(uint16[] calldata prompt, uint16 maxNewTokens) external returns (uint256 requestId) {
        return _begin(prompt, maxNewTokens);
    }

    /// @notice Tokenize UTF-8 bytes on-chain, then prepend BOS and append SEP.
    function beginText(string calldata text, uint16 maxNewTokens) external returns (uint256 requestId) {
        if (address(tokenizer) == address(0)) revert TextUnavailable();
        uint16[] memory encoded = tokenizer.encode(text);
        uint16[] memory prompt = new uint16[](encoded.length + 2);
        prompt[0] = 1;
        for (uint256 i; i < encoded.length; ++i) prompt[i + 1] = encoded[i];
        prompt[prompt.length - 1] = 3;
        return _begin(prompt, maxNewTokens);
    }

    function _begin(uint16[] memory prompt, uint16 maxNewTokens) private returns (uint256 requestId) {
        if (prompt.length == 0 || maxNewTokens == 0 || maxNewTokens > MAX_NEW_TOKENS ||
            prompt.length + maxNewTokens > _config.maxSeqLen) revert InvalidRequest();
        for (uint256 i; i < prompt.length; ++i) {
            if (prompt[i] >= _config.vocabSize) revert InvalidRequest();
        }
        requestId = nextRequestId++;
        Request storage r = _requests[requestId];
        r.state.owner = msg.sender;
        r.state.phase = Phase.Embed;
        r.state.promptLength = uint16(prompt.length);
        r.state.maxNewTokens = maxNewTokens;
        r.ids = prompt;
        uint256 d = _config.dim;
        r.x = new int32[](d);
        r.u = new int32[](d);
        r.q = new int32[](d);
        r.k = new int32[](d);
        r.v = new int32[](d);
        r.a = new int32[](d);
        r.y = new int32[](d);
        r.h = new int32[](_config.hiddenDim);
        r.scores = new int32[](_config.vocabSize);
        emit Begun(requestId, msg.sender, modelId,
                   keccak256(abi.encode(modelId, msg.sender, prompt, maxNewTokens)),
                   prompt.length, maxNewTokens);
    }

    function status(uint256 requestId) external view returns (Status memory) {
        return _request(requestId).state;
    }

    function tokens(uint256 requestId) external view returns (uint16[] memory) {
        return _request(requestId).ids;
    }

    function outputTokens(uint256 requestId) public view returns (uint16[] memory result) {
        Request storage r = _request(requestId);
        result = new uint16[](r.state.generated);
        for (uint256 i; i < result.length; ++i) result[i] = r.ids[r.state.promptLength + i];
    }

    /// @notice Last output's complete logits are valid when status.logitsReady.
    function logits(uint256 requestId) external view returns (int32[] memory) {
        return _request(requestId).scores;
    }

    /// @notice Raw token decoding; decoding does not validate or execute actions.
    function decodedOutput(uint256 requestId) external view returns (bytes memory) {
        if (address(tokenizer) == address(0)) revert TextUnavailable();
        return tokenizer.decode(outputTokens(requestId), false);
    }

    /// @notice Debug snapshots expose the arithmetic state for independent checks.
    function activations(uint256 requestId, uint8 buffer) external view returns (int32[] memory) {
        Request storage r = _request(requestId);
        if (buffer == 0) return r.x;
        if (buffer == 1) return r.u;
        if (buffer == 2) return r.q;
        if (buffer == 3) return r.k;
        if (buffer == 4) return r.v;
        if (buffer == 5) return r.a;
        if (buffer == 6) return r.h;
        if (buffer == 7) return r.y;
        revert InvalidRequest();
    }

    function cache(uint256 requestId, uint256 layer) external view
        returns (int32[] memory keys, int32[] memory values)
    {
        _request(requestId);
        if (layer >= _config.layers) revert InvalidRequest();
        KVCache storage kv = _cache[requestId][layer];
        return (kv.keys, kv.values);
    }

    function cancel(uint256 requestId) external {
        Request storage r = _request(requestId);
        if (r.state.owner != msg.sender) revert NotOwner();
        if (r.state.done || r.state.cancelled) revert TerminalRequest();
        r.state.cancelled = true;
        r.state.phase = Phase.Cancelled;
        emit RequestCancelled(requestId);
    }

    /// @notice Execute one bounded phase, or at most maxRows matrix output rows.
    /// @dev Work is performed entirely in EVM instructions against pinned weights.
    function advance(uint256 requestId, uint256 maxRows) external returns (bool done) {
        if (maxRows == 0 || maxRows > MAX_ROWS) revert InvalidBudget();
        Request storage r = _request(requestId);
        Status storage s = r.state;
        if (s.done || s.cancelled) revert TerminalRequest();
        Phase p = s.phase;
        uint256 b = 2 + 14 * uint256(s.layer);
        uint256 tail = 2 + 14 * uint256(_config.layers);
        if (p == Phase.Embed) {
            _embed(r);
        } else if (p == Phase.AttnNorm) {
            (int32[] memory u, uint256 saturated) = S0ULMath.norm(
                r.x, model.readTensor(b, 0, uint256(_config.dim) * 8), _config.epsQ28);
            _overwrite(r.u, u);
            s.saturationCount += saturated;
            s.phase = Phase.Q;
        } else if (p == Phase.Q || p == Phase.K || p == Phase.V || p == Phase.O ||
                   p == Phase.FFNUp || p == Phase.FFNDown || p == Phase.Logits) {
            _linearStep(r, maxRows, b);
        } else if (p == Phase.RoPEQ || p == Phase.RoPEKCache) {
            _rotateAndCache(requestId, r, tail);
        } else if (p == Phase.Attend) {
            _attentionStep(requestId, r, tail);
        } else if (p == Phase.AttnResidual) {
            _residual(r);
            (int32[] memory u, uint256 saturated) = S0ULMath.norm(
                r.x, model.readTensor(b + 9, 0, uint256(_config.dim) * 8), _config.epsQ28);
            _overwrite(r.u, u);
            s.saturationCount += saturated;
            s.phase = Phase.FFNUp;
        } else if (p == Phase.FFNResidual) {
            _residual(r);
            if (uint256(s.layer) + 1 < _config.layers) {
                ++s.layer;
                s.phase = Phase.AttnNorm;
            } else if (uint256(s.position) + 1 < s.promptLength) {
                ++s.position;
                s.layer = 0;
                s.phase = Phase.Embed;
            } else {
                s.phase = Phase.FinalNorm;
            }
        } else if (p == Phase.FinalNorm) {
            (int32[] memory u, uint256 saturated) = S0ULMath.norm(
                r.x, model.readTensor(tail, 0, uint256(_config.dim) * 8), _config.epsQ28);
            _overwrite(r.u, u);
            s.saturationCount += saturated;
            s.phase = Phase.Logits;
        } else if (p == Phase.Select) {
            _select(requestId, r);
        } else {
            revert InconsistentState();
        }
        emit Advanced(requestId, s.phase, s.position, s.layer, s.row, s.head, s.saturationCount);
        return s.done;
    }

    function _embed(Request storage r) private {
        Status storage s = r.state;
        uint256 d = _config.dim;
        if (s.position >= r.ids.length || s.position >= _config.maxSeqLen) revert InconsistentState();
        uint256 id = r.ids[s.position];
        bytes memory q = model.readTensor(0, id * d, d);
        int256 scale = S0ULMath.readLE(model.readTensor(1, id * 8, 8), 0);
        if (scale <= 0 || scale > (1 << 24)) revert InvalidModelValue();
        uint256 saturationCount;
        for (uint256 i; i < d; ++i) {
            int256 weight = int8(uint8(q[i]));
            if (weight == -128) revert InvalidModelValue();
            (int32 value, uint256 saturated) = S0ULMath.clip(S0ULMath.roundDiv(weight * scale, 1 << 10));
            r.x[i] = value;
            saturationCount += saturated;
        }
        s.saturationCount += saturationCount;
        s.layer = 0;
        s.row = 0;
        s.head = 0;
        s.logitsReady = false;
        s.phase = Phase.AttnNorm;
    }

    function _linearStep(Request storage r, uint256 maxRows, uint256 b) private {
        Status storage s = r.state;
        Phase phase = s.phase;
        uint256 tensor;
        uint256 rows = _config.dim;
        int32[] storage destination = r.q;
        int32[] memory input;
        Phase next = Phase.K;
        if (phase == Phase.Q) { tensor = b + 1; }
        else if (phase == Phase.K) { tensor = b + 3; destination = r.k; next = Phase.V; }
        else if (phase == Phase.V) { tensor = b + 5; destination = r.v; next = Phase.RoPEQ; }
        else if (phase == Phase.O) {
            tensor = b + 7; destination = r.y; input = r.a; next = Phase.AttnResidual;
        } else if (phase == Phase.FFNUp) {
            tensor = b + 10; destination = r.h; rows = _config.hiddenDim; next = Phase.FFNDown;
        } else if (phase == Phase.FFNDown) {
            tensor = b + 12; destination = r.y; input = r.h; next = Phase.FFNResidual;
        } else if (phase == Phase.Logits) {
            tensor = 0; destination = r.scores; rows = _config.vocabSize; next = Phase.Select;
        } else { revert InconsistentState(); }
        if (phase != Phase.O && phase != Phase.FFNDown) input = r.u;
        uint256 first = s.row;
        if (first >= rows) revert InconsistentState();
        uint256 count = rows - first;
        if (count > maxRows) count = maxRows;
        (int32[] memory result, uint256 saturated) = S0ULMath.linear(
            model.readTensor(tensor, first * input.length, count * input.length),
            model.readTensor(tensor + 1, first * 8, count * 8), input);
        if (result.length != count) revert InconsistentState();
        for (uint256 i; i < count; ++i) {
            int32 value = result[i];
            if (phase == Phase.FFNUp && value < 0) value = 0;
            destination[first + i] = value;
        }
        s.saturationCount += saturated;
        if (first + count == rows) {
            s.row = 0;
            s.phase = next;
            if (next == Phase.Select) s.logitsReady = true;
        } else {
            s.row = uint16(first + count);
        }
    }

    function _rotateAndCache(uint256 requestId, Request storage r, uint256 tail) private {
        Status storage s = r.state;
        uint256 pairs = uint256(_config.dim) / _config.heads / 2;
        bytes memory cosRow = model.readTensor(tail + 1, uint256(s.position) * pairs * 8, pairs * 8);
        bytes memory sinRow = model.readTensor(tail + 2, uint256(s.position) * pairs * 8, pairs * 8);
        if (s.phase == Phase.RoPEQ) {
            (int32[] memory q, uint256 saturated) = S0ULMath.rope(r.q, cosRow, sinRow, _config.heads);
            _overwrite(r.q, q);
            s.saturationCount += saturated;
            s.phase = Phase.RoPEKCache;
        } else {
            (int32[] memory k, uint256 saturated) = S0ULMath.rope(r.k, cosRow, sinRow, _config.heads);
            _overwrite(r.k, k);
            s.saturationCount += saturated;
            KVCache storage kv = _cache[requestId][s.layer];
            uint256 d = _config.dim;
            if (kv.keys.length != uint256(s.position) * d || kv.values.length != kv.keys.length) {
                revert InconsistentState();
            }
            for (uint256 i; i < d; ++i) {
                kv.keys.push(k[i]);
                kv.values.push(r.v[i]);
            }
            s.head = 0;
            s.phase = Phase.Attend;
        }
    }

    function _attentionStep(uint256 requestId, Request storage r, uint256 tail) private {
        Status storage s = r.state;
        uint256 d = _config.dim;
        uint256 width = d / _config.heads;
        uint256 positions = uint256(s.position) + 1;
        uint256 offset = uint256(s.head) * width;
        if (s.head >= _config.heads) revert InconsistentState();
        int32[] memory q = new int32[](width);
        int32[] memory keys = new int32[](positions * width);
        int32[] memory values = new int32[](positions * width);
        KVCache storage kv = _cache[requestId][s.layer];
        if (kv.keys.length != positions * d || kv.values.length != kv.keys.length) revert InconsistentState();
        for (uint256 i; i < width; ++i) q[i] = r.q[offset + i];
        for (uint256 t; t < positions; ++t) {
            for (uint256 i; i < width; ++i) {
                keys[t * width + i] = kv.keys[t * d + offset + i];
                values[t * width + i] = kv.values[t * d + offset + i];
            }
        }
        int32[] memory result = S0ULMath.attentionHead(
            q, keys, values, model.readTensor(tail + 3, 0, 4097 * 8), _config.attentionScaleQ14);
        if (result.length != width) revert InconsistentState();
        for (uint256 i; i < width; ++i) r.a[offset + i] = result[i];
        if (uint256(s.head) + 1 == _config.heads) {
            s.head = 0;
            s.phase = Phase.O;
        } else { ++s.head; }
    }

    function _residual(Request storage r) private {
        uint256 saturationCount;
        uint256 d = _config.dim;
        for (uint256 i; i < d; ++i) {
            (int32 value, uint256 saturated) = S0ULMath.clip(int256(r.x[i]) + int256(r.y[i]));
            r.x[i] = value;
            saturationCount += saturated;
        }
        r.state.saturationCount += saturationCount;
    }

    function _select(uint256 requestId, Request storage r) private {
        Status storage s = r.state;
        if (!s.logitsReady) revert InconsistentState();
        uint16 winner;
        int32 best = r.scores[0];
        for (uint256 i = 1; i < _config.vocabSize; ++i) {
            if (r.scores[i] > best) { best = r.scores[i]; winner = uint16(i); }
        }
        r.ids.push(winner);
        emit TokenGenerated(requestId, s.generated, winner);
        ++s.generated;
        if (winner == 2 || s.generated == s.maxNewTokens) {
            s.done = true;
            s.phase = Phase.Done;
            emit Completed(requestId, s.generated, winner == 2, s.saturationCount);
        } else {
            ++s.position;
            s.layer = 0;
            s.logitsReady = false;
            s.phase = Phase.Embed;
        }
    }

    function _overwrite(int32[] storage destination, int32[] memory values) private {
        if (destination.length != values.length) revert InconsistentState();
        for (uint256 i; i < values.length; ++i) destination[i] = values[i];
    }

    function _request(uint256 requestId) private view returns (Request storage r) {
        r = _requests[requestId];
        if (r.state.owner == address(0)) revert UnknownRequest();
    }
}
