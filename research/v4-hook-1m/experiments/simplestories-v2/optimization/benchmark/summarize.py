#!/usr/bin/env python3
"""Summarize local optimized-vs-original receipt measurements without changing them."""
from pathlib import Path
import argparse
import hashlib
import json

HERE = Path(__file__).resolve().parent
BASE = HERE.parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--input", default="gas-benchmark-final.json")
parser.add_argument("--output", default="result-summary.json")
args = parser.parse_args()
run_path = HERE / args.input
run = json.loads(run_path.read_text())
prior_path = BASE / "gas-rerun/gas-benchmark.json"
prior = json.loads(prior_path.read_text())
assert run["status"] == "COMPLETE"
assert run["checks"]["totalUniqueParameterCountVerified"]
assert run["architecture"]["parameters"] == 1_235_968
assert run["checks"]["fullModelIdentityVerified"]
assert run["checks"]["originalArtifactsVerifiedAfter"]
def key(r):
    if r["kind"] == "full_forward":
        return "forward:" + r["fixture"]
    if r["kind"] == "full_generation":
        return "generation:" + r["fixture"]
    if r["kind"].endswith("_measured"):
        return r["kind"]
old_rows = {key(r): r for r in prior["probes"] if key(r) and r["status"] == 1}
rows = []
for r in run["probes"]:
    if r["kind"] == "full_forward" and r.get("mode") != "LOCAL_ABOVE_CAP":
        continue
    k = key(r)
    if not k or r["status"] != 1:
        continue
    b = old_rows.get(k)
    if not b:
        continue
    before, after = int(b["gasUsed"]), int(r["gasUsed"])
    rows.append({"measurement": k, "original_gas": before, "optimized_gas": after,
                 "reduction_percent": round(100 * (before - after) / before, 4),
                 "speedup": round(before / after, 5),
                 "prompt_tokens": r.get("promptTokenCount"),
                 "new_token_cap": r.get("maximumNewTokens"),
                 "generated": r.get("text") or next((e.get("text") for e in r.get("events", []) if e["name"] == "TokensSpoken"), None),
                 "ended": r.get("ended") if "ended" in r else next((e.get("ended") for e in r.get("events", []) if e["name"] == "TokensSpoken"), None)})
normal = run["normal32M"]["requiredSpeechSwaps"]
result = {"schema_version": 1, "model": run["repository"], "revision": run["revision"],
          "parameters": run["architecture"]["parameters"],
          "scope": "Isolated local Anvil, chain31337; no fork or public-chain RPC.",
          "normal_transaction_gas_ceiling": 32_000_000,
          "normal_required_speech_results": normal,
          "exact_integer_reference_parity": run["checks"]["selectedForwardReferenceFixturesVerified"],
          "comparisons": rows,
          "checks": run["checks"],
          "source_reports": {str(p.relative_to(BASE)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [prior_path, run_path]},
          "limitations": ["Exact matches are against the existing integer Q12 reference, not FP32.",
                          "A successful swap with one generated token is not a complete sentence or answer.",
                          "Model-storage deployment gas is excluded; all inference gas is measured in real local transactions.",
                          "No quality improvement follows from a math-preserving kernel optimization."]}
destination = HERE / args.output
destination.write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))

