"""Build a separate host CLI with one exact-final-step log; no prover math edits."""
from pathlib import Path
import os,subprocess,json,hashlib,difflib,time,shutil,platform
assert platform.system()=='Linux'
r=Path('/root/gl3-aot-jit');p=r/'source/crates/prover/src/main.rs';out=r/'evidence/prover-exact-final-steps';out.mkdir(exist_ok=False)
before=p.read_text();anchor='    println!("End machine status: {:?}", mach.get_status());';assert before.count(anchor)==1
after=before.replace(anchor,anchor+'\n    println!("GL3_EXACT_FINAL_STEPS {}", mach.get_steps());',1);p.write_text(after)
(out/'host-cli.patch').write_text(''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/crates/prover/src/main.rs',tofile='b/crates/prover/src/main.rs')))
sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
original=Path('/root/prover');original_sha=sha(original);lock=sha(r/'source/Cargo.lock')
env={**os.environ,'CARGO_HOME':str(r/'cargo'),'RUSTUP_HOME':str(r/'rustup'),'RUSTUP_TOOLCHAIN':'1.93.0','CARGO_BUILD_JOBS':'4','RAYON_NUM_THREADS':'4','PATH':str(r/'cargo/bin')+':'+os.environ['PATH']};started=time.monotonic()
with (out/'build.log').open('w') as log:proc=subprocess.run([str(r/'cargo/bin/cargo'),'build','--release','-p','prover','--bin','prover','--features','cc_brotli','--locked','-j','4'],cwd=r/'source',env=env,stdout=log,stderr=subprocess.STDOUT)
(out/'build-exit.json').write_text(json.dumps({'exitCode':proc.returncode,'seconds':time.monotonic()-started})+'\n');assert proc.returncode==0
target=r/'bin/prover-exact-final-steps';target.parent.mkdir(exist_ok=True);shutil.copyfile(r/'source/target/release/prover',target);target.chmod(0o755)
help_run=subprocess.run([str(target),'--help'],capture_output=True,text=True);(out/'help.log').write_text(help_run.stdout+help_run.stderr);assert help_run.returncode==0
assert sha(original)==original_sha and sha(r/'source/Cargo.lock')==lock
report={'passed':True,'scope':'Host prover CLI logging-only change; prover-library math, guest modules and roots unchanged','binary':str(target),'binarySHA256':sha(target),'beforeSourceSHA256':hashlib.sha256(before.encode()).hexdigest(),'afterSourceSHA256':hashlib.sha256(after.encode()).hexdigest(),'originalProverSHA256Unchanged':original_sha,'CargoLockSHA256Unchanged':lock,'helpExitCode':help_run.returncode,'exactStepExecutionTested':False,'allExecutionOnRunpod':True}
(out/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
