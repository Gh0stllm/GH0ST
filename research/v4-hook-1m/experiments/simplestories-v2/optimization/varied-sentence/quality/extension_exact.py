"""Disjoint exact sampler run, preserving actual global seeds with range-local draw storage.

Imports the unchanged reference implementation. Does not create, repair, or filter text.
"""
from pathlib import Path
import hashlib
import json
import time
from exact_sampling import ExactPredictor, generate, reference, OUT

START, END, STEPS = 262144, 393216, 5
LABEL = "extension-262144-393216"
DRAWS = OUT / "extension-seed-draws-262144-393216x5.bin"


def main():
    draws = DRAWS.read_bytes()
    assert len(draws) == (END - START) * STEPS * 32
    draw_hash = hashlib.sha256(draws).hexdigest()
    predictor = ExactPredictor()
    cache = OUT / "extension-prefixes.local.pkl"
    unique = {}
    completed = 0
    counts = {}
    started = time.monotonic()
    for local_seed, global_seed in enumerate(range(START, END)):
        # The buffer slot is local, but its Keccak preimage contained global_seed.
        row = generate(predictor, [3], local_seed, draws, 64, 1000, STEPS, STEPS)
        row["seed_index"] = global_seed
        row["seed"] = "0x" + global_seed.to_bytes(32, "big").hex()
        counts[str(len(row["tokens"]))] = counts.get(str(len(row["tokens"])), 0) + 1
        if row["complete"]:
            completed += 1
            key = row["text"]
            if key not in unique:
                unique[key] = row | {"frequency": 0}
            unique[key]["frequency"] += 1
        done = local_seed + 1
        if done % 4096 == 0 or global_seed + 1 == END:
            summary = {
                "schema_version": 1,
                "status": "COMPLETE" if global_seed + 1 == END else "RUNNING",
                "scope": "Offline unchanged exact Q12 model and top-k/table/Keccak sampling; disjoint global seed range.",
                "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "reference_source_sha256": hashlib.sha256((OUT / "exact_sampling.py").read_bytes()).hexdigest(),
                "weights_sha256": hashlib.sha256(reference.blob).hexdigest(),
                "seed_draws_sha256": draw_hash,
                "seed_range_start": START,
                "seed_range_end_exclusive": END,
                "last_seed_processed": global_seed,
                "seeds_processed": done,
                "prompt_ids": [3], "top_k": 64, "temperature_milli": 1000, "max_new_tokens": STEPS,
                "natural_ending_samples": completed,
                "unique_natural_ending_texts": len(unique),
                "token_counts": counts,
                "unique_prefix_evaluations": predictor.calls,
                "elapsed_seconds": round(time.monotonic() - started, 3),
                "limitations": ["Natural terminal output is not a grammar guarantee.",
                                "Canonical deduplication and grammar screening are separate later steps.",
                                "No text was repaired and no punctuation was forced."],
            }
            (OUT / f"{LABEL}-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
            (OUT / f"{LABEL}-unique.checkpoint.json").write_text(json.dumps(list(unique.values()), separators=(",", ":")) + "\n")
            print(json.dumps({key: summary[key] for key in ["seeds_processed", "last_seed_processed", "natural_ending_samples", "unique_natural_ending_texts", "elapsed_seconds"]}), flush=True)
            if done % 32768 == 0:
                predictor.save_cache(cache)
    predictor.save_cache(cache)
    (OUT / f"{LABEL}-unique.json").write_text(json.dumps(list(unique.values()), separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
