"""Compile/test only on the owned Runpod worker, at most four build workers."""
from pathlib import Path
import subprocess,os,json,time,hashlib,platform
assert platform.system()=='Linux'
r=Path('/root/gl3-aot-jit');out=r/'evidence';out.mkdir(exist_ok=True)
env={**os.environ,'CARGO_HOME':str(r/'cargo'),'RUSTUP_HOME':str(r/'rustup'),'RUSTUP_TOOLCHAIN':'1.93.0','CARGO_BUILD_JOBS':'4','RAYON_NUM_THREADS':'4','PATH':str(r/'cargo/bin')+':'+os.environ['PATH']}
lock=hashlib.file_digest((r/'source/Cargo.lock').open('rb'),'sha256').hexdigest()
for name,args in [('cross-memory-tests',['test','--release','-p','jit','--features','cc_brotli','--locked','-j','4','--lib','aot_bridge::tests','--','--nocapture']),('jit-build',['build','--release','-p','jit','--features','cc_brotli','--locked','-j','4','--bin','jit'])]:
 started=time.monotonic()
 with (out/(name+'.log')).open('w') as log:p=subprocess.run([str(r/'cargo/bin/cargo'),*args],cwd=r/'source',env=env,stdout=log,stderr=subprocess.STDOUT)
 result={'exitCode':p.returncode,'seconds':time.monotonic()-started,'allExecutionOnRunpod':True,'buildWorkers':4};(out/(name+'-exit.json')).write_text(json.dumps(result,indent=2)+'\n');print(name,json.dumps(result),flush=True)
 assert hashlib.file_digest((r/'source/Cargo.lock').open('rb'),'sha256').hexdigest()==lock,'Cargo.lock changed'
 assert p.returncode==0
binary=r/'source/target/release/jit';(out/'jit-binary.json').write_text(json.dumps({'path':str(binary),'bytes':binary.stat().st_size,'SHA256':hashlib.file_digest(binary.open('rb'),'sha256').hexdigest(),'diagnosticOnly':True,'interpreterOrOSPAcceptance':False},indent=2)+'\n')
