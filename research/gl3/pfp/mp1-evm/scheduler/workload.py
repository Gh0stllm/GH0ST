#!/usr/bin/env python3
"""Replay the arithmetic dimensions of the exact pinned M-P1 Q5 browser graph."""

import argparse
import hashlib
import json
from decimal import Decimal
from pathlib import Path


COMPONENTS = {
    "m-p1.bin": "c08f7a858225992e6aae2a495a46a305ff16c5d4b6677d5225d1cc792c1b8ab9",
    "m-p1.json": "96c83b057434ecc4f3fe7886030b2fb3b6813e05ca926f0756bac54ff27794e7",
    "palette.bin": "c847f2c7a43df1354a77813c5dc68a2cefbcac211b0ac4159d7d91480a990650",
    "vocab.bin": "a632c5cbafae21c45f9b5991941fbbc48726f48e0f62707c563483ff855a893a",
}
PACK_SHA256 = "14b714ef8c016b1a321becfa5397d18d9011878e03d46a00eda1cdf68e6491a1"
PACK_BYTES = 2976901
SOURCE_SHA256 = "1ededf81877ac8a623ef35057fa0fba94dd9e0189e1443e28861cb882bd06c77"
SOURCE_REVISION = "b0ba29f8994082ab1af89351bcce9f2d86919269"
EXPECTED_CONFIG = {
    "width": 192, "depth": 8, "heads": 4, "patch": 1, "mlp_ratio": 4,
    "text_dim": 64, "text_len": 12, "n_vocab": 10947,
}


