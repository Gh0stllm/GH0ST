"""Hash-pinned experimental INT8 weight storage, not full integer inference."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Mapping

import numpy as np
import torch


FORMAT = "gh0st-s0ul-int8-v1"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def quantize_rows(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Symmetric rowwise INT8, nearest ties away from zero, FP32 scales."""
    values = np.asarray(values, dtype=np.float32)
    if values.ndim != 2 or not all(values.shape) or not np.all(np.isfinite(values)):
        raise ValueError("quantization requires a nonempty finite matrix")
    maximum = np.max(np.abs(values), axis=1)
    scales = np.where(maximum == 0, np.float32(1.0), maximum / np.float32(127.0)).astype("<f4")
    if not np.all(np.isfinite(scales)) or np.any(scales <= 0):
        raise ValueError("float32 scale underflow or overflow")
    normalized = values / scales[:, None]
    q = np.sign(normalized) * np.floor(np.abs(normalized) + np.float32(0.5))
    return np.clip(q, -127, 127).astype(np.int8), scales


def _safe_file(root: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or Path(name).name != name:
        raise ValueError("artifact names must be plain basenames")
    path = root / name
    if path.is_symlink():
        raise ValueError("artifact must not be a symlink")
    return path


def export_state(state: Mapping[str, torch.Tensor], config: dict[str, Any],
                 output_dir: str | Path, shard_bytes: int = 90000,
                 source_checkpoint_sha256: str | None = None,
                 tokenizer: dict[str, Any] | None = None) -> dict[str, Any]:
    if not 1 <= shard_bytes <= 90000:
        raise ValueError("shard size must be between 1 and 90000 bytes")
    root = Path(output_dir)
    root.mkdir(parents=True, exist_ok=True)
    payload = bytearray()
    tensors = []
    for name, tensor in sorted(state.items()):
        if not isinstance(tensor, torch.Tensor):
            raise ValueError(f"state value {name} is not a tensor")
        values = tensor.detach().cpu().to(torch.float32).numpy()
        if values.ndim not in (1, 2) or not values.size or not np.all(np.isfinite(values)):
            raise ValueError(f"unsupported or nonfinite tensor: {name}")
        offset = len(payload)
        entry: dict[str, Any] = {"name": name, "shape": list(values.shape),
                                 "parameter_count": int(values.size), "offset": offset}
        if values.ndim == 2:
            q, scales = quantize_rows(values)
            encoded = q.tobytes(order="C") + scales.tobytes(order="C")
            entry.update(encoding="int8-rowwise-f32-scales", values_dtype="int8",
                         values_nbytes=int(q.nbytes), scales_dtype="float32-le",
                         scales_offset=offset + int(q.nbytes), scales_count=int(values.shape[0]))
        else:
            encoded = values.astype("<f4").tobytes(order="C")
            entry.update(encoding="float32-le", values_dtype="float32-le")
        entry.update(nbytes=len(encoded), sha256=sha256(encoded))
        payload.extend(encoded)
        tensors.append(entry)
    if not tensors:
        raise ValueError("empty model state")
    data = bytes(payload)
    _safe_file(root, "weights.bin").write_bytes(data)
    shards = []
    for i, offset in enumerate(range(0, len(data), shard_bytes)):
        block = data[offset:offset + shard_bytes]
        name = f"shard-{i:03d}.bin"
        _safe_file(root, name).write_bytes(block)
        shards.append({"path": name, "offset": offset, "nbytes": len(block), "sha256": sha256(block)})
    manifest = {
        "format": FORMAT, "model": "GH0ST S0UL-1M", "config": config,
        "stage": "experimental-weight-export",
        "full_integer_inference": False,
        "source_checkpoint_sha256": source_checkpoint_sha256,
        "tokenizer": tokenizer,
        "parameter_count": sum(t["parameter_count"] for t in tensors),
        "payload": {"path": "weights.bin", "nbytes": len(data), "sha256": sha256(data)},
        "quantization": {"weights": "symmetric INT8 per output row",
                         "rounding": "nearest, ties away from zero",
                         "scales": "IEEE754 float32 little endian",
                         "norm_gains": "IEEE754 float32 little endian",
                         "activation_arithmetic": "not specified by this weight export"},
        "tensors": tensors, "shard_payload_limit_bytes": shard_bytes, "shards": shards,
        "limitations": ["Scales and normalization gains remain float32.",
                        "Quantize/dequantize quality uses floating-point activations.",
                        "Shard bytes are payload, not deployed contract code or gas measurements.",
                        "No public-chain transaction is performed by the exporter."],
    }
    _safe_file(root, "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    verify_export(root / "manifest.json")
    return manifest


def export_checkpoint(checkpoint_path: str | Path, output_dir: str | Path,
                      shard_bytes: int = 90000) -> dict[str, Any]:
    checkpoint_path = Path(checkpoint_path)
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    if not isinstance(checkpoint, dict) or not isinstance(checkpoint.get("config"), dict):
        raise ValueError("checkpoint requires config and model_state_dict")
    state = checkpoint.get("model_state_dict")
    if not isinstance(state, dict):
        raise ValueError("checkpoint requires model_state_dict")
    from .tokenizer import S0ULTokenizer
    tokenizer = checkpoint.get("tokenizer")
    if tokenizer != S0ULTokenizer().spec():
        raise ValueError("checkpoint tokenizer differs from the installed frozen specification")
    from .model import ModelConfig, S0ULModel
    config = ModelConfig(**checkpoint["config"])
    if config.vocab_size != tokenizer["vocab_size"]:
        raise ValueError("checkpoint model vocabulary differs from tokenizer")
    # Strict loading validates every expected state name and tensor shape.
    validator = S0ULModel(config)
    validator.load_state_dict(state, strict=True)
    return export_state(state, checkpoint["config"], output_dir, shard_bytes,
                        sha256(checkpoint_path.read_bytes()), tokenizer)


def verify_export(manifest_path: str | Path) -> dict[str, Any]:
    """Verify hashes, dimensions, offsets, scales and exact shard reconstruction."""
    manifest_path = Path(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    root = manifest_path.parent
    if manifest.get("format") != FORMAT or manifest.get("full_integer_inference") is not False:
        raise ValueError("unsupported or misleading export format")
    payload_meta = manifest["payload"]
    payload = _safe_file(root, payload_meta["path"]).read_bytes()
    if len(payload) != payload_meta["nbytes"] or sha256(payload) != payload_meta["sha256"]:
        raise ValueError("payload hash or length mismatch")
    expected_offset = count = 0
    seen = set()
    for tensor in manifest["tensors"]:
        shape = tensor["shape"]
        if tensor["name"] in seen or not shape or any(not isinstance(n, int) or n <= 0 for n in shape):
            raise ValueError("duplicate name or invalid tensor shape")
        seen.add(tensor["name"])
        size = math.prod(shape)
        if size != tensor["parameter_count"] or tensor["offset"] != expected_offset:
            raise ValueError("parameter count or tensor offset mismatch")
        nbytes = tensor["nbytes"]
        block = payload[expected_offset:expected_offset + nbytes]
        if len(block) != nbytes or sha256(block) != tensor["sha256"]:
            raise ValueError("tensor hash or length mismatch")
        encoding = tensor["encoding"]
        if encoding == "int8-rowwise-f32-scales":
            if len(shape) != 2 or nbytes != size + 4 * shape[0]:
                raise ValueError("invalid quantized tensor layout")
            if (tensor["values_nbytes"] != size or tensor["scales_count"] != shape[0]
                    or tensor["scales_offset"] != expected_offset + size
                    or tensor["values_dtype"] != "int8" or tensor["scales_dtype"] != "float32-le"):
                raise ValueError("invalid scale metadata")
            q = np.frombuffer(block[:size], dtype=np.int8)
            scales = np.frombuffer(block[size:], dtype="<f4")
            if np.any(q == -128) or np.any(scales <= 0) or not np.all(np.isfinite(scales)):
                raise ValueError("invalid quantized values or scales")
        elif encoding == "float32-le":
            if len(shape) != 1 or nbytes != size * 4 or tensor["values_dtype"] != "float32-le":
                raise ValueError("invalid float tensor layout")
            if not np.all(np.isfinite(np.frombuffer(block, dtype="<f4"))):
                raise ValueError("nonfinite norm gain")
        else:
            raise ValueError("unknown tensor encoding")
        expected_offset += nbytes
        count += size
    if not seen or expected_offset != len(payload) or count != manifest["parameter_count"]:
        raise ValueError("payload coverage or total parameter count mismatch")
    shard_offset = 0
    limit = manifest["shard_payload_limit_bytes"]
    if not isinstance(limit, int) or not 1 <= limit <= 90000:
        raise ValueError("invalid shard payload limit")
    shard_names = set()
    for shard in manifest["shards"]:
        block = _safe_file(root, shard["path"]).read_bytes()
        if shard["path"] in shard_names:
            raise ValueError("duplicate shard path")
        shard_names.add(shard["path"])
        if (shard["offset"] != shard_offset or not 0 < len(block) <= limit
                or len(block) != shard["nbytes"] or sha256(block) != shard["sha256"]
                or payload[shard_offset:shard_offset + len(block)] != block):
            raise ValueError("shard hash, coverage or payload mismatch")
        shard_offset += len(block)
    if shard_offset != len(payload):
        raise ValueError("shards do not cover payload")
    return manifest


def load_exported_state(manifest_path: str | Path) -> tuple[dict[str, Any], dict[str, torch.Tensor]]:
    manifest_path = Path(manifest_path)
    manifest = verify_export(manifest_path)
    payload = (manifest_path.parent / manifest["payload"]["path"]).read_bytes()
    state = {}
    for tensor in manifest["tensors"]:
        start, size = tensor["offset"], tensor["parameter_count"]
        if tensor["encoding"] == "int8-rowwise-f32-scales":
            q = np.frombuffer(payload, dtype=np.int8, count=size, offset=start).reshape(tensor["shape"])
            scales = np.frombuffer(payload, dtype="<f4", count=tensor["scales_count"], offset=tensor["scales_offset"])
            values = q.astype(np.float32) * scales[:, None]
        else:
            values = np.frombuffer(payload, dtype="<f4", count=size, offset=start).reshape(tensor["shape"]).copy()
        state[tensor["name"]] = torch.from_numpy(values.copy())
    return manifest["config"], state


def model_from_export(manifest_path: str | Path):
    from .model import ModelConfig, S0ULModel
    manifest = verify_export(manifest_path)
    if manifest.get("tokenizer") is not None:
        from .tokenizer import S0ULTokenizer
        if manifest["tokenizer"] != S0ULTokenizer().spec():
            raise ValueError("export tokenizer differs from the installed frozen specification")
    config, state = load_exported_state(manifest_path)
    model = S0ULModel(ModelConfig(**config))
    model.load_state_dict(state, strict=True)
    model.eval()
    return model


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--checkpoint", type=Path)
    source.add_argument("--verify", type=Path)
    parser.add_argument("--output", type=Path, default=Path("exports/pilot"))
    parser.add_argument("--shard-bytes", type=int, default=90000)
    args = parser.parse_args()
    if args.verify:
        manifest = verify_export(args.verify)
    else:
        manifest = export_checkpoint(args.checkpoint, args.output, args.shard_bytes)
    print(json.dumps({"format": manifest["format"], "parameter_count": manifest["parameter_count"],
                      "payload_bytes": manifest["payload"]["nbytes"], "shards": len(manifest["shards"]),
                      "full_integer_inference": False, "verified": True}, sort_keys=True))


if __name__ == "__main__":
    main()
