#!/usr/bin/env python3
"""Adapt a pinned public numeric model to bounded fee labels on synthetic data.

Training is offline. This script deliberately makes no claim of market performance,
integer inference, Solidity equivalence, or swap-path gas feasibility.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.metadata
import json
import math
import platform
import struct
import time
import urllib.request
from pathlib import Path

import numpy as np
import torch
from safetensors.torch import load_file, save_file
from torch import nn
from tsfm_public.models.tinytimemixer import TinyTimeMixerForPrediction


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "configs" / "model-experiment.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def array_hash(value: np.ndarray) -> str:
    """Hash shape/dtype plus C-order bytes, independently of zip timestamps."""
    header = json.dumps({"shape": list(value.shape), "dtype": str(value.dtype)}, sort_keys=True)
    return hashlib.sha256(header.encode() + value.tobytes(order="C")).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def fetch_checkpoint(config: dict, allow_download: bool) -> tuple[Path, dict]:
    target = ROOT / "model-data" / "ttm-r2-base"
    target.mkdir(parents=True, exist_ok=True)
    sources = {}
    for name in ("config.json", "model.safetensors", "README.md"):
        path = target / name
        url = f"https://huggingface.co/{config['model_id']}/resolve/{config['revision']}/{name}"
        if not path.exists():
            if not allow_download:
                raise FileNotFoundError(f"Missing pinned checkpoint {path}; run with --download once.")
            with urllib.request.urlopen(url, timeout=60) as response:
                payload = response.read(16 * 1024 * 1024 + 1)
            if len(payload) > 16 * 1024 * 1024:
                raise ValueError("Unexpectedly large checkpoint file")
            path.write_bytes(payload)
        actual_hash = sha256(path)
        if actual_hash != config["expected_source_sha256"][name]:
            raise ValueError(f"Pinned source digest mismatch for {name}")
        sources[name] = {"url": url, "sha256": actual_hash, "bytes": path.stat().st_size}
    with (target / "model.safetensors").open("rb") as handle:
        header_length = struct.unpack("<Q", handle.read(8))[0]
        if header_length > 2_000_000:
            raise ValueError("Unexpected safetensors header length")
        header = json.loads(handle.read(header_length))
    tensors = {key: value for key, value in header.items() if key != "__metadata__"}
    tensor_count = sum(math.prod(value["shape"]) for value in tensors.values())
    if tensor_count != config["expected_base_parameters"]:
        raise ValueError(f"Unexpected tensor count: {tensor_count}")
    manifest = {
        "model_id": config["model_id"],
        "revision": config["revision"],
        "declared_license": config["declared_license"],
        "source_files": sources,
        "checkpoint_parameter_count": tensor_count,
        "checkpoint_tensor_count": len(tensors),
        "loader": "Installed granite-tsfm 0.3.11; local safetensors; no remote Python code",
    }
    write_json(target / "source-manifest.json", manifest)
    return target, manifest


def synthetic_split(count: int, seed: int, config: dict) -> dict[str, np.ndarray]:
    """Independent simulated volatility histories, not downloaded market data.

    Three latent volatility regimes evolve with occasional state transitions.
    Smooth log-volatility and exponentially decaying shocks are observed with
    multiplicative measurement noise. Labels depend only on the future window.
    No future observation is provided to the model or feature scaler.
    """
    rng = np.random.default_rng(seed)
    context = config["context_length"]
    horizon = config["forecast_length"]
    regimes = rng.integers(0, 3, size=count)
    regime_means = np.array([3.0, 8.0, 18.0], dtype=np.float64)
    log_volatility = np.log(regime_means[regimes])
    shock = np.zeros(count, dtype=np.float64)
    values = np.empty((count, context + horizon), dtype=np.float32)
    for step in range(context + horizon):
        switches = rng.random(count) < 0.002
        alternatives = rng.integers(0, 3, size=count)
        regimes = np.where(switches, alternatives, regimes)
        log_volatility = (
            0.92 * log_volatility
            + 0.08 * np.log(regime_means[regimes])
            + rng.normal(0.0, 0.045, size=count)
        )
        impulses = np.where(rng.random(count) < 0.003, rng.uniform(0.4, 1.1, size=count), 0.0)
        shock = 0.90 * shock + impulses
        observations = np.exp(log_volatility + shock + rng.normal(0.0, 0.12, size=count))
        values[:, step] = np.clip(observations, 0.1, 100.0)
    history = values[:, :context].copy()
    future = values[:, context:].copy()
    target = np.mean(future, axis=1)
    labels = np.digitize(target, config["synthetic_target_thresholds_bps"]).astype(np.int64)
    return {"history": history, "future": future, "target": target, "labels": labels}


def load_verified_base(base_path: Path, config: dict) -> tuple[nn.Module, dict]:
    for name, expected_hash in config["expected_source_sha256"].items():
        if sha256(base_path / name) != expected_hash:
            raise ValueError(f"Pinned source digest mismatch for {name}")
    model, loading_info = TinyTimeMixerForPrediction.from_pretrained(
        str(base_path), local_files_only=True, output_loading_info=True
    )
    for key in ("missing_keys", "unexpected_keys", "mismatched_keys", "error_msgs"):
        if loading_info.get(key):
            raise ValueError(f"Checkpoint did not load exactly: {key}={loading_info[key]}")
    model.eval()
    for parameter in model.parameters():
        parameter.requires_grad_(False)
    return model, loading_info


HISTORY_FEATURES = [
    "latest_volatility",
    "mean_last_8",
    "mean_last_32",
    "mean_last_128",
    "mean_context",
    "std_last_32",
    "max_last_32",
    "mean_last_8_minus_mean_last_32",
]


def history_features(history: np.ndarray) -> np.ndarray:
    return np.stack(
        [
            history[:, -1],
            history[:, -8:].mean(axis=1),
            history[:, -32:].mean(axis=1),
            history[:, -128:].mean(axis=1),
            history.mean(axis=1),
            history[:, -32:].std(axis=1),
            history[:, -32:].max(axis=1),
            history[:, -8:].mean(axis=1) - history[:, -32:].mean(axis=1),
        ],
        axis=1,
    ).astype(np.float32)


@torch.inference_mode()
def forecasts(model: nn.Module, history: np.ndarray, mean: float, std: float) -> np.ndarray:
    outputs = []
    model.eval()
    for start in range(0, len(history), 64):
        batch = torch.from_numpy(((history[start : start + 64] - mean) / std).astype(np.float32))
        result = model(past_values=batch.unsqueeze(-1)).prediction_outputs.squeeze(-1)
        outputs.append((result.numpy() * std + mean).astype(np.float32))
    return np.concatenate(outputs)


def create_head(input_features: int, width: int) -> nn.Module:
    return nn.Sequential(nn.Linear(input_features, width), nn.ReLU(), nn.Linear(width, 3))


def fit_head(
    model: nn.Module,
    train_features: np.ndarray,
    train_labels: np.ndarray,
    validation_features: np.ndarray,
    validation_labels: np.ndarray,
    settings: dict,
) -> tuple[nn.Module, dict]:
    x = torch.from_numpy(train_features)
    y = torch.from_numpy(train_labels)
    vx = torch.from_numpy(validation_features)
    vy = torch.from_numpy(validation_labels)
    optimizer = torch.optim.AdamW(model.parameters(), lr=settings["learning_rate"], weight_decay=settings["weight_decay"])
    loss_fn = nn.CrossEntropyLoss()
    best_loss = float("inf")
    best_state = copy.deepcopy(model.state_dict())
    best_epoch = 0
    records = []
    generator = torch.Generator().manual_seed(settings["seed"])
    for epoch in range(1, settings["epochs"] + 1):
        model.train()
        order = torch.randperm(len(x), generator=generator)
        total_loss = 0.0
        for start in range(0, len(x), settings["batch_size"]):
            selected = order[start : start + settings["batch_size"]]
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(x[selected]), y[selected])
            loss.backward()
            optimizer.step()
            total_loss += float(loss.detach()) * len(selected)
        model.eval()
        with torch.inference_mode():
            validation_loss = float(loss_fn(model(vx), vy))
        records.append({"epoch": epoch, "train_cross_entropy": total_loss / len(x), "validation_cross_entropy": validation_loss})
        if validation_loss < best_loss - 1e-6:
            best_loss = validation_loss
            best_state = copy.deepcopy(model.state_dict())
            best_epoch = epoch
        if epoch - best_epoch >= settings["patience"]:
            break
    model.load_state_dict(best_state)
    model.eval()
    return model, {"best_epoch": best_epoch, "epochs_run": len(records), "best_validation_cross_entropy": best_loss, "history": records}


def metrics(labels: np.ndarray, predictions: np.ndarray) -> dict:
    confusion = np.zeros((3, 3), dtype=np.int64)
    for actual, predicted in zip(labels, predictions, strict=True):
        confusion[actual, predicted] += 1
    f1 = []
    for category in range(3):
        true_positive = int(confusion[category, category])
        denominator = int(confusion[category].sum() + confusion[:, category].sum())
        f1.append(2 * true_positive / denominator if denominator else 0.0)
    return {
        "samples": len(labels),
        "accuracy": float(np.mean(labels == predictions)),
        "macro_f1": float(np.mean(f1)),
        "confusion_rows_actual_columns_predicted": confusion.tolist(),
        "actual_class_counts": np.bincount(labels, minlength=3).tolist(),
    }


def quantize_state(state: dict[str, torch.Tensor]) -> tuple[dict[str, torch.Tensor], dict[str, torch.Tensor], dict]:
    packed = {}
    dequantized = {}
    squared_error = 0.0
    count = 0
    max_error = 0.0
    for name, tensor in state.items():
        source = tensor.detach().cpu().float().contiguous()
        max_abs = float(source.abs().max())
        scale = max_abs / 127.0 if max_abs else 1.0
        quantized = torch.round(source / scale).clamp(-127, 127).to(torch.int8)
        scale_tensor = torch.tensor(scale, dtype=torch.float32)
        restored = quantized.float() * scale_tensor
        error = restored - source
        squared_error += float((error.double() ** 2).sum())
        count += source.numel()
        max_error = max(max_error, float(error.abs().max()))
        packed[f"int8.{name}"] = quantized
        packed[f"scale.{name}"] = scale_tensor
        dequantized[name] = restored
    return packed, dequantized, {
        "parameters_quantized": count,
        "quantized_tensor_count": len(state),
        "raw_int8_payload_bytes": count,
        "float32_scale_bytes": len(state) * 4,
        "raw_fp32_payload_bytes": count * 4,
        "weight_rmse": math.sqrt(squared_error / count),
        "weight_max_absolute_error": max_error,
        "arithmetic": "float32 after int8 round-and-dequantize; not integer inference",
    }


def evaluate_head(head: nn.Module, features: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    with torch.inference_mode():
        logits = head(torch.from_numpy(features)).numpy()
    return logits.argmax(axis=1).astype(np.int64), logits


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", action="store_true", help="Fetch only the pinned public config, safetensors and model card if missing.")
    args = parser.parse_args()
    started = time.perf_counter()
    config = json.loads(CONFIG_PATH.read_text())
    torch.set_num_threads(config["training"]["cpu_threads"])
    torch.manual_seed(config["training"]["seed"])
    torch.use_deterministic_algorithms(True)
    base_path, provenance = fetch_checkpoint(config, args.download)
    base, loading_info = load_verified_base(base_path, config)
    base_parameters = sum(parameter.numel() for parameter in base.parameters())
    if base_parameters != config["expected_base_parameters"]:
        raise ValueError(f"Loaded parameter count mismatch: {base_parameters}")
    splits = {name: synthetic_split(value["count"], value["seed"], config) for name, value in config["synthetic_splits"].items()}
    input_mean = float(splits["train"]["history"].mean())
    input_std = float(splits["train"]["history"].std())
    for name, split in splits.items():
        split["forecast"] = forecasts(base, split["history"], input_mean, input_std)
        split["features"] = np.concatenate([split["forecast"], history_features(split["history"])], axis=1)
        print(f"Frozen pretrained inference: {name} {len(split['labels'])} samples", flush=True)
    feature_mean = splits["train"]["features"].mean(axis=0)
    feature_std = np.maximum(splits["train"]["features"].std(axis=0), 1e-5)
    for split in splits.values():
        split["standard_features"] = ((split["features"] - feature_mean) / feature_std).astype(np.float32)
    train, validation, test = (splits[name] for name in ("train", "validation", "test"))
    head = create_head(train["features"].shape[1], config["head_hidden_width"])
    head, training = fit_head(head, train["standard_features"], train["labels"], validation["standard_features"], validation["labels"], config["training"])
    predictions, logits = evaluate_head(head, test["standard_features"])
    head_parameters = sum(parameter.numel() for parameter in head.parameters())
    # This ablation tests whether the pretrained forecasts help beyond the same
    # eight causal history features. It has the same hidden width and optimizer.
    torch.manual_seed(config["training"]["seed"])
    history_head = create_head(len(HISTORY_FEATURES), config["head_hidden_width"])
    history_head, history_training = fit_head(history_head, train["standard_features"][:, -8:], train["labels"], validation["standard_features"][:, -8:], validation["labels"], config["training"])
    history_predictions, _ = evaluate_head(history_head, test["standard_features"][:, -8:])
    majority_class = int(np.bincount(train["labels"], minlength=3).argmax())
    majority_predictions = np.full_like(test["labels"], majority_class)
    persistence_predictions = np.digitize(test["history"][:, -32:].mean(axis=1), config["synthetic_target_thresholds_bps"]).astype(np.int64)
    forecast_predictions = np.digitize(test["forecast"].mean(axis=1), config["synthetic_target_thresholds_bps"]).astype(np.int64)
    packed_base, dq_base_state, base_quantization = quantize_state(dict(base.state_dict()))
    packed_head, dq_head_state, head_quantization = quantize_state(dict(head.state_dict()))
    quantized_base = copy.deepcopy(base)
    quantized_base.load_state_dict(dq_base_state)
    quantized_head = copy.deepcopy(head)
    quantized_head.load_state_dict(dq_head_state)
    quantized_forecasts = forecasts(quantized_base, test["history"], input_mean, input_std)
    quantized_features = np.concatenate([quantized_forecasts, history_features(test["history"])], axis=1)
    quantized_features = ((quantized_features - feature_mean) / feature_std).astype(np.float32)
    quantized_predictions, quantized_logits = evaluate_head(quantized_head, quantized_features)
    artifacts = ROOT / "model-data" / "adapted"
    artifacts.mkdir(parents=True, exist_ok=True)
    save_file({key: value.detach().contiguous() for key, value in head.state_dict().items()}, str(artifacts / "fee-head.safetensors"))
    save_file({key: value.detach().contiguous() for key, value in history_head.state_dict().items()}, str(artifacts / "history-only-head.safetensors"))
    packed = {f"base.{key}": value for key, value in packed_base.items()}
    packed.update({f"head.{key}": value for key, value in packed_head.items()})
    save_file(packed, str(artifacts / "model-int8-storage.safetensors"), metadata={"scheme": "symmetric per tensor signed int8", "evaluation": "float32 dequantization only"})
    scaler = {"input_mean": input_mean, "input_std": input_std, "feature_mean": feature_mean.tolist(), "feature_std": feature_std.tolist(), "features": [f"pretrained_forecast_{index + 1}" for index in range(config["forecast_length"])] + HISTORY_FEATURES}
    write_json(artifacts / "preprocessing.json", scaler)
    np.savez_compressed(artifacts / "heldout-fixtures.npz", **{name: test[name] for name in ("history", "future", "target", "labels", "forecast", "features", "standard_features")}, logits=logits, quantized_logits=quantized_logits)
    fees = np.array([action["fee_millionths"] for action in config["actions"]], dtype=np.int64)
    predictions_report = {
        "test_seed": config["synthetic_splits"]["test"]["seed"],
        "data_scope": "independent synthetic simulation only",
        "samples": [
            {"index": int(index), "future_mean_volatility_bps": float(test["target"][index]), "target_class": int(test["labels"][index]), "float32_class": int(predictions[index]), "float32_fee_millionths": int(fees[predictions[index]]), "int8_dequantized_class": int(quantized_predictions[index]), "history_only_class": int(history_predictions[index]), "persistence_class": int(persistence_predictions[index])}
            for index in range(len(predictions))
        ],
    }
    write_json(ROOT / "reports" / "model-predictions.json", predictions_report)
    summary = {
        "schema_version": 1,
        "status": "completed local synthetic adaptation experiment",
        "model": provenance,
        "architecture": {"base": "TinyTimeMixerForPrediction; frozen pretrained 512-to-96 numeric forecaster", "adapter": f"104 -> {config['head_hidden_width']} ReLU -> 3 logits; argmax to fixed LP fee tiers", "base_parameters": base_parameters, "trainable_adapter_parameters": head_parameters, "total_parameters": base_parameters + head_parameters, "all_weights_resident_during_float_inference": base_parameters + head_parameters},
        "data": {"type": "synthetic regime-switching volatility observations", "target": "class of the mean observed volatility in the next 96 synthetic time steps", "target_thresholds_bps": config["synthetic_target_thresholds_bps"], "actions": config["actions"], "splits": {name: {**config["synthetic_splits"][name], "history_sha256": array_hash(split["history"]), "future_sha256": array_hash(split["future"]), "class_counts": np.bincount(split["labels"], minlength=3).tolist()} for name, split in splits.items()}, "leakage_controls": ["independent RNG seeds and independently generated samples per split", "all input and feature scaling fit on training data only", "early stopping uses validation only", "test labels never used for training, thresholds, or selection"]},
        "test_metrics": {"adapted_pretrained_float32": metrics(test["labels"], predictions), "adapted_pretrained_int8_dequantized": metrics(test["labels"], quantized_predictions), "trained_history_only_ablation": metrics(test["labels"], history_predictions), "pretrained_forecast_threshold_rule": metrics(test["labels"], forecast_predictions), "trailing_32_volatility_rule": metrics(test["labels"], persistence_predictions), "constant_training_majority": metrics(test["labels"], majority_predictions)},
        "quantization": {"base": base_quantization, "adapter": head_quantization, "total_int8_payload_bytes": base_parameters + head_parameters, "packed_file_bytes": (artifacts / "model-int8-storage.safetensors").stat().st_size, "float32_action_agreement": float(np.mean(predictions == quantized_predictions)), "changed_actions": int(np.count_nonzero(predictions != quantized_predictions)), "forecast_rmse_bps": float(np.sqrt(np.mean((quantized_forecasts - test["forecast"]) ** 2))), "logit_rmse": float(np.sqrt(np.mean((quantized_logits - logits) ** 2))), "limitation": "Storage compression and rounded-dequantized sensitivity only; inference still uses float32 operations and activations."},
        "training": {key: value for key, value in training.items() if key != "history"},
        "history_ablation_training": {key: value for key, value in history_training.items() if key != "history"},
        "validation": {"all_actions_in_allowlist": bool(np.isin(fees[predictions], fees).all()), "all_quantized_actions_in_allowlist": bool(np.isin(fees[quantized_predictions], fees).all()), "all_logits_finite": bool(np.isfinite(logits).all() and np.isfinite(quantized_logits).all()), "checkpoint_parameter_count_matches": base_parameters == config["expected_base_parameters"], "base_checkpoint_unchanged": sha256(base_path / "model.safetensors") == provenance["source_files"]["model.safetensors"]["sha256"], "source_sha256_enforced": True, "strict_loading_info": loading_info},
        "environment": {"python": platform.python_version(), "platform": platform.platform(), "packages": {name: importlib.metadata.version(name) for name in ("torch", "transformers", "granite-tsfm", "numpy", "safetensors")}, "cpu_threads": torch.get_num_threads(), "deterministic_algorithms": torch.are_deterministic_algorithms_enabled()},
        "artifact_hashes": {str(path.relative_to(ROOT)): {"sha256": sha256(path), "bytes": path.stat().st_size} for path in sorted(artifacts.iterdir()) if path.is_file()},
        "limitations": ["Synthetic-only numeric target; no real pool data or financial/economic objective.", "Chosen fee tiers are illustrative labels, not optimized market fees.", "No validation of profitability, LP loss reduction, adversarial manipulation resistance, or routing behaviour.", "Training and inference here run offline on CPU; pretrained weights alone do not establish native integer inference.", "This 812k-class model is a research candidate; no claim that its 512-step inference fits an atomic swap gas budget.", "Results compare fixed supplied seeds; they do not establish broad statistical significance."],
        "elapsed_seconds": time.perf_counter() - started,
    }
    write_json(ROOT / "reports" / "model-training.json", {"adapter": training, "history_only_ablation": history_training})
    write_json(ROOT / "reports" / "model-benchmark.json", summary)
    print(json.dumps({"parameters": summary["architecture"], "test_metrics": summary["test_metrics"], "quantization_agreement": summary["quantization"]["float32_action_agreement"], "elapsed_seconds": summary["elapsed_seconds"]}, indent=2), flush=True)


if __name__ == "__main__":
    main()
