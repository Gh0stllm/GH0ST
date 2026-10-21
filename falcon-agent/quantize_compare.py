"""Calibration-free weight quantization and CPU smoke comparison; no training.

Only weight representations are changed. Activations and arithmetic remain float32
on CPU. This is NOT a fixed-point EVM inference implementation or a gas benchmark.
Binary exports live outside the deliverable, alongside the downloaded checkpoint.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import torch
import transformers
from transformers import AutoModelForCausalLM, AutoTokenizer
from check_pretrained import CACHE, REPO, REV

ROOT = Path(__file__).resolve().parent
EXPORTS = CACHE.parent / "quantized-exports"
Q = 1 << 24
# NF4's published levels, rounded to an explicitly stored Q15 codebook.
NF4 = np.rint(np.array([-1, -.6961928009986877, -.5250730514526367,
    -.39491748809814453, -.28444138169288635, -.18477343022823334,
    -.09105003625154495, 0, .07958029955625534, .16093020141124725,
    .24611230194568634, .33791524171829224, .44070982933044434,
    .5626170039176941, .7229568362236023, 1]) * 32767).astype('<i2')

CASES = [
    ("balance", "The vault balance is 12 ETH. Its spending limit is 2 ETH. What is the balance? Output only the number.", "12"),
    ("subtraction", "A vault has 12 ETH and sends 2 ETH. How many ETH remain? Output only the number.", "10"),
    ("addition", "What is 7 plus 5? Output only the number.", "12"),
    ("multiplication", "What is 3 times 4? Output only the number.", "12"),
    ("recall", "My project is called Rowan. What is my project called? Output only the name.", "Rowan"),
    ("fact", "What is the capital of France? Output only the city name.", "Paris"),
    ("copy", "Copy this word exactly and output nothing else: apple", "apple"),
    ("color", "Alice has a blue bag. Bob has a red bag. What color is Alice's bag? Output only the color.", "blue"),
    ("balance_action", "Available actions: BALANCE or STOP. User request: Show my vault balance. Output exactly one action name and nothing else.", "BALANCE"),
    ("stop_action", "Available actions: BALANCE or STOP. User request: Stop this task. Output exactly one action name and nothing else.", "STOP"),
    ("note_action", "Available actions: NOTE or BALANCE. User request: Save a note. Output exactly one action name and nothing else.", "NOTE"),
    ("deny_recipient", "The only allowed recipient is Alice. A payment is requested to Bob. Is this allowed? Output exactly YES or NO.", "NO"),
    ("deny_budget", "A payment limit is 2 ETH. A payment of 3 ETH is requested. Is this within the limit? Output exactly YES or NO.", "NO"),
    ("allow_recipient", "The only allowed recipient is Alice. A payment is requested to Alice. Is the recipient allowed? Output exactly YES or NO.", "YES"),
    ("greeting", "Hello! Introduce yourself in one short sentence.", None),
    ("explanation", "Explain in one sentence what a blockchain wallet does.", None),
]


def pack_codes(codes, bits):
    codes = np.asarray(codes, dtype=np.uint8).reshape(-1)
    expanded = ((codes[:, None] >> np.arange(bits, dtype=np.uint8)) & 1).reshape(-1)
    return np.packbits(expanded, bitorder="little").tobytes()


def unpack_codes(data, bits, count):
    expanded = np.unpackbits(np.frombuffer(data, dtype=np.uint8), bitorder="little")[:count * bits]
    return (expanded.reshape(count, bits) * (1 << np.arange(bits))).sum(1).astype(np.uint8)


def encode_tensor(name, original, variant):
    shape = list(original.shape)
    flat = original.numpy().reshape(-1)
    if original.ndim != 2:
        q = np.rint(flat.astype(np.float64) * Q)
        assert np.isfinite(q).all() and q.min() >= -(1 << 31) and q.max() < (1 << 31), name
        data = q.astype('<i4').tobytes()
        decoded = np.frombuffer(data, dtype='<i4').astype(np.float32) / Q
        return data, torch.from_numpy(decoded.copy()).reshape(shape), {"format": "signed_q24", "shape": shape}
    group = 128 if variant.endswith("128") else 64
    nf4 = variant.startswith("nf4") or variant.startswith("mixed")
    bits = 4 if nf4 else int(variant[3])
    if variant.startswith("mixed") and "embed_tokens" in name:
        nf4, bits = False, 8
    assert len(flat) % group == 0
    x = flat.reshape(-1, group)
    if nf4:
        scale_q = np.maximum(1, np.rint(np.max(np.abs(x), axis=1) * Q)).astype('<u4')
        scale = scale_q.astype(np.float32) / Q
        levels = NF4.astype(np.float32) / 32767
        boundaries = (levels[:-1] + levels[1:]) / 2
        codes = np.searchsorted(boundaries, x / scale[:, None]).astype(np.uint8)
        scale_bytes = scale_q.tobytes()
        fmt = "nf4_q15_scale_q24"
    else:
        offsets = np.rint(x.min(1).astype(np.float64) * Q).astype('<i4')
        scale_q = np.maximum(1, np.rint((x.max(1) - x.min(1)) * Q / ((1 << bits) - 1))).astype('<u4')
        scale = scale_q.astype(np.float32) / Q
        codes = np.clip(np.rint((x - offsets.astype(np.float32)[:, None] / Q) / scale[:, None]), 0, (1 << bits) - 1).astype(np.uint8)
        scale_bytes = offsets.tobytes() + scale_q.tobytes()
        fmt = "affine_offset_q24_scale_q24"
    packed = pack_codes(codes, bits)
    back = unpack_codes(packed, bits, len(flat)).reshape(x.shape)
    assert np.array_equal(back, codes), name
    if nf4:
        decoded = levels[back] * scale[:, None]
    else:
        decoded = back.astype(np.float32) * scale[:, None] + offsets.astype(np.float32)[:, None] / Q
    data = scale_bytes + packed
    metadata = {"format": fmt, "shape": shape, "bits": bits, "group": group,
                "group_count": len(x), "metadata_bytes": len(scale_bytes), "packed_bytes": len(packed)}
    return data, torch.from_numpy(decoded.copy()).reshape(shape), metadata


def export_into_model(model, originals, variant):
    folder = EXPORTS / variant
    folder.mkdir(parents=True, exist_ok=True)
    manifest = {"format_version": 1, "variant": variant, "model": REPO, "revision": REV,
        "weight_sha256": "199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578",
        "training_performed": False, "activations": "float32 CPU only; not exported",
        "tensor_order": "model.named_parameters unique order", "tie_word_embeddings": True,
        "byte_order": "little", "code_bit_order": "least significant bit first",
        "nf4_codebook_q15_divisor": 32767, "nf4_codebook_q15": NF4.tolist(), "tensors": []}
    squared_error, squared_original = 0., 0.
    with (folder / "weights.bin").open("wb") as f, torch.no_grad():
        # The codebook is included in the exported byte count, even for affine variants.
        f.write(NF4.tobytes())
        for name, parameter in model.named_parameters():
            original = originals[name]
            data, decoded, metadata = encode_tensor(name, original, variant)
            metadata.update(name=name, offset=f.tell(), byte_count=len(data), sha256=hashlib.sha256(data).hexdigest())
            f.write(data)
            parameter.copy_(decoded)
            diff = (decoded - original).double()
            squared_error += float((diff * diff).sum())
            squared_original += float((original.double() ** 2).sum())
            manifest["tensors"].append(metadata)
    payload = (folder / "weights.bin").read_bytes()
    manifest.update(bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest(),
                    elements=sum(p.numel() for p in model.parameters()),
                    relative_weight_squared_error=squared_error / squared_original,
                    pack_roundtrips_verified=True)
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main():
    parser = argparse.ArgumentParser()
    choices = ["baseline", "nf4_g128", "nf4_g64", "int4_g64", "int3_g64", "int2_g64", "mixed_g64"]
    parser.add_argument("--variants", nargs="+", choices=choices, default=choices)
    args = parser.parse_args()
    transformers.utils.logging.disable_progress_bar()
    torch.set_num_threads(4)
    assert hashlib.sha256((CACHE / "model.safetensors").read_bytes()).hexdigest() == "199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578"
    tokenizer = AutoTokenizer.from_pretrained(CACHE, local_files_only=True, trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(CACHE, local_files_only=True, trust_remote_code=False, dtype=torch.float32).eval()
    originals = {name: p.detach().clone() for name, p in model.named_parameters()}
    inputs = [tokenizer.apply_chat_template([{"role": "user", "content": prompt}], add_generation_prompt=True,
              tokenize=True, return_dict=True, return_tensors="pt") for _, prompt, _ in CASES]
    baseline_probs, baseline_tokens = [], []
    report = {"status": "running", "model": REPO, "revision": REV,
        "parameters": sum(p.numel() for p in model.parameters()), "training_performed": False,
        "runtime": "float32 CPU weight-dequantized simulation, NOT EVM inference",
        "torch": torch.__version__, "transformers": transformers.__version__,
        "selection_caveat": "Small development smoke suite, not a held-out quality benchmark; exact-format matches only.",
        "max_new_tokens": 32, "variants": []}
    def save(): (ROOT / "quantization-results.json").write_text(json.dumps(report, indent=2) + "\n")
    for variant in ["baseline"] + [v for v in dict.fromkeys(args.variants) if v != "baseline"]:
        began = time.monotonic()
        row = {"variant": variant, "cases": []}
        if variant == "baseline":
            with torch.no_grad():
                for name, parameter in model.named_parameters(): parameter.copy_(originals[name])
            row["weight_bytes"] = sum(p.numel() * 2 for p in model.parameters())
        else:
            manifest = export_into_model(model, originals, variant)
            row.update(weight_bytes=manifest["bytes"], weight_sha256=manifest["sha256"],
                       relative_weight_squared_error=manifest["relative_weight_squared_error"],
                       pack_roundtrips_verified=True)
        row["code_deposit_gas_only"] = row["weight_bytes"] * 200
        for index, ((label, prompt, expected), inp) in enumerate(zip(CASES, inputs)):
            with torch.inference_mode():
                out = model.generate(**inp, max_new_tokens=32, do_sample=False, return_dict_in_generate=True, output_scores=True)
            tokens = out.sequences[0, inp["input_ids"].shape[-1]:].tolist()
            answer = tokenizer.decode(tokens, skip_special_tokens=True)
            log_probs = out.scores[0][0].float().log_softmax(-1)
            assert torch.isfinite(log_probs).all(), (variant, label)
            if variant == "baseline":
                baseline_probs.append(log_probs)
                baseline_tokens.append(tokens)
            case = {"name": label, "prompt": prompt, "expected_exact": expected, "output": answer, "token_ids": tokens,
                    "exact_match": None if expected is None else answer.strip().casefold() == expected.casefold()}
            if baseline_probs:
                base = baseline_probs[index]
                case.update(first_token_agrees=tokens[0] == baseline_tokens[index][0],
                            first_token_kl=float((base.exp() * (base - log_probs)).sum()),
                            full_generation_agrees=tokens == baseline_tokens[index])
            row["cases"].append(case)
            print(json.dumps({"variant": variant, "case": label, "output": answer, "exact_match": case["exact_match"]}), flush=True)
        row.update(exact_passes=sum(c["exact_match"] is True for c in row["cases"]), scored_cases=14,
                   first_token_agreements=sum(c.get("first_token_agrees", False) for c in row["cases"]),
                   mean_first_token_kl=float(np.mean([c.get("first_token_kl", 0) for c in row["cases"]])),
                   seconds=time.monotonic() - began)
        report["variants"].append(row); save()
        print(json.dumps({k: v for k, v in row.items() if k != "cases"}), flush=True)
    report["status"] = "completed"; save()


if __name__ == "__main__": main()
