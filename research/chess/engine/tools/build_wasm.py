#!/usr/bin/env python3
"""Build the real ICP canister, with a complete unchanged SF19 network."""
import argparse
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument("--incremental",action="store_true");args=p.parse_args()
for script in ["fetch_sources.py","prepare_port.py"]:
    subprocess.run([sys.executable,str(ROOT/"tools"/script)],cwd=ROOT,check=True)
compiler=ROOT/".cache/toolchain/wasi-sdk/wasi-sdk-25.0/bin/clang"
subprocess.run([str(compiler),"-c",str(ROOT/".cache/generated/nnue_embed.s"),"-o",str(ROOT/".cache/generated/nnue_embed.o")],cwd=ROOT,check=True)
cmd=[sys.executable,str(ROOT/"tools/icpp_local.py"),"build-wasm","--generate-bindings","no"]
if args.incremental:cmd += ["--to-compile","mine-no-lib"]
subprocess.run(cmd,cwd=ROOT,check=True)
