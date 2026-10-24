"""Collect local evidence without contacting a chain or changing a model."""
import gzip
import hashlib
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent
read = lambda path: json.loads((ROOT / path).read_text())
result = read("RESULTS.json")
result["status"] = "TEN_SENTENCES_PER_SECOND_NOT_DEMONSTRATED"
result["active_target"] = read("TARGET.json")
result["alternative_runtime_results_eligible_for_target"] = False
result["overall_target_met"] = False
result["production_wasm_pool_integration_tested"] = False
result["sentence_cap"] = 32
result["cap_policy"] = "Revert the entire trade if the neural model does not naturally end a sentence within the cap."
security = read("sentence-compact-security/sentence-security.json")
result["compact_sentence_security_mock"] = {
    "status": security["status"],
    "checks": len(security["checks"]),
    "all_checks_passed": all(c["passed"] for c in security["checks"]),
    "note": "Real local PoolManager with an inexpensive adversarial model; not a neural performance benchmark.",
}
result["rate_budget"]["measured_example_gas_demand_at_10_per_second"] = 183_624_960 * 10
result["rate_budget"]["measured_example_multiple_of_saved_target"] = 183_624_960 * 10 / 7_000_000
result["rate_budget"]["sentences_per_minute_spending_entire_saved_target"] = 7_000_000 * 60 / 183_624_960
result["rate_budget"]["example"] = "compact EVM hook, 20 neural words"
meter_path = ROOT / "audit/official-stylus-meter.json"
if meter_path.exists():
    meter = read("audit/official-stylus-meter.json")
    rows = [row for row in meter["rows"] if row.get("max_code_size_scenario") == 24576 and "metered_execution_gas_ceil" in row]
    for row in rows:
        row["known_total_cached_gas_excluding_pool_and_state"] = (
            row["metered_execution_gas_ceil"]
            + row["initial_memory_gas_not_in_execution_meter"]
            + row["cached_invocation_overhead_gas_scenario"]
        )
    best = min(rows, key=lambda row: row["known_total_cached_gas_excluding_pool_and_state"])
    result["official_stylus_meter"] = {
        "scope": "OFFLINE_OFFICIAL_NITRO_RUNTIME_WITH_LOCAL_CHARGED_CODE_HOST",
        "nitro_commit": meter["nitro_commit"],
        "nitro_tag": meter["nitro_tag"],
        "chain_configuration_verified": False,
        "full_swap_metered": False,
        "baseline_20_word_rows": rows,
        "best_measured_name": best["name"],
        "best_known_total_cached_gas_excluding_pool_and_state": best["known_total_cached_gas_excluding_pool_and_state"],
        "gas_at_ten_sentences_per_second_excluding_pool_and_state": best["known_total_cached_gas_excluding_pool_and_state"] * 10,
        "notes": meter["notes"],
    }
seed_path = ROOT / "audit/official-stylus-best-seeds.json"
if seed_path.exists():
    seeds = read("audit/official-stylus-best-seeds.json")
    execution = [row["metered_execution_gas_ceil"] for row in seeds["rows"]]
    known = [row["known_cached_execution_plus_initial_memory_and_invocation"] for row in seeds["rows"]]
    result["best_wasm_sentence_distribution"] = {
        "status": seeds["status"],
        "scope": "Independent sentences starting from zero state, seeds 42 through 57; not a persistent-story or pool-load benchmark.",
        "sentences": len(known),
        "word_count_min": min(row["words"] for row in seeds["rows"]),
        "word_count_max": max(row["words"] for row in seeds["rows"]),
        "every_sentence_matches_reference_tokens_and_punctuation": all(row["exact_reference_tokens_and_punctuation"] for row in seeds["rows"]),
        "execution_gas": {"min": min(execution), "mean": statistics.mean(execution), "max": max(execution)},
        "execution_plus_memory_and_cached_invocation_gas": {"min": min(known), "mean": statistics.mean(known), "max": max(known)},
        "includes_pool_or_persistent_state_costs": False,
        "gas_demand_at_ten_sentences_per_second_using_mean_excluding_pool": statistics.mean(known) * 10,
        "relative_to_saved_seven_million_target": statistics.mean(known) * 10 / 7_000_000,
        "full_swap_throughput_demonstrated": False,
    }
reports = [
    "word-full-test/integration-results.json",
    "word-full-test/independent-neural-reference.json",
    "sentence-buffered-test/sentence-results.json",
    "sentence-buffered-test/independent-neural-reference.json",
    "sentence-buffered-security-1m-mock/sentence-security.json",
    "sentence-compact-test/sentence-results.json",
    "sentence-compact-test/independent-neural-reference.json",
    "sentence-compact-security/sentence-security.json",
    "audit/official-stylus-meter.json",
    "audit/official-stylus-best-seeds.json",
    "audit/official-stylus-packed3-seeds.json",
]
for rel in reports:
    path = ROOT / rel
    if not path.exists():
        continue
    data = path.read_bytes()
    result["reports"][rel] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    if len(data) > 50_000:
        compressed = gzip.compress(data, mtime=0)
        Path(str(path) + ".gz").write_bytes(compressed)
        result["reports"][rel]["published_as"] = rel + ".gz"
        result["reports"][rel]["gzip_sha256"] = hashlib.sha256(compressed).hexdigest()
bounded_path = ROOT / "evm32/RESULTS.json"
if bounded_path.exists():
    bounded = json.loads(bounded_path.read_text())
    assert bounded["status"] == "PASS_LOCAL_SOLIDITY_32M_BOUNDED_TEXT"
    result["status"] = "PASS_SOLIDITY_32M_BOUNDED_TEXT"
    result["requested_output"] = result["active_target"]["output_per_successful_swap"]
    result["bounded_text_target_met"] = True
    result["ten_swaps_per_second_demonstrated"] = False
    result["historical_full_sentence_word_cap"] = 32
    result["sentence_cap"] = None
    result["max_words_per_swap"] = 3
    result["cap_policy"] = bounded["stopping_policy"]
    result["bounded_text"] = bounded
round2_path = ROOT / "evm32-round2/RESULTS.json"
if round2_path.exists():
    round2 = json.loads(round2_path.read_text())
    assert round2["status"] == "PASS_LOCAL_SOLIDITY_32M_SECOND_OPTIMIZATION"
    result["previous_bounded_text"] = result["bounded_text"]
    result["bounded_text"] = round2
    result["status"] = round2["status"]
    result["cap_policy"] = round2["stopping_policy"]
(ROOT / "RESULTS.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"status": result["status"], "compact_security_checks": len(security["checks"]), "report_count": len(result["reports"])}))
