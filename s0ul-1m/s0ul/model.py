"""S0UL's bias-free 984,192-parameter causal transformer.

This module defines the floating-point training reference. It is not an EVM
implementation or a claim of fixed-point numerical agreement.
"""
from dataclasses import asdict, dataclass
import math

import torch
from torch import nn
from torch.nn import functional as F


@dataclass(frozen=True)
class ModelConfig:
    vocab_size: int = 512
    dim: int = 128
    n_layers: int = 4
    n_heads: int = 4
    hidden_dim: int = 640
    max_seq_len: int = 128
    rms_eps: float = 1e-5

    def __post_init__(self):
        for field in ("vocab_size", "dim", "n_layers", "n_heads", "hidden_dim", "max_seq_len"):
            if type(getattr(self, field)) is not int or getattr(self, field) <= 0:
                raise ValueError(f"{field} must be a positive integer")
        if self.dim % self.n_heads or (self.dim // self.n_heads) % 2:
            raise ValueError("head width must be an even integer")
        if not math.isfinite(self.rms_eps) or self.rms_eps <= 0:
            raise ValueError("rms_eps must be positive and finite")

    def to_dict(self):
        return asdict(self)

    def expected_parameters(self):
        v, d, n, h = self.vocab_size, self.dim, self.n_layers, self.hidden_dim
        return v * d + n * (4 * d * d + 2 * d * h + 2 * d) + d


class RMSNorm(nn.Module):
    def __init__(self, dim, eps):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(dim))
        self.eps = eps

    def forward(self, x):
        # Explicit float32 accumulation is part of this training reference.
        return (x.float() * torch.rsqrt(x.float().square().mean(-1, keepdim=True) + self.eps)).to(x.dtype) * self.weight


class CausalAttention(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.n_heads = config.n_heads
        self.head_dim = config.dim // config.n_heads
        self.q = nn.Linear(config.dim, config.dim, bias=False)
        self.k = nn.Linear(config.dim, config.dim, bias=False)
        self.v = nn.Linear(config.dim, config.dim, bias=False)
        self.o = nn.Linear(config.dim, config.dim, bias=False)
        inv = 1.0 / (10000.0 ** (torch.arange(0, self.head_dim, 2).float() / self.head_dim))
        angles = torch.outer(torch.arange(config.max_seq_len).float(), inv)
        self.register_buffer("rope_cos", angles.cos(), persistent=False)
        self.register_buffer("rope_sin", angles.sin(), persistent=False)

    def rotate(self, x):
        # Adjacent channel pairs: (a,b) -> (a*cos-b*sin, a*sin+b*cos).
        cos = self.rope_cos[:x.size(-2)].to(dtype=x.dtype)[None, None]
        sin = self.rope_sin[:x.size(-2)].to(dtype=x.dtype)[None, None]
        a, b = x[..., 0::2], x[..., 1::2]
        return torch.stack((a * cos - b * sin, a * sin + b * cos), dim=-1).flatten(-2)

    def forward(self, x):
        b, t, d = x.shape
        def heads(projection):
            return projection(x).reshape(b, t, self.n_heads, self.head_dim).transpose(1, 2)
        q, k, v = self.rotate(heads(self.q)), self.rotate(heads(self.k)), heads(self.v)
        attention = F.scaled_dot_product_attention(q, k, v, dropout_p=0.0, is_causal=True)
        return self.o(attention.transpose(1, 2).contiguous().reshape(b, t, d))


class FeedForward(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.up = nn.Linear(config.dim, config.hidden_dim, bias=False)
        self.down = nn.Linear(config.hidden_dim, config.dim, bias=False)

    def forward(self, x):
        return self.down(F.relu(self.up(x)))


class DecoderBlock(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.attn_norm = RMSNorm(config.dim, config.rms_eps)
        self.attention = CausalAttention(config)
        self.ffn_norm = RMSNorm(config.dim, config.rms_eps)
        self.ffn = FeedForward(config)

    def forward(self, x):
        x = x + self.attention(self.attn_norm(x))
        return x + self.ffn(self.ffn_norm(x))


class S0ULModel(nn.Module):
    def __init__(self, config=None):
        super().__init__()
        self.config = config or ModelConfig()
        self.token_embedding = nn.Embedding(self.config.vocab_size, self.config.dim)
        self.layers = nn.ModuleList(DecoderBlock(self.config) for _ in range(self.config.n_layers))
        self.norm = RMSNorm(self.config.dim, self.config.rms_eps)
        self.apply(self._init_weights)
        if self.parameter_count() != self.config.expected_parameters():
            raise RuntimeError("parameter count disagrees with architecture formula")

    @staticmethod
    def _init_weights(module):
        if isinstance(module, (nn.Linear, nn.Embedding)):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def parameter_count(self):
        return sum(parameter.numel() for parameter in self.parameters())

    def forward(self, input_ids):
        if input_ids.ndim != 2 or input_ids.size(0) == 0 or input_ids.size(1) == 0:
            raise ValueError("input_ids must have nonempty [batch, sequence] shape")
        if input_ids.dtype not in (torch.int32, torch.int64):
            raise ValueError("input_ids must be integer token IDs")
        if input_ids.size(1) > self.config.max_seq_len:
            raise ValueError("sequence exceeds configured context; no implicit truncation")
        x = self.token_embedding(input_ids)
        for layer in self.layers:
            x = layer(x)
        return F.linear(self.norm(x), self.token_embedding.weight)

    @torch.no_grad()
    def generate(self, input_ids, max_new_tokens, eos_id=2):
        if type(max_new_tokens) is not int or max_new_tokens < 0:
            raise ValueError("max_new_tokens must be a nonnegative integer")
        if input_ids.ndim != 2 or input_ids.size(1) == 0 or input_ids.size(0) == 0:
            raise ValueError("input_ids must have nonempty [batch, sequence] shape")
        if input_ids.size(1) + max_new_tokens > self.config.max_seq_len:
            raise ValueError("requested generation exceeds context")
        if not 0 <= eos_id < self.config.vocab_size:
            raise ValueError("eos_id outside vocabulary")
        was_training = self.training
        self.eval()
        try:
            ids = input_ids.clone()
            finished = torch.zeros(ids.size(0), dtype=torch.bool, device=ids.device)
            for _ in range(max_new_tokens):
                next_ids = self(ids)[:, -1].argmax(-1)
                next_ids = torch.where(finished, torch.full_like(next_ids, eos_id), next_ids)
                ids = torch.cat((ids, next_ids[:, None]), dim=1)
                finished |= next_ids.eq(eos_id)
                if bool(finished.all()):
                    break
            return ids
        finally:
            self.train(was_training)
