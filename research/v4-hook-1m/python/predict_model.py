#!/usr/bin/env python3
"""Offline CPU predictor for the saved research adapter. No transaction sending."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from safetensors.torch import load_file

from model_experiment import CONFIG_PATH, ROOT, create_head, forecasts, history_features, load_verified_base, sha256


class ResearchPredictor:
    def __init__(self) -> None:
        self.config = json.loads(CONFIG_PATH.read_text())
        torch.set_num_threads(self.config["training"]["cpu_threads"])
        self.base, self.loading_info = load_verified_base(ROOT / "model-data" / "ttm-r2-base", self.config)
        artifacts = ROOT / "model-data" / "adapted"
        report = json.loads((ROOT / "reports" / "model-benchmark.json").read_text())
        for name in ("fee-head.safetensors", "preprocessing.json", "model-int8-storage.safetensors"):
            path = artifacts / name
            expected = report["artifact_hashes"][str(path.relative_to(ROOT))]["sha256"]
            if sha256(path) != expected:
                raise ValueError(f"Adapted artifact digest mismatch: {name}")
        self.preprocessing = json.loads((artifacts / "preprocessing.json").read_text())
        self.head = create_head(104, self.config["head_hidden_width"])
        self.head.load_state_dict(load_file(str(artifacts / "fee-head.safetensors")), strict=True)
        self.head.eval()
        self.quantized_base = None
        self.quantized_head = None

    def load_quantized(self) -> None:
        # This restores int8 * scale into float32 modules. It is intentionally
        # not advertised as native integer inference.
        import copy

        tensors = load_file(str(ROOT / "model-data" / "adapted" / "model-int8-storage.safetensors"))
        self.quantized_base = copy.deepcopy(self.base)
        self.quantized_head = copy.deepcopy(self.head)
        for prefix, model in (("base", self.quantized_base), ("head", self.quantized_head)):
            state = {}
            for name in model.state_dict():
                state[name] = tensors[f"{prefix}.int8.{name}"].float() * tensors[f"{prefix}.scale.{name}"]
            model.load_state_dict(state, strict=True)
            model.eval()

    def predict(self, histories: np.ndarray, quantized: bool = False) -> dict[str, np.ndarray]:
        value = np.asarray(histories, dtype=np.float32)
        if value.ndim == 1:
            value = value[np.newaxis, :]
        if value.ndim != 2 or value.shape[1] != self.config["context_length"] or len(value) == 0:
            raise ValueError("Expected one or more complete 512-step volatility histories")
        if not np.isfinite(value).all():
            raise ValueError("Volatility observations must be finite")
        if (value < 0).any():
            raise ValueError("Volatility observations must be nonnegative")
        if quantized and self.quantized_base is None:
            self.load_quantized()
        base = self.quantized_base if quantized else self.base
        head = self.quantized_head if quantized else self.head
        predicted = forecasts(base, value, self.preprocessing["input_mean"], self.preprocessing["input_std"])
        features = np.concatenate([predicted, history_features(value)], axis=1)
        standardized = (features - np.array(self.preprocessing["feature_mean"], dtype=np.float32)) / np.array(self.preprocessing["feature_std"], dtype=np.float32)
        with torch.inference_mode():
            logits = head(torch.from_numpy(standardized.astype(np.float32))).numpy()
        if not np.isfinite(logits).all():
            raise ValueError("Model produced a non-finite output")
        classes = logits.argmax(axis=1).astype(np.int64)
        fees = np.array([action["fee_millionths"] for action in self.config["actions"]], dtype=np.int64)[classes]
        return {"classes": classes, "fees_millionths": fees, "logits": logits}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, help="JSON array of 512 observations, or a list of histories; defaults to the first three saved synthetic fixtures.")
    parser.add_argument("--int8-dequantized", action="store_true", help="Evaluate compressed weights after restoring them into float32 modules.")
    args = parser.parse_args()
    if args.input:
        histories = np.asarray(json.loads(args.input.read_text()), dtype=np.float32)
    else:
        histories = np.load(ROOT / "model-data" / "adapted" / "heldout-fixtures.npz")["history"][:3]
    result = ResearchPredictor().predict(histories, quantized=args.int8_dequantized)
    print(json.dumps({"scope": "offline synthetic research predictor; no onchain execution", **{key: value.tolist() for key, value in result.items()}}, indent=2))


if __name__ == "__main__":
    main()
