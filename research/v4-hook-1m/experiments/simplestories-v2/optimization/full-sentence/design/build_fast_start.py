"""Build a separate first-position exact-dead-work optimization."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "generation-candidate/SimpleStoriesV2ModelOptimized.sol"
OUT = ROOT / "generation-faststart"

FAST_PATH = r'''
        // A single causal key has probability one. Preserve malformed-table
        // zero-denominator behavior, then return the exact GQA value vector.
        if (position == 0) {
            if (_u32(tables, 2052) == 0) {
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
'''


def main():
    original = SOURCE.read_text()
    source = original.replace(
        "function _attention(Work memory w, uint256 position, bytes memory tables) private pure {",
        "function _attention(Work memory w, uint256 position, bytes memory tables) private pure {" + FAST_PATH)
    source = source.replace("if (completeLayer) {\n                _linear(layerOffset + 256,", 
                            "if (completeLayer && position != 0) {\n                _linear(layerOffset + 256,")
    assert source != original and "if (completeLayer && position != 0)" in source
    OUT.mkdir(exist_ok=True)
    (OUT / SOURCE.name).write_text(source)
    (OUT / "derivation.json").write_text(json.dumps({"base": str(SOURCE.relative_to(ROOT)),
        "base_sha256": hashlib.sha256(original.encode()).hexdigest(),
        "source_sha256": hashlib.sha256(source.encode()).hexdigest(),
        "change": "Exact position-zero single-key attention; omit unused initial-token query projection and query RoPE; retain keys and values"}, indent=2)+"\n")
    print(OUT)


if __name__ == "__main__": main()
