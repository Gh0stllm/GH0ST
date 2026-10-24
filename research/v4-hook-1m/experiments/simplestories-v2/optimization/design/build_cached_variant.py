"""Build an isolated memory-KV variant from the frozen unrolled kernel."""
from pathlib import Path
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "kernel8unrolled/SimpleStoriesV2ModelOptimized.sol"
OUT = ROOT / "kernel8cached"

CACHED_FUNCTIONS = r'''
    struct CachedWork {
        Work work;
        int32[][] keys;
        int32[][] values;
        bytes matrixWeights;
        bytes tables;
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
            if (completeLayer) {
                _linear(layerOffset + 256, 128, 128, w.norm, w.qTemp, matrixWeights);
                _rope(w.qTemp, w.query, position * 128, 4, position, tables);
            }
            _linear(layerOffset + 69888, 64, 128, w.norm, w.kTemp, matrixWeights);
            _linear(layerOffset + 104704, 64, 128, w.norm, w.vTemp, matrixWeights);
            _rope(w.kTemp, w.key, position * 64, 2, position, tables);
            for (uint256 j; j < 64; ++j) w.value[position * 64 + j] = w.vTemp[j];
            if (completeLayer) {
                _attention(w, position, tables);
                _linear(layerOffset + 139520, 128, 128, w.attention, w.projection, matrixWeights);
                for (uint256 j; j < HIDDEN; ++j) w.hidden[j] = _checked(int256(w.hidden[j]) + w.projection[j]);
                _fill(_weights, layerOffset + 209152, HIDDEN * 2, matrixWeights);
                _rms(w.hidden, 0, matrixWeights, 0, w.norm);
                _linear(layerOffset + 209408, 341, 128, w.norm, w.gate, matrixWeights);
                _linear(layerOffset + 394912, 341, 128, w.norm, w.up, matrixWeights);
                for (uint256 j; j < INTERMEDIATE; ++j)
                    w.gate[j] = _checked(_silu(w.gate[j], tables) * int256(w.up[j]) / Q);
                _linear(layerOffset + 580416, 128, 341, w.gate, w.projection, matrixWeights);
                for (uint256 j; j < HIDDEN; ++j) w.hidden[j] = _checked(int256(w.hidden[j]) + w.projection[j]);
            }
        }
        if (readout) {
            _fill(_weights, FINAL_NORM_OFFSET, HIDDEN * 2, matrixWeights);
            _rms(w.hidden, 0, matrixWeights, 0, w.norm);
            (nextToken, logitHash) = _head(w.norm, matrixWeights);
        }
    }

    /// @notice Same greedy token sequence as full-prefix recomputation; KV is
    /// reused only inside this call. No persistent state or external cache.
    function generate(uint16[] calldata prompt, uint8 maximumNewTokens) external view
        returns (uint16[] memory tokens, bool ended, bytes32 lastLogitHash)
    {
        if (prompt.length == 0 || maximumNewTokens == 0 || maximumNewTokens > MAX_NEW_TOKENS
            || prompt.length + maximumNewTokens - 1 > MAX_CONTEXT) revert InvalidInput();
        uint256 capacity = prompt.length + maximumNewTokens - 1;
        CachedWork memory state;
        state.work = _newWork(capacity);
        state.keys = new int32[][](LAYERS);
        state.values = new int32[][](LAYERS);
        for (uint256 layer; layer < LAYERS; ++layer) {
            state.keys[layer] = new int32[](capacity * 64);
            state.values[layer] = new int32[](capacity * 64);
        }
        state.matrixWeights = new bytes(MATRIX_BUFFER_BYTES);
        state.tables = new bytes(TABLE_BYTES);
        _fill(_tables, 0, TABLE_BYTES, state.tables);
        for (uint256 position; position + 1 < prompt.length; ++position)
            _appendToken(state, prompt[position], position, false);
        tokens = new uint16[](maximumNewTokens);
        uint16 pending = prompt[prompt.length - 1];
        for (uint256 i; i < maximumNewTokens; ++i) {
            (uint16 next, bytes32 hash) = _appendToken(state, pending, prompt.length - 1 + i, true);
            tokens[i] = next;
            lastLogitHash = hash;
            if (next == EOS_TOKEN) {
                ended = true;
                assembly ("memory-safe") { mstore(tokens, add(i, 1)) }
                break;
            }
            pending = next;
        }
    }
'''


def main():
    OUT.mkdir(exist_ok=True)
    source = SOURCE.read_text()
    marker = source.index("    function generate(")
    variant = source[:marker] + CACHED_FUNCTIONS + "}\n"
    (OUT / SOURCE.name).write_text(variant)
    if not (OUT / "model").exists():
        shutil.copytree(ROOT / "kernel8/model", OUT / "model")
    (OUT / "variant.json").write_text(json.dumps({
        "name": "swar8cached", "base_source": str(SOURCE.relative_to(ROOT)),
        "base_source_sha256": hashlib.sha256(source.encode()).hexdigest(),
        "variant_source_sha256": hashlib.sha256(variant.encode()).hexdigest(),
        "math": "Exact Q12 cached-key/value reuse within one view call; full output vocabulary; no persistent storage",
        "weights_changed": False, "parameters": 1235968,
    }, indent=2) + "\n")
    print(OUT)


if __name__ == "__main__":
    main()
