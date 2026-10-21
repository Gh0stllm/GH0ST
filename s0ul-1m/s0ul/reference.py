"""Independent arithmetic references. This is not a full integer transformer."""

from __future__ import annotations

import math
from typing import Mapping, Sequence

import numpy as np


def round_divide(numerator: int, denominator: int) -> int:
    """Divide integers with round-to-nearest, exact ties away from zero."""
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    magnitude = (abs(int(numerator)) + denominator // 2) // denominator
    return magnitude if numerator >= 0 else -magnitude


def dot_int8_int16(weights: Sequence[int], activations: Sequence[int]) -> int:
    """Exact signed dot product, checked against the intended EVM ranges."""
    if len(weights) != len(activations):
        raise ValueError("dot-product lengths differ")
    total = 0
    for weight, activation in zip(weights, activations):
        if not isinstance(weight, (int, np.integer)) or not -127 <= weight <= 127:
            raise ValueError("weight outside symmetric INT8 range")
        if not isinstance(activation, (int, np.integer)) or not -32768 <= activation <= 32767:
            raise ValueError("activation outside INT16 range")
        total += int(weight) * int(activation)
    if not -(1 << 255) <= total < (1 << 255):
        raise OverflowError("accumulator exceeds signed 256 bits")
    return total


def requantize(accumulator: int, multiplier: int, shift: int,
               minimum: int = -32768, maximum: int = 32767) -> int:
    """Integer multiply/shift, nearest ties-away rounding, then saturation.

    The multiplier and shift are supplied by the caller. The current exporter
    does not derive a transformer-wide integer activation scaling scheme.
    """
    if shift < 0 or shift > 255 or multiplier < 0 or minimum > maximum:
        raise ValueError("invalid requantization parameters")
    product = int(accumulator) * int(multiplier)
    if not -(1 << 255) <= product < (1 << 255):
        raise OverflowError("requantization product exceeds signed 256 bits")
    return min(maximum, max(minimum, round_divide(product, 1 << shift)))


def forward_float(tokens: Sequence[int], state: Mapping[str, np.ndarray],
                  config: Mapping[str, int | float]) -> np.ndarray:
    """NumPy float32 causal forward reference; return [sequence, vocabulary].

    This independently reproduces model.py for parity checks, including
    float RMSNorm, rotary positions, attention softmax and ReLU. It is
    explicitly a FLOAT reference, not on-chain integer inference.
    """
    ids = np.asarray(tokens, dtype=np.int64)
    if ids.ndim != 1 or len(ids) == 0:
        raise ValueError("tokens must be a nonempty one-dimensional sequence")
    if len(ids) > int(config["max_seq_len"]):
        raise ValueError("context limit exceeded")
    vocab = int(config["vocab_size"])
    if np.any(ids < 0) or np.any(ids >= vocab):
        raise ValueError("token outside vocabulary")
    d, heads = int(config["dim"]), int(config["n_heads"])
    if d % heads or (d // heads) % 2:
        raise ValueError("head dimension must be even")
    head_dim = d // heads
    eps = float(config.get("rms_eps", 1e-5))
    embed = np.asarray(state["token_embedding.weight"], dtype=np.float32)
    x = embed[ids].copy()
    inv = np.float32(1.0) / np.power(
        np.float32(10000.0), np.arange(0, head_dim, 2, dtype=np.float32) / head_dim)
    angles = np.arange(len(ids), dtype=np.float32)[:, None] * inv[None, :]
    cos, sin = np.cos(angles)[None, :, :], np.sin(angles)[None, :, :]

    def norm(z: np.ndarray, name: str) -> np.ndarray:
        variance = np.mean(z * z, axis=-1, keepdims=True, dtype=np.float32)
        return z / np.sqrt(variance + np.float32(eps)) * np.asarray(state[name], dtype=np.float32)

    def rope(z: np.ndarray) -> np.ndarray:
        out = np.empty_like(z)
        out[..., 0::2] = z[..., 0::2] * cos - z[..., 1::2] * sin
        out[..., 1::2] = z[..., 0::2] * sin + z[..., 1::2] * cos
        return out

    for layer in range(int(config["n_layers"])):
        prefix = f"layers.{layer}."
        z = norm(x, prefix + "attn_norm.weight")
        projections = [(z @ np.asarray(state[prefix + "attention." + key + ".weight"], dtype=np.float32).T)
                       .reshape(len(ids), heads, head_dim).transpose(1, 0, 2)
                       for key in ("q", "k", "v")]
        q, k, v = projections
        scores = (rope(q) @ rope(k).transpose(0, 2, 1)) / np.float32(math.sqrt(head_dim))
        scores[:, np.triu_indices(len(ids), 1)[0], np.triu_indices(len(ids), 1)[1]] = -np.inf
        scores -= np.max(scores, axis=-1, keepdims=True)
        probs = np.exp(scores)
        probs /= np.sum(probs, axis=-1, keepdims=True)
        attention = (probs @ v).transpose(1, 0, 2).reshape(len(ids), d)
        x += attention @ np.asarray(state[prefix + "attention.o.weight"], dtype=np.float32).T
        z = norm(x, prefix + "ffn_norm.weight")
        up = z @ np.asarray(state[prefix + "ffn.up.weight"], dtype=np.float32).T
        x += np.maximum(up, np.float32(0.0)) @ np.asarray(state[prefix + "ffn.down.weight"], dtype=np.float32).T
    return norm(x, "norm.weight") @ embed.T
