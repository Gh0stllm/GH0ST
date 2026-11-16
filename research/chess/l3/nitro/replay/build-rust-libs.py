from pathlib import Path
import subprocess,os,json,time,shutil
b=Path(__file__).resolve().parents[1]/'.cache';s=b/'nitro-build';tb=b/'rust-1.93.0/bin';sdk=(b/'../../../engine/.cache/toolchain/wasi-sdk/wasi-sdk-25.0').resolve();env={**os.environ,'PATH':str(tb)+':'+str(sdk/'bin')+':'+os.environ['PATH'],'RUSTC':str(tb/'rustc'),'RUSTDOC':str(tb/'rustdoc'),'CARGO_HOME':str(b/'cargo-home'),'CARGO_TARGET_DIR':str(b/'stylus-target'),'CC_wasm32_wasip1':str(sdk/'bin/clang'),'AR_wasm32_wasip1':str(sdk/'bin/llvm-ar')};records=[]
def run(args):
 t=time.time();p=subprocess.run(args,cwd=s,env=env,capture_output=True,text=True);r={'command':args,'exitCode':p.returncode,'seconds':round(time.time()-t,3),'outputTail':(p.stdout+p.stderr)[-5000:]};records.append(r)
 if p.returncode:raise RuntimeError(json.dumps(r))
 return r
try:
 cargo=str(tb/'cargo');cfg=str(s/'crates/wasm-libraries/.cargo/config.toml')
 run([cargo,'build','--locked','--release','--target','wasm32-unknown-unknown','--config',cfg,'-p','wasi-stub'])
 run([cargo,'build','--locked','--release','--target','wasm32-wasip1','--config',cfg,'-p','host-io','-p','user-host','-p','program-exec','-p','arbcompress','-p','arbcrypto'])
 run([cargo,'build','--locked','--release','-p','forward','--bin','forward'])
 machines=s/'target/machines/latest';machines.mkdir(parents=True,exist_ok=True)
 for name in ['host_io','user_host','program_exec','arbcompress','arbcrypto']:
  shutil.copy2(b/'stylus-target/wasm32-wasip1/release'/(name+'.wasm'),machines/(name+'.wasm'))
 shutil.copy2(b/'stylus-target/wasm32-unknown-unknown/release/wasi_stub.wasm',machines/'wasi_stub.wasm')
 for name in ['forward','forward_stub']:
  args=[str(b/'stylus-target/release/forward'),'--path',str(machines/(name+'.wat'))]
  if name.endswith('stub'):args.append('--stub')
  run(args)
finally:
 (b/'replay-rust-libs-build.json').write_text(json.dumps({'scope':'Pinned upstream Rust companion WASM compilation','records':records,'allPassed':all(x['exitCode']==0 for x in records)},indent=2)+'\n');print(json.dumps(records[-1] if records else {},indent=2))
