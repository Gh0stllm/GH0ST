"""Run the real Go/Wasm wrapper and scalar companion with native Wasmtime.

Tiny Wasm adapters implement the existing cross-module memory operations, with
no Python callback per copied word. Compare the frozen eager wrapper against
the new lazy mirror and the independent portable VM checkpoint.
"""
from pathlib import Path
import hashlib,json,os,subprocess,time
import wasmtime
HERE=Path(__file__).resolve().parent;CHESS=HERE.parents[1];REPO=CHESS.parents[2];CACHE=HERE/'.cache'
go=REPO/'research/chess/l3/core/node/.cache/go-1.25.12/go/bin/go'
source=HERE/'proof_runtime.go.txt';new=CHESS/'.cache/aot-runtime-lazy-probe';old=CHESS/'.cache/aot-runtime-aot'
assert old.exists(), 'build the baseline AOT variant first'
subprocess.run(['python3',str(HERE/'make_runtime.py'),str(new)],check=True)
engine=wasmtime.Engine();dispatch=wasmtime.Module(engine,'''(module
 (type $load (func (param i32) (result i32))) (type $store (func (param i32 i32)))
 (table (export "handlers") 4 funcref)
 (func (export "wavm_caller_load32") (param i32) (result i32) local.get 0 i32.const 0 call_indirect (type $load))
 (func (export "wavm_caller_load8") (param i32) (result i32) local.get 0 i32.const 1 call_indirect (type $load))
 (func (export "wavm_caller_store32") (param i32 i32) local.get 0 local.get 1 i32.const 2 call_indirect (type $store))
 (func (export "wavm_caller_store8") (param i32 i32) local.get 0 local.get 1 i32.const 3 call_indirect (type $store)))''')
memory_adapter=wasmtime.Module(engine,'''(module
 (import "go" "memory" (memory 0))
 (global $loads (export "loads") (mut i64) (i64.const 0))
 (global $stores (export "stores") (mut i64) (i64.const 0))
 (func (export "load32") (param i32) (result i32) global.get $loads i64.const 4 i64.add global.set $loads local.get 0 i32.load)
 (func (export "load8") (param i32) (result i32) global.get $loads i64.const 1 i64.add global.set $loads local.get 0 i32.load8_u)
 (func (export "store32") (param i32 i32) global.get $stores i64.const 4 i64.add global.set $stores local.get 0 local.get 1 i32.store)
 (func (export "store8") (param i32 i32) global.get $stores i64.const 1 i64.add global.set $stores local.get 0 local.get 1 i32.store8))''')
companion=CACHE/'companion.wasm';proof=json.loads((CACHE/'proof-parity.json').read_text());assert proof['artifactSHA256']==hashlib.sha256(companion.read_bytes()).hexdigest()
cm=wasmtime.Module.from_file(engine,str(companion));results={}
for name,runtime in [('eager',old),('lazy',new)]:
 folder=CACHE/('wrapper-'+name);folder.mkdir(exist_ok=True)
 (folder/'main.go').write_bytes((HERE/'wrapper_probe.go.txt').read_bytes())
 (folder/'go.mod').write_text('module gh0st-wrapper-probe\n\ngo 1.25.0\n\nrequire github.com/Gh0stllm/GH0ST/gl3/slicedchess v0.0.0\nreplace github.com/Gh0stllm/GH0ST/gl3/slicedchess => '+str(runtime)+'\n')
 wasm=folder/'probe.wasm';subprocess.run([str(go),'build','-mod=mod','-tags=gl3aotproof','-o',str(wasm),'.'],cwd=folder,env={**os.environ,'GOOS':'wasip1','GOARCH':'wasm','CGO_ENABLED':'0','GOTOOLCHAIN':'local'},check=True)
 store=wasmtime.Store(engine);wasi=wasmtime.WasiConfig();wasi.stdout_file=str(folder/'stdout.json');wasi.stderr_file=str(folder/'stderr.log');store.set_wasi(wasi)
 linker=wasmtime.Linker(engine);linker.define_wasi()
 d=linker.instantiate(store,dispatch).exports(store)
 for imp in cm.imports:
  if imp.module=='env':linker.define(store,imp.module,imp.name,d[imp.name])
  elif imp.module!='wasi_snapshot_preview1':raise RuntimeError('unexpected companion host '+imp.module+'.'+imp.name)
 c=linker.instantiate(store,cm).exports(store);linker.define(store,'gl3aot','execute',c['gl3aot__execute'])
 m=wasmtime.Module.from_file(engine,str(wasm));x=linker.instantiate(store,m).exports(store)
 linker.define(store,'go','memory',x['memory']);a=linker.instantiate(store,memory_adapter).exports(store)
 for i,n in enumerate(['load32','load8','store32','store8']):d['handlers'].set(store,i,a[n])
 start=time.monotonic()
 try:x['_start'](store)
 except wasmtime.ExitTrap as e:
  if e.code!=0:raise
 result=json.loads((folder/'stdout.json').read_text());result.update(memoryReadBytes=a['loads'].value(store),memoryWrittenBytes=a['stores'].value(store),seconds=time.monotonic()-start)
 results[name]=result;print(name,json.dumps(result),flush=True)
assert results['eager']['checkpoints']==results['lazy']['checkpoints']
assert all(r['illegalHistoryRejected'] for r in results.values())
assert results['lazy']['checkpoints'][-1]['memorySHA256']=='ed3ceea9850c84f6e30ade1096a29b5f851a016a7cb4ad1478dc97c03518eadf'
# Two successful groups and two initializations: eager has eight step copies,
# lazy has two. Init snapshots are kept equal on both sides of the comparison.
saved=results['eager']['memoryWrittenBytes']-results['lazy']['memoryWrittenBytes']
assert saved==6*466157568,(saved,results)
report={'passed':True,'scope':'real Go/Wasm wrapper plus unchanged scalar companion under Wasmtime; no full WAVM block proof implied','results':results,'copiedBytesSaved':saved,'perFourStepOperationCopiesBefore':4,'perFourStepOperationCopiesAfter':1,'companionSHA256':proof['artifactSHA256'],'lazySourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'publicDeployment':False,'realSpend':0}
(CACHE/'wrapper-parity.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2),flush=True)
