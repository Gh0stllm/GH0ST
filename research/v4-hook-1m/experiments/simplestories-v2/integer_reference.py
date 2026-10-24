"""Independent integer reference and checkpoint export for the local EVM test.

All trained tensors come from the pinned public checkpoint. This process is
offline and does not train, connect to a chain, or load remote Python code.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import subprocess

os.environ["TOKENIZERS_PARALLELISM"] = "false"
ROOT = Path(__file__).resolve().parent
Q = 4096


def save(name, value):
    path = ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def main():
    import numpy as np
    import torch
    from safetensors.numpy import load_file
    from transformers import AutoModelForCausalLM, AutoTokenizer

    torch.set_num_threads(2)
    spec = json.loads((ROOT / "contracts/protocol.json").read_text())
    provenance = json.loads((ROOT / "provenance.json").read_text())
    raw = load_file(str(ROOT / "model-cache/model.safetensors"))
    tensors = {}
    binary = bytearray()
    errors = {}
    for entry in spec["weights"]["tensor_layout"]:
        name = entry["name"]
        array = raw[name]
        assert list(array.shape) == entry["shape"]
        values = np.rint(array.astype(np.float64) * Q).astype(np.int64)
        assert int(values.min()) >= -32768 and int(values.max()) <= 32767, name
        assert len(binary) == entry["byte_offset"], name
        binary.extend(values.astype(">i2").tobytes())
        tensors[name] = values
        errors[name] = float(np.max(np.abs(values / Q - array)))
    assert len(binary) == 2471936

    cos = np.array([[round(math.cos(p * 10000 ** (-j / 16)) * Q)
                     for j in range(16)] for p in range(16)], dtype=np.int64)
    sin = np.array([[round(math.sin(p * 10000 ** (-j / 16)) * Q)
                     for j in range(16)] for p in range(16)], dtype=np.int64)
    sigmoid = np.array([round(65536 / (1 + math.exp(-i / 16))) for i in range(257)], dtype=np.int64)
    exp = np.array([round(math.exp(-i / 16) * 1048576) for i in range(257)], dtype=np.int64)
    table = cos.astype(">i2").tobytes() + sin.astype(">i2").tobytes() + sigmoid.astype(">u4").tobytes() + exp.astype(">u4").tobytes()
    assert len(table) == spec["table_blob"]["total_bytes"] == 3080
    (ROOT / "model").mkdir(exist_ok=True)
    (ROOT / "model/weights.bin").write_bytes(binary)
    (ROOT / "model/tables.bin").write_bytes(table)
    artifacts = {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                 for name, data in [("weights.bin", binary), ("tables.bin", table)]}
    manifest = {"schema_version": 1, "repository": provenance["repository"], "revision": provenance["revision"],
                "checkpoint_sha256": provenance["files"]["model.safetensors"]["sha256"],
                "parameters": spec["parameter_count"], "weight_scale": Q, "clipped_weights": 0,
                "maximum_absolute_weight_error": max(errors.values()), "per_tensor_maximum_weight_error": errors,
                "chunk_bytes": 24000, "model_hash_domain": spec["model_hash_domain"], "artifacts": artifacts,
                "bounds": spec["bounds"], "quantization": "INT16 Q12, nearest-even export; exact documented integer operations at inference",
                "limitations": ["Research port uses bounded 16-token context and up to 4 generated tokens per EVM call.",
                                "Fixed-point normalization, lookup-table nonlinearities and rounding approximate FP32.",
                                "This exports the actual pretrained transformer; no distillation or retraining is performed."]}
    save("model/manifest.json", manifest)

    def div(a, b):
        a = np.asarray(a, dtype=np.int64)
        return np.sign(a) * (np.abs(a) // b)

    def checked(a):
        a = np.asarray(a, dtype=np.int64)
        assert int(a.min()) >= -(2 ** 31) and int(a.max()) < 2 ** 31
        return a

    def linear(x, w):
        return checked(div(x @ w.T, Q))

    def rms(x, w):
        denominator = np.array([math.isqrt(int((row * row).sum()) // 128 + 17) for row in x], dtype=np.int64)
        normalized = div(x * Q, denominator[:, None])
        return checked(div(normalized * w, Q))

    def rotate(x):
        out = x.copy()
        for pos in range(x.shape[0]):
            for h in range(x.shape[1]):
                a, b = x[pos, h, :16], x[pos, h, 16:]
                out[pos, h, :16] = div(a * cos[pos] - b * sin[pos], Q)
                out[pos, h, 16:] = div(b * cos[pos] + a * sin[pos], Q)
        return checked(out)

    def interpolate(values, magnitude, saturated):
        scaled = np.asarray(magnitude, dtype=np.int64) * 16
        index, remainder = scaled // Q, scaled % Q
        safe_index = np.minimum(index, 255)
        result = (values[safe_index] * (Q - remainder) + values[safe_index + 1] * remainder) // Q
        return np.where(index >= 256, saturated, result)

    def silu(x):
        positive = interpolate(sigmoid, np.abs(x), 65536)
        probability = np.where(x >= 0, positive, 65536 - positive)
        return checked(div(x * probability, 65536))

    def forward(ids, include_trace=False):
        assert 1 <= len(ids) <= 16
        assert all(0 <= int(i) < 4019 for i in ids)
        x = tensors["model.embed_tokens.weight"][ids].copy()
        trace = []
        for layer in range(4):
            prefix = f"model.layers.{layer}."
            normal = rms(x, tensors[prefix + "input_layernorm.weight"])
            query = rotate(linear(normal, tensors[prefix + "self_attn.q_proj.weight"]).reshape(len(ids), 4, 32))
            key = rotate(linear(normal, tensors[prefix + "self_attn.k_proj.weight"]).reshape(len(ids), 2, 32))
            value = linear(normal, tensors[prefix + "self_attn.v_proj.weight"]).reshape(len(ids), 2, 32)
            attended = np.zeros((len(ids), 4, 32), dtype=np.int64)
            for pos in range(len(ids)):
                for h in range(4):
                    scores = div(key[:pos + 1, h // 2] @ query[pos, h], 23170)
                    weights = interpolate(exp, scores.max() - scores, 0)
                    attended[pos, h] = div(weights @ value[:pos + 1, h // 2], int(weights.sum()))
            x = checked(x + linear(attended.reshape(len(ids), 128), tensors[prefix + "self_attn.o_proj.weight"]))
            normal = rms(x, tensors[prefix + "post_attention_layernorm.weight"])
            gate = silu(linear(normal, tensors[prefix + "mlp.gate_proj.weight"]))
            up = linear(normal, tensors[prefix + "mlp.up_proj.weight"])
            product = checked(div(gate * up, Q))
            x = checked(x + linear(product, tensors[prefix + "mlp.down_proj.weight"]))
            if include_trace:
                trace.append(x.tolist())
        hidden = rms(x, tensors["model.norm.weight"])[-1]
        logits = linear(hidden[None, :], tensors["model.embed_tokens.weight"])[0]
        logit_hash = None
        if include_trace:
            encoded = (32).to_bytes(32, "big") + len(logits).to_bytes(32, "big") + b"".join(
                int(v).to_bytes(32, "big", signed=True) for v in logits)
            # Use the project's existing audited Keccak implementation; no new package or network required.
            node = os.environ.get("NODE_BINARY", "/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
            logit_hash = subprocess.check_output([node, "--input-type=module", "-e",
                'import fs from "node:fs";import {keccak256} from "ethers";process.stdout.write(keccak256(fs.readFileSync(0,"utf8").trim()));'],
                input=("0x" + encoded.hex()).encode(), cwd=ROOT.parent.parent).decode()
        return {"next_token": int(np.argmax(logits)), "last_hidden": hidden.tolist(),
                "logits": logits.tolist(), "logit_hash": logit_hash, "layer_outputs": trace}

    tokenizer = AutoTokenizer.from_pretrained(ROOT / "model-cache", local_files_only=True, trust_remote_code=False)
    fp32 = AutoModelForCausalLM.from_pretrained(ROOT / "model-cache", local_files_only=True, trust_remote_code=False,
                                              attn_implementation="eager").eval()
    fixtures = []
    with torch.inference_mode():
        for name, prompt in [("single-token", "The"), ("two-token-attention", "The little"), ("market-context", "The market")]:
            ids = tokenizer.encode(prompt, add_special_tokens=False)
            output = forward(ids, True)
            exact = fp32(torch.tensor([ids]), output_hidden_states=True).logits[0, -1].float().numpy()
            output.update({"name": name, "prompt": prompt, "prompt_ids": ids,
                           "next_token_text": tokenizer.decode([output["next_token"]]),
                           "fp32_next_token": int(np.argmax(exact)),
                           "fp32_next_token_text": tokenizer.decode([int(np.argmax(exact))]),
                           "fp32_next_token_matches": output["next_token"] == int(np.argmax(exact)),
                           "logits_max_absolute_error_fp32": float(np.max(np.abs(np.array(output["logits"]) / Q - exact))),
                           "logits_rmse_fp32": float(np.sqrt(np.mean((np.array(output["logits"]) / Q - exact) ** 2)))})
            fixtures.append(output)
            print(json.dumps({k: output[k] for k in ["name", "prompt_ids", "next_token_text", "fp32_next_token_text", "fp32_next_token_matches", "logits_rmse_fp32"]}), flush=True)

        comparisons = []
        for prompt in ["The little bird", "A child opened", "The market", "She was afraid"]:
            initial = tokenizer.encode(prompt, add_special_tokens=False)
            ids = initial.copy()
            quantized = []
            step_matches = []
            for _ in range(min(8, 16 - len(initial))):
                out = forward(ids)
                actual = int(fp32(torch.tensor([ids])).logits[0, -1].argmax())
                nxt = out["next_token"]
                step_matches.append(nxt == actual)
                quantized.append(nxt)
                ids.append(nxt)
                if nxt == 1:
                    break
            original = fp32.generate(torch.tensor([initial]), max_new_tokens=len(quantized), do_sample=False,
                                     eos_token_id=1, pad_token_id=0)[0, len(initial):].tolist()
            comparisons.append({"prompt": prompt, "input_ids": initial, "integer_ids": quantized,
                                "integer_text": tokenizer.decode(quantized, skip_special_tokens=True),
                                "fp32_ids": original, "fp32_text": tokenizer.decode(original, skip_special_tokens=True),
                                "argmax_matches_on_integer_context": step_matches,
                                "ended_eos": bool(quantized and quantized[-1] == 1)})
    save("integer-reference.json", {"schema_version": 1, "protocol": "contracts/protocol.json", "manifest": "model/manifest.json",
                                     "fixtures": fixtures, "short_generation_comparisons": comparisons,
                                     "limitations": ["Integer arithmetic is an approximation of the original FP32 model.",
                                                     "Generation comparison is limited to four short greedy contexts, not a broad quality benchmark."]})
    print("Export and independent integer reference complete", flush=True)


if __name__ == "__main__":
    main()
