"""CPU reference and model inventory. Does not execute on a blockchain.

Runs only a pinned public checkpoint, with remote Python code disabled.
No secrets, transaction signing, paid APIs or mainnet writes are used.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import time
from datetime import datetime, timezone
from pathlib import Path


def assess(case_id: str, output: str) -> dict:
    """Narrow checks, not a general quality or safety score."""
    text = output.strip()
    if case_id == "action_json":
        try:
            value = json.loads(text)
        except (ValueError, TypeError):
            return {"check": "strict_json_schema", "passed": False}
        passed = (isinstance(value, dict) and set(value) == {"action", "goal"}
                  and value["action"] == "set_goal"
                  and isinstance(value["goal"], str)
                  and "solidity" in value["goal"].lower())
        return {"check": "strict_json_schema", "passed": passed}
    if case_id == "arithmetic":
        return {"check": "exact_answer", "passed": text == "43"}
    if case_id == "provided_fact":
        return {"check": "contains_provided_project_name", "passed": "cedar" in text.lower()}
    return {"check": "manual_review_required", "passed": None}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--max-new-tokens", type=int, default=32)
    parser.add_argument("--context-budget", type=int, default=256)
    parser.add_argument("--dtype", choices=["float32", "bfloat16"], default="float32")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "results" / "reference.json")
    args = parser.parse_args()
    if min(args.threads, args.max_new_tokens, args.context_budget) < 1:
        parser.error("Numeric settings must be positive")

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    root = Path(__file__).resolve().parent
    lock = json.loads((root / "model-lock.json").read_text())
    cases = json.loads((root / "prompts.json").read_text())
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.manual_seed(0)
    torch.use_deterministic_algorithms(True)
    started = time.perf_counter()
    tokenizer = AutoTokenizer.from_pretrained(**dict(pretrained_model_name_or_path=lock["model_id"],
                                                     revision=lock["revision"], trust_remote_code=False))
    model = AutoModelForCausalLM.from_pretrained(
        lock["model_id"], revision=lock["revision"], trust_remote_code=False,
        dtype=getattr(torch, args.dtype), attn_implementation="eager"
    ).to("cpu").eval()
    load_seconds = time.perf_counter() - started
    tensors = [{"name": name, "shape": list(p.shape), "parameters": p.numel(),
                "dtype": str(p.dtype)} for name, p in model.named_parameters()]
    parameter_count = sum(t["parameters"] for t in tensors)
    # The formulas assume all unique parameters can be packed uniformly.
    # Real quantization also needs scales, padding and sometimes higher precision.
    estimates = {str(bits): math.ceil(parameter_count * bits / 8) for bits in (4, 8, 16, 32)}
    config = model.config.to_dict()
    eos = model.generation_config.eos_token_id
    eos_ids = set(eos if isinstance(eos, list) else [eos])
    head_dim = config.get("head_dim") or config["hidden_size"] // config["num_attention_heads"]
    attention_layers = config["layer_types"].count("full_attention")
    kv_elements_per_context_token = 2 * attention_layers * config["num_key_value_heads"] * head_dim
    report = {
        "status": "local_cpu_reference_only",
        "onchain_inference_executed": False,
        "gas_per_token": None,
        "reply_cost_eth": None,
        "model": lock,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "machine": {"platform": platform.platform(), "python": platform.python_version(),
                    "cpu_threads": args.threads, "device": "cpu"},
        "versions": {p: importlib.metadata.version(p) for p in ["torch", "transformers", "numpy", "safetensors"]},
        "numeric_format": args.dtype,
        "attention_implementation": "eager",
        "generation": {"sampling": False, "max_new_tokens": args.max_new_tokens,
                       "total_context_budget": args.context_budget},
        "load_seconds_including_download_if_needed": load_seconds,
        "unique_parameters": parameter_count,
        "ideal_packed_parameter_bytes_before_overhead": estimates,
        "kv_cache_elements_per_context_token": kv_elements_per_context_token,
        "kv_cache_bytes_at_context_budget_float32": kv_elements_per_context_token * args.context_budget * 4,
        "inventory": tensors,
        "cases": [],
        "limitations": [
            "CPU timings do not predict Stylus gas or blockchain reply latency.",
            "Floating-point outputs are a quality baseline, not an integer contract parity test.",
            "Ideal packed sizes exclude quantization metadata, tokenizer, transient state and code.",
            "Six prompts are smoke checks, not a representative model-quality evaluation.",
            "On-chain activation, resource limits and the full inference runtime remain untested."
        ]
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Warm-up uses the same code path but is not counted as a test case.
    warm = tokenizer.apply_chat_template(cases[0]["messages"], tokenize=True,
                                        add_generation_prompt=True, return_tensors="pt", return_dict=True)
    with torch.inference_mode():
        model.generate(**warm, max_new_tokens=1, do_sample=False, use_cache=True,
                       pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id)
    for case in cases:
        inputs = tokenizer.apply_chat_template(case["messages"], tokenize=True,
                                               add_generation_prompt=True, return_tensors="pt", return_dict=True)
        prompt_tokens = inputs["input_ids"].shape[-1]
        if prompt_tokens + args.max_new_tokens > args.context_budget:
            raise ValueError(f"{case['id']}: prompt plus output exceeds context budget; no silent truncation")
        start = time.perf_counter()
        with torch.inference_mode():
            result = model.generate(**inputs, max_new_tokens=args.max_new_tokens, do_sample=False,
                                    use_cache=True, pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id)
        elapsed = time.perf_counter() - start
        ids = result[0, prompt_tokens:].tolist()
        output = tokenizer.decode(ids, skip_special_tokens=True)
        item = {"id": case["id"], "messages": case["messages"], "prompt_tokens": prompt_tokens,
                "generated_tokens_including_eos": len(ids), "generated_token_ids": ids,
                "input_token_ids": inputs["input_ids"][0].tolist(), "output": output,
                "generation_seconds": elapsed,
                "tokens_per_second_including_prefill": len(ids) / elapsed,
                "stopped_at_eos": bool(ids and ids[-1] in eos_ids),
                "hit_output_cap": len(ids) == args.max_new_tokens and ids[-1] not in eos_ids,
                "token_ids_sha256": hashlib.sha256(json.dumps(ids, separators=(",", ":")).encode()).hexdigest(),
                "smoke_check": assess(case["id"], output)}
        report["cases"].append(item)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({k: item[k] for k in ["id", "output", "generation_seconds", "smoke_check"]}), flush=True)
    print(json.dumps({"result_file": str(args.output), "unique_parameters": parameter_count,
                      "ideal_4bit_bytes": estimates["4"]}), flush=True)


if __name__ == "__main__":
    main()
