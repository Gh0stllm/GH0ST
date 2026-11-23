"""Encode the 500 KB model and reproduce its signed fixed-point inference."""

from hashlib import sha256

import numpy as np


EXPERT_BYTES = 67_584
SHARED_BYTES = 26_912
PACK_BYTES = 500_000
EXPERTS = 7
EMBEDDINGS = (
    ("subject", 256, 24), ("tint", 32, 24), ("relation", 16, 8),
    ("background", 64, 8), ("style", 7, 8), ("palette", 16, 8),
)
BLOCKS = ((0, 372), (1204, 1576))
SHARED_OFFSETS = (5736, 14696, 16744, 24480, 26272)


def pack_u5(values):
    values = np.asarray(values, dtype=np.uint8).reshape(-1)
    assert len(values) % 8 == 0 and np.all(values < 32)
    bits = (values[:, None] >> np.arange(5, dtype=np.uint8)) & 1
    return np.packbits(bits.reshape(-1), bitorder="little").tobytes()


def unpack_u5(blob):
    bits = np.unpackbits(np.frombuffer(blob, dtype=np.uint8), bitorder="little")
    return bits.reshape(-1, 5) @ np.array([1, 2, 4, 8, 16], dtype=np.uint8)


def encode_layer(weights, bias):
    weights = np.asarray(weights).reshape(len(bias), -1)
    assert np.isfinite(weights).all() and np.isfinite(bias).all()
    peak = np.max(np.abs(weights), axis=1)
    scale = np.clip(np.rint(peak * (65536 / 15)), 1, 65535).astype("<u2")
    quantized = np.clip(np.rint(weights * 65536 / scale[:, None]), -16, 15).astype(np.int8)
    bias = np.rint(np.asarray(bias) * 1024).astype("<i4")
    return pack_u5(quantized.astype(np.int16) + 16) + scale.tobytes() + bias.tobytes()


def decode_layer(blob, offset, outputs, width):
    size = outputs * width * 5 // 8
    weight = unpack_u5(blob[offset:offset + size]).astype(np.int64).reshape(outputs, width) - 16
    offset += size
    scale = np.frombuffer(blob, dtype="<u2", count=outputs, offset=offset).astype(np.int64)
    bias = np.frombuffer(blob, dtype="<i4", count=outputs, offset=offset + 2 * outputs).astype(np.int64)
    return weight, scale, bias


def prompt_number(fields):
    return int.from_bytes(bytes(fields), "big")


def noise_features(fields, seed):
    digest = sha256(bytes(fields) + int(seed).to_bytes(8, "big")).digest()
    return np.frombuffer(digest[:16], dtype=np.uint8).astype(np.int16) - 128


def apply_tints(pixels, fields):
    """Map a subject's three learned shade roles to the requested color."""
    indices = np.arange(32, dtype=np.uint8)
    for role, tint in enumerate(fields[2:4]):
        start = 8 + 3 * role
        offset = 8 + 3 * tint
        indices[start:start + 3] = np.arange(offset, offset + 3)
    return indices[pixels]


def layer(inputs, encoded):
    weight, scale, bias = encoded
    return ((inputs @ weight.T) * scale >> 16) + bias


class FrozenDecoder:
    def __init__(self, pack):
        assert len(pack) == PACK_BYTES
        self.sha256 = sha256(pack).hexdigest()
        self.experts = [decode_layer(pack, style * EXPERT_BYTES, 1024, 96) for style in range(EXPERTS)]
        shared = pack[EXPERTS * EXPERT_BYTES:]
        self.blocks = [
            (decode_layer(shared, depth, 32, 9), decode_layer(shared, point, 32, 32))
            for depth, point in BLOCKS
        ]
        self.head = decode_layer(shared, 2408, 128, 32)
        dictionary, palettes, offset, adapters, header = SHARED_OFFSETS
        self.codebook = unpack_u5(shared[dictionary:palettes]).reshape(EXPERTS, 128, 4, 4)
        self.palettes = np.frombuffer(shared[palettes:offset], dtype=np.uint8).reshape(16, 32, 4)
        self.embeddings = {}
        for name, rows, width in EMBEDDINGS:
            size = rows * width
            self.embeddings[name] = np.frombuffer(shared[offset:offset + size], dtype=np.int8).reshape(rows, width)
            offset += size
        assert offset == adapters and shared[header:header + 9] == b"GH0STSD2\x00"
        self.adapter_bytes = shared[adapters:header]

    def features(self, fields, seed):
        a, b, ta, tb, relation, background, style, palette = fields
        embeddings = self.embeddings
        subjects = [
            embeddings["subject"][subject].astype(np.int64) + (embeddings["tint"][tint] if subject else 0)
            for subject, tint in ((a, ta), (b, tb))
        ]
        return 8 * np.concatenate((
            *subjects, embeddings["relation"][relation], embeddings["background"][background],
            embeddings["style"][style], embeddings["palette"][palette], noise_features(fields, seed),
        ))

    def generate(self, fields, seed):
        style, palette = fields[-2:]
        x = layer(self.features(fields, seed), self.experts[style])
        x = np.clip(x.reshape(4, 4, 32, 2).max(axis=-1), 0, 8192)
        x = x.repeat(2, axis=0).repeat(2, axis=1)
        for block, (depth, point) in enumerate(self.blocks):
            weight, scale, bias = depth
            padded = np.pad(x, ((1, 1), (1, 1), (0, 0)))
            accum = sum(
                padded[ky:ky + 8, kx:kx + 8] * weight[:, ky * 3 + kx]
                for ky in range(3) for kx in range(3)
            )
            depth_result = np.clip((accum * scale >> 16) + bias, 0, 8192)
            x = layer(depth_result, point)
            offset = (style * 2 + block) * 128
            gain = np.frombuffer(self.adapter_bytes, dtype="<u2", count=32, offset=offset)
            bias = np.frombuffer(self.adapter_bytes, dtype="<i2", count=32, offset=offset + 64)
            x = np.clip((x * gain >> 8) + bias, 0, 8192)
        ids = layer(x, self.head).argmax(axis=-1)
        pixels = self.codebook[style, ids].transpose(0, 2, 1, 3).reshape(32, 32)
        return apply_tints(pixels, fields), self.palettes[palette], ids
