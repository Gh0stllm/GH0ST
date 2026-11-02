"""Reproduce planning scenarios, not measured Watch bills. Run: python cost_model.py"""
import json
import math


def scan_cu(days=30, interval_seconds=30, scanners=1, blocks_per_tick=1,
            max_blocks_per_query=10000, head_cu=10, logs_cu=60):
    if days <= 0 or interval_seconds <= 0 or scanners < 1 or blocks_per_tick < 0 or max_blocks_per_query < 1:
        raise ValueError("Invalid workload")
    ticks = math.ceil(days * 86400 / interval_seconds)
    log_calls_per_tick = math.ceil(blocks_per_tick / max_blocks_per_query)
    return {"ticks": ticks, "log_calls_per_tick": log_calls_per_tick,
            "primary_provider_cu": ticks * scanners * (head_cu + log_calls_per_tick * logs_cu)}


def monthly(explanations, fixed=(25, 100), per_output=(3, 5)):
    if explanations < 0:
        raise ValueError("Negative workload")
    return [fixed[0] + explanations * per_output[0], fixed[1] + explanations * per_output[1]]


def scenarios():
    shared = scan_cu()
    separate = scan_cu(scanners=25)
    constrained = scan_cu(blocks_per_tick=300, max_blocks_per_query=10)
    baseline, selected = monthly(300), monthly(30)
    # Known analytical results protect against arithmetic/regression mistakes.
    assert shared["primary_provider_cu"] == 6048000
    assert separate["primary_provider_cu"] == 151200000
    assert constrained["primary_provider_cu"] == 156384000
    assert scan_cu(blocks_per_tick=0)["log_calls_per_tick"] == 0
    assert scan_cu(blocks_per_tick=11, max_blocks_per_query=10)["log_calls_per_tick"] == 2
    assert baseline == [925, 1600] and selected == [115, 250]
    return {"status": "modeled, not observed", "currency": "USD",
            "exclusions": "setup, development, taxes, SMS, archive backfill, high availability; see README",
            "rates_source": "https://www.alchemy.com/docs/reference/compute-unit-costs",
            "scan_scope": "primary scanner only; excludes verification, retries, backfill, stream delivery and filter splitting",
            "shared_scan": shared, "25_separate_scans": separate,
            "hypothetical_300_blocks_tick_10_block_limit": constrained,
            "removed_duplicate_scan_fraction": 1 - shared["primary_provider_cu"] / separate["primary_provider_cu"],
            "all_300_explanations": baseline, "selected_30_explanations": selected,
            "no_ai": monthly(0), "total_cost_reduction_matched_bounds": [1 - s / b for s, b in zip(selected, baseline)],
            "fanout_example": {"subscribers_with_identical_public_context": 20, "inference_jobs_before": 20, "inference_jobs_after": 1, "fewer_jobs_fraction": 0.95}}


if __name__ == "__main__":
    print(json.dumps(scenarios(), indent=2))
