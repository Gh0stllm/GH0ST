"""Create a separate exact sentence-stopping candidate without editing its base."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "kernel/SimpleStoriesV2ModelOptimized.sol"
OUT = ROOT / "generation-candidate"


def extract(source, marker):
    start = source.index(marker)
    depth, opened = 0, False
    for i in range(start, len(source)):
        if source[i] == "{": depth, opened = depth + 1, True
        if source[i] == "}":
            depth -= 1
            if opened and depth == 0: return source[start:i+1]
    raise ValueError(marker)


SENTENCE = r'''
    /// @notice Stops only on a naturally predicted native . ! ? token or EOS.
    /// @dev The cap is a resource limit, not a sentence-completion signal.
    function generateSentence(uint16[] calldata prompt, uint8 maximumNewTokens) external view
        returns (uint16[] memory tokens, bool endedEos, bool endedSentence, bytes32 lastLogitHash)
    {
        if (prompt.length == 0 || maximumNewTokens == 0 || maximumNewTokens > MAX_CONTEXT
            || prompt.length + maximumNewTokens - 1 > MAX_CONTEXT) revert InvalidInput();
        uint256 capacity = prompt.length + maximumNewTokens - 1;
        CachedWork memory state;
        state.work = _newCachedScratch(capacity);
        state.keys = new int32[][](LAYERS);
        state.values = new int32[][](LAYERS);
        for (uint256 layer; layer < LAYERS; ++layer) {
            state.keys[layer] = new int32[](capacity * 64);
            state.values[layer] = new int32[](capacity * 64);
        }
        state.matrixWeights = new bytes(MATRIX_BUFFER_BYTES);
        state.tables = new bytes(TABLE_BYTES);
        state.logits = _newLogits();
        _fill(_tables, 0, TABLE_BYTES, state.tables);
        for (uint256 position; position + 1 < prompt.length; ++position)
            _appendToken(state, prompt[position], position, false);
        tokens = new uint16[](maximumNewTokens);
        uint16 pending = prompt[prompt.length - 1];
        for (uint256 i; i < maximumNewTokens; ++i) {
            (uint16 next, bytes32 hash) = _appendToken(state, pending, prompt.length - 1 + i, true);
            tokens[i] = next;
            lastLogitHash = hash;
            endedEos = next == EOS_TOKEN;
            endedSentence = next == 15 || next == 2 || next == 30;
            if (endedEos || endedSentence) {
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
    helper = (ROOT / "design/math-helpers.sol.inc").read_text()
    # Drop exact helpers in place; old scalar functions remain available for audit.
    source = source.replace(extract(source, "function _rope("), extract(helper, "function _rope("))
    extras = "\n\n".join(extract(helper, marker) for marker in ["function _siluMultiply(", "function _addResidual(", "function _newCachedScratch("])
    source = source[:source.rfind("}")] + extras + SENTENCE + "\n}\n"
    source = source.replace("        bytes tables;\n    }", "        bytes tables;\n        int256[] logits;\n    }")
    source = source.replace("state.work = _newWork(capacity);", "state.work = _newCachedScratch(capacity);")
    source = source.replace("state.tables = new bytes(TABLE_BYTES);\n        _fill", "state.tables = new bytes(TABLE_BYTES);\n        state.logits = _newLogits();\n        _fill")
    source = source.replace("(nextToken, logitHash) = _head(w.norm, matrixWeights);\n        }", "(nextToken, logitHash) = _headWithScratch(w.norm, matrixWeights, state.logits);\n        }")
    old_loop = "for (uint256 j; j < INTERMEDIATE; ++j)\n                    w.gate[j] = _checked(_silu(w.gate[j], tables) * int256(w.up[j]) / Q);"
    source = source.replace(old_loop, "_siluMultiply(w.gate, w.up, tables);")
    source = source.replace("for (uint256 j; j < INTERMEDIATE; ++j) w.gate[j] = _checked(_silu(w.gate[j], tables) * int256(w.up[j]) / Q);", "_siluMultiply(w.gate, w.up, tables);")
    source = source.replace("for (uint256 j; j < HIDDEN; ++j) w.hidden[j] = _checked(int256(w.hidden[j]) + w.projection[j]);", "_addResidual(w.hidden, 0, w.projection);")
    source = source.replace("for (uint256 j; j < HIDDEN; ++j) w.hidden[t * HIDDEN + j] = _checked(int256(w.hidden[t * HIDDEN + j]) + w.projection[j]);", "_addResidual(w.hidden, t * HIDDEN, w.projection);")
    assert "state.logits" in source and "function generateSentence(" in source
    assert "state.work = _newWork(capacity)" not in source
    (OUT / SOURCE.name).write_text(source)
    (OUT / "derivation.json").write_text(json.dumps({"base": str(SOURCE.relative_to(ROOT)),
        "base_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "source_sha256": hashlib.sha256(source.encode()).hexdigest(),
        "changes": ["reusable full-logit workspace", "reduced scratch arrays", "exact RoPE/SwiGLU/residual assembly", "native punctuation/EOS stopping"]}, indent=2) + "\n")
    print(OUT)


if __name__ == "__main__": main()
