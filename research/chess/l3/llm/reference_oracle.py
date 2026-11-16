# Independent NumPy oracle reused from the earlier complete TinyStories port.
# Runtime code is a separate C++ implementation; this file is test-only.
"""Independent NumPy integer GPT-2 oracle, with a complete incremental KV cache.

The oracle consumes the full exported model, never an EVM intermediate. FP32
comparison uses the pinned upstream checkpoint separately. Tokenization is
explicitly local preprocessing; these scripts have no public-chain signer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import time

import numpy as np

ROOT = Path(__file__).resolve().parent
CACHE = ROOT.parent / "quality" / "tinystories1m"
Q = 4096
SCALE = 1 << 24
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")


def trunc0(numerator, denominator):
    """Signed division matching EVM SDIV, on values known to fit int64."""
    if np.isscalar(numerator) and np.isscalar(denominator):
        numerator, denominator = int(numerator), int(denominator)
        if denominator <= 0:
            raise ValueError("positive denominator required")
        return -(abs(numerator) // denominator) if numerator < 0 else numerator // denominator
    a, b = np.asarray(numerator, dtype=np.int64), np.asarray(denominator, dtype=np.int64)
    if np.any(b <= 0):
        raise ValueError("positive denominator required")
    return np.sign(a) * (np.abs(a) // b)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Trace:
    def __init__(self, root: Path, case: str, position: int):
        self.root, self.case, self.position = root, case, position
        self.stages = {}

    def put(self, name: str, value: np.ndarray, phase: int | None = None,
            vector: int | None = None, layer: int | None = None, head: int | None = None):
        value = np.asarray(value, dtype=np.int64)
        if value.min() < -(1 << 31) or value.max() >= 1 << 31:
            raise OverflowError(f"Trace does not fit int32: {name}")
        relative = f"reference-vectors/{self.case}/p{self.position:04d}-{name}.bin"
        output = self.root / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        payload = value.astype(">i4").tobytes()
        output.write_bytes(payload)
        self.stages[name] = {"file": relative, "count": int(value.size), "dtype": "i32be",
                             "sha256": sha256(payload), "minimum": int(value.min()),
                             "maximum": int(value.max()), "completed_phase": phase,
                             "vector_id": vector, "layer": layer, "head": head}


class IntegerNeo:
    def __init__(self, data: Path = ROOT / "data", verify_hashes: bool = True):
        self.data = data
        self.manifest = json.loads((data / "manifest.json").read_text())
        self.tensors = []
        for tensor in self.manifest["tensors"]:
            payload = (data / tensor["file"]).read_bytes()
            if verify_hashes and sha256(payload) != tensor["sha256"]:
                raise ValueError(f"Export hash mismatch: {tensor['name']}")
            width, kind = tensor["width"], tensor["kind"]
            if kind == "linear":
                dtype = np.dtype([("bias", ">i4"), ("scale", ">u4"), ("weights", "i1", (width,))])
                records = np.frombuffer(payload, dtype=dtype)
                item = {"bias": records["bias"].astype(np.int64),
                        "scale": records["scale"].astype(np.int64),
                        "weights": records["weights"]}
            elif kind == "embedding":
                dtype = np.dtype([("scale", ">u4"), ("weights", "i1", (width,))])
                records = np.frombuffer(payload, dtype=dtype)
                item = {"scale": records["scale"].astype(np.int64), "weights": records["weights"]}
            elif kind == "layernorm":
                decoded = np.frombuffer(payload, dtype=">i4").astype(np.int64)
                item = {"gamma": decoded[:64], "beta": decoded[64:]}
            elif kind == "position":
                item = np.frombuffer(payload, dtype=">i4").astype(np.int64).reshape(2048, 64)
            elif kind == "exp_lut":
                item = np.frombuffer(payload, dtype=">u4").astype(np.int64)
            elif kind == "tanh_lut":
                item = np.frombuffer(payload, dtype=">u2").astype(np.int64)
            else:
                raise ValueError(kind)
            self.tensors.append(item)
        self.reset()

    def reset(self):
        self.position = 0
        self.keys = np.zeros((8, 64, 16, 4), dtype=np.int64)
        self.values = np.zeros_like(self.keys)

    def embedding(self, token_id: int) -> np.ndarray:
        table = self.tensors[0]
        row = table["weights"][token_id].astype(np.int64)
        return trunc0(row * table["scale"][token_id], Q) + self.tensors[1][self.position]

    def layernorm(self, x: np.ndarray, tensor_id: int) -> np.ndarray:
        tensor = self.tensors[tensor_id]
        mean = trunc0(int(x.sum()), 64)
        delta = x - mean
        variance = int(np.dot(delta, delta)) // 64
        denom = math.isqrt(variance + 168)
        normalized = trunc0(delta * Q, denom)
        return trunc0(normalized * tensor["gamma"], Q) + tensor["beta"]

    def linear(self, x: np.ndarray, tensor_id: int) -> np.ndarray:
        tensor = self.tensors[tensor_id]
        dot = tensor["weights"] @ x
        return trunc0(dot * tensor["scale"], SCALE) + tensor["bias"]

    def gelu(self, x: np.ndarray) -> np.ndarray:
        x2 = trunc0(x * x, Q)
        x3 = trunc0(x2 * x, Q)
        inner = trunc0((x + trunc0(x3 * 183, Q)) * 3268, Q)
        index = np.abs(inner) // 16
        lookup = self.tensors[52][np.minimum(index, 2048)]
        lookup = np.where(index >= 2048, Q, lookup)
        tanh = np.sign(inner) * lookup
        return trunc0(x * (Q + tanh), 2 * Q)

    def attention(self, qkv: np.ndarray, layer: int, trace: Trace | None) -> np.ndarray:
        q, k, v = qkv.reshape(3, 16, 4)
        self.keys[layer, self.position] = k
        self.values[layer, self.position] = v
        count = self.position + 1
        output = np.zeros((16, 4), dtype=np.int64)
        all_scores = []
        for head in range(16):
            scores = trunc0(self.keys[layer, :count, head] @ q[head], Q)
            maximum = int(scores.max())
            difference = maximum - scores
            index = np.minimum(difference // 16, 4096)
            exponential = np.where(difference > 65536, 0, self.tensors[51][index])
            weighted = exponential @ self.values[layer, :count, head]
            output[head] = trunc0(weighted, int(exponential.sum()))
            all_scores.append(scores)
            if trace:
                trace.put(f"l{layer:02d}-scores-h{head:02d}", scores, 4, 5, layer, head)
        if trace:
            trace.put(f"l{layer:02d}-scores", np.concatenate(all_scores), 4, 5, layer)
        return output.reshape(64)

    def logits(self, x: np.ndarray) -> np.ndarray:
        tensor = self.tensors[0]
        return trunc0((tensor["weights"] @ x) * tensor["scale"], SCALE)

    def step(self, token_id: int, trace: Trace | None = None) -> np.ndarray:
        if token_id < 0 or token_id >= 50257:
            raise ValueError("token outside GPT-2 vocabulary")
        if self.position >= 64:
            raise ValueError("GPT-2 context is full; start a new session")
        x = self.embedding(token_id)
        if trace:
            trace.put("embedding", x, 1, 0)
        for layer in range(8):
            first = 3 + layer * 6
            n = self.layernorm(x, first)
            if trace:
                trace.put(f"l{layer:02d}-ln1", n, 2, 1, layer)
            qkv = self.linear(n, first + 2)
            if trace:
                trace.put(f"l{layer:02d}-qkv", qkv, 3, 2, layer)
            attention = self.attention(qkv, layer, trace)
            if trace:
                trace.put(f"l{layer:02d}-attention", attention, 5, 3, layer, 15)
            projected = self.linear(attention, first + 3)
            if trace:
                trace.put(f"l{layer:02d}-attnout", projected)
            x = x + projected
            if trace:
                trace.put(f"l{layer:02d}-residual1", x, 6, 0, layer)
            n = self.layernorm(x, first + 1)
            if trace:
                trace.put(f"l{layer:02d}-ln2", n, 7, 1, layer)
            fc = self.linear(n, first + 4)
            if trace:
                trace.put(f"l{layer:02d}-fc", fc)
            gelu = self.gelu(fc)
            if trace:
                trace.put(f"l{layer:02d}-gelu", gelu, 8, 4, layer)
            projected = self.linear(gelu, first + 5)
            if trace:
                trace.put(f"l{layer:02d}-proj", projected)
            x = x + projected
            if trace:
                trace.put(f"l{layer:02d}-residual2", x, 9, 0, layer)
        n = self.layernorm(x, 2)
        if trace:
            trace.put("final-ln", n, 10, 1, 8)
        logits = self.logits(n)
        if trace:
            trace.put("logits", logits, 11, None, 8)
        self.position += 1
        return logits
