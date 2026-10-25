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
CACHE = Path(os.environ.get("GH0ST_MODEL_CACHE") or str(ROOT.parent / "model-cache"))
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


class IntegerGPT2:
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
                item = {"gamma": decoded[:768], "beta": decoded[768:]}
            elif kind == "position":
                item = np.frombuffer(payload, dtype=">i4").astype(np.int64).reshape(1024, 768)
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
        self.keys = np.zeros((12, 1024, 12, 64), dtype=np.int64)
        self.values = np.zeros_like(self.keys)

    def embedding(self, token_id: int) -> np.ndarray:
        table = self.tensors[0]
        row = table["weights"][token_id].astype(np.int64)
        return trunc0(row * table["scale"][token_id], Q) + self.tensors[1][self.position]

    def layernorm(self, x: np.ndarray, tensor_id: int) -> np.ndarray:
        tensor = self.tensors[tensor_id]
        mean = trunc0(int(x.sum()), 768)
        delta = x - mean
        variance = int(np.dot(delta, delta)) // 768
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
        lookup = self.tensors[76][np.minimum(index, 2048)]
        lookup = np.where(index >= 2048, Q, lookup)
        tanh = np.sign(inner) * lookup
        return trunc0(x * (Q + tanh), 2 * Q)

    def attention(self, qkv: np.ndarray, layer: int, trace: Trace | None) -> np.ndarray:
        q, k, v = qkv.reshape(3, 12, 64)
        self.keys[layer, self.position] = k
        self.values[layer, self.position] = v
        count = self.position + 1
        output = np.zeros((12, 64), dtype=np.int64)
        all_scores = []
        for head in range(12):
            scores = trunc0(self.keys[layer, :count, head] @ q[head], 8 * Q)
            maximum = int(scores.max())
            difference = maximum - scores
            index = np.minimum(difference // 16, 4096)
            exponential = np.where(difference > 65536, 0, self.tensors[75][index])
            weighted = exponential @ self.values[layer, :count, head]
            output[head] = trunc0(weighted, int(exponential.sum()))
            all_scores.append(scores)
            if trace:
                trace.put(f"l{layer:02d}-scores-h{head:02d}", scores, 4, 5, layer, head)
        if trace:
            trace.put(f"l{layer:02d}-scores", np.concatenate(all_scores), 4, 5, layer)
        return output.reshape(768)

    def logits(self, x: np.ndarray) -> np.ndarray:
        tensor = self.tensors[0]
        return trunc0((tensor["weights"] @ x) * tensor["scale"], SCALE)

    def step(self, token_id: int, trace: Trace | None = None) -> np.ndarray:
        if token_id < 0 or token_id >= 50257:
            raise ValueError("token outside GPT-2 vocabulary")
        if self.position >= 1024:
            raise ValueError("GPT-2 context is full; start a new session")
        x = self.embedding(token_id)
        if trace:
            trace.put("embedding", x, 1, 0)
        for layer in range(12):
            first = 3 + layer * 6
            n = self.layernorm(x, first)
            if trace:
                trace.put(f"l{layer:02d}-ln1", n, 2, 1, layer)
            qkv = self.linear(n, first + 2)
            if trace:
                trace.put(f"l{layer:02d}-qkv", qkv, 3, 2, layer)
            attention = self.attention(qkv, layer, trace)
            if trace:
                trace.put(f"l{layer:02d}-attention", attention, 5, 3, layer, 11)
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
            trace.put("final-ln", n, 10, 1, 12)
        logits = self.logits(n)
        if trace:
            trace.put("logits", logits, 11, None, 12)
        self.position += 1
        return logits


def compare(args):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    manifest = json.loads((args.data / "manifest.json").read_text())
    with (CACHE / "model.safetensors").open("rb") as checkpoint:
        if hashlib.file_digest(checkpoint, "sha256").hexdigest() != manifest["checkpoint_sha256"]:
            raise ValueError("FP32 reference checkpoint differs from the exported model")
    for filename, metadata in manifest["tokenizer"]["files"].items():
        payload = (CACHE / filename).read_bytes()
        if len(payload) != metadata["bytes"] or sha256(payload) != metadata["sha256"]:
            raise ValueError("FP32 reference tokenizer differs from export: " + filename)
    torch.set_num_threads(4)
    tokenizer = AutoTokenizer.from_pretrained(CACHE, local_files_only=True, trust_remote_code=False)
    fp32 = AutoModelForCausalLM.from_pretrained(
        CACHE, local_files_only=True, trust_remote_code=False, use_safetensors=True,
        attn_implementation="eager", dtype=torch.float32).eval().to("cpu")
    oracle = IntegerGPT2(args.data)
    cases = [{"id": "eos", "prompt": "<|endoftext|>", "input_ids": [50256]},
             {"id": "the-price", "prompt": "The price"},
             {"id": "capital", "prompt": "The capital of France is"}]
    if args.quick:
        cases = cases[:1]
    outputs = []
    agreement = 0
    tested = 0
    with torch.inference_mode():
        for case in cases:
            ids = case.get("input_ids") or tokenizer.encode(case["prompt"])
            oracle.reset()
            fp_cache = None
            position_reports = []
            generated = []
            pending = list(ids)
            started = time.perf_counter()
            while pending or len(generated) < args.tokens:
                token = pending.pop(0) if pending else generated[-1]
                position = oracle.position
                trace = Trace(args.data, case["id"], position)
                integer_logits = oracle.step(token, trace)
                chosen = int(np.argmax(integer_logits))
                floating = fp32(input_ids=torch.tensor([[token]]), past_key_values=fp_cache,
                                use_cache=True)
                fp_cache = floating.past_key_values
                float_logits = floating.logits[0, -1].numpy().astype(np.float64)
                fp_chosen = int(np.argmax(float_logits))
                match = chosen == fp_chosen
                agreement += int(match)
                tested += 1
                decoded_logits = integer_logits.astype(np.float64) / Q
                float_centered = float_logits - float_logits.mean()
                integer_centered = decoded_logits - decoded_logits.mean()
                cosine = float(np.dot(float_centered, integer_centered) /
                               (np.linalg.norm(float_centered) * np.linalg.norm(integer_centered)))
                top8 = np.argsort(-integer_logits, kind="stable")[:8]
                position_reports.append({"position": position, "input_token_id": token,
                    "next_token_id": chosen, "next_token_text": tokenizer.decode([chosen]),
                    "fp32_teacher_forced_next_token_id": fp_chosen,
                    "fp32_teacher_forced_next_token_text": tokenizer.decode([fp_chosen]),
                    "argmax_matches_fp32": match,
                    "logits_rmse": float(np.sqrt(np.mean((decoded_logits - float_logits) ** 2))),
                    "centered_logits_cosine": cosine,
                    "integer_top8": [{"id": int(i), "text": tokenizer.decode([int(i)]),
                                       "logit_q12": int(integer_logits[i])} for i in top8],
                    "stages": trace.stages})
                if not pending:
                    generated.append(chosen)
                print(json.dumps({"case": case["id"], "position": position, "input": token,
                                  "integer_next": chosen, "fp32_next": fp_chosen,
                                  "matches": match, "cosine": round(cosine, 6)}), flush=True)
            encoded = torch.tensor([ids])
            fp_generated = fp32.generate(input_ids=encoded, max_new_tokens=args.tokens,
                                        do_sample=False, use_cache=True,
                                        pad_token_id=tokenizer.eos_token_id)[0, len(ids):].tolist()
            outputs.append({"id": case["id"], "prompt": case["prompt"], "input_ids": ids,
                            "integer_generated_ids": generated,
                            "integer_continuation": tokenizer.decode(generated),
                            "fp32_generated_ids": fp_generated,
                            "fp32_continuation": tokenizer.decode(fp_generated),
                            "free_generation_token_agreement": sum(a == b for a, b in zip(generated, fp_generated)),
                            "seconds": time.perf_counter() - started,
                            "positions": position_reports})
            print(json.dumps({"case": case["id"], "integer": tokenizer.decode(generated),
                              "fp32": tokenizer.decode(fp_generated)}), flush=True)
    report = {"schema_version": 1, "status": "PASS_FULL_MODEL_INTEGER_REFERENCE",
              "model_id_hash": oracle.manifest["model_id_hash"],
              "checkpoint_sha256": oracle.manifest["checkpoint_sha256"],
              "unique_parameter_count": oracle.manifest["unique_parameter_count"],
              "architecture": oracle.manifest["architecture"],
              "arithmetic": oracle.manifest["runtime_arithmetic"],
              "execution": "local CPU only; all matrices and vocabulary rows executed for each token",
              "trace_format": "one signed i32 big-endian binary per complete phase vector",
              "cases": outputs,
              "quality_comparison": {"teacher_forced_positions": tested, "argmax_matches": agreement,
                                     "argmax_agreement": agreement / tested,
                                     "comparison": "FP32 checkpoint on exactly the same input history as integer oracle",
                                     "free_generation_total_tokens": len(outputs) * args.tokens,
                                     "free_generation_matches": sum(r["free_generation_token_agreement"] for r in outputs)},
              "limitations": ["Three short prompts are a smoke check, not a general quality or perplexity benchmark.",
                              "Quantization and fixed-point nonlinearities do not preserve FP32 parity.",
                              "CPU traces require separate EVM stage-by-stage verification before claiming on-chain generation.",
                              "Tokenizer executes off-chain; model token IDs and all token arithmetic are deterministic."]}
    (args.data / "reference-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"status": report["status"], **report["quality_comparison"]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=ROOT.parent / "data")
    parser.add_argument("--tokens", type=int, default=3)
    parser.add_argument("--quick", action="store_true")
    compare(parser.parse_args())
