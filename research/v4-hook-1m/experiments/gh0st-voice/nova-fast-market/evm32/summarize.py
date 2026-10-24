"""Summarize verified Solidity-only 32M results; no external calls."""
import gzip
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
read = lambda p: json.loads((HERE / p).read_text())
report = read("final-local-test/text-results.json")
replay = read("final-local-test/independent-reference.json")
security = read("audit/batch-security-adaptive/sentence-security.json")
assert report["status"] == replay["status"] == "PASS"
assert report["transaction_gas_ceiling"] == 32_000_000
assert all(int(x["gasUsed"]) <= 32_000_000 for x in report["swaps"])
assert all(c["passed"] for c in report["checks"])
assert security["status"] == "PASS" and all(c["passed"] for c in security["checks"])
out = {
    "status": "PASS_LOCAL_SOLIDITY_32M_BOUNDED_TEXT",
    "scope": "UNFORKED_LOCAL_ONLY",
    "mainnet_actions": 0,
    "model_parameters": 8175493,
    "checkpoint_sha256": "904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3",
    "weights_or_precision_changed": False,
    "stylus_or_wasm_used": False,
    "full_sentence_per_swap_required": False,
    "new_words_per_successful_swap": [1, 3],
    "stopping_policy": "Preflight selects a bounded batch; stop earlier only for neural terminal punctuation. Every attempted batch failure reverts the whole trade.",
    "transaction_and_block_limit": 32_000_000,
    "maximum_inference_call_gas": 26_000_000,
    "maximum_decoder_call_gas": 2_400_000,
    "callback_gas_reserve": 3_250_000,
    "security_note": "Local tests and internal review, not an external audit or deployment approval.",
    "real_swaps": report["summary"],
    "full_pool_checks": len(report["checks"]),
    "adversarial_mock_pool_checks": len(security["checks"]),
    "independent_replay": {k:v for k,v in replay.items() if k not in ("rows", "words")},
    "ten_swaps_per_second_demonstrated": False,
    "limits": ["Words per swap depend on supplied gas, router call depth and natural sentence endings.", "Language quality is the unchanged model's quality; saved neural context is not a guarantee of semantic coherence.", "No production chain configuration was queried and nothing was deployed."],
    "source_hashes": {},
    "reports": {},
}
for rel in ["NovaAdaptiveBatchTextHook.sol", "batch/GRU2BatchCheckedModel.sol", "test-text.mjs", "verify-text.py"]:
    out["source_hashes"][rel] = hashlib.sha256((HERE / rel).read_bytes()).hexdigest()
for rel in ["final-local-test/text-results.json", "final-local-test/independent-reference.json", "kernel/RESULTS.json", "batch/RESULTS.json", "audit/batch-security-adaptive/sentence-security.json", "audit/BATCH-SECURITY-RESULTS.json", "audit/batch-pointer-layout.json", "audit/batch-pointer-binding.json"]:
    data = (HERE / rel).read_bytes()
    entry = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    if len(data) > 50_000:
        packed = gzip.compress(data, mtime=0)
        Path(str(HERE / rel)+".gz").write_bytes(packed)
        entry.update(published_as=rel+".gz", gzip_sha256=hashlib.sha256(packed).hexdigest())
    out["reports"][rel] = entry
(HERE / "RESULTS.json").write_text(json.dumps(out, indent=2)+"\n")
print(json.dumps({"status": out["status"], "swaps": out["real_swaps"]["swaps"], "words": out["real_swaps"]["total_words"]}))
