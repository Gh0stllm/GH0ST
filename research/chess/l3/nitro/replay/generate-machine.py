"""Canonicalize actual built companions and generate a complete WAVM machine.

Requires the separate full node/replay source build and build-c/rust-libs.py.
No fake imports: the only added WASI filesystem exports unconditionally trap.
"""
from pathlib import Path
import os,subprocess,json,time,hashlib,shutil
r=Path(__file__).resolve().parents[1];b=r/'.cache';s=b/'nitro-build';m=s/'target/machines/latest';tb=b/'rust-1.93.0/bin';canon=r/'stylus-native/.cache/target/release/gh0st-wasm-canonicalizer'
env={**os.environ,'PATH':str(tb)+':'+os.environ['PATH'],'RUSTC':str(tb/'rustc'),'RUSTDOC':str(tb/'rustdoc'),'CARGO_HOME':str(b/'cargo-home'),'CARGO_TARGET_DIR':str(b/'stylus-target')}
source=s/'crates/wasm-libraries/wasi-stub/lib.rs'
if 'fn wasi_snapshot_preview1__path_link(' not in source.read_text():subprocess.run(['git','apply',str(r/'replay/wasi-deny-io.patch')],cwd=s,env={**os.environ,'GIT_CEILING_DIRECTORIES':str(b)},check=True)
subprocess.run([str(tb/'cargo'),'build','--locked','--release','--target','wasm32-unknown-unknown','--config',str(s/'crates/wasm-libraries/.cargo/config.toml'),'-p','wasi-stub'],cwd=s,env=env,check=True)
watEnv={**env,'CARGO_TARGET_DIR':str(b/'wat-tool-target')};subprocess.run([str(tb/'cargo'),'build','--locked','--release','--manifest-path',str(r/'replay/wat-tool/Cargo.toml')],env=watEnv,check=True)
wat=b/'wat-tool-target/release/gh0st-replay-wat-tool'
for name in ['forward','forward_stub']:subprocess.run([str(wat),str(m/(name+'.wat')),str(m/(name+'.wasm'))],check=True)
shutil.copy2(b/'stylus-target/wasm32-unknown-unknown/release/wasi_stub.wasm',m/'wasi_stub.wasm');shutil.copy2(b/'bin/replay.wasm',m/'replay.wasm')
records=[]
for p in sorted(m.glob('*.wasm')):
 raw=p.read_bytes();out=p.with_suffix('.canonical');subprocess.run([str(canon),str(p),str(out)],check=True);p.unlink();out.rename(p);records.append({'name':p.name,'rawSHA256':hashlib.sha256(raw).hexdigest(),'canonicalSHA256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
(b/'replay-companion-artifacts.json').write_text(json.dumps({'artifacts':records},indent=2)+'\n')
subprocess.run([str(tb/'cargo'),'build','--locked','--release','-p','prover','--bin','prover','--features','cc_brotli'],cwd=s,env=env,check=True)
out=b/'replay-machine';out.mkdir(exist_ok=True);args=[str(b/'stylus-target/release/prover'),str(m/'replay.wasm'),'--generate-binaries',str(out)]
for name in ['forward','soft-float','wasi_stub','host_io','user_host','arbcompress','arbcrypto','program_exec']:args+=['-l',str(m/(name+'.wasm'))]
started=time.time();p=subprocess.run(args,cwd=s,capture_output=True,text=True,timeout=300)
report={'exitCode':p.returncode,'seconds':time.time()-started,'output':p.stdout+p.stderr,'machineGenerated':p.returncode==0,'inferenceExecuted':False,'fraudChallengeExecuted':False,'financialActions':False}
if not p.returncode:report['moduleRoot']=(out/'module-root.txt').read_text().strip()
(b/'replay-machine-reproduction.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));raise SystemExit(p.returncode)
