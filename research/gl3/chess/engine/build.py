"""Build one full-strength source for native and scalar WAVM companion targets."""
from pathlib import Path
import argparse,concurrent.futures,hashlib,json,os,shutil,subprocess
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[3];ENGINE=REPO/'research/chess/engine';CACHE=HERE/'.cache';SRC=CACHE/'src';SRC.mkdir(parents=True,exist_ok=True)
lock=json.loads((ENGINE/'source-lock.json').read_text());upstream=ENGINE/'.cache/Stockfish';assert subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip()==lock['stockfish']['commit']
network=upstream/'src'/lock['network']['name'];assert hashlib.sha256(network.read_bytes()).hexdigest()==lock['network']['sha256']
shutil.copytree(ENGINE/'.cache/Stockfish-icp/src',SRC,dirs_exist_ok=True,ignore=shutil.ignore_patterns('*.o','*.nnue','stockfish','*.a'))
# Give only the logical-state serializer explicit access; no search arithmetic is changed.
for name,cls in [('engine.h','class Engine {'),('search.h','class Worker {'),('tt.h','class TranspositionTable {'),('timeman.h','class TimeManagement {')]:
 p=SRC/name;s=p.read_text().replace('namespace Stockfish {','namespace Stockfish {\nstruct CheckpointAccess;',1);assert s.count(cls)==1;s=s.replace(cls,cls+'\n    friend struct ::Stockfish::CheckpointAccess;',1);p.write_text(s)
# Deterministic topology and embedded model only. No host filesystem/model fallback.
p=SRC/'engine.cpp';s=p.read_text().replace('numaContext(NumaConfig::from_system(DefaultNumaPolicy))','numaContext(NumaConfig{})');p.write_text(s)
p=SRC/'numa.h';s=p.read_text().replace('NumaConfig cfg = empty();','return NumaConfig{}; // GL3: fixed single-worker topology\n        NumaConfig cfg = empty();',1);p.write_text(s)
p=SRC/'nnue/network.cpp';s=p.read_text().replace('#if defined(GH0ST_ICP) && defined(__wasm__)','#if defined(GH0ST_ICP)');start=s.index('void Network::load(');end=s.index('\nbool Network::save(',start)
s=s[:start]+'''void Network::load(const fs::path&, fs::path evalfilePath, EvalFile& evalFile) {
 if (!evalfilePath.empty() && evalfilePath != evalFile.defaultName) std::abort();
 if (evalFile.current != evalFile.defaultName) load_internal(evalFile);
 if (evalFile.current != evalFile.defaultName) std::abort();
}
'''+s[end:];p.write_text(s)
for name in ['checkpoint.h','engine.cpp']:shutil.copy2(HERE/name,CACHE/name)
sources=[p for p in SRC.rglob('*.cpp') if p.name not in ['main.cpp']]
# Only the regular source list; test/vendor entrypoints are not admitted.
sources=[p for p in sources if p.parent==SRC or p.parent.name in ['nnue','features','syzygy']]
sources.append(CACHE/'engine.cpp')
wasi=ENGINE/'.cache/toolchain/wasi-sdk/wasi-sdk-25.0/bin';common=['-std=c++20','-O3','-fno-exceptions','-fno-rtti','-DGH0ST_ICP','-DIS_64BIT','-DUSE_POPCNT','-DNO_TABLEBASES','-DARCH=gl3-scalar','-fconstexpr-steps=500000000','-I'+str(SRC),'-I'+str(CACHE)]
parser=argparse.ArgumentParser();parser.add_argument('--target',choices=['native','wasm','both'],default='both');options=parser.parse_args()
records=[]
for target,compiler,extra in [('native','/usr/bin/clang++',['-fPIC','-DUSE_NEON=8','-DUSE_NEON_DOTPROD','-mcpu=apple-m1']),('wasm',str(wasi/'clang++'),['-mno-simd128'])]:
 if options.target not in ['both',target]:continue
 out=CACHE/target;out.mkdir(exist_ok=True)
 def compile(p):
  obj=out/(str(p.relative_to(SRC)) if p.is_relative_to(SRC) else 'gl3.cpp');obj=obj.with_suffix('.o');obj.parent.mkdir(parents=True,exist_ok=True)
  subprocess.run([compiler,*common,*extra,'-c',str(p),'-o',str(obj)],check=True,stdout=subprocess.DEVNULL);return obj
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:objects=list(pool.map(compile,sources))
 asm=out/'weights.s';symbol='_gEmbeddedNNUEData' if target=='native' else 'gEmbeddedNNUEData';section='.section __TEXT,__const' if target=='native' else '.section .rodata.gEmbeddedNNUEData,"",@'
 asm.write_text(section+'\n.globl '+symbol+('\n.type '+symbol+',@object' if target=='wasm' else '')+'\n.p2align 6\n'+symbol+':\n.incbin "'+str(network)+'"\n'+('.size '+symbol+', .-'+symbol+'\n' if target=='wasm' else ''))
 embed=out/'weights.o';subprocess.run([compiler,'-c',str(asm),'-o',str(embed)],check=True)
 if target=='native':
  artifact=CACHE/'libgl3chess-neon.dylib';subprocess.run(['/usr/bin/ar','rcs',str(CACHE/'libgl3chess.a'),*[str(p) for p in objects],str(embed)],check=True);args=[compiler,'-dynamiclib',*[str(p) for p in objects],str(embed),'-o',str(artifact)]
 else:
  artifact=CACHE/'gl3chess.wasm';exports=['gl3chess__execute','gl3_execute','gl3_free','gl3_alloc','__wasm_call_ctors']
  args=[compiler,'-mexec-model=reactor',*[str(p) for p in objects],str(embed),'-Wl,-z,stack-size=8388608','-Wl,--initial-memory=134217728','-Wl,--max-memory=2147483648',*[f'-Wl,--export={x}' for x in exports],'-Wl,--allow-undefined','-o',str(artifact)]
 subprocess.run(args,check=True)
 records.append({'target':target,'bytes':artifact.stat().st_size,'SHA256':hashlib.sha256(artifact.read_bytes()).hexdigest()})
(CACHE/'build.json').write_text(json.dumps({'stockfishCommit':lock['stockfish']['commit'],'NNUE_SHA256':lock['network']['sha256'],'nodes':24000000,'HashMiB':128,'threads':1,'artifacts':records},indent=2)+'\n')
print(json.dumps(records,indent=2))
