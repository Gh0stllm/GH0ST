"""Canonicalize the reviewed contract and test real local Nitro activation/calls.

Requires native-build.py prerequisites. Never starts a node or sends a transaction.
"""
import hashlib,json,os,shutil,subprocess
from pathlib import Path
r=Path(__file__).resolve().parent;n=r.parent;stylus=n.parent/'stylus'
raw=stylus/'target/wasm32-unknown-unknown/release/gh0st_stylus_kernel.wasm'
assert hashlib.sha256(raw.read_bytes()).hexdigest()=='50c3f59bb8bdbd6b6883835ce5caf24a58057e526ea3989d77403ad921db723c'
out=r/'.cache/canonical.wasm';out.parent.mkdir(exist_ok=True)
env={**os.environ,'CARGO_TARGET_DIR':str(r/'.cache/target')}
subprocess.run(['cargo','build','--locked','--release','--manifest-path',str(r/'canonicalizer/Cargo.toml')],cwd=r,env=env,check=True)
subprocess.run([str(r/'.cache/target/release/gh0st-wasm-canonicalizer'),str(raw),str(out)],check=True)
assert hashlib.sha256(out.read_bytes()).hexdigest()=='e15336947f6bc96a6e29c5eab5d0ad84ffb8d76422f03866115766d1173b5527'
shutil.copy2(r/'GH0STStylusActivation_test.go',n/'.cache/nitro-build/precompiles/GH0STStylusActivation_test.go')
env={**os.environ,'GOTOOLCHAIN':'local','GH0ST_STYLUS_WASM':str(out),'GH0ST_STYLUS_CASES':str(stylus/'evidence/abi-cases.json'),'GH0ST_STYLUS_EVIDENCE':str(r/'result.json')}
subprocess.run([str(n/'.cache/go/bin/go'),'test','./precompiles','-run','^TestGH0STRealStylusActivationAndABI$','-count=1','-v'],cwd=n/'.cache/nitro-build',env=env,check=True,timeout=180)
