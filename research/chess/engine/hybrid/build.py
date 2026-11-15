#!/usr/bin/env python3
"""Build the immutable24m hybrid engine without changing baseline sources.

Use the parent engine's pinned local Python/WASI/Rust dependencies. No identity,
public canister, deployment command, or paid-game adapter is used.
"""
from pathlib import Path
import json
import re
import shutil
import subprocess
import sys
import argparse
HERE=Path(__file__).resolve().parent
ENGINE=HERE.parent
parser=argparse.ArgumentParser();parser.add_argument('--volume-test',action='store_true');options=parser.parse_args()
CACHE=ENGINE/('.cache/hybrid-volume' if options.volume_test else '.cache/hybrid-engine')
CACHE.mkdir(parents=True,exist_ok=True)
# Shared pinned sources/toolchain are read-only inputs prepared by the baseline.
assert (ENGINE/'.cache/Stockfish-icp/src/search.cpp').exists()
assert (ENGINE/'build-library/__ic_candid__/__ic_candid__.a').exists()
for name in ['runtime.cpp','adapter.cpp','engine.did','stack-switch.s','transform.py']:
 shutil.copyfile(HERE/name,CACHE/name)
search=(ENGINE/'.cache/Stockfish-icp/src/search.cpp').read_text()
search='#include <cstdint>\nextern "C" void gh0st_stockfish_yield(std::uint64_t);\n'+search
anchor='    if (--callsCnt > 0)\n        return;'
assert search.count(anchor)==1
(CACHE/'search.cpp').write_text(search.replace(anchor,anchor+'\n\n    gh0st_stockfish_yield(worker.threads.nodes_searched());'))
s=(ENGINE/'icpp.toml').read_text().replace('canister = "gh0st_stockfish19"','canister = "gh0st_stockfish_hybrid24"')
s=s.replace('"src/gh0st_engine.cpp"',json.dumps(str(CACHE/'adapter.cpp')))
s=s.replace('".cache/Stockfish-icp/src/search.cpp"',json.dumps(str(CACHE/'search.cpp')))
s=s.replace('"src/canister.cpp"',json.dumps(str(CACHE/'runtime.cpp')))
s=s.replace('did_path = "src/engine.did"','did_path = '+json.dumps(str(CACHE/'engine.did')))
for match in reversed(list(re.finditer(r'"((?:src/|include|\.cache/|\.\./\.cache/)[^"]*)"',s))):
 q=match.group(1)
 if q.startswith('../.cache/'):q=q[3:]
 s=s[:match.start()]+json.dumps(str(ENGINE/q))+s[match.end():]
s=s.replace('"-Wl,-z,stack-size=8388608",','"-Wl,-z,stack-size=8388608", '+json.dumps(str(CACHE/'stack-switch.o'))+', "-Wl,--export=gh0st_call_on_engine_stack", "-Wl,--export=gh0st_current_stack_pointer",')
if options.volume_test:s=s.replace('cpp_compile_flags = [','cpp_compile_flags = ["-DHYBRID_TEST_VOLUME",')
(CACHE/'icpp.toml').write_text(s)
if not (CACHE/'build-library').exists():(CACHE/'build-library').symlink_to(ENGINE/'build-library',target_is_directory=True)
clang=ENGINE/'.cache/toolchain/wasi-sdk/wasi-sdk-25.0/bin/clang'
subprocess.run([str(clang),'-c',str(CACHE/'stack-switch.s'),'-o',str(CACHE/'stack-switch.o')],check=True)
subprocess.run([sys.executable,str(ENGINE/'tools/icpp_local.py'),'build-wasm','--config',str(CACHE/'icpp.toml'),'--to-compile','mine-no-lib','--generate-bindings','no'],cwd=ENGINE,check=True)
subprocess.run([sys.executable,str(CACHE/'transform.py')],cwd=ENGINE,check=True)
print(CACHE/'engine.asyncify.wasm')
