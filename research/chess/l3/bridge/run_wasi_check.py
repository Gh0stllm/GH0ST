"""Run the real Go/WASI interpreter executable against the same native fixture.

File IO is confined to the fixture command. No Nitro proving claim is made.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import time
import wasmtime

HERE=Path(__file__).resolve().parent
CACHE=HERE/'.cache';CACHE.mkdir(exist_ok=True)
go=HERE.parent/'nitro/.cache/go/bin/go'
native=CACHE/'replaycheck';wasm=CACHE/'replaycheck.wasm'
subprocess.run([str(go),'build','-o',str(native),'./cmd/replaycheck'],cwd=HERE,check=True)
import os
subprocess.run([str(go),'build','-o',str(wasm),'./cmd/replaycheck'],cwd=HERE,check=True,env={**os.environ,'GOOS':'wasip1','GOARCH':'wasm'})
native_result=json.loads(subprocess.check_output([str(native),str(HERE.parent),'complete'],cwd=HERE,text=True))
engine=wasmtime.Engine();store=wasmtime.Store(engine);store.set_limits(memory_size=1024*1024*1024)
wasi=wasmtime.WasiConfig();wasi.argv=['replaycheck','/fixtures','complete'];wasi.preopen_dir(str(HERE.parent),'/fixtures')
wasi.stdout_file=str(CACHE/'wasi.stdout');wasi.stderr_file=str(CACHE/'wasi.stderr');store.set_wasi(wasi)
linker=wasmtime.Linker(engine);linker.define_wasi();module=wasmtime.Module.from_file(engine,str(wasm))
started=time.perf_counter();instance=linker.instantiate(store,module)
try:
    instance.exports(store)['_start'](store)
except wasmtime.ExitTrap as exit:
    if exit.code!=0:raise
wasi_result=json.loads((CACHE/'wasi.stdout').read_text())
assert native_result==wasi_result,(native_result,wasi_result)
assert wasi_result['Done'] and wasi_result['BestToken']==2402
assert wasi_result['LogitsI32LESHA256']=='44f7ac472b255db705be0be97f0ad9b820dd985530ac16fd3534363081b2787a'
report={'scope':'Actual compiled Go/WASI interpreter execution against native Go, one complete model position; not a Nitro fraud prover',
 'nativeAndWasiEqual':True,'result':wasi_result,'goWasiModuleSHA256':hashlib.sha256(wasm.read_bytes()).hexdigest(),
 'goWasiModuleBytes':wasm.stat().st_size,'localWasiSeconds':round(time.perf_counter()-started,6),
 'fixtureIOOutsideRuntimeBridge':True,'chainBooted':False,'fraudProofExecuted':False}
(HERE/'evidence').mkdir(exist_ok=True);(HERE/'evidence/wasi-execution.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
