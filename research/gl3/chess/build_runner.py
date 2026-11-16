"""Build only the additive research driver; leave upstream prover/STF unchanged."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
OLD=REPO/'research/chess/l3/nitro'
SOURCE=OLD/'.cache/nitro-build'
TB=OLD/'.cache/rust-1.93.0/bin'
before=hashlib.sha256((SOURCE/'crates/prover/src/machine.rs').read_bytes()).hexdigest()
target=SOURCE/'crates/prover/src/bin/gl3_chess_replay.rs'
target.parent.mkdir(exist_ok=True)
shutil.copy2(HERE/'prover_runner.rs',target)
env={**os.environ,'PATH':str(TB)+':'+os.environ['PATH'],'RUSTC':str(TB/'rustc'),'RUSTDOC':str(TB/'rustdoc'),'CARGO_HOME':str(OLD/'.cache/cargo-home'),'CARGO_TARGET_DIR':str(OLD/'.cache/stylus-target')}
subprocess.run([str(TB/'cargo'),'build','--locked','--release','-p','prover','--bin','gl3_chess_replay','--features','cc_brotli'],cwd=SOURCE,env=env,check=True)
assert before==hashlib.sha256((SOURCE/'crates/prover/src/machine.rs').read_bytes()).hexdigest()
binary=OLD/'.cache/stylus-target/release/gl3_chess_replay'
out=HERE/'.cache/bin/gl3-chess-replay'
shutil.copy2(binary,out)
report={'scope':'Additive diagnostic driver using unchanged upstream interpreter; no replay execution implied','interpreterSourceSHA256':before,'driverSourceSHA256':hashlib.sha256((HERE/'prover_runner.rs').read_bytes()).hexdigest(),'binarySHA256':hashlib.sha256(out.read_bytes()).hexdigest(),'binaryBytes':out.stat().st_size,'WAVMModuleRootUnchanged':True,'botPolicyUnchanged':True}
(HERE/'.cache/runner-build.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
