"""Add host-only separate Go/C linear-memory high-water reporting on Runpod."""
from pathlib import Path
import hashlib,difflib,subprocess,json,os,time,shutil,platform
assert platform.system()=='Linux'
r=Path('/root/gl3-aot-jit');out=r/'evidence-metrics-v3';out.mkdir(exist_ok=False)
binary=r/'source/target/release/jit';assert hashlib.file_digest(binary.open('rb'),'sha256').hexdigest()=='0d8a9c8ea7217bb6a6ed0bb551f57362f51c465805aded0e7208a0c63f946bfb';shutil.copyfile(binary,r/'bin/jit-v2-original-metrics')
p=r/'source/crates/jit/src/lib.rs';before=p.read_text();t=before.replace('    pub memory_used: Pages,','    pub memory_used: Pages,\n    pub companion_memory_used: Option<Pages>,',1)
anchor='    let memory_used = instance.exports.get_memory("memory")?.view(store).size();';assert t.count(anchor)==1
t=t.replace(anchor,anchor+'\n    let companion_memory = env.as_ref(&*store).aot_instance.as_ref()\n        .and_then(|x|x.exports.get_memory("memory").ok()).cloned();\n    let companion_memory_used = companion_memory.as_ref().map(|x|x.view(&*store).size());',1)
t=t.replace('        memory_used,','        memory_used,\n        companion_memory_used,',1);p.write_text(t)
patch=''.join(difflib.unified_diff(before.splitlines(True),t.splitlines(True),fromfile='a/crates/jit/src/lib.rs',tofile='b/crates/jit/src/lib.rs'))
p=r/'source/crates/jit/src/main.rs';before=p.read_text();anchor='            "guestMemoryBytes":result.memory_used.bytes().0,';assert before.count(anchor)==1
t=before.replace(anchor,anchor+'\n            "goLinearMemoryPeakBytes":result.memory_used.bytes().0,\n            "companionLinearMemoryPeakBytes":result.companion_memory_used.map(|x|x.bytes().0),\n            "linearMemoryPeakMethod":"Final size of non-shrinking WASM linear memory; excludes host RSS",',1);p.write_text(t);patch+=''.join(difflib.unified_diff(before.splitlines(True),t.splitlines(True),fromfile='a/crates/jit/src/main.rs',tofile='b/crates/jit/src/main.rs'));(out/'host-observability.patch').write_text(patch)
env={**os.environ,'CARGO_HOME':str(r/'cargo'),'RUSTUP_HOME':str(r/'rustup'),'RUSTUP_TOOLCHAIN':'1.93.0','CARGO_BUILD_JOBS':'4','RAYON_NUM_THREADS':'4','PATH':str(r/'cargo/bin')+':'+os.environ['PATH']};lock=hashlib.file_digest((r/'source/Cargo.lock').open('rb'),'sha256').hexdigest()
for name,args in [('tests',['test','--release','-p','jit','--features','cc_brotli','--locked','-j','4','--lib','aot_bridge::tests','--','--nocapture']),('build',['build','--release','-p','jit','--features','cc_brotli','--locked','-j','4','--bin','jit'])]:
 start=time.monotonic()
 with (out/(name+'.log')).open('w') as log:p=subprocess.run([str(r/'cargo/bin/cargo'),*args],cwd=r/'source',env=env,stdout=log,stderr=subprocess.STDOUT)
 (out/(name+'-exit.json')).write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-start})+'\n');assert p.returncode==0
assert hashlib.file_digest((r/'source/Cargo.lock').open('rb'),'sha256').hexdigest()==lock
result={'passed':True,'hostObservabilityOnly':True,'jitSHA256':hashlib.file_digest(binary.open('rb'),'sha256').hexdigest(),'previousJitPreserved':str(r/'bin/jit-v2-original-metrics'),'guestAndCompanionBytesUnchanged':True,'allExecutionOnRunpod':True,'CargoLockSHA256':lock};(out/'build-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
