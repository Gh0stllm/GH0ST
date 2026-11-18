#!/usr/bin/env python3
"""Relink frequently interacting Stockfish unit pairs and minimize the observed cut."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from itertools import combinations
import json
from pathlib import Path

import brotli

from build_aot_candidate import STYLUS_COMPRESSED_BYTES, STYLUS_WASM_BYTES, run, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("shards", "wasi_clang", "wasm_opt", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    args.output.mkdir()
    trace = json.loads((args.shards / "first-group.json").read_text())
    matrix = trace["crossUnitCallMatrix"]
    units = trace["shardNames"]
    pairs = [(a, b) for a, b in combinations(range(len(units)), 2)
             if matrix[a][b] + matrix[b][a] >= 1_000]

    def measure(pair):
        a, b = pair
        name = f"{a}-{b}"
        raw = args.output / f"{name}.wasm"
        optimized = args.output / f"{name}-opt.wasm"
        objects = [args.shards / "wasm-objects" / f"{units[idx]}.o" for idx in pair]
        run([args.wasi_clang, "-nostartfiles", "-Oz", "-Wl,--no-entry", "-Wl,--export-all",
             "-Wl,--allow-undefined", "-Wl,--strip-all", "-Wl,--max-memory=8388608", *objects, "-o", raw])
        run([args.wasm_opt, raw, "-Oz", "--all-features", "--strip-debug", "-o", optimized])
        code = optimized.read_bytes()
        packed = brotli.compress(code, quality=11, lgwin=22)
        if brotli.decompress(packed) != code:
            raise ValueError("Fused unit compression changed bytes")
        return {"units": list(pair), "eliminatedBoundaries": matrix[a][b] + matrix[b][a],
                "wasmBytes": len(code), "brotliBytes": len(packed), "wasmSHA256": sha(code),
                "fitsSizingEnvelope": len(code) <= STYLUS_WASM_BYTES and len(packed) <= STYLUS_COMPRESSED_BYTES}

    with ThreadPoolExecutor(max_workers=2) as pool:
        tested = list(pool.map(measure, pairs))
    candidates = {tuple(item["units"]): item["eliminatedBoundaries"] for item in tested if item["fitsSizingEnvelope"]}

    @lru_cache(maxsize=None)
    def best(remaining):
        if not remaining:
            return 0, ()
        first, *tail = remaining
        answer = best(tuple(tail))
        for other in tail:
            pair = first, other
            saving = candidates.get(pair, 0)
            if saving:
                saved, merges = best(tuple(unit for unit in tail if unit != other))
                if saved + saving > answer[0]:
                    answer = saved + saving, (pair,) + merges
        return answer

    saved, merges = best(tuple(range(len(units))))
    residual = trace["crossUnitCalls"] - saved
    report = {"scope": "Best disjoint pair grouping among measured compiled pairs before contract linkage",
              "selectedMerges": merges, "pairs": tested, "eliminatedCalls": saved, "remainingCalls": residual,
              "minimumAccountAccessGasIfOneDelegatecallPerEntry": residual * trace["warmEvmAccountAccessGasPerCall"],
              "isCompleteStylusEngine": False}
    (args.output / "pair-grouping.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"{len(tested)} pairs measured, {residual:,} potential boundary calls remain", flush=True)


if __name__ == "__main__":
    main()
