#!/usr/bin/env python3
"""Deterministic fixed-point reference for the published M-P1 Q5 image model."""

import argparse
from decimal import Decimal, localcontext
import hashlib
import json
import math
from pathlib import Path
import re
import time
import numpy as np
from PIL import Image

Q16 = 1 << 16
Q24 = 1 << 24
Q32 = 1 << 32
D, HEADS, HEAD_DIM = 192, 4, 48
TEXT, PIXELS, N = 12, 256, 269
EPS_Q32, ATTENTION_SCALE_Q24, LOG2_E_Q16 = 42950, 2421583, 94548
TICK_NUMERATORS = tuple(range(300, 14, -19)) + (0,)
RULES = "gh0st-mp1-q5-q16-v1"
MODEL_DIGESTS = {
    "m-p1.bin": "c08f7a858225992e6aae2a495a46a305ff16c5d4b6677d5225d1cc792c1b8ab9",
    "m-p1.json": "96c83b057434ecc4f3fe7886030b2fb3b6813e05ca926f0756bac54ff27794e7",
    "palette.bin": "c847f2c7a43df1354a77813c5dc68a2cefbcac211b0ac4159d7d91480a990650",
    "vocab.bin": "a632c5cbafae21c45f9b5991941fbbc48726f48e0f62707c563483ff855a893a",
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def arithmetic_constants():
    # Decimal constants are non-weight, protocol-defined data. Any implementation
    # can consume the committed resulting integers without transcendental calls.
    with localcontext() as ctx:
        ctx.prec = 80
        pi = Decimal("3.141592653589793238462643383279502884197169399375105820974944592307816406286")
        gain = Decimal(1)
        angles = [round(pi * Q32 / 4)]
        for i in range(32):
            z = Decimal(2) ** -i
            gain /= (1 + z * z).sqrt()
            if i:
                # atan(z), z <= 1/2, sufficient for Q32 rounding.
                term = z
                total = term
                for j in range(1, 145):
                    term *= -z * z
                    total += term / (2 * j + 1)
                angles.append(round(total * Q32))
        freq = lambda n: [round(Decimal(10000) ** (-Decimal(i) / n) * Q32) for i in range(n)]
        return {
            "pi": round(pi * Q32), "twoPi": round(2 * pi * Q32),
            "halfPi": round(pi * Q32 / 2), "gain": round(gain * Q32),
            "angles": angles, "ln2": round(Decimal(2).ln() * Q32),
            "lnTiny": round(Decimal("1e-12").ln() * Q32),
            "exp2": [round(Decimal(2) ** (-Decimal(i) / 256) * Q24) for i in range(257)],
            "freqPosition": freq(48), "freqTime": freq(96),
        }


C = arithmetic_constants()
EXP2 = np.array(C["exp2"], dtype=np.int64)


def sdiv(a, b):
    """Signed division matching EVM SDIV with a strictly positive divisor."""
    if isinstance(a, (int, np.integer)) and isinstance(b, (int, np.integer)):
        a, b = int(a), int(b)
        return a // b if a >= 0 else -((-a) // b)
    return np.where(a >= 0, a // b, -((-a) // b))


def checked_i32(a):
    if np.max(a, initial=0) >= 1 << 31 or np.min(a, initial=0) < -(1 << 31):
        raise OverflowError("Tensor is outside the signed Q16.16 wire format")
    return a


def abs_bound(value):
    return max(abs(int(value.min(initial=0))), abs(int(value.max(initial=0))))


def q32_trig(angle):
    z = (angle + C["pi"]) % C["twoPi"] - C["pi"]
    sign_cos = 1
    if z > C["halfPi"]:
        z, sign_cos = C["pi"] - z, -1
    if z < -C["halfPi"]:
        z, sign_cos = -C["pi"] - z, -1
    x, y = C["gain"], 0
    for i, angle_i in enumerate(C["angles"]):
        if z >= 0:
            x, y, z = x - (y >> i), y + (x >> i), z - angle_i
        else:
            x, y, z = x + (y >> i), y - (x >> i), z + angle_i
    return x * sign_cos, y


def log_uniform_q32(u):
    if not u:
        return C["lnTiny"]
    bit = u.bit_length() - 1
    mantissa = u << (32 - bit)
    factor = ((mantissa - Q32) << 32) // (mantissa + Q32)
    factor_squared = factor * factor >> 32
    term = total = factor
    for i in range(1, 20):
        term = term * factor_squared >> 32
        total += term // (2 * i + 1)
    return 2 * total + (bit - 32) * C["ln2"]


def mulberry(seed):
    mask = (1 << 32) - 1
    while True:
        seed = (seed + 0x6D2B79F5) & mask
        t = ((seed ^ (seed >> 15)) * (1 | seed)) & mask
        t ^= (t + ((t ^ (t >> 7)) * (61 | t))) & mask
        yield t ^ (t >> 14)


def noise_q16(seed):
    stream = mulberry(seed)
    result = np.empty(1024, dtype=np.int64)
    for i in range(0, 1024, 2):
        radius = math.isqrt((-2 * log_uniform_q32(next(stream))) << 32)
        angle = next(stream) * C["twoPi"] >> 32
        cos, sin = q32_trig(angle)
        result[i] = sdiv(radius * cos, 1 << 48)
        result[i + 1] = sdiv(radius * sin, 1 << 48)
    return result


def exp_neg_q24(abs_x):
    exponent = (np.asarray(abs_x, dtype=np.int64) * LOG2_E_Q16) >> 16
    shift = exponent >> 16
    lut_index = (exponent >> 8) & 255
    remainder = exponent & 255
    weight = (EXP2[lut_index] * (256 - remainder) + EXP2[lut_index + 1] * remainder) >> 8
    return np.where(shift < 25, weight >> np.minimum(shift, 25), 0)


def silu_q16(x):
    factor = exp_neg_q24(np.abs(x))
    return sdiv(x * np.where(x >= 0, Q24, factor), Q24 + factor)


def dot(a, b):
    """Integer matrix product; speed up only inside a proven exact binary64 bound."""
    bound = abs_bound(a) * abs_bound(b) * a.shape[-1]
    if bound > (1 << 63) - 1:
        raise OverflowError("Int64 dot product bound exceeded")
    if bound < 1 << 53:
        # All individual products and accumulation orders are exact integers
        # inside binary64's consecutive-integer interval.
        # Apple's Accelerate reports floating-point flags from its matmul
        # dispatch path on small integer inputs. Validate the output directly.
        with np.errstate(invalid="ignore", over="ignore", divide="ignore"):
            result = np.asarray(a, dtype=np.float64) @ np.asarray(b, dtype=np.float64)
        if not np.all(np.isfinite(result)) or abs_bound(result) > bound:
            raise ArithmeticError("Binary64 dot product exceeded its proven bound")
        integer = result.astype(np.int64)
        if not np.array_equal(result, integer):
            raise ArithmeticError("Dot product was not an exact integer")
        return integer
    return np.asarray(a, dtype=np.int64) @ np.asarray(b, dtype=np.int64)


def layer_norm(x, gamma, bias):
    width = x.shape[-1]
    mu = sdiv(x.sum(axis=-1, keepdims=True), width)
    delta = x - mu
    if abs_bound(delta) ** 2 * width > (1 << 63) - 1:
        raise OverflowError("Int64 layer norm variance bound exceeded")
    variance = (delta * delta).sum(axis=-1, keepdims=True) // width
    sigma = np.array([math.isqrt(int(v) + EPS_Q32) for v in variance.ravel()], dtype=np.int64).reshape(mu.shape)
    return checked_i32(sdiv(delta * gamma, sigma) + bias)


def score_q16(query, key):
    return sdiv(sdiv(dot(query, np.swapaxes(key,-2,-1)), Q16) * ATTENTION_SCALE_Q24, Q24)


def attention(qkv, operands=None):
    batch = len(qkv)
    query, key, values = qkv.reshape(batch, N, 3, HEADS, HEAD_DIM).transpose(2, 0, 3, 1, 4)
    scores = score_q16(query, key)
    weights = exp_neg_q24(scores.max(axis=-1, keepdims=True) - scores)
    sums = weights.sum(axis=-1, keepdims=True)
    attended = checked_i32(sdiv(dot(weights, values), sums))
    fixture = None
    if operands is not None:
        operands["attention-kv.bin"] = i32_wire(key[0, 0]) + i32_wire(values[0, 0])
        fixture = {
            "query": query[0, 0, 13].tolist(),
            "firstKey": key[0, 0, 0].tolist(),
            "firstScore": int(scores[0, 0, 13, 0]),
            "scores": scores[0, 0, 13].tolist(),
            "weightsQ24": weights[0, 0, 13].tolist(),
            "weightSumQ24": int(sums[0, 0, 13, 0]),
            "sampleValueColumnQ16": values[0, 0, :, 0].tolist(),
            "outputQ16": attended[0, 0, 13].tolist(),
        }
    return attended.transpose(0, 2, 1, 3).reshape(batch, N, D), fixture


class Pack:
    def __init__(self, path):
        files = {name: (path / name).read_bytes() for name in MODEL_DIGESTS}
        if {name: sha(raw) for name, raw in files.items()} != MODEL_DIGESTS:
            raise ValueError("The input is not the originally benchmarked M-P1 Q5 pack")
        meta = json.loads(files["m-p1.json"])
        if meta["format"] != "gh0st-mp1-qpack-v1" or meta["bits"] != 5:
            raise ValueError("Unsupported model format")
        raw = files["m-p1.bin"]
        self.q, self.f = {}, {}
        for t in meta["tensors"]:
            offset = t["offset"]
            shape = t["shape"]
            count = math.prod(shape)
            if t["dtype"] == "float32":
                param = np.frombuffer(raw, dtype="<f4", count=count, offset=offset).astype(np.float64)
                self.f[t["name"]] = checked_i32(np.rint(param * Q16).astype(np.int64).reshape(shape))
            else:
                bytes5 = np.frombuffer(raw, dtype=np.uint8, offset=offset, count=t["length"]).reshape(-1, 5)
                words = (bytes5.astype(np.uint64) << np.arange(0, 40, 8, dtype=np.uint64)).sum(axis=1)
                codes = (((words[:, None] >> np.arange(0, 40, 5, dtype=np.uint64)) & 31).reshape(-1)[:count].astype(np.int8) - 16)
                scale = np.frombuffer(raw, dtype="<f2", count=t["scaleCount"], offset=t["scaleOffset"]).astype(np.float64)
                exact = scale * Q24
                if not np.array_equal(exact, np.rint(exact)):
                    raise ValueError("Scale is not exact in Q24")
                self.q[t["name"]] = (codes.reshape(shape), exact.astype(np.int64).reshape(shape[0], -1), t["group"])
        vocabulary = files["vocab.bin"].decode().split("\0")
        if vocabulary[-1] != "":
            raise ValueError("Truncated vocabulary")
        self.vocab = {word: i for i, word in enumerate(vocabulary[:-1], start=meta["vocabBaseId"])}
        self.palette = np.frombuffer(files["palette.bin"], dtype=np.uint8).reshape(-1, 3)
        color = Q16 * (2 * self.palette.astype(np.int64) - 255)
        self.palette_fixed = sdiv(color + np.where(color >= 0, 127, -127), 255)
        self.positions = spatial_q16()
        self.linear_input_max_abs = {}

    def tokenize(self, prompt):
        words = re.findall(r"[a-z0-9]+(?:[-'][a-z0-9]+)*", prompt.lower())[:TEXT]
        return ([self.vocab.get(word, 1) for word in words] + [0] * TEXT)[:TEXT]

    def linear(self, x, name, relu=False):
        codes, scales, group = self.q[name + ".weight"]
        self.linear_input_max_abs[name] = max(abs_bound(x), self.linear_input_max_abs.get(name, 0))
        y = np.zeros(x.shape[:-1] + (codes.shape[0],), dtype=np.int64)
        bound = 0
        for g, j in enumerate(range(0, codes.shape[1], group)):
            # Keep the complete group-scaled sum before the single Q24 SDIV.
            partial = dot(x[..., j:j + group], codes[:, j:j + group].T)
            bound += abs_bound(partial) * abs_bound(scales[:, g])
            if bound > (1 << 63) - 1:
                raise OverflowError("Int64 scaled linear accumulator bound exceeded")
            y += partial * scales[:, g]
        y = sdiv(y, Q24) + self.f[name + ".bias"]
        return checked_i32(np.maximum(0, y) if relu else y)

    def linear_fixture(self, x, name, start, count):
        codes, scales, group = self.q[name + ".weight"]
        return {
            "name": name,
            "firstOutputChannel": start,
            "inputQ16": x.tolist(),
            "groupWidth": group,
            "codes": codes[start:start + count].tolist(),
            "scalesQ24": scales[start:start + count].tolist(),
            "biasQ16": self.f[name + ".bias"][start:start + count].tolist(),
            "outputQ16": self.linear(x, name)[start:start + count].tolist(),
        }

    def text_embedding(self, ids):
        codes, scales, group = self.q["text_emb.weight"]
        assert group == 64
        selected = codes[ids] * scales[ids]
        # Text embeddings enter the Q16 activation domain before projecting.
        return self.linear(sdiv(selected, 1 << 8), "text_proj") + self.f["text_pos"]

    def time_token(self, tick):
        return self.linear(silu_q16(self.linear(time_feature_q16(tick), "time_mlp.0.0")), "time_mlp.0.2")

    def palette_tokens(self, z):
        out = np.zeros(PIXELS, dtype=np.uint16)
        for i in range(PIXELS):
            if z[3, i] >= 0:
                diff = self.palette_fixed[1:] - z[:3, i]
                out[i] = np.argmin(np.sum(diff * diff, axis=1)) + 1
        return out


def spatial_q16():
    entries = []
    for coordinate in range(16):
        pairs = [q32_trig(coordinate * freq) for freq in C["freqPosition"]]
        entries.append([sdiv(p[1], Q16) for p in pairs] + [sdiv(p[0], Q16) for p in pairs])
    return np.array([entries[y] + entries[x] for y in range(16) for x in range(16)], dtype=np.int64)


def time_feature_q16(tick):
    pairs = [q32_trig((freq * 1000 * tick) // 300) for freq in C["freqTime"]]
    return np.array([sdiv(p[1], Q16) for p in pairs] + [sdiv(p[0], Q16) for p in pairs], dtype=np.int64)


def i32_wire(tensor):
    return checked_i32(tensor).astype("<i4").tobytes()


def tensor_hash(tensor):
    return sha(i32_wire(tensor))


def full_image(pack, prompt, seed, verbose):
    text_ids = pack.tokenize(prompt)
    condition = pack.text_embedding(np.array([text_ids, [2] + [0] * (TEXT - 1)]))
    initial = noise_q16(seed)
    state = initial.reshape(4, PIXELS)
    trace = {}
    operands = {}
    vectors = {"format": RULES, "prompt": prompt, "seed": seed, "tokenIds": text_ids,
               "noisePrefixQ16": initial[:32].tolist(), "noiseHash": tensor_hash(initial)}
    for step, (tick, next_tick) in enumerate(zip(TICK_NUMERATORS, TICK_NUMERATORS[1:])):
        if verbose:
            print(f"step {step + 1}/16", flush=True)
        time_token = pack.time_token(tick)
        pixels = pack.linear(state.T, "pix_in") + pack.positions
        tokens = np.concatenate((np.repeat(time_token[None, None, :], 2, axis=0), condition,
                                 np.repeat(pixels[None, :, :], 2, axis=0)), axis=1)
        trace[f"{step:02d}.assembly"] = tensor_hash(tokens)
        for layer in range(8):
            prefix = f"blocks.{layer}."
            name = f"{step:02d}.{layer:02d}."
            norm = layer_norm(tokens, pack.f[prefix + "norm1.weight"], pack.f[prefix + "norm1.bias"])
            qkv = pack.linear(norm, prefix + "qkv")
            trace[name + "norm1"] = tensor_hash(norm)
            trace[name + "qkv"] = tensor_hash(qkv)
            capture = step == 0 and layer == 0
            attended, attvec = attention(qkv, operands if capture else None)
            tokens2 = checked_i32(tokens + pack.linear(attended, prefix + "proj"))
            norm2 = layer_norm(tokens2, pack.f[prefix + "norm2.weight"], pack.f[prefix + "norm2.bias"])
            fc1 = pack.linear(norm2, prefix + "fc1", relu=True)
            tokens3 = checked_i32(tokens2 + pack.linear(fc1, prefix + "fc2"))
            trace[name + "attention"] = tensor_hash(attended)
            trace[name + "residual1"] = tensor_hash(tokens2)
            trace[name + "norm2"] = tensor_hash(norm2)
            trace[name + "fc1"] = tensor_hash(fc1)
            trace[name + "residual2"] = tensor_hash(tokens3)
            if capture:
                vectors["norm1"] = {
                    "inputQ16": tokens[0, 13].tolist(),
                    "gammaQ16": pack.f[prefix + "norm1.weight"].tolist(),
                    "biasQ16": pack.f[prefix + "norm1.bias"].tolist(),
                    "outputQ16": norm[0, 13].tolist(),
                }
                vectors["linearQkv"] = pack.linear_fixture(norm[0, 13], prefix + "qkv", 0, 4)
                vectors["linearFc2"] = pack.linear_fixture(fc1[0, 13], prefix + "fc2", 0, 2)
                vectors["attention"] = attvec
            tokens = tokens3
        pix_norm = layer_norm(tokens[:, 1 + TEXT:, :], pack.f["norm_out.weight"], pack.f["norm_out.bias"])
        decoded = pack.linear(pix_norm, "pix_out").transpose(0, 2, 1)
        trace[f"{step:02d}.prediction"] = tensor_hash(decoded)
        guided = sdiv(3 * decoded[0] - decoded[1], 2)
        next_state = checked_i32(sdiv(next_tick * state + (tick - next_tick) * guided, tick))
        if step == 0:
            operands["euler-first-step.bin"] = b"".join(map(i32_wire, (state, decoded[0], decoded[1], next_state)))
            vectors["sampler"] = {
                "tick": tick, "nextTick": next_tick,
                "inputQ16": state[0, :32].tolist(),
                "conditionalQ16": decoded[0, 0, :32].tolist(),
                "unconditionalQ16": decoded[1, 0, :32].tolist(),
                "guidedQ16": guided[0, :32].tolist(),
                "outputQ16": next_state[0, :32].tolist(),
            }
        state = next_state
        trace[f"{step:02d}.latent"] = tensor_hash(state)
    return pack.palette_tokens(state), state, trace, vectors, operands


def rgba_for(indices, palette):
    rgba = np.zeros((PIXELS, 4), dtype=np.uint8)
    opaque = indices != 0
    rgba[opaque, :3] = palette[indices[opaque]]
    rgba[opaque, 3] = 255
    return rgba.reshape(16, 16, 4)


def image_similarity(actual, png_path):
    expected = np.array(Image.open(png_path).convert("RGBA"))
    a, b = actual[..., 3] >= 128, expected[..., 3] >= 128
    union = a | b
    rgb_a, rgb_b = (actual[..., :3].astype(np.float64) * a[..., None],
                    expected[..., :3].astype(np.float64) * b[..., None])
    return {
        "reference": png_path.name,
        "silhouetteIoU": round(float((a & b).sum() / union.sum()), 6) if union.any() else 1,
        "premultipliedRgbMae": round(float(np.abs(rgb_a - rgb_b)[union].mean()), 6) if union.any() else 0,
        "exactRgbaPixels": int(np.all(actual == expected, axis=-1).sum()),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prompt", default="blue crystal")
    parser.add_argument("--seed", type=int, default=24680)
    parser.add_argument("--browser-png", type=Path)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    if not 0 < args.seed < 2**32:
        parser.error("seed must be a positive uint32")
    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    start = time.perf_counter()
    model = Pack(args.pack)
    indices, state, trace, vectors, operands = full_image(model, args.prompt, args.seed, args.verbose)
    vectors["featureHashes"] = {
        "noise": {str(seed): tensor_hash(noise_q16(seed)) for seed in (1, args.seed, 2**32 - 1)},
        "time": {str(step): tensor_hash(time_feature_q16(TICK_NUMERATORS[step])) for step in (0, 7, 15)},
        "spatial": {"full": tensor_hash(model.positions), "tail": tensor_hash(model.positions[224:])},
    }
    rgba = rgba_for(indices, model.palette)
    duration = time.perf_counter() - start
    (out / "constants.json").write_text(json.dumps(C, separators=(",", ":")) + "\n")
    (out / "vectors.json").write_text(json.dumps(vectors, separators=(",", ":")) + "\n")
    (out / "checkpoint-sha256.json").write_text(json.dumps(trace, indent=2) + "\n")
    pixels = indices.astype("<u2").tobytes()
    (out / "pixels.bin").write_bytes(pixels)
    for name, data in operands.items():
        (out / name).write_bytes(data)
    Image.fromarray(rgba).save(out / "sample.png")
    report = {
        "rules": RULES, "model": MODEL_DIGESTS, "modelBytes": 2976901,
        "prompt": args.prompt, "seed": args.seed, "tokenIds": vectors["tokenIds"],
        "steps": 16, "conditionalAndUnconditionalPasses": 32, "timestepNumerators": TICK_NUMERATORS,
        "timestepDenominator": 300, "guidanceNumerator": 3, "guidanceDenominator": 2,
        "pixelSize": [16, 16], "pixelEncoding": "uint16-le palette indexes, row-major, 0 transparent",
        "opaquePixels": int(np.count_nonzero(indices)), "pixelsSHA256": sha(pixels),
        "initialNoiseSHA256": vectors["noiseHash"], "finalLatentSHA256": tensor_hash(state),
        "checkpointCount": len(trace), "elapsedSeconds": round(duration, 4),
        "linearInputMaxAbsQ16": model.linear_input_max_abs,
        "operands": {
            name: {"bytes": len(data), "sha256": sha(data)} for name, data in operands.items()
        },
    }
    if args.browser_png:
        report["browserComparison"] = image_similarity(rgba, args.browser_png)
    (out / "reference-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