def checked_metadata(pack, browser_source):
    for name, digest in COMPONENTS.items():
        data = (pack / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError(f"{name} differs from the pinned Q5 artifact")
    payload = b"".join((pack / name).read_bytes() for name in COMPONENTS)
    if len(payload) != PACK_BYTES or hashlib.sha256(payload).hexdigest() != PACK_SHA256:
        raise ValueError("Q5 pack size or hash differs")
    if hashlib.sha256(browser_source.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError("Browser source differs from the pinned file")
    meta = json.loads((pack / "m-p1.json").read_bytes())
    if meta["config"] != EXPECTED_CONFIG or meta["sampler"] != {"cfg": 1.5, "cfg_alpha": 1.5}:
        raise ValueError("Architecture or sampler differs from the M-P1 Q5 benchmark")
    return meta


def ceil_div(x, y):
    return (x + y - 1) // y


def workload(meta, gas_price, tx_limit):
    config = meta["config"]
    steps, branches = 16, 2
    depth, width, heads = config["depth"], config["width"], config["heads"]
    caption, text_dim = config["text_len"], config["text_dim"]
    patch = config["patch"]
    patches, patch_dim = (16 // patch) ** 2, 4 * patch ** 2
    tokens = 1 + caption + patches
    feedforward = width * config["mlp_ratio"]
    n_forwards = steps * branches
    weight_by_name = {t["name"]: t for t in meta["tensors"]}

    def linear(names, repeat, rows, inner, outputs):
        weights = [weight_by_name[name] for name in names]
        if any(w["shape"] != [outputs, inner] or w["dtype"] != "int5" for w in weights):
            raise ValueError(f"Unexpected Q5 tensor dimensions for {names}")
        groups = [ceil_div(inner, w["group"]) for w in weights]
        return {
            "dimensions_mkn": [rows, inner, outputs],
            "invocations": repeat * len(names),
            "macs": repeat * len(names) * rows * inner * outputs,
            "output_values": repeat * len(names) * rows * outputs,
            "scale_group_partials": repeat * rows * outputs * sum(groups),
        }

    def block_weights(name):
        return [f"blocks.{i}.{name}.weight" for i in range(depth)]

    projections = {
        "caption": linear(["text_proj.weight"], branches, caption, text_dim, width),
        "time": linear(["time_mlp.0.0.weight", "time_mlp.0.2.weight"], steps, 1, width, width),
        "pixel_input": linear(["pix_in.weight"], n_forwards, patches, patch_dim, width),
        "block_qkv": linear(block_weights("qkv"), n_forwards, tokens, width, 3 * width),
        "block_proj": linear(block_weights("proj"), n_forwards, tokens, width, width),
        "block_fc1": linear(block_weights("fc1"), n_forwards, tokens, width, feedforward),
        "block_fc2": linear(block_weights("fc2"), n_forwards, tokens, feedforward, width),
        "pixel_output": linear(["pix_out.weight"], n_forwards, patches, width, patch_dim),
    }
    linear_macs = sum(p["macs"] for p in projections.values())
    attention_dot_count = n_forwards * depth * heads * tokens ** 2
    attention_macs = attention_dot_count * (width // heads)
    norm_rows = n_forwards * (2 * depth * tokens + patches)
    macs = linear_macs + 2 * attention_macs

    def fee(gas):
        return str(Decimal(gas * gas_price) / 10**18)

    def scalar_scenario():
        gas = macs * (5 + 3)
        return {
            "scope": (
                "One EVM MUL plus one ADD per logical dot-product term. "
                "This charges arithmetic alone for a specific scalar implementation. "
                "Packing can change that opcode count. It is neither a measured "
                "estimate nor a lower bound on optimized inference."
            ),
            "illustrative_arithmetic_gas": gas,
            "illustrative_ETH_at_sampled_price": fee(gas),
            "32M_equivalent_transactions": ceil_div(gas, tx_limit),
        }

    def fractional_scenario():
        gas = macs
        return {
            "scope": (
                "Example sensitivity at an effective one gas per logical MAC. This "
                "rate is an assumption, not a kernel measurement. It excludes "
                "storage, fixed-point nonlinearities, and transaction overhead."
            ),
            "assumed_arithmetic_gas": gas,
            "illustrative_ETH_at_sampled_price": fee(gas),
            "32M_equivalent_transactions": ceil_div(gas, tx_limit),
        }

    time_numerators = [300 - 19 * i for i in range(steps)] + [0]
    return {
        "upstream_revision": SOURCE_REVISION,
        "browser_source_sha256": SOURCE_SHA256,
        "pack_sha256": PACK_SHA256,
        "pack_bytes": PACK_BYTES,
        "config": config,
        "inference": {
            "dimensions": [16, 16, 4],
            "sequence_tokens": tokens,
            "caption_tokens": caption,
            "patch_tokens": patches,
            "denoising_steps": steps,
            "forward_branches": branches,
            "forward_passes": n_forwards,
            "time_grid_numerators": time_numerators,
            "time_grid_denominator": 300,
            "guidance_numerator": 3,
            "guidance_denominator": 2,
        },
        "projections": projections,
        "dot_product_totals": {
            "linear_macs": linear_macs,
            "attention_qk_macs": attention_macs,
            "attention_av_macs": attention_macs,
            "all_macs": macs,
        },
        "selected_non_matrix_counts": {
            "softmax_rows": n_forwards * depth * heads * tokens,
            "softmax_logits": attention_dot_count,
            "softmax_exp_evaluations": attention_dot_count,
            "softmax_weight_divisions": attention_dot_count,
            "layer_norm_rows": norm_rows,
            "layer_norm_values": norm_rows * width,
            "layer_norm_square_roots": norm_rows,
            "mlp_relu_values": n_forwards * depth * tokens * feedforward,
            "time_encoding_angles": steps * (width // 2),
            "time_silu_values": steps * width,
            "guidance_rgba_values": steps * 16 * 16 * 4,
            "euler_rgba_values": steps * 16 * 16 * 4,
            "box_muller_normal_pairs": 16 * 16 * 4 // 2,
            "box_muller_prng_draws": 16 * 16 * 4,
            "palette_distance_comparisons_if_all_pixels_opaque": 16 * 16 * 4096,
        },
        "observation": (
            "Counts describe the browser algorithm. Optimizations such as caching "
            "the unconditional caption projection or sharing each step's pixel "
            "projection between the two branches must be accounted separately."
        ),
        "assumptions": {"gas_price_wei": gas_price, "transaction_gas_limit": tx_limit},
        "illustrative_only": {
            "scalar_mul_add": scalar_scenario(),
            "effective_one_gas_per_mac": fractional_scenario(),
        },
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--pack", type=Path, required=True)
    p.add_argument("--browser-source", type=Path, required=True)
    p.add_argument("--gas-price-wei", type=int, default=22264000)
    p.add_argument("--tx-gas-limit", type=int, default=32000000)
    args = p.parse_args()
    if args.gas_price_wei < 0 or args.tx_gas_limit <= 0:
        p.error("gas price must be nonnegative and transaction limit positive")
    meta = checked_metadata(args.pack, args.browser_source)
    print(json.dumps(workload(meta, args.gas_price_wei, args.tx_gas_limit), indent=2))


if __name__ == "__main__":
    main()
