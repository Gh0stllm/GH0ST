#!/usr/bin/env python3
"""Trace exact cross-unit calls and verify the full split native fixture."""

import argparse
import ctypes as c
import hashlib
import json
from pathlib import Path

from run_aot_reference import rehearse

SHARD_COUNT = 12
WARM_CALL_GAS = 100
COMPUTE_CAP_GAS = 32_000_000


class BoundaryTrace:
    def __init__(self, library, report):
        self.report = report
        self.begin = library.gl3shards_begin
        self.begin.argtypes = []
        self.begin.restype = c.c_int
        self.end = library.gl3shards_end
        self.end.argtypes = []
        self.end.restype = None
        self.count = library.gl3shards_count
        self.count.argtypes = [c.c_uint, c.c_uint]
        self.count.restype = c.c_uint64

    def start(self):
        if not self.begin():
            raise ValueError("The ELF shard mappings could not be verified")

    def finish(self, group):
        self.end()
        if (group["start"], group["end"], group["nodes"]) != (0, 40, 98_566):
            raise ValueError("The first group differs from the pinned portable execution")
        matrix = [[self.count(source, target) for target in range(SHARD_COUNT)]
                  for source in range(SHARD_COUNT)]
        total = sum(map(sum, matrix))
        if not total or any(matrix[i][i] for i in range(SHARD_COUNT)):
            raise ValueError("The cross-unit trace was inconsistent")
        result = {"scope": "Function entries between independent native ELF Stockfish units",
                  "firstGroup": group, "shardNames": [f"gl3vm_{i}" for i in range(SHARD_COUNT)],
                  "crossUnitCallMatrix": matrix, "crossUnitCalls": total,
                  "warmEvmAccountAccessGasPerCall": WARM_CALL_GAS,
                  "minimumAccountAccessGasIfOneDelegatecallPerEntry": total * WARM_CALL_GAS,
                  "singleGroupComputeCapGas": COMPUTE_CAP_GAS, "stylusExecution": False}
        with self.report.open("x") as file:
            json.dump(result, file, indent=2)
        print(f"First 40 quanta matched: {total:,} ELF unit crossings", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("program", type=Path)
    args = parser.parse_args()
    program = args.program.resolve()
    first_group = program.parent / "first-group.json"
    full_move = program.parent / "full-move.json"
    if first_group.exists() or full_move.exists():
        parser.error("Use an untouched trial directory")
    library = c.CDLL(str(program))
    result = rehearse(library, BoundaryTrace(library, first_group))
    result["scope"] = "Full native move across twelve independently compiled ELF shards on Runpod"
    result["shards"] = {
        module.name: hashlib.sha256(module.read_bytes()).hexdigest()
        for module in sorted(program.parent.glob("libgl3vm_*.so"))
    }
    if len(result["shards"]) != SHARD_COUNT:
        raise ValueError("The independent shard artifacts changed during the test")
    with full_move.open("x") as file:
        json.dump(result, file, indent=2)
    print(f"Full move matched after {result['totalGroups']} groups", flush=True)


if __name__ == "__main__":
    main()
