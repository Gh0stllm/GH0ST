"""Cached integer-v1 evaluation, verified against the untouched full reference.

Only previously computed causal K/V values are reused. Every generated token
still comes from the transformer argmax over all 512 output logits.
"""
from __future__ import annotations

import numpy as np


class CachedInteger:
    def __init__(self, model):
        from s0ul.integer import _dot, _multiply, _round_div
        self.model = model
        self.dot, self.multiply, self.round_div = _dot, _multiply, _round_div
        self.cache = [[] for _ in range(model.config["n_layers"])]
        self.position = 0

    def _rotate(self, x):
        m = self.model
        cos = m.arrays["rope.cos_q14"][self.position:self.position + 1, None, :]
        sin = m.arrays["rope.sin_q14"][self.position:self.position + 1, None, :]
        a, b = x[..., 0::2], x[..., 1::2]
        out = np.empty_like(x)
        out[..., 0::2] = self.round_div(self.multiply(a, cos) - self.multiply(b, sin), 1 << 14)
        out[..., 1::2] = self.round_div(self.multiply(a, sin) + self.multiply(b, cos), 1 << 14)
        return m._saturate(out)

    def step(self, token):
        m, rd, mul, dot = self.model, self.round_div, self.multiply, self.dot
        if type(token) is not int or not 0 <= token < m.config["vocab_size"]:
            raise ValueError("token outside model vocabulary")
        if self.position >= m.config["max_seq_len"]:
            raise ValueError("cached position exceeds model context")
        q = m.arrays["token_embedding.weight.q"][[token]]
        scale = m.arrays["token_embedding.weight.scale_q24"][[token], None]
        x = m._saturate(rd(mul(q, scale), 1 << 10))
        heads = m.config["n_heads"]
        width = m.config["dim"] // heads
        for layer in range(m.config["n_layers"]):
            prefix = f"layers.{layer}."
            norm = m._norm(x, prefix + "attn_norm.weight")
            ap = prefix + "attention."
            q = self._rotate(m._linear(norm, ap + "q.weight").reshape(1, heads, width))
            k = self._rotate(m._linear(norm, ap + "k.weight").reshape(1, heads, width))
            v = m._linear(norm, ap + "v.weight").reshape(1, heads, width)
            self.cache[layer].append((k[0].copy(), v[0].copy()))
            keys = np.stack([kv[0] for kv in self.cache[layer]])
            values = np.stack([kv[1] for kv in self.cache[layer]])
            output = np.empty_like(v)
            for head in range(heads):
                scores = rd(mul(dot(q[:, head], keys[:, head].T), m.attention_scale_q14), 1 << 28)[0]
                weights = m._softmax_weights(scores)
                weighted = dot(weights[None, :], values[:, head])[0]
                output[0, head] = rd(weighted, int(np.sum(weights)))
            x = m._saturate(x + m._linear(output.reshape(1, m.config["dim"]), ap + "o.weight"))
            hidden = np.maximum(0, m._linear(m._norm(x, prefix + "ffn_norm.weight"), prefix + "ffn.up.weight"))
            x = m._saturate(x + m._linear(hidden, prefix + "ffn.down.weight"))
        self.position += 1
        return m._linear(m._norm(x, "norm.weight"), "token_embedding.weight")[0]

    def generate(self, prompt, budget=32, *, capture=False):
        if self.position:
            raise ValueError("use a fresh cache per independent request")
        if not prompt or len(prompt) + budget > self.model.config["max_seq_len"]:
            raise ValueError("invalid prompt or generation context")
        for token in prompt:
            logits = self.step(token)
        output, decisions = [], []
        for _ in range(budget):
            if capture:
                decisions.append(logits.tolist())
            token = int(np.argmax(logits))
            output.append(token)
            if token == 2:
                break
            logits = self.step(token)
        return (output, decisions) if capture else output
