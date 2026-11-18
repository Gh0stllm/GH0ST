#!/usr/bin/env python3
"""Run all exact Stockfish groups through the compiled native parity host."""

import argparse
import ctypes as c
import hashlib
import json
from pathlib import Path
from time import monotonic

EXPECTED_NODES = 24_000_033
EXPECTED_QUANTA = 9_853
GROUP = 40
CHECKPOINT_BYTES = 163_085_439
CHECKPOINT_SHA256 = "5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6"
GLOBALS = (0, 98, 99)


def bind(library, name, params, returns):
    method = getattr(library, "gl3aot_" + name)
    method.argtypes = params
    method.restype = returns
    return method


def rehearse(library, first_group_trace=None):
    v, u = c.c_void_p, c.c_uint32
    create = bind(library, "create", [], v)
    destroy = bind(library, "destroy", [v], None)
    memory = bind(library, "memory", [v], v)
    length = bind(library, "memory_size", [v], u)
    grow = bind(library, "grow", [v, u], None)
    read_global = bind(library, "global_get", [v, u], u)
    set_global = bind(library, "global_set", [v, u, u], None)
    invoke = bind(library, "call", [v, u, u, u], c.c_uint64)

    def cold_restart(vm):
        checkpoint_bytes = length(vm)
        globals_before = {i: read_global(vm, i) for i in GLOBALS}
        other = create()
        if not other:
            raise ValueError("Could not allocate cold reference host")
        try:
            grow(other, checkpoint_bytes)
            c.memmove(memory(other), memory(vm), checkpoint_bytes)
            for index, value in globals_before.items():
                set_global(other, index, value)
            return other
        except Exception:
            destroy(other)
            raise

    engine = create()
    if not engine:
        raise ValueError("Could not allocate reference host")
    groups = []
    cold_restarts = []
    try:
        invoke(engine, 0, 0, 0)
        if invoke(engine, 1, 0, 0) != 1:
            raise ValueError("Reference initialization failed")
        history = b"e2e4"
        pointer = invoke(engine, 2, len(history), 0)
        c.memmove(memory(engine) + pointer, history, len(history))
        began = monotonic()
        if first_group_trace is not None:
            first_group_trace.start()
        more = invoke(engine, 4, pointer, len(history))
        invoke(engine, 3, pointer, 0)
        last_nodes = 0
        for start in range(0, EXPECTED_QUANTA, GROUP):
            group_at = began if start == 0 else monotonic()
            end = min(start + GROUP, EXPECTED_QUANTA)
            cursor = invoke(engine, 8, 0, 0)
            while more and cursor < end:
                more = invoke(engine, 5, 0, 0)
                next_cursor = invoke(engine, 8, 0, 0)
                if next_cursor != cursor + 1:
                    raise ValueError(f"Invalid progression at quantum {cursor}")
                cursor = next_cursor
            nodes = invoke(engine, 6, 0, 0)
            if cursor != end or bool(more) != (end < EXPECTED_QUANTA) or nodes < last_nodes:
                raise ValueError(f"Unexpected compiled checkpoint at quantum {end}")
            groups.append({"start": start, "end": end, "nodes": nodes, "wallMs": (monotonic() - group_at) * 1000})
            if start == 0 and first_group_trace is not None:
                first_group_trace.finish(groups[-1])
            last_nodes = nodes
            if end in (40, 4_000, 9_840):
                before = monotonic()
                restored = cold_restart(engine)
                destroy(engine)
                engine = restored
                cold_restarts.append({"quantum": end, "memoryBytes": length(engine),
                                      "wallMs": (monotonic() - before) * 1000})
        elapsed = monotonic() - began
        actual = invoke(engine, 7, 0, 0)
        depth = invoke(engine, 9, 0, 0)
        best = c.string_at(memory(engine) + invoke(engine, 10, 0, 0), 8).split(b"\0")[0].decode()
        start = invoke(engine, 11, 0, 0)
        size = invoke(engine, 12, 0, 0)
        if size != CHECKPOINT_BYTES or start + size > length(engine):
            raise ValueError("Canonical checkpoint length or bounds differ")
        view = (c.c_ubyte * size).from_address(memory(engine) + start)
        digest = hashlib.sha256(view).hexdigest()
        if (actual, depth, best, digest, groups[0]["nodes"]) != (
            EXPECTED_NODES, 38, "e7e5", CHECKPOINT_SHA256, 98_566
        ):
            raise ValueError("Compiled search differs from the pinned reference")
        return {"scope": "Native compiled parity fixture on Runpod", "opening": "e2e4",
                "groupSize": GROUP, "totalGroups": len(groups), "totalQuanta": EXPECTED_QUANTA,
                "actualNodes": actual, "depth": depth, "move": best, "firstGroupNodes": groups[0]["nodes"],
                "firstGroupWallMs": groups[0]["wallMs"], "wallSeconds": elapsed,
                "canonicalCheckpointBytes": size, "canonicalCheckpointSHA256": digest,
                "coldRestarts": cold_restarts, "groups": groups,
                "onChain": False, "publicDeployment": False, "passed": True}
    finally:
        destroy(engine)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("library", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    if args.report.exists():
        parser.error("Choose a new report path")
    result = rehearse(c.CDLL(str(args.library.resolve())))
    with args.report.open("x") as file:
        json.dump(result, file, indent=2)
        file.write("\n")
    print(json.dumps({k: v for k, v in result.items() if k != "groups"}), flush=True)


if __name__ == "__main__":
    main()
