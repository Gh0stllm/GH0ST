"""Original-tokenizer recovery export; no training or public-chain operations.

The original SimpleStories tokenizer is WordPiece, although this experiment is
called BPE to distinguish it from the replacement WordLevel experiment. Reuse
the independently checked integer implementation without editing its source.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import time

from transformers import AutoTokenizer

HERE = Path(__file__).resolve().parent
VOICE = HERE.parents[2]
LEGACY = VOICE / "export/quantize_eval.py"
spec = importlib.util.spec_from_file_location("gh0st_bpe_reviewed_q12", LEGACY)
q12 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q12)


def validate_prompt_token(token):
    token = int(token)
    assert 0 < token < 4019 and token not in q12.TERMINALS, "Prompt must be one nonterminal vocabulary token"
    return token


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def checked_tokenizer(tokenizer):
    original = AutoTokenizer.from_pretrained(q12.BASE / "model-cache", local_files_only=True, trust_remote_code=False)
    current = json.loads(tokenizer.backend_tokenizer.to_str())
    canonical = json.loads(original.backend_tokenizer.to_str())
    for key in ["model", "normalizer", "pre_tokenizer", "post_processor", "decoder", "added_tokens"]:
        assert current.get(key) == canonical.get(key), f"Original tokenizer semantics changed: {key}"
    assert current["model"]["type"] == "WordPiece"
    assert tokenizer.encode("i", add_special_tokens=False) == [40]
    assert tokenizer.encode('"', add_special_tokens=False) == [3]
    return canonical


def bind_metadata(out, quantization, tokenizer, canonical, prompt, top_k, temperature):
    """Correct the legacy helper's hardcoded prompt3 metadata, never its math."""
    prompt = validate_prompt_token(prompt)
    token_dir = out / "tokenizer"
    token_dir.mkdir(exist_ok=True)
    raw = (q12.BASE / "model-cache/tokenizer.json").read_bytes()
    (token_dir / "tokenizer.json").write_bytes(raw)
    metadata = {
        "tokenizer_type": "WordPiece",
        "tokenizer_sha256": q12.sha(raw),
        "tokenizer_semantics_sha256": q12.sha(canonical_json(canonical)),
        "tokenizer_vocab_unchanged": True,
        "initial_prompt_ids": [prompt],
        "prompt_text": tokenizer.decode([prompt], skip_special_tokens=True),
        "prompt_counts_as_generated": False,
        "top_k": top_k,
        "temperature_milli": temperature,
    }
    quantization.update(metadata)
    quantization["legacy_reference_exporter_sha256"] = q12.sha(LEGACY.read_bytes())
    q12.write_json(out / "quantization-report.json", quantization)
    q12.write_json(token_dir / "manifest.json", metadata)
    manifest_path = out / "evm/model-manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        manifest.update(metadata)
        manifest["initial_prompt_token"] = prompt
        manifest["legacy_reference_exporter_sha256"] = q12.sha(LEGACY.read_bytes())
        # Constructor already receives and commits the actual prompt argument.
        manifest["local_model_changes"].append("single-token prompt metadata agrees with constructor argument; original tokenizer preserved")
        q12.write_json(manifest_path, manifest)
    return metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seeds", default="42,0,1,2,3,4,5,6,7,8")
    parser.add_argument("--tokens", type=int, default=160)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--prompt", help="Text that must encode to one nonterminal token; default is a quotation mark")
    group.add_argument("--prompt-token", type=int)
    parser.add_argument("--top-k", type=int, default=8)
    parser.add_argument("--temperature-milli", type=int, default=800)
    parser.add_argument("--include-baseline", action="store_true")
    parser.add_argument("--skip-evm-artifacts", action="store_true")
    args = parser.parse_args()
    assert args.tokens > 0 and 1 <= args.top_k <= 64 and args.temperature_milli > 0
    started = time.monotonic()
    args.out.mkdir(parents=True, exist_ok=True)
    tensors, tokenizer, quantization = q12.export_checkpoint(args.checkpoint, args.out)
    canonical = checked_tokenizer(tokenizer)
    prompt_ids = [args.prompt_token] if args.prompt_token is not None else tokenizer.encode(args.prompt if args.prompt is not None else '"', add_special_tokens=False)
    assert len(prompt_ids) == 1, "Local constructor supports exactly one prompt token"
    prompt = validate_prompt_token(prompt_ids[0])
    cosine, sine, sigmoid, exponential = q12.tables()
    table = cosine.astype(">i2").tobytes() + sine.astype(">i2").tobytes() + sigmoid.astype(">u4").tobytes() + exponential.astype(">u4").tobytes()
    assert len(table) == 6152
    (args.out / "model/tables-relative64.bin").write_bytes(table)
    metadata = bind_metadata(args.out, quantization, tokenizer, canonical, prompt, args.top_k, args.temperature_milli)
    seeds = [int(value) for value in args.seeds.split(",")]
    assert len(seeds) == len(set(seeds)) and all(0 <= seed < 2**256 for seed in seeds)
    result = {
        "schema_version": 2,
        "scope": "Original-tokenizer recovery: independent local Q12 reference; no public-chain operations",
        "checkpoint_sha256": quantization["checkpoint_sha256"],
        "weights_sha256": quantization["weights_sha256"],
        "parameters": 1235968, "window": 64, **metadata,
        "token_policy": "2 iff processed<=26, otherwise1; native terminals end chunk; no context reset",
        "runs": [],
        "limitations": ["Original tokenizer is WordPiece, not WordLevel.", "Input prefix is not a generated token.", "Offline reference is not EVM gas evidence."],
    }
    models = [("tuned", tensors)]
    if args.include_baseline:
        models.insert(0, ("baseline", q12.baseline_tensors()))
    for name, weights in models:
        for seed, draws in zip(seeds, q12.get_draws(seeds, args.tokens)):
            row, logits = q12.generate(weights, tokenizer, seed, draws, args.tokens, [prompt], args.top_k, args.temperature_milli)
            row.update(model=name, every_step_logit_hash=q12.logit_hashes(logits), generated_text=tokenizer.decode(row["generated_tokens"], skip_special_tokens=True))
            result["runs"].append(row)
            print(json.dumps({"model": name, "seed": seed, "prompt": row["prompt_text"], "generated": row["generated_text"], "q12_safety": row["q12_safety"]}), flush=True)
    result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    q12.write_json(args.out / "q12-continuity-comparison.json", result)
    (args.out / "q12-transcripts.txt").write_text("\n\n".join(f"{row['model']} / seed {row['seed']}\nPROMPT: {row['prompt_text']}\nGENERATED: {row['generated_text']}\nCOMBINED: {row['full_text']}" for row in result["runs"]) + "\n")
    artifacts = {"status": "SKIPPED"}
    if not args.skip_evm_artifacts:
        artifacts = q12.evm_artifacts(args.out, quantization)
        assert artifacts["status"] == "EXPORTED_NOT_EVM_TESTED"
        bind_metadata(args.out, quantization, tokenizer, canonical, prompt, args.top_k, args.temperature_milli)
    q12.write_json(args.out / "evm-artifact-report.json", artifacts)
    print(json.dumps({"out": str(args.out), "elapsed_seconds": round(time.monotonic() - started, 3), "initial_prompt_ids": [prompt], "artifacts": artifacts}), flush=True)


if __name__ == "__main__":
    main()
