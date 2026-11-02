"""Small synthetic Watch prompt/model screen; NOT an ICP cost benchmark.

Run with llama-cpp-python==0.3.36:
python benchmark_local.py --model-17 /path/Qwen3-1.7B-Q4_K_M.gguf \
  --model-06 /path/Qwen3-0.6B-Q4_K_M.gguf --output local-results.json
Only public synthetic facts are used. Download hashes are verified before loading.
"""
import argparse
import hashlib
import json
import platform
import statistics
import time
from pathlib import Path

MODELS = {
    "1.7B": {"sha256": "b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897", "repo": "unsloth/Qwen3-1.7B-GGUF", "revision": "d7f544eead698dbd1f15126ef60b45a1e1933222"},
    "0.6B": {"sha256": "ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a", "repo": "unsloth/Qwen3-0.6B-GGUF", "revision": "50968a4468ef4233ed78cd7c3de230dd1d61a56b"},
}
FIXTURES = [
    {"id": "large", "amount": "25000", "symbol": "TOKEN", "threshold": "10000", "sender": "wallet-A", "recipient": "wallet-B"},
    {"id": "decimal", "amount": "1.25", "symbol": "USDC", "threshold": "1", "sender": "wallet-C", "recipient": "wallet-D"},
    {"id": "tiny", "amount": "0.000001", "symbol": "TOKEN", "threshold": "0.0000005", "sender": "wallet-E", "recipient": "wallet-F"},
    {"id": "equal", "amount": "100", "symbol": "TOKEN", "threshold": "100", "sender": "wallet-G", "recipient": "wallet-H"},
    {"id": "one", "amount": "1", "symbol": "TOKEN", "threshold": "0", "sender": "wallet-I", "recipient": "wallet-J"},
    {"id": "huge", "amount": "1000000000", "symbol": "TOKEN", "threshold": "999999999", "sender": "wallet-K", "recipient": "wallet-L"},
    {"id": "precision", "amount": "123.456789", "symbol": "TOKEN", "threshold": "123.456788", "sender": "wallet-M", "recipient": "wallet-N"},
    {"id": "round", "amount": "500", "symbol": "TOKEN", "threshold": "250", "sender": "wallet-O", "recipient": "wallet-P"},
]
PROMPTS = {
    "compact_v2": "Convert the JSON facts into one short sentence. Use the actual values for sender, recipient, amount and symbol. State that the amount meets the threshold. Copy numbers exactly. Use only these facts; do not infer intent or risk.",
    "verbose": "You write short factual observations for GH0ST Watch, a public blockchain monitoring research project. The following JSON contains synthetic facts already decoded and checked by deterministic software. The rule is amount greater than or equal to threshold. Write exactly one plain sentence stating the sender, recipient, exact amount and token symbol, and that the transfer meets the configured threshold. Preserve amount digits exactly as supplied, with no commas or rounding. Use only the supplied facts. Do not infer whether this was a sale, purchase, exploit, malicious transfer, exchange deposit or market signal. Do not infer the identities or intentions of the wallets. Do not provide financial advice, a risk rating, an explanation of your process, or introductory text. The observation must be concise and must not invent any information absent from the supplied packet.",
    "compact": "One factual sentence: sender transferred exact amount symbol to recipient; meets threshold (>=). Keep amount digits unchanged. Only given facts; no intent, advice or risk claims.",
}


def packet(fixture):
    return {k: v for k, v in fixture.items() if k != "id"}


def prompt(variant, fixture):
    # Qwen3 non-thinking framing. Same facts and completion prefix for both variants.
    return ("<|im_start|>system\n" + PROMPTS[variant] + "<|im_end|>\n"
            "<|im_start|>user\n" + json.dumps(packet(fixture), separators=(",", ":"))
            + "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n")


def guard(text, fixture, finish):
    # Conservative lexical screen, not a semantic correctness proof.
    required = [fixture[k] for k in ("amount", "symbol", "sender", "recipient")]
    missing = [value for value in required if value not in text]
    banned = [word for word in ("bullish", "bearish", "exploit", "malicious", "sell", "buy", "sale", "exchange", "suspicious") if word in text.lower()]
    return {"missing_literal_fields": missing, "banned_terms": banned,
            "mentions_threshold": "threshold" in text.lower(),
            "pass": not missing and not banned and "threshold" in text.lower() and finish == "stop"}


def main():
    from llama_cpp import Llama, __version__
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-17", required=True)
    parser.add_argument("--model-06", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--variants", nargs="+", choices=list(PROMPTS), default=["verbose", "compact"])
    args = parser.parse_args()
    settings = dict(n_ctx=1024, n_batch=64, n_threads=4, n_threads_batch=4, n_gpu_layers=0, seed=42, verbose=False)
    result = {"scope": "synthetic native CPU screening; not ICP execution or cost", "runtime": "llama-cpp-python " + __version__, "machine": {"system": platform.system(), "machine": platform.machine()}, "settings": settings, "max_tokens": 64, "temperature": 0, "models": MODELS, "fixtures": FIXTURES, "prompts": PROMPTS, "runs": []}
    for size, path in (("1.7B", args.model_17), ("0.6B", args.model_06)):
        model_path = Path(path)
        with model_path.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        if digest != MODELS[size]["sha256"]:
            raise ValueError("Unexpected model hash: " + size)
        model = Llama(model_path=str(model_path), **settings)
        # Exclude a warmup from measured runs. No prefix/KV reuse across samples.
        model.create_completion(prompt=prompt("compact", FIXTURES[0]), max_tokens=1, temperature=0)
        for index, fixture in enumerate(FIXTURES):
            # Alternate order to reduce systematic ordering bias; still one trial/case.
            variants = args.variants if index % 2 == 0 else list(reversed(args.variants))
            for variant in variants:
                model.reset()
                started = time.perf_counter()
                response = model.create_completion(prompt=prompt(variant, fixture), max_tokens=64, temperature=0, seed=42, stop=["<|im_end|>"])
                elapsed = time.perf_counter() - started
                choice = response["choices"][0]
                record = {"model": size, "case": fixture["id"], "variant": variant, "elapsed_seconds": round(elapsed, 4), "usage": response["usage"], "output": choice["text"], "finish_reason": choice["finish_reason"], "guard": guard(choice["text"], fixture, choice["finish_reason"])}
                result["runs"].append(record)
                Path(args.output).write_text(json.dumps(result, indent=2) + "\n")
                print(size, fixture["id"], variant, record["usage"], record["guard"]["pass"], round(elapsed, 2), flush=True)
        model.close()
    result["summary"] = []
    for size in MODELS:
        for variant in args.variants:
            rows = [r for r in result["runs"] if r["model"] == size and r["variant"] == variant]
            result["summary"].append({"model": size, "variant": variant, "cases": len(rows), "lexical_passes": sum(r["guard"]["pass"] for r in rows), "input_tokens_mean": statistics.mean(r["usage"]["prompt_tokens"] for r in rows), "output_tokens_mean": statistics.mean(r["usage"]["completion_tokens"] for r in rows), "seconds_median": statistics.median(r["elapsed_seconds"] for r in rows)})
    Path(args.output).write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
