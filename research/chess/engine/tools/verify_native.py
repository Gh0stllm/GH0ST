#!/usr/bin/env python3
"""Compare pinned upstream versus actual single-worker port, including warm reuse."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import time
ROOT = Path(__file__).resolve().parents[1]
START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
CASES = [
    ("start-1m", START, "", 1000000, 0),
    ("opening-full-history", START, "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6", 250000, 0),
    ("castling-tactics", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", "", 250000, 0),
    ("mate-in-one", "7k/5K2/6Q1/8/8/8/8/8 w - - 0 1", "", 100000, 0),
    ("promotion", "8/6P1/8/8/8/3k4/8/4K3 w - - 0 1", "", 100000, 0),
    ("illegal-history", START, "e2e5", 100000, 2),
    ("invalid-fen", "not-a-fen", "", 100000, 2),
    ("already-checkmated", "7k/6Q1/5K2/8/8/8/8/8 b - - 0 1", "", 100000, 3),
    ("stalemate", "7k/5K2/6Q1/8/8/8/8/8 b - - 0 1", "", 100000, 3),
]
report = {"scope": "local native execution only; not an on-chain result or Elo measurement", "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "cases": []}
for name, fen, moves, nodes, expected in CASES:
    row = {"case": name, "initial_fen": fen, "moves": moves.split(), "target_nodes": nodes, "hash_mb": 128, "runs": {}}
    for binary in ("native_probe", "port_probe"):
        start = time.monotonic()
        p = subprocess.run([str(ROOT/".cache"/binary), fen, str(nodes), "128", moves, "2"], capture_output=True, text=True, timeout=120)
        runs = [json.loads(x) for x in p.stdout.splitlines() if x.startswith("{")]
        assert p.returncode == expected and len(runs) == 2, (name, binary, p.stdout, p.stderr)
        assert runs[0] == runs[1], ("warm state differs", name, runs)
        row["runs"][binary] = {"results": runs, "elapsed_seconds": round(time.monotonic()-start, 3)}
    assert row["runs"]["native_probe"]["results"] == row["runs"]["port_probe"]["results"], ("port diverged", row)
    report["cases"].append(row)
    print(name, row["runs"]["port_probe"]["results"][0], flush=True)
report["all_passed"] = True
report["native_binaries"] = {name: hashlib.sha256((ROOT/".cache"/name).read_bytes()).hexdigest() for name in ("native_probe", "port_probe")}
(ROOT/"evidence/native-verification.json").write_text(json.dumps(report, indent=2)+"\n")
