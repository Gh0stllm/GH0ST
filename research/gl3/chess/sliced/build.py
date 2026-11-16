"""Build an isolated, portable exact continuation; never edits the old prover inputs."""
from pathlib import Path
import concurrent.futures,hashlib,json,os,shutil,subprocess,sys
HERE=Path(__file__).resolve().parent
CHESS=HERE.parent
REPO=CHESS.parents[2]
CACHE=HERE/'.cache';CACHE.mkdir(exist_ok=True)
SRC=CHESS/'engine/.cache/src'
SDK=REPO/'research/chess/engine/.cache/toolchain/wasi-sdk/wasi-sdk-25.0/bin'
PY=REPO/'research/chess/engine/.cache/venv/bin/python'
def run(args,**kw):subprocess.run([str(x) for x in args],check=True,**kw)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
search=(SRC/'search.cpp').read_text()
anchor='    if (--callsCnt > 0)\n        return;'
assert search.count(anchor)==1
search='#include <cstdint>\nextern "C" void gh0st_stockfish_yield(std::uint64_t);\n'+search.replace(anchor,anchor+'\n\n    gh0st_stockfish_yield(worker.threads.nodes_searched());')
(CACHE/'search.cpp').write_text(search)
shutil.copyfile(REPO/'research/chess/engine/hybrid/stack-switch.s',CACHE/'stack-switch.s')
common=['-std=c++20','-O3','-fno-exceptions','-fno-rtti','-DGH0ST_ICP','-DIS_64BIT','-DUSE_POPCNT','-DNO_TABLEBASES','-DARCH=gl3-scalar','-fconstexpr-steps=500000000','-I'+str(SRC),'-I'+str(CHESS/'engine'),'-mno-simd128']
for name in ['search','continuation']:
 source=CACHE/'search.cpp' if name=='search' else HERE/'continuation.cpp'
 run([SDK/'clang++',*common,'-c',source,'-o',CACHE/(name+'.o')])
run([SDK/'clang','-c',CACHE/'stack-switch.s','-o',CACHE/'stack-switch.o'])
objects=[p for p in (CHESS/'engine/.cache/wasm').rglob('*.o') if p.name not in ['search.o','gl3.o']]
assert len(objects)>10
exports=['gh0st_engine_thunk','gh0st_call_on_engine_stack','gh0st_current_stack_pointer','gl3_alloc','gl3_free','gl3_slice_init','gl3_slice_begin','gl3_slice_advance','gl3_slice_observed','gl3_slice_actual','gl3_slice_steps','gl3_slice_depth','gl3_slice_best','gl3_slice_canonical','gl3_slice_canonical_size']
raw=CACHE/'sliced.raw.wasm'
run([SDK/'clang++','-mexec-model=reactor',*objects,CACHE/'search.o',CACHE/'continuation.o',CACHE/'stack-switch.o','-Wl,-z,stack-size=8388608','-Wl,--initial-memory=134217728','-Wl,--max-memory=2147483648',*[f'-Wl,--export={x}' for x in exports],'-Wl,--allow-undefined','-o',raw])
run([PY,HERE/'transform.py'])
(HERE/'runtime/.cache').mkdir(parents=True,exist_ok=True)
shutil.copyfile(CACHE/'sliced.wasm',HERE/'runtime/.cache/sliced.wasm')
report={'scope':'Build only; complete sliced search and chain cadence not implied','moduleSHA256':sha(CACHE/'sliced.wasm'),'bytes':(CACHE/'sliced.wasm').stat().st_size,'nodes':24000000,'quantum':2048,'HashMiB':128,'threads':1,'upstreamSearchSHA256':sha(SRC/'search.cpp'),'instrumentedSearchSHA256':sha(CACHE/'search.cpp'),'publicDeployment':False,'realSpend':0}
(CACHE/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
