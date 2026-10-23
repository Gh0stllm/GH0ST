#!/usr/bin/env python3
"""Verify saved artifacts and reproduce held-out outputs in a fresh process."""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

import numpy as np

from model_experiment import CONFIG_PATH, ROOT, array_hash, load_verified_base, synthetic_split, write_json
from predict_model import ResearchPredictor


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text())
    report = json.loads((ROOT / "reports" / "model-benchmark.json").read_text())
    fixtures = np.load(ROOT / "model-data" / "adapted" / "heldout-fixtures.npz")
    predictions = json.loads((ROOT / "reports" / "model-predictions.json").read_text())["samples"]
    regenerated = synthetic_split(config["synthetic_splits"]["test"]["count"], config["synthetic_splits"]["test"]["seed"], config)
    assert array_hash(regenerated["history"]) == report["data"]["splits"]["test"]["history_sha256"]
    assert array_hash(regenerated["future"]) == report["data"]["splits"]["test"]["future_sha256"]
    assert np.array_equal(regenerated["history"], fixtures["history"])
    assert np.array_equal(regenerated["labels"], fixtures["labels"])
    predictor = ResearchPredictor()
    floating = predictor.predict(fixtures["history"])
    quantized = predictor.predict(fixtures["history"], quantized=True)
    assert np.array_equal(floating["classes"], [item["float32_class"] for item in predictions])
    assert np.array_equal(quantized["classes"], [item["int8_dequantized_class"] for item in predictions])
    np.testing.assert_allclose(floating["logits"], fixtures["logits"], rtol=0, atol=1e-6)
    np.testing.assert_allclose(quantized["logits"], fixtures["quantized_logits"], rtol=0, atol=1e-6)
    rejected = []
    invalid = {
        "short_history": np.ones(511, dtype=np.float32),
        "negative_volatility": np.full(512, -1.0, dtype=np.float32),
        "nan": np.full(512, np.nan, dtype=np.float32),
        "infinity": np.full(512, np.inf, dtype=np.float32),
        "empty_batch": np.empty((0, 512), dtype=np.float32),
    }
    for name, value in invalid.items():
        try:
            predictor.predict(value)
        except ValueError:
            rejected.append(name)
        else:
            raise AssertionError(f"Invalid input accepted: {name}")
    with tempfile.TemporaryDirectory(prefix="gh0st-model-pin-") as directory:
        copied = Path(directory)
        original = ROOT / "model-data" / "ttm-r2-base"
        for name in config["expected_source_sha256"]:
            shutil.copyfile(original / name, copied / name)
        weight_path = copied / "model.safetensors"
        changed = bytearray(weight_path.read_bytes())
        changed[-1] ^= 1
        weight_path.write_bytes(changed)
        try:
            load_verified_base(copied, config)
        except ValueError as error:
            assert "digest mismatch" in str(error)
        else:
            raise AssertionError("Same-size altered checkpoint was accepted")
    summary = {
        "status": "passed",
        "fresh_process_saved_artifact_check": True,
        "heldout_samples": len(fixtures["history"]),
        "synthetic_seed_regeneration_exact": True,
        "float32_classes_match_saved_report": True,
        "int8_dequantized_classes_match_saved_report": True,
        "float32_max_logit_absolute_error": float(np.max(np.abs(floating["logits"] - fixtures["logits"]))),
        "int8_dequantized_max_logit_absolute_error": float(np.max(np.abs(quantized["logits"] - fixtures["quantized_logits"]))),
        "invalid_inputs_rejected": rejected,
        "same_size_altered_checkpoint_rejected_before_loading": True,
        "scope": "Offline CPU serialization and reproducibility check only; no EVM or economic validation.",
    }
    write_json(ROOT / "reports" / "model-verification.json", summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
