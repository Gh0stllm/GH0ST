"""Export every learned GPT-2 parameter for the resumable BSC integer runtime.

No downloading, retraining, pruning, or broadcasting.  Matrix weights are
row-wise symmetric INT8; all other learned values are Q12 signed integers.
The exported model is an approximation to the pinned pretrained checkpoint.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np
from safetensors import safe_open

ROOT = Path(__file__).resolve().parent
CACHE = Path(os.environ.get("GH0ST_MODEL_CACHE") or str(ROOT.parent / "model-cache"))
CHECKPOINT_SHA256 = "248dfc3911869ec493c76e65bf2fcf7f615828b0254c12b473182f0f81d3a707"
REVISION = "607a30d783dfa663caf39e06633721c8d4cfcd7e"
PARAMETERS = 124439808
Q = 4096
SCALE = 1 << 24


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def export(output: Path) -> dict:
    checkpoint = CACHE / "model.safetensors"
    with checkpoint.open("rb") as handle:
        actual_sha256 = hashlib.file_digest(handle, "sha256").hexdigest()
    if actual_sha256 != CHECKPOINT_SHA256:
        raise ValueError("Pinned GPT-2 checkpoint hash mismatch")
    output.mkdir(parents=True, exist_ok=True)
    (output / "tensors").mkdir(exist_ok=True)
    tensors = []
    used = set()
    quantization = []
    learned_count = 0

    with safe_open(checkpoint, framework="np") as weights:
        def learned(name: str) -> np.ndarray:
            nonlocal learned_count
            if name in used:
                raise ValueError(f"Parameter exported twice: {name}")
            used.add(name)
            value = weights.get_tensor(name).astype(np.float64)
            learned_count += value.size
            return value

        def save(name: str, kind: str, rows: int, width: int, row_bytes: int,
                 payload: bytes, source_names: list[str], details: dict | None = None):
            index = len(tensors)
            assert len(payload) == rows * row_bytes
            relative = f"tensors/{index:03d}-{name}.bin"
            (output / relative).write_bytes(payload)
            per_shard = 24575 // row_bytes
            assert per_shard > 0
            shards = []
            for first in range(0, rows, per_shard):
                count = min(per_shard, rows - first)
                offset = first * row_bytes
                length = count * row_bytes
                runtime = b"\x00" + payload[offset:offset + length]
                shards.append({"file": relative, "offset": offset, "length": length,
                               "first_row": first, "rows": count,
                               "runtime_bytes": len(runtime), "runtime_sha256": sha256(runtime)})
            item = {"id": index, "name": name, "kind": kind, "rows": rows,
                    "width": width, "row_bytes": row_bytes, "rows_per_shard": per_shard,
                    "file": relative, "bytes": len(payload), "sha256": sha256(payload),
                    "source_tensors": source_names, "shards": shards}
            item["catalog"] = {"address_bytes": 32, "addresses_per_page": 767,
                               "paged": len(shards) > 767,
                               "pages": (len(shards) + 766) // 767 if len(shards) > 767 else 0}
            if details:
                item.update(details)
            tensors.append(item)
            print(json.dumps({"id": index, "name": name, "bytes": len(payload),
                              "shards": len(shards)}), flush=True)

        def matrix(name: str, source: str, bias_source: str | None = None,
                   transpose: bool = True):
            value = learned(source)
            if transpose:
                value = value.T.copy()
            rows, width = value.shape
            # Derive codes from the original floating scale, then store that
            # scale as Q24. Both conversions use NumPy round-to-nearest-even.
            scale_float = np.max(np.abs(value), axis=1) / 127.0
            scale_float = np.where(scale_float == 0, 1.0 / SCALE, scale_float)
            scale_q24 = np.maximum(1, np.rint(scale_float * SCALE)).astype(np.uint32)
            codes = np.clip(np.rint(value / scale_float[:, None]), -127, 127).astype(np.int8)
            decoded = codes.astype(np.float64) * (scale_q24.astype(np.float64) / SCALE)[:, None]
            error = decoded - value
            quantization.append({"tensor": source, "max_absolute_error": float(np.max(np.abs(error))),
                                 "root_mean_square_error": float(np.sqrt(np.mean(error * error))),
                                 "original_rms": float(np.sqrt(np.mean(value * value))),
                                 "minimum_scale_q24": int(scale_q24.min()),
                                 "maximum_scale_q24": int(scale_q24.max())})
            if bias_source:
                bias = np.rint(learned(bias_source) * Q).astype(">i4")
                assert bias.shape == (rows,)
                raw = np.empty((rows, width + 8), dtype=np.uint8)
                raw[:, :4] = bias.view(np.uint8).reshape(rows, 4)
                raw[:, 4:8] = scale_q24.astype(">u4").view(np.uint8).reshape(rows, 4)
                raw[:, 8:] = codes.view(np.uint8)
                save(name, "linear", rows, width, width + 8, raw.tobytes(),
                     [source, bias_source], {"record": "bias:i32be,scale:u32be,weights:i8[width]"})
            else:
                raw = np.empty((rows, width + 4), dtype=np.uint8)
                raw[:, :4] = scale_q24.astype(">u4").view(np.uint8).reshape(rows, 4)
                raw[:, 4:] = codes.view(np.uint8)
                save(name, "embedding", rows, width, width + 4, raw.tobytes(), [source],
                     {"record": "scale:u32be,weights:i8[width]", "tied_lm_head": True})

        def layernorm(name: str, prefix: str):
            gamma_name, beta_name = prefix + ".weight", prefix + ".bias"
            values = np.concatenate([learned(gamma_name), learned(beta_name)])
            payload = np.rint(values * Q).astype(">i4").tobytes()
            save(name, "layernorm", 1, 768, 6144, payload, [gamma_name, beta_name],
                 {"record": "gamma:i32be[768],beta:i32be[768]"})

        matrix("wte", "wte.weight", transpose=False)
        positions = learned("wpe.weight")
        save("wpe", "position", 1024, 768, 3072,
             np.rint(positions * Q).astype(">i4").tobytes(), ["wpe.weight"],
             {"record": "position:i32be[768]"})
        layernorm("lnf", "ln_f")
        for layer in range(12):
            prefix = f"h.{layer}"
            layernorm(f"layer{layer}-ln1", prefix + ".ln_1")
            layernorm(f"layer{layer}-ln2", prefix + ".ln_2")
            for suffix, original in [("qkv", ".attn.c_attn"), ("attnout", ".attn.c_proj"),
                                     ("fc", ".mlp.c_fc"), ("proj", ".mlp.c_proj")]:
                matrix(f"layer{layer}-{suffix}", prefix + original + ".weight",
                       prefix + original + ".bias")
        ignored_buffers = sorted(set(weights.keys()) - used)
        if learned_count != PARAMETERS:
            raise ValueError(f"Expected {PARAMETERS} unique parameters; got {learned_count}")
        if any(not name.endswith(".attn.bias") for name in ignored_buffers):
            raise ValueError(f"Unexpected unexported source tensors: {ignored_buffers}")

    exp = np.array([round(math.exp(-i / 256) * SCALE) for i in range(4097)], dtype=">u4")
    tanh = np.array([round(math.tanh(i / 256) * Q) for i in range(2049)], dtype=">u2")
    save("exp", "exp_lut", 1, 4097, len(exp.tobytes()), exp.tobytes(), [],
         {"record": "exp_negative:u32be[4097]"})
    save("tanh", "tanh_lut", 1, 2049, len(tanh.tobytes()), tanh.tobytes(), [],
         {"record": "tanh_positive:u16be[2049]"})
    assert len(tensors) == 77
    manifest = {"schema_version": 1, "status": "FULL_PINNED_GPT2_INT8_EXPORT",
                "model_id": "openai-community/gpt2", "revision": REVISION,
                "checkpoint_sha256": CHECKPOINT_SHA256, "unique_parameter_count": learned_count,
                "architecture": {"layers": 12, "width": 768, "heads": 12, "head_width": 64,
                                 "vocabulary": 50257, "context_tokens": 1024,
                                 "mlp_width": 3072, "tied_input_output_embedding": True},
                "quantization": {"matrix_codes": "symmetric signed INT8 [-127,127], row-wise",
                                 "matrix_scales": "unsigned Q24", "other_learned_values": "signed Q12",
                                 "export_rounding": "nearest, ties to even", "pruned_parameters": 0,
                                 "retrained": False, "distilled": False,
                                 "matrix_error_statistics": quantization},
                "runtime_arithmetic": {"activation_fraction_bits": 12, "scale_fraction_bits": 24,
                    "signed_division": "truncate toward zero", "layernorm_epsilon_q24": 168,
                    "layernorm_mean": "trunc0(sum(x)/768)",
                    "layernorm_variance": "floor(sum((x-mean)^2)/768)",
                    "layernorm_denominator": "floor_sqrt(variance+168)",
                    "layernorm_output": "trunc0(trunc0((x-mean)*4096/denom)*gamma/4096)+beta",
                    "linear_output": "trunc0(dot(x,weights_i8)*scale_q24/16777216)+bias_q12",
                    "embedding_output": "trunc0(weight_i8*scale_q24/4096)+position_q12",
                    "attention_score": "trunc0(dot(q,k)/(8*4096))",
                    "softmax": "stable exp table; index=floor((max-score)/16); difference>65536 -> 0",
                    "attention_output": "trunc0(sum(exp_q24*value_q12)/sum(exp_q24))",
                    "gelu": "x2=trunc0(x*x/4096); x3=trunc0(x2*x/4096); inner=trunc0((x+trunc0(x3*183/4096))*3268/4096); t=sign(inner)*tanh[floor(abs(inner)/16)], clamped to4096 if index>=2048; trunc0(x*(4096+t)/8192)",
                    "argmax": "full 50257 vocabulary; smallest token id wins ties"},
                "storage": {"data_runtime_prefix": "00", "max_runtime_bytes": 24576,
                            "root_catalog": "STOP,77 tensor catalog addresses left-padded to32bytes",
                            "tensor_catalog": "STOP,shard addresses left-padded to32bytes; if more than767shards,STOP,page addresses,eachpage atmost767shard addresses",
                            "payload_bytes": sum(t["bytes"] for t in tensors),
                            "data_shards": sum(len(t["shards"]) for t in tensors),
                            "data_runtime_bytes": sum(s["runtime_bytes"] for t in tensors for s in t["shards"])},
                "ignored_nonlearned_checkpoint_buffers": ignored_buffers,
                "tokenizer": {"execution": "off-chain preprocessing only", "files": {}},
                "tensors": tensors,
                "limitations": ["INT8 and fixed-point nonlinearities approximate the original FP32 checkpoint.",
                                "This manifest proves export coverage, not end-to-end EVM execution.",
                                "No chain transactions or deployment occurred in this script."]}
    for name in ["tokenizer.json", "vocab.json", "merges.txt", "tokenizer_config.json"]:
        raw = (CACHE / name).read_bytes()
        manifest["tokenizer"]["files"][name] = {"bytes": len(raw), "sha256": sha256(raw)}
    identity = {"checkpoint_sha256": manifest["checkpoint_sha256"],
                "architecture": manifest["architecture"],
                "runtime_arithmetic": manifest["runtime_arithmetic"],
                "tensor_sha256s_in_id_order": [t["sha256"] for t in tensors]}
    manifest["model_id_hash"] = "0x" + sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode())
    manifest["model_id_hash_algorithm"] = "SHA256(canonical JSON checkpoint_sha256,architecture,runtime_arithmetic,tensor_sha256s_in_id_order)"
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT.parent / "data")
    args = parser.parse_args()
    manifest = export(args.output)
    print(json.dumps({"status": manifest["status"], "parameters": manifest["unique_parameter_count"],
                      **manifest["storage"]}, indent=2))
