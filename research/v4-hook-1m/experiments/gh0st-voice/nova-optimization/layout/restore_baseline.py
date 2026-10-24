"""Restore selected N0VA baseline artifacts with their pinned publication hashes.

Local files only. No network, RPC, signing, or deployment operations.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[3]
PREFIX = "research/v4-hook-1m/"
SELECTED = PREFIX + "experiments/gh0st-voice/voice-v8/exports/selected/"
EXPECTED_REFERENCE_SHA256 = "9e7cfa1b40330a69fbc1b5278fafa51a151d9fcd94e8f12273f385a50b578c0d"
EXPECTED_CHECKPOINT_SHA256 = "904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3"
REQUIRED = {"core.bin", "groups.bin", "words.bin", "fused.bin", "punctuation.bin",
            "vocabulary.bin", "vocabulary.json", "sigmoid-delta.bin", "exp-q32.bin",
            "reference.npz", "manifest.json", "GRU2SIMDModel.sol", "GRU2SIMDHook.sol"}
sha = lambda data: hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=PROJECT,
                        help="Root containing final-model publication artifact paths after research/v4-hook-1m/")
    parser.add_argument("--selection-manifest", type=Path, default=PROJECT / "final-model.json")
    parser.add_argument("--output", type=Path, default=HERE / "baseline-restored")
    args = parser.parse_args()
    selection = json.loads(args.selection_manifest.read_text())
    assert selection["selection"]["source_checkpoint_sha256"] == EXPECTED_CHECKPOINT_SHA256
    items = [item for item in selection["artifacts"] if item["path"].startswith(SELECTED)]
    assert len(items) == len(REQUIRED), "Unexpected selected-baseline artifact set"
    restored = {}
    for item in items:
        source_relative = Path(item["path"].removeprefix(PREFIX))
        assert not source_relative.is_absolute() and ".." not in source_relative.parts
        data = (args.source_root / source_relative).read_bytes()
        assert len(data) == item["bytes"] and sha(data) == item["sha256"], item["path"]
        if item["encoding"] == "gzip":
            data = gzip.decompress(data)
            assert len(data) == item["restored_bytes"]
            assert sha(data) == item["restored_sha256"]
            name = Path(item["restored_path"]).name
        else:
            assert item["encoding"] == "identity"
            name = Path(item["path"]).name
        assert name in REQUIRED and name not in restored
        restored[name] = data
    assert set(restored) == REQUIRED
    assert sha(restored["reference.npz"]) == EXPECTED_REFERENCE_SHA256
    args.output.mkdir(parents=True, exist_ok=True)
    for name, data in restored.items():
        target = args.output / name
        if target.exists():
            assert target.read_bytes() == data, "Refusing to overwrite different bytes: " + str(target)
        else:
            target.write_bytes(data)
    with np.load(args.output / "reference.npz", allow_pickle=False) as reference:
        parameter_count = sum(reference[name].size for name in reference.files)
        assert parameter_count == 8_175_493
        shapes = {name: list(reference[name].shape) for name in reference.files}
    report = {"status": "PASS", "mode": "LOCAL_FILES_ONLY", "mainnet_actions": 0,
              "selected_checkpoint_sha256": EXPECTED_CHECKPOINT_SHA256,
              "reference_sha256": EXPECTED_REFERENCE_SHA256,
              "parameter_count": parameter_count, "tensor_shapes": shapes,
              "artifacts": {name: {"bytes": len(data), "sha256": sha(data)} for name, data in restored.items()}}
    (args.output / "restoration-verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"status": "PASS", "files": len(restored), "parameters": parameter_count,
                      "output": str(args.output.resolve())}))


if __name__ == "__main__":
    main()
