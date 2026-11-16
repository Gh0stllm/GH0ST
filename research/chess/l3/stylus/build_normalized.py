"""Canonicalize Rust Wasm for the real Nitro Stylus parser; no chain calls."""
from pathlib import Path
import hashlib,json,os,subprocess
ROOT=Path(__file__).resolve().parent
raw=ROOT/'target/wasm32-unknown-unknown/release/gh0st_stylus_kernel.wasm'
out=ROOT/'target/gh0st_stylus_kernel.canonical.wasm'
if not raw.is_file():raise SystemExit('Build the raw Rust contract first')
env=dict(os.environ);env['CARGO_TARGET_DIR']=str(ROOT/'target/canonicalizer')
subprocess.run(['cargo','run','--locked','--release','--manifest-path',str(ROOT/'normalize/Cargo.toml'),
    '--',str(raw),str(out)],check=True,env=env,cwd=ROOT,capture_output=True,text=True)
record={'scope':'Canonical Wasm re-encoding only; activation evidence is a separate native Nitro test',
    'method':'wasmparser/wasm-encoder0.245.1 RoundtripReencoder; no instruction-semantic changes',
    'raw':{'bytes':raw.stat().st_size,'sha256':hashlib.sha256(raw.read_bytes()).hexdigest()},
    'canonical':{'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()},
    'reasons':['LLVM pads call_indirect table index zero; reference-types-disabled Nitro parser needs canonical reserved zero'],
    'productionReady':False,'chainCallsSubmitted':0}
(ROOT/'evidence/canonicalized-build.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
