#!/usr/bin/env python3
"""Local CPU voice evaluation. No training, network inference, or chain writes.

Input cases must be exported by coordinator/examples/export_voice_cases.rs so
the visible prompt exactly matches the canister's framed request. This native
runner is NOT an ICP Wasm parity or cycle-cost benchmark.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import sys
import time
from pathlib import Path

EXPECTED_MODEL_SHA256 = "b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897"
EXPECTED_MODEL_BYTES = 1107409472


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_cases(path: Path) -> tuple[dict, list[dict]]:
    value = json.loads(path.read_text())
    if isinstance(value, list):
        return {}, value
    cases = value["cases"]
    for case in cases:
        if "chunk_seeds" not in case and "chunk_seeds_by_attempt_and_generated_offset" in case:
            case["chunk_seeds"] = case["chunk_seeds_by_attempt_and_generated_offset"][0]
    return {k: v for k, v in value.items() if k != "cases"}, cases


def flags(text: str, examples: list[str], earlier: list[str]) -> dict:
    stripped = text.strip()
    normalize = lambda s: " ".join(re.findall(r"[a-z0-9]+", s.lower()))
    lowered = stripped.lower()
    words = re.findall(r"[A-Za-z']+", stripped)
    checks = {
        "length_in_range": 30 <= len(stripped) <= 180,
        "ascii": stripped.isascii(),
        "finished": bool(re.search(r"[.!?](?:[')])?$", stripped)),
        "no_links_mentions_hashtags": not re.search(r"https?://|www\.|[@#]", stripped, re.I),
        "no_role_or_prompt_leak": not re.search(r"<\||</?think>|^\s*(assistant|user|system|thought|monologue)\s*:|as an ai|here(?:'s| is)", lowered),
        "not_example_copy": normalize(stripped) not in {normalize(s) for s in examples},
        "not_exact_repeat": normalize(stripped) not in {normalize(s) for s in earlier},
        "no_obvious_trading_call": not re.search(r"\b(buy now|sell now|buy gh0st|to the moon|guaranteed profit|price will|100x)\b", lowered),
    }
    checks["structural_pass"] = all(checks.values())
    checks["characters"] = len(stripped)
    checks["words"] = len(words)
    checks["distinct_word_fraction"] = round(len(set(w.lower() for w in words)) / max(len(words), 1), 3)
    return checks


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=min(6, os.cpu_count() or 1))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--variant")
    parser.add_argument("--one-shot", action="store_true")
    parser.add_argument("--compare-baseline", action="store_true")
    parser.add_argument("--kv-q8", action="store_true", help="Q8 K/V with native flash attention (required by this native build)")
    args = parser.parse_args()
    if args.model.stat().st_size != EXPECTED_MODEL_BYTES or sha256_file(args.model) != EXPECTED_MODEL_SHA256:
        raise SystemExit("Local model is not the pinned Qwen3-1.7B Q4_K_M GGUF")
    from llama_cpp import Llama, LlamaGrammar, llama_print_system_info, llama_vocab_is_eog, GGML_TYPE_Q8_0
    from llama_cpp._internals import LlamaSampler

    export_metadata, cases = read_cases(args.cases)
    if args.compare_baseline:
        expanded = []
        for case in cases:
            expanded.append({**case, "variant":"tuned"})
            expanded.append({**case, "variant":"baseline", "wire_prompt":case["baseline_wire_prompt"],
                "sampling":{"temperature":0,"top_p":.9,"top_k":40,"min_p":0,"repeat_penalty":1.1,"tokens_per_call":4,"max_output_tokens":50},
                "chunk_seeds":[42]*129})
        cases = expanded
    if args.variant:
        cases = [case for case in cases if case.get("variant") == args.variant]
    if args.limit:
        cases = cases[: args.limit]
    profile_path = Path(__file__).resolve().parents[1] / "persona-profile.json"
    profile = json.loads(profile_path.read_text())
    metadata = {
        "record_type": "provenance",
        "execution": "local CPU; no ICP deployment/inference/cost claim",
        "model": {"repository": "unsloth/Qwen3-1.7B-GGUF", "revision": "d7f544eead698dbd1f15126ef60b45a1e1933222", "filename": args.model.name, "sha256": EXPECTED_MODEL_SHA256, "bytes": EXPECTED_MODEL_BYTES},
        "runner": {"llama_cpp_python": importlib.metadata.version("llama-cpp-python"), "python": sys.version, "platform": platform.platform(), "system_info": llama_print_system_info().decode(), "threads": args.threads, "context": 4096, "batch": 8, "gpu_layers": 0, "kv_cache":{"k":"q8_0" if args.kv_q8 else "f16","v":"q8_0" if args.kv_q8 else "f16","flash_attention":args.kv_q8}},
        "profile_sha256": sha256_file(profile_path),
        "prompt_export_sha256": sha256_file(args.cases),
        "export_metadata": export_metadata,
        "mode": "one-shot native sampler" if args.one_shot else "fresh native sampler per exported token-offset chunk; KV retained; prior last64 tokens accepted into penalties",
        "parity_limit": "Native llama.cpp is a different build from the ICP runtime. Fixed four-token groups do not prove IC instruction-yield lengths, sampler implementation or output parity.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    kv_args = {"type_k":GGML_TYPE_Q8_0,"type_v":GGML_TYPE_Q8_0,"flash_attn":True} if args.kv_q8 else {}
    model = Llama(model_path=str(args.model), n_ctx=4096, n_batch=8, n_ubatch=8, n_threads=args.threads, n_threads_batch=args.threads, n_gpu_layers=0, verbose=False, last_n_tokens_size=64, seed=42, **kv_args)
    earlier: dict[str, list[str]] = {}
    with args.output.open("w") as report:
        report.write(json.dumps(metadata) + "\n")
        report.flush()
        for ordinal, case in enumerate(cases):
            sampling = case.get("sampling", profile["sampling"])
            prompt = case.get("wire_prompt", case.get("framed_prompt"))
            if not prompt:
                raise ValueError("Exporter must supply wire_prompt or framed_prompt")
            variant = case.get("variant", "tuned")
            seeds = case.get("chunk_seeds", case.get("seeds"))
            if not seeds:
                raise ValueError("Exporter must supply deterministic seeds by output-token offset")
            if isinstance(seeds, dict):
                seeds = [seeds[str(i)] for i in range(max(int(k) for k in seeds) + 1)]
            max_output = int(sampling.get("max_output_tokens", 80))
            group_size = max_output if args.one_shot else int(sampling.get("tokens_per_call", 4))
            prompt_tokens = model.tokenize(prompt.encode(), add_bos=True, special=True)
            model.reset()
            started = time.monotonic()
            model.eval(prompt_tokens)
            prefill_seconds = time.monotonic() - started
            generated: list[int] = []
            chunks = []
            ended = False
            while len(generated) < max_output and not ended:
                offset = len(generated)
                seed = int(seeds[offset])
                model.set_seed(seed)
                # Seed/restore penalties before adding grammar. Prompt tokens
                # belong to penalty history, not the output-only grammar.
                sampler = LlamaSampler()
                sampler.add_penalties(n_vocab=model._n_vocab, penalty_last_n=64,
                    penalty_repeat=float(sampling.get("repeat_penalty",1.12)),penalty_freq=0.,penalty_present=0.)
                history = (prompt_tokens + generated)[-64:]
                for token in history:
                    sampler.accept(token)
                grammar_object = None
                if sampling.get("grammar"):
                    grammar_object = LlamaGrammar.from_string(sampling["grammar"],verbose=False)
                    sampler.add_grammar(model._model,grammar_object)
                temperature=float(sampling.get("temperature",.85))
                if temperature==0:
                    sampler.add_greedy()
                else:
                    sampler.add_top_k(int(sampling.get("top_k",40)))
                    sampler.add_typical(1.,1)
                    sampler.add_top_p(float(sampling.get("top_p",.9)),1)
                    sampler.add_min_p(float(sampling.get("min_p",0)),1)
                    sampler.add_temp(temperature)
                    sampler.add_dist(seed)
                chunk_tokens = []
                try:
                    for _ in range(min(group_size, max_output - offset)):
                        token = sampler.sample(model._ctx)
                        if llama_vocab_is_eog(model._model.vocab, token):
                            ended = True
                            break
                        generated.append(token)
                        chunk_tokens.append(token)
                        model.eval([token])
                finally:
                    sampler.close()
                chunks.append({"output_offset": offset, "seed": seed, "tokens": chunk_tokens})
            raw_bytes = model.detokenize(generated, special=False)
            raw_text = raw_bytes.decode("utf-8", errors="replace")
            special_text = model.detokenize(generated, special=True).decode("utf-8", errors="replace")
            text = raw_text.strip()
            metrics = flags(text, profile.get("examples", []), earlier.setdefault(variant, []))
            row = {"record_type": "completion", "ordinal": ordinal, "case": case, "variant": variant, "raw_text": raw_text, "special_tokens_text":special_text,"text": text, "raw_utf8_hex": raw_bytes.hex(), "generated_token_ids": generated, "ended_naturally": ended, "prompt_tokens": len(prompt_tokens), "generated_tokens": len(generated), "prefill_seconds": round(prefill_seconds, 4), "total_seconds": round(time.monotonic() - started, 4), "chunks": chunks, "checks": metrics}
            report.write(json.dumps(row) + "\n")
            report.flush()
            earlier[variant].append(text)
            print(json.dumps({"ordinal": ordinal, "variant": variant, "case": case.get("name", case.get("scenario")), "text": text, "ended": ended, "checks": metrics, "seconds": row["total_seconds"]}), flush=True)
    model.close()


if __name__ == "__main__":
    main()
