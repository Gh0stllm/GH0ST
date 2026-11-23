#!/usr/bin/env python3
"""Multiply measured prototype call shapes by the pinned model's workload counts."""

import argparse
import json
from decimal import Decimal
from pathlib import Path


def load(path):
    return json.loads(path.read_bytes())


def project(workload, linear, runtime, gas_price):
    if linear["chainId"] != 4663 or runtime["chainId"] != 4663:
        raise ValueError("Expected Robinhood pre-deployment simulation evidence")
    if linear["packedModelSHA256"] != (
        "c08f7a858225992e6aae2a495a46a305ff16c5d4b6677d5225d1cc792c1b8ab9"
    ):
        raise ValueError("Linear measurements used the wrong Q5 weights")
    if workload["config"]["width"] != 192 or workload["inference"]["sequence_tokens"] != 269:
        raise ValueError("Expected M-P1 Q5 tile dimensions")
    stage_values = workload["selected_non_matrix_counts"]
    estimates = []
    unmeasured = []

    def add(stage, calls, per_call, block, macs=0, fixture=None):
        total = calls * per_call
        estimates.append({
            "stage": stage,
            "fixture_block": block,
            "fixture": fixture,
            "calls_in_prototype_schedule": calls,
            "logical_macs_in_modeled_work": macs,
            "gas_per_fixture_call": per_call,
            "projected_gas": total,
            "projected_ETH": str(Decimal(total * gas_price) / 10**18),
        })

    def find_linear(rows, outputs):
        return next((
            s["estimatedGas"] for s in linear["samples"]
            if s.get("tokens") == rows and s.get("outputs") == outputs and s.get("width") == 192
            and s.get("matchesIntegerOracle") and "estimatedGas" in s
            and s["estimatedGas"] <= linear["maxTransactionGas"]
        ), None)

    def best_column_split(rows, columns):
        """Pick the cheapest complete cover from the measured slot sizes."""
        gas_64, gas_128 = (find_linear(rows, n) for n in (64, 128))
        if gas_64 is None:
            raise ValueError(f"Missing gas fixture for the {rows}x64x192 base tile")
        if gas_128 is not None and gas_128 < 2 * gas_64:
            return [(128, columns // 128, gas_128), (64, columns % 128 // 64, gas_64)]
        return [(64, columns // 64, gas_64)]

    blocks = [p for name, p in workload["projections"].items() if name.startswith("block_")]
    tile_counts = {}
    for block in blocks:
        rows, inner, outputs = block["dimensions_mkn"]
        if rows != 269 or inner % 192 or outputs % 64:
            raise ValueError("Model stages do not match the measured block tile")
        full, tail = divmod(rows, 32)
        for tile_rows, batches in [(32, full), (tail, int(tail > 0))]:
            if not batches:
                continue
            for tile_outputs, tiles, gas in best_column_split(tile_rows, outputs):
                key = (tile_rows, tile_outputs, gas)
                calls = batches * tiles * block["invocations"] * (inner // 192)
                if calls:
                    tile_counts[key] = tile_counts.get(key, 0) + calls
    for (rows, outputs, gas), calls in sorted(tile_counts.items(), reverse=True):
        add(f"raw_block_linear_{rows}x{outputs}x192", calls, gas, linear["block"],
            rows * outputs * 192 * calls, "authentic-weight-and-synthetic-activations")

    dimensions = {"attention": [269, 48], "normalize": [192], "silu": [192], "euler": [1024]}
    results = {}
    for item in runtime["results"]:
        stage = item["id"]
        if stage not in results or item.get("fixture", "").startswith("authentic"):
            results[stage] = item

    query_fixture = results["attention"]
    if query_fixture["shape"] != dimensions["attention"] or not query_fixture["matched"]:
        raise ValueError("Attention fixture differs from the one-query prototype shape")
    query_gas = query_fixture["estimatedGas"]
    tokens = workload["inference"]["sequence_tokens"]
    heads, remainder = divmod(stage_values["softmax_rows"], tokens)
    if remainder:
        raise ValueError("The attention work does not contain complete heads")
    batch_fixture = results.get("attentionBatch")
    batch_rows = 4
    if batch_fixture is not None:
        if batch_fixture["shape"] != [batch_rows, *dimensions["attention"]] or not batch_fixture["matched"]:
            raise ValueError("Attention batch fixture differs from the four-query prototype shape")
        batch_gas = batch_fixture["estimatedGas"]
        if batch_gas < batch_rows * query_gas:
            full, tail = divmod(tokens, batch_rows)
            add("attention_4_queries", heads * full, batch_gas, runtime["block"],
                2 * tokens * 48 * heads * full * batch_rows, batch_fixture.get("fixture"))
            tokens_without_batch = heads * tail
        else:
            tokens_without_batch = heads * tokens
    else:
        tokens_without_batch = heads * tokens
    add("attention_1_query", tokens_without_batch, query_gas, runtime["block"],
        2 * tokens * 48 * tokens_without_batch, query_fixture.get("fixture"))

    for stage, count in (
        ("normalize", stage_values["layer_norm_rows"]),
        ("silu", stage_values["time_silu_values"] // 192),
        ("euler", workload["inference"]["denoising_steps"]),
    ):
        fixture = results[stage]
        if fixture["shape"] != dimensions[stage] or not fixture["matched"]:
            raise ValueError(f"Fixture {stage} differs from the projected prototype shape")
        add(stage, count, fixture["estimatedGas"], runtime["block"], fixture=fixture.get("fixture"))

    for stage in ("caption", "time", "pixel_input", "pixel_output"):
        unmeasured.append({"stage": stage, "macs": workload["projections"][stage]["macs"]})
    total_gas = sum(row["projected_gas"] for row in estimates)
    return {
        "kind": "standalone-prototype-call-extrapolation",
        "scope": (
            "Assumes each modeled stage runs in an independent invocation with the "
            "same gas as the matched-shape read-only fixture. The model's real "
            "activation values, calldata density, cache reuse, and storage access "
            "could change gas. This is not an observed or optimized image quote "
            "and is not a lower bound for a redesigned executor."
        ),
        "unmodeled": [
            "quantized scale/bias completion and residual operations",
            "caption lookup and input, time, and output projections",
            "position/time embeddings, noise creation, and palette matching",
            "shard-boundary splits and job/checkpoint storage",
        ],
        "pricing_gas_price_wei": gas_price,
        "pricing_block": runtime["block"] if gas_price == int(runtime["gasPriceWei"]) else None,
        "modeled_prototype_calls": sum(row["calls_in_prototype_schedule"] for row in estimates),
        "logical_mac_coverage": {
            "modeled": sum(row["logical_macs_in_modeled_work"] for row in estimates),
            "total": workload["dot_product_totals"]["all_macs"],
        },
        "stages": estimates,
        "unmeasured_stages": unmeasured,
        "modeled_prototype_subtotal_gas": total_gas,
        "modeled_prototype_subtotal_ETH": str(Decimal(total_gas * gas_price) / 10**18),
    }


def main():
    directory = Path(__file__).resolve().parent
    stage_root = directory.parent
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workload", type=Path, default=directory / "workload.json")
    p.add_argument("--linear", type=Path, default=stage_root / "kernel" / "robinhood-linear-gas.json")
    p.add_argument("--runtime", type=Path, default=stage_root / "runtime" / "robinhood-batched.json")
    p.add_argument("--gas-price-wei", type=int)
    args = p.parse_args()
    runtime = load(args.runtime)
    gas_price = int(runtime["gasPriceWei"]) if args.gas_price_wei is None else args.gas_price_wei
    if gas_price <= 0:
        p.error("gas price must be positive")
    print(json.dumps(project(load(args.workload), load(args.linear), runtime, gas_price), indent=2))


if __name__ == "__main__":
    main()
