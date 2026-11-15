#!/usr/bin/env python3
"""Fetch only public pinned upstream sources/net; verify before building."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
PIN="edb0d9db6731067ec50ce619ff372b463bc4dd5d"
NET="nn-1a298aa575a0.nnue"
SHA="1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2"
EMSCRIPTEN="08e2de1031913e4ba7963b1c56f35f036a7d4d56"
source=ROOT/".cache/Stockfish"
source.parent.mkdir(exist_ok=True)
if not source.exists():
    subprocess.run(["git","clone","--depth","1","--branch","sf_19","https://github.com/official-stockfish/Stockfish.git",str(source)],check=True)
assert subprocess.check_output(["git","-C",str(source),"rev-parse","HEAD"],text=True).strip()==PIN
net=source/"src"/NET
if not net.exists():
    net.write_bytes(urllib.request.urlopen("https://tests.stockfishchess.org/api/nn/"+NET,timeout=120).read())
assert net.stat().st_size==98511183 and hashlib.sha256(net.read_bytes()).hexdigest()==SHA
lock=json.loads((ROOT/"source-lock.json").read_text())
compat=ROOT/".cache/emscripten-compat";compat.mkdir(exist_ok=True)
def fetch(row):
    target=compat/row["file"]
    if not target.exists():
        url=f"https://raw.githubusercontent.com/emscripten-core/emscripten/{EMSCRIPTEN}/system/include/compat/{row['file']}"
        target.write_bytes(urllib.request.urlopen(url,timeout=60).read())
    assert hashlib.sha256(target.read_bytes()).hexdigest()==row["sha256"]
list(concurrent.futures.ThreadPoolExecutor(max_workers=6).map(fetch,lock["emscripten_compatibility_headers"]))
print("Pinned SF19 source, full NNUE, and SIMD compatibility headers verified")
