"""Experimental integer-only S0UL inference, with offline float conversion.

The conversion methods use floating point. After conversion/loading, forward
and generation use only integer arrays and Python integer arithmetic. This is
a deliberately conservative reference, not an optimized or deployed runtime.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import time

import numpy as np


FORMAT = "gh0st-s0ul-integer-v1"
ACT_BITS = 14
SCALE_BITS = 24
ONE = 1 << ACT_BITS
LIMIT = (1 << 20) - 1
I64_MAX = (1 << 63) - 1
LUT_STEPS = 4096


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _round_float(values):
    values = np.asarray(values, dtype=np.float64)
    if not np.isfinite(values).all():
        raise ValueError("conversion received a nonfinite value")
    if np.max(np.abs(values), initial=0) > I64_MAX // 2:
        raise OverflowError("conversion exceeds the integer bound")
    return (np.sign(values) * np.floor(np.abs(values) + 0.5)).astype(np.int64)


def _integers(values):
    values = np.asarray(values)
    if values.dtype.kind not in "iu":
        raise TypeError("integer runtime received a noninteger array")
    if values.dtype.kind == "u" and np.max(values, initial=0) > I64_MAX:
        raise OverflowError("unsigned value exceeds int64")
    values = values.astype(np.int64, copy=False)
    if np.any(values == -(1 << 63)):
        raise OverflowError("minimum int64 has no representable absolute value")
    return values


def _round_div(values, denominator):
    """Nearest integer, exact halfway cases away from zero."""
    values = _integers(values)
    denominator = _integers(denominator)
    if np.any(denominator <= 0):
        raise ValueError("division denominator must be positive")
    absolute = np.abs(values)
    quotient, remainder = absolute // denominator, absolute % denominator
    # ceil(denominator / 2), without overflowing denominator + 1.
    threshold = denominator // 2 + denominator % 2
    return np.sign(values) * (quotient + (remainder >= threshold))


def _multiply(a, b):
    a, b = _integers(a), _integers(b)
    amax, bmax = int(np.max(np.abs(a), initial=0)), int(np.max(np.abs(b), initial=0))
    if amax * bmax > I64_MAX:
        raise OverflowError("integer multiply exceeds int64")
    return a * b


def _dot(a, b):
    a, b = _integers(a), _integers(b)
    if a.shape[-1] != b.shape[-2]:
        raise ValueError("dot dimensions disagree")
    amax, bmax = int(np.max(np.abs(a), initial=0)), int(np.max(np.abs(b), initial=0))
    if amax * bmax * a.shape[-1] > I64_MAX:
        raise OverflowError("integer dot exceeds int64")
    return a @ b


def _clip(values):
    return np.clip(_integers(values), -LIMIT, LIMIT)


def _config(config):
    config = dict(config)
    required = ("vocab_size", "dim", "n_layers", "n_heads", "hidden_dim", "max_seq_len")
    for key in required:
        if type(config.get(key)) is not int or config[key] <= 0:
            raise ValueError(f"invalid config field: {key}")
    if config["dim"] % config["n_heads"] or (config["dim"] // config["n_heads"]) % 2:
        raise ValueError("head width must be an even integer")
    return config


def _expected_shapes(config):
    d, m = config["dim"], config["hidden_dim"]
    shapes = {"token_embedding.weight": (config["vocab_size"], d), "norm.weight": (d,)}
    for i in range(config["n_layers"]):
        prefix = f"layers.{i}."
        shapes[prefix + "attn_norm.weight"] = (d,)
        shapes[prefix + "ffn_norm.weight"] = (d,)
        for name in ("q", "k", "v", "o"):
            shapes[prefix + f"attention.{name}.weight"] = (d, d)
        shapes[prefix + "ffn.up.weight"] = (m, d)
        shapes[prefix + "ffn.down.weight"] = (d, m)
    return shapes


class IntegerModel:
    """A hash-pinnable, integer-only transformer reference.

    The output is integer Q14 logits; argmax is the model's token decision.
    Saturation is observable through ``saturation_count`` and is a quality
    concern, not a guarantee of agreement with the float training model.
    """

    def __init__(self, config, arrays, *, eps_q28, attention_scale_q14,
                 source_checkpoint_sha256=None, tokenizer_spec=None):
        self.config = _config(config)
        self.arrays = {name: np.asarray(array) for name, array in arrays.items()}
        if type(eps_q28) is not int or type(attention_scale_q14) is not int:
            raise ValueError("numeric manifest scalars must be integers")
        self.eps_q28 = eps_q28
        self.attention_scale_q14 = attention_scale_q14
        self.source_checkpoint_sha256 = source_checkpoint_sha256
        self.tokenizer_spec = tokenizer_spec
        self.forward_count = 0
        self.saturation_count = 0
        self._validate()

    def _validate(self):
        if self.tokenizer_spec is not None:
            from .tokenizer import S0ULTokenizer
            if self.tokenizer_spec != S0ULTokenizer().spec() or self.config["vocab_size"] != 512:
                raise ValueError("integer bundle tokenizer does not match the pinned implementation")
        expected = {}
        for name, shape in _expected_shapes(self.config).items():
            if len(shape) == 2:
                expected[name + ".q"] = shape
                expected[name + ".scale_q24"] = (shape[0],)
            else:
                expected[name + ".q14"] = shape
        head_dim = self.config["dim"] // self.config["n_heads"]
        expected["rope.cos_q14"] = (self.config["max_seq_len"], head_dim // 2)
        expected["rope.sin_q14"] = expected["rope.cos_q14"]
        expected["softmax.exp_q24"] = (LUT_STEPS + 1,)
        if set(self.arrays) != set(expected):
            raise ValueError("integer bundle has unexpected or missing tensors")
        for name, shape in expected.items():
            array = self.arrays[name]
            if array.shape != shape or array.dtype.kind not in "iu":
                raise ValueError(f"invalid integer tensor {name}")
            if np.max(np.abs(_integers(array)), initial=0) > LIMIT and name.endswith(".q14"):
                raise ValueError("normalization gain exceeds supported bound")
            if name.endswith(".q") and (np.min(array) < -127 or np.max(array) > 127):
                raise ValueError("quantized weight outside [-127,127]")
            if name.endswith(".scale_q24") and (np.min(array) < 1 or np.max(array) > (1 << 24)):
                raise ValueError("weight scale outside supported (0,1] range")
        if not 1 <= self.eps_q28 <= (1 << 28):
            raise ValueError("invalid RMSNorm epsilon")
        if not 1 <= self.attention_scale_q14 <= ONE:
            raise ValueError("invalid attention scale")
        lut = self.arrays["softmax.exp_q24"]
        if lut[0] != 1 << 24 or np.any(lut <= 0) or np.any(lut[1:] > lut[:-1]):
            raise ValueError("invalid monotonic exponential lookup table")
        if np.max(np.abs(self.arrays["rope.cos_q14"])) > ONE or np.max(np.abs(self.arrays["rope.sin_q14"])) > ONE:
            raise ValueError("invalid RoPE table range")

    @classmethod
    def from_state_dict(cls, state, config, source_checkpoint_sha256=None):
        """OFFLINE conversion; float arithmetic is intentionally used here."""
        config = _config(config)
        if set(state) != set(_expected_shapes(config)):
            raise ValueError("state dictionary does not match the architecture")
        arrays = {}
        for name, shape in _expected_shapes(config).items():
            value = state[name]
            if hasattr(value, "detach"):
                value = value.detach().cpu().numpy()
            value = np.asarray(value, dtype=np.float64)
            if value.shape != shape or not np.isfinite(value).all():
                raise ValueError(f"invalid source tensor {name}")
            if len(shape) == 2:
                maximum = np.max(np.abs(value), axis=1)
                # A zero row stays zero with the smallest positive Q24 scale.
                scale_q24 = np.maximum(1, _round_float(maximum / 127.0 * (1 << SCALE_BITS)))
                arrays[name + ".scale_q24"] = scale_q24
                effective_scale = scale_q24.astype(np.float64) / (1 << SCALE_BITS)
                arrays[name + ".q"] = np.clip(_round_float(value / effective_scale[:, None]), -127, 127).astype(np.int8)
            else:
                arrays[name + ".q14"] = _round_float(value * ONE)
        head_dim = config["dim"] // config["n_heads"]
        inverse = 1.0 / (10000.0 ** (np.arange(0, head_dim, 2, dtype=np.float64) / head_dim))
        angles = np.outer(np.arange(config["max_seq_len"], dtype=np.float64), inverse)
        arrays["rope.cos_q14"] = _round_float(np.cos(angles) * ONE)
        arrays["rope.sin_q14"] = _round_float(np.sin(angles) * ONE)
        arrays["softmax.exp_q24"] = _round_float(np.exp(-np.arange(LUT_STEPS + 1) / 256.0) * (1 << 24))
        eps = float(config.get("rms_eps", 1e-5))
        if not math.isfinite(eps) or eps <= 0:
            raise ValueError("invalid conversion epsilon")
        return cls(config, arrays, eps_q28=max(1, int(_round_float(eps * (1 << 28)))),
                   attention_scale_q14=int(_round_float(ONE / math.sqrt(head_dim))),
                   source_checkpoint_sha256=source_checkpoint_sha256)

    @classmethod
    def from_checkpoint(cls, checkpoint):
        import torch  # Offline-only checkpoint reader; inference does not call it.
        from .tokenizer import S0ULTokenizer
        path = Path(checkpoint)
        saved = torch.load(path, map_location="cpu", weights_only=True)
        if saved.get("format") != "s0ul-training-v1" or saved.get("tokenizer") != S0ULTokenizer().spec():
            raise ValueError("checkpoint format or pinned tokenizer mismatch")
        result = cls.from_state_dict(saved["model_state_dict"], saved["config"], _sha(path.read_bytes()))
        result.tokenizer_spec = saved["tokenizer"]
        result._validate()
        return result

    def _saturate(self, value):
        value = _integers(value)
        self.saturation_count += int(np.count_nonzero((value > LIMIT) | (value < -LIMIT)))
        return _clip(value)

    def _linear(self, x, name):
        q = self.arrays[name + ".q"]
        scale = self.arrays[name + ".scale_q24"]
        return self._saturate(_round_div(_multiply(_dot(x, q.T), scale), 1 << SCALE_BITS))

    def _norm(self, x, name):
        x = _integers(x)
        roots = []
        for row in x:
            square_sum = sum(int(v) * int(v) for v in row)
            roots.append(math.isqrt(square_sum // len(row) + self.eps_q28))
        normalized = _round_div(_multiply(x, ONE), np.asarray(roots, dtype=np.int64)[:, None])
        return self._saturate(_round_div(_multiply(normalized, self.arrays[name + ".q14"]), ONE))

    def _rotate(self, x):
        positions = x.shape[0]
        cos = self.arrays["rope.cos_q14"][:positions, None, :]
        sin = self.arrays["rope.sin_q14"][:positions, None, :]
        a, b = x[..., 0::2], x[..., 1::2]
        even = _round_div(_multiply(a, cos) - _multiply(b, sin), ONE)
        odd = _round_div(_multiply(a, sin) + _multiply(b, cos), ONE)
        rotated = np.empty_like(x)
        rotated[..., 0::2], rotated[..., 1::2] = even, odd
        return self._saturate(rotated)

    def _softmax_weights(self, scores):
        distances = np.clip(int(np.max(scores)) - scores, 0, 16 * ONE)
        index, fraction = distances // 64, distances % 64
        table = self.arrays["softmax.exp_q24"]
        left, right = table[index], table[np.minimum(index + 1, LUT_STEPS)]
        return _round_div(left * (64 - fraction) + right * fraction, 64)

    def _attention(self, x, prefix):
        t, d = x.shape
        heads = self.config["n_heads"]
        width = d // heads
        q = self._rotate(self._linear(x, prefix + "q.weight").reshape(t, heads, width))
        k = self._rotate(self._linear(x, prefix + "k.weight").reshape(t, heads, width))
        v = self._linear(x, prefix + "v.weight").reshape(t, heads, width)
        output = np.empty_like(v)
        for head in range(heads):
            scores = _round_div(_multiply(_dot(q[:, head], k[:, head].T), self.attention_scale_q14), 1 << 28)
            for position in range(t):
                weights = self._softmax_weights(scores[position, :position + 1])
                weighted = _dot(weights[None, :], v[:position + 1, head])[0]
                output[position, head] = _round_div(weighted, int(np.sum(weights)))
        return self._linear(output.reshape(t, d), prefix + "o.weight")

    def forward(self, input_ids):
        """Return [sequence,vocabulary] integer logits for one causal sequence."""
        ids = _integers(input_ids)
        if ids.ndim != 1 or not 1 <= len(ids) <= self.config["max_seq_len"]:
            raise ValueError("input must be one nonempty sequence within context")
        if np.min(ids) < 0 or np.max(ids) >= self.config["vocab_size"]:
            raise ValueError("token outside vocabulary")
        self.forward_count += 1
        q = self.arrays["token_embedding.weight.q"][ids]
        scales = self.arrays["token_embedding.weight.scale_q24"][ids, None]
        x = self._saturate(_round_div(_multiply(q, scales), 1 << (SCALE_BITS - ACT_BITS)))
        for i in range(self.config["n_layers"]):
            prefix = f"layers.{i}."
            x = self._saturate(x + self._attention(self._norm(x, prefix + "attn_norm.weight"), prefix + "attention."))
            hidden = np.maximum(0, self._linear(self._norm(x, prefix + "ffn_norm.weight"), prefix + "ffn.up.weight"))
            x = self._saturate(x + self._linear(hidden, prefix + "ffn.down.weight"))
        return self._linear(self._norm(x, "norm.weight"), "token_embedding.weight")

    def generate(self, input_ids, max_new_tokens, eos_id=2):
        ids = _integers(input_ids).tolist()
        if type(max_new_tokens) is not int or max_new_tokens < 0:
            raise ValueError("max_new_tokens must be a nonnegative integer")
        if not ids or len(ids) + max_new_tokens > self.config["max_seq_len"]:
            raise ValueError("generation exceeds context")
        if not 0 <= eos_id < self.config["vocab_size"]:
            raise ValueError("EOS outside vocabulary")
        for _ in range(max_new_tokens):
            # NumPy argmax chooses the lowest token ID on a tie.
            next_id = int(np.argmax(self.forward(ids)[-1]))
            ids.append(next_id)
            if next_id == eos_id:
                break
        return ids

    def save(self, output):
        root = Path(output)
        root.mkdir(parents=True, exist_ok=True)
        payload = bytearray()
        entries = []
        for name, source in sorted(self.arrays.items()):
            array = np.asarray(source, dtype=np.int8 if name.endswith(".q") else "<i8")
            raw = array.tobytes(order="C")
            entries.append({"name": name, "shape": list(array.shape), "dtype": array.dtype.str,
                            "offset": len(payload), "nbytes": len(raw), "sha256": _sha(raw)})
            payload.extend(raw)
        raw = bytes(payload)
        (root / "integer-weights.bin").write_bytes(raw)
        manifest = {"format": FORMAT, "config": self.config, "activation_fraction_bits": ACT_BITS,
                    "weight_scale_fraction_bits": SCALE_BITS, "activation_limit": LIMIT,
                    "eps_q28": self.eps_q28, "attention_scale_q14": self.attention_scale_q14,
                    "source_checkpoint_sha256": self.source_checkpoint_sha256, "tokenizer": self.tokenizer_spec,
                    "payload": {"path": "integer-weights.bin", "nbytes": len(raw), "sha256": _sha(raw)},
                    "arrays": entries, "scope": "Python integer inference reference; no EVM deployment or gas result"}
        (root / "integer-manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        return manifest

    def payload_sha256(self):
        """Digest exactly the deterministic integer payload without writing it."""
        digest = hashlib.sha256()
        for name, source in sorted(self.arrays.items()):
            array = np.asarray(source, dtype=np.int8 if name.endswith(".q") else "<i8")
            digest.update(array.tobytes(order="C"))
        return digest.hexdigest()

    @classmethod
    def load(cls, source):
        root = Path(source)
        manifest = json.loads((root / "integer-manifest.json").read_text())
        if manifest["format"] != FORMAT:
            raise ValueError("unsupported integer bundle format")
        for key, value in (("activation_fraction_bits", ACT_BITS), ("weight_scale_fraction_bits", SCALE_BITS), ("activation_limit", LIMIT)):
            if manifest[key] != value:
                raise ValueError("integer numeric specification mismatch")
        payload = manifest["payload"]
        if payload["path"] != "integer-weights.bin":
            raise ValueError("unexpected payload path")
        raw = (root / payload["path"]).read_bytes()
        if len(raw) != payload["nbytes"] or _sha(raw) != payload["sha256"]:
            raise ValueError("integer payload hash or size mismatch")
        arrays = {}
        cursor = 0
        for entry in manifest["arrays"]:
            offset, nbytes = entry["offset"], entry["nbytes"]
            if type(offset) is not int or type(nbytes) is not int or offset < 0 or nbytes <= 0:
                raise ValueError("integer tensor offsets and sizes must be nonnegative/positive integers")
            if entry["name"] in arrays or offset != cursor or entry["dtype"] not in ("|i1", "<i8"):
                raise ValueError("invalid array encoding or layout")
            canonical_dtype = "|i1" if entry["name"].endswith(".q") else "<i8"
            if entry["dtype"] != canonical_dtype:
                raise ValueError("integer tensor uses a noncanonical dtype")
            end = cursor + nbytes
            block = raw[cursor:end]
            if end < cursor or end > len(raw) or len(block) != nbytes or _sha(block) != entry["sha256"]:
                raise ValueError("integer tensor hash or size mismatch")
            dtype = np.dtype(entry["dtype"])
            shape = entry["shape"]
            if any(type(x) is not int or x <= 0 for x in shape) or math.prod(shape) * dtype.itemsize != len(block):
                raise ValueError("integer tensor shape/size mismatch")
            arrays[entry["name"]] = np.frombuffer(block, dtype=dtype).copy().reshape(shape)
            cursor = end
        if cursor != len(raw):
            raise ValueError("unreferenced integer payload bytes")
        return cls(manifest["config"], arrays, eps_q28=manifest["eps_q28"],
                   attention_scale_q14=manifest["attention_scale_q14"],
                   source_checkpoint_sha256=manifest.get("source_checkpoint_sha256"),
                   tokenizer_spec=manifest.get("tokenizer"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sources = parser.add_mutually_exclusive_group(required=True)
    sources.add_argument("--checkpoint")
    sources.add_argument("--bundle")
    parser.add_argument("--output")
    parser.add_argument("--prompt")
    parser.add_argument("--max-new-tokens", type=int, default=24)
    parser.add_argument("--evaluate-data", help="Frozen JSONL split; evaluate every record")
    parser.add_argument("--evaluation-output", help="Write the complete integer evaluation report")
    parser.add_argument("--compare-checkpoint", help="Optional float checkpoint comparison, outside integer model computation")
    args = parser.parse_args()
    model = IntegerModel.from_checkpoint(args.checkpoint) if args.checkpoint else IntegerModel.load(args.bundle)
    report = {"format": FORMAT, "runtime": "integer-only Python/NumPy reference", "evm_deployed": False}
    if args.output:
        manifest = model.save(args.output)
        report["payload"] = manifest["payload"]
    if args.prompt is not None:
        from .tokenizer import S0ULTokenizer
        tokenizer = S0ULTokenizer()
        if model.tokenizer_spec != tokenizer.spec():
            raise ValueError("text generation requires the checkpoint-pinned tokenizer")
        prompt_ids = [tokenizer.bos_id] + tokenizer.encode(args.prompt) + [tokenizer.sep_id]
        started = time.perf_counter()
        result = model.generate(prompt_ids, args.max_new_tokens, tokenizer.eos_id)
        generated = result[len(prompt_ids):]
        terminated = bool(generated and generated[-1] == tokenizer.eos_id)
        text_ids = generated[:-1] if terminated else generated
        report.update(prompt=args.prompt, prompt_tokens=len(prompt_ids), generated_tokens=len(result) - len(prompt_ids),
                      response=tokenizer.decode(text_ids, skip_special_tokens=False), generated_token_ids=generated,
                      terminated=terminated, elapsed_seconds=time.perf_counter() - started,
                      full_forward_calls=model.forward_count, saturated_values=model.saturation_count)
    if args.evaluate_data:
        if not args.evaluation_output:
            parser.error("--evaluate-data requires --evaluation-output")
        evaluation = evaluate_integer_records(model, args.evaluate_data, args.max_new_tokens, args.compare_checkpoint)
        path = Path(args.evaluation_output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(evaluation, indent=2, sort_keys=True) + "\n")
        report["evaluation"] = {"output": str(path), "generation": evaluation["generation"],
                                "float_comparison": evaluation["float_comparison"],
                                "elapsed_seconds": evaluation["elapsed_seconds"]}
    print(json.dumps(report, indent=2))


def evaluate_integer_records(model, path, max_new_tokens=32, compare_checkpoint=None):
    """Evaluate a frozen split; optional float comparison is explicit/offline."""
    from collections import defaultdict
    from .actions import is_valid_action
    from .tokenizer import S0ULTokenizer
    tokenizer = S0ULTokenizer()
    if model.tokenizer_spec != tokenizer.spec() or type(max_new_tokens) is not int or max_new_tokens <= 0:
        raise ValueError("evaluation requires the pinned tokenizer and positive output budget")
    path = Path(path)
    dataset_bytes = path.read_bytes()
    records = [json.loads(line) for line in dataset_bytes.decode().splitlines() if line.strip()]
    if not records or len({row["id"] for row in records}) != len(records):
        raise ValueError("evaluation split must contain unique, nonempty records")
    float_model = None
    if compare_checkpoint:
        import torch
        from .evaluate import load_checkpoint
        if _sha(Path(compare_checkpoint).read_bytes()) != model.source_checkpoint_sha256:
            raise ValueError("float comparison must use the exact integer source checkpoint")
        torch.set_num_threads(2)
        torch.use_deterministic_algorithms(True)
        float_model, _ = load_checkpoint(compare_checkpoint)
    rows = []
    started = time.perf_counter()
    forward_start, saturation_start = model.forward_count, model.saturation_count
    for index, record in enumerate(records):
        prefix = [tokenizer.bos_id] + tokenizer.encode(record["prompt"]) + [tokenizer.sep_id]
        budget = min(max_new_tokens, model.config["max_seq_len"] - len(prefix))
        if budget <= 0:
            raise ValueError(f"record {record['id']} leaves no context for output")
        row_started = time.perf_counter()
        generated = model.generate(prefix, budget, tokenizer.eos_id)[len(prefix):]
        integer_seconds = time.perf_counter() - row_started
        terminated = tokenizer.eos_id in generated
        content_ids = generated[:generated.index(tokenizer.eos_id)] if terminated else generated
        unexpected = any(token in (tokenizer.pad_id, tokenizer.bos_id, tokenizer.sep_id) for token in content_ids)
        prediction = tokenizer.decode(content_ids, skip_special_tokens=False)
        valid = terminated and not unexpected and is_valid_action(prediction)
        expected = record["response"]
        row = {"id": record["id"], "scenario": record.get("scenario"), "prompt": record["prompt"],
               "expected": expected, "prediction": prediction, "generated_token_ids": generated,
               "exact_match": valid and prediction == expected,
               "action_type_match": not unexpected and prediction.split("|", 1)[0] == expected.split("|", 1)[0],
               "format_valid": valid, "unexpected_special_tokens": unexpected,
               "terminated_with_eos": terminated, "integer_elapsed_seconds": integer_seconds}
        if float_model is not None:
            import torch
            with torch.no_grad():
                floating = float_model.generate(torch.tensor([prefix]), budget, tokenizer.eos_id)[0].tolist()[len(prefix):]
            float_content = floating[:floating.index(tokenizer.eos_id)] if tokenizer.eos_id in floating else floating
            row.update(float_generated_token_ids=floating,
                       float_prediction=tokenizer.decode(float_content, skip_special_tokens=False),
                       float_integer_output_ids_equal=floating == generated,
                       matching_token_positions=sum(a == b for a, b in zip(floating, generated)),
                       compared_token_positions=max(len(floating), len(generated)))
        rows.append(row)
        if (index + 1) % 30 == 0:
            print(json.dumps({"event": "integer_evaluation_progress", "completed": index + 1,
                              "total": len(records), "elapsed_seconds": time.perf_counter() - started}), flush=True)
    groups = defaultdict(list)
    for row in rows:
        groups[row["expected"].split("|", 1)[0]].append(row)
    summary = {"examples": len(rows), "exact_action_and_arguments_accuracy": sum(row["exact_match"] for row in rows) / len(rows),
               "action_type_accuracy": sum(row["action_type_match"] for row in rows) / len(rows),
               "format_valid_fraction": sum(row["format_valid"] for row in rows) / len(rows),
               "eos_termination_fraction": sum(row["terminated_with_eos"] for row in rows) / len(rows),
               "per_action": {action: {"examples": len(group), "exact_accuracy": sum(row["exact_match"] for row in group) / len(group)}
                              for action, group in sorted(groups.items())}}
    comparison = None if float_model is None else {
        "same_source_checkpoint": True, "output_ids_equal_count": sum(row["float_integer_output_ids_equal"] for row in rows),
        "examples": len(rows), "matching_token_positions": sum(row["matching_token_positions"] for row in rows),
        "compared_token_positions": sum(row["compared_token_positions"] for row in rows)}
    return {"status": "local_synthetic_held_out_integer_evaluation", "format": FORMAT,
            "split": records[0].get("split"), "split_total_examples": len(records), "evaluated_entire_split": True,
            "checkpoint_sha256": model.source_checkpoint_sha256, "dataset_sha256": _sha(dataset_bytes),
            "integer_payload_sha256": model.payload_sha256(),
            "tokenizer": tokenizer.spec(), "decoding": {"method": "greedy_argmax", "max_new_tokens": max_new_tokens},
            "generation": summary, "float_comparison": comparison,
            "full_forward_calls": model.forward_count - forward_start,
            "saturated_values": model.saturation_count - saturation_start,
            "elapsed_seconds": time.perf_counter() - started,
            "limitations": ["Narrow synthetic action benchmark, not broad language or safety validation",
                            "Python integer reference, not EVM execution or gas measurement",
                            "Optional floating-point comparison is outside integer model computation"],
            "predictions": rows}


if __name__ == "__main__":
    main()
