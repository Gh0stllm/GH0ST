#!/usr/bin/env python3
"""Build a direct, portable scalar probe from pinned SF19 sources."""
import argparse
from pathlib import Path
import subprocess
import os
ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--port", action="store_true")
args = parser.parse_args()
src = ROOT / ".cache" / ("Stockfish-icp" if args.port else "Stockfish") / "src"
sources = [p for p in src.glob("*.cpp") if p.name != "main.cpp"]
sources += list((src/"nnue").glob("*.cpp"))
sources += list((src/"nnue/features").glob("*.cpp"))
sources += [src/"syzygy/tbprobe.cpp", ROOT/"src/gh0st_engine.cpp", ROOT/"src/native_probe.cpp"]
out = ROOT / ".cache" / ("port_probe" if args.port else "native_probe")
cmd = [os.environ.get("CXX", "/usr/bin/clang++"), "-O3", "-std=c++17", "-fno-exceptions", "-DNDEBUG", "-DIS_64BIT", "-DUSE_POPCNT", "-DNO_TABLEBASES", "-DARCH=general-64", "-I"+str(ROOT/"include"), "-I"+str(src)]
if args.port:
    cmd += ["-DGH0ST_ICP"]
cmd += [str(p) for p in sources] + ["-o", str(out)]
subprocess.run(cmd, cwd=src, check=True)
print(out)
