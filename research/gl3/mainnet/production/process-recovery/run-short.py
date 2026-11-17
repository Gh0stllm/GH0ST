from pathlib import Path
import subprocess,os,json,time,hashlib
b=Path('/root/gl3-process-recovery');src=b/'native';go=Path('/root/bounded-restore/toolchain/go/bin/go');o=b/'attempt-01';o.mkdir(exist_ok=False)
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
files=['precompiles/gl3_restore_schedule_wasm.go','precompiles/gl3_restore_schedule_native.go','precompiles/ArbGhostChessSlices.go','precompiles/ArbGhostChessSliceDelta.go','go-ethereum/core/state/state_object.go','go-ethereum/core/state/statedb.go','go-ethereum/core/state/statedb_hooked.go','system_tests/common_test.go','system_tests/test_info.go']
before={f:sha(src/f) for f in files};ref=Path('/root/bounded-restore/fast-comparison/C-combined/native');assert all(before[f]==sha(ref/f) for f in files)
manifest={'sourceBefore':before,'fixtureSHA256':sha(src/'system_tests/gl3_process_recovery_test.go'),'enginePolicyChanged':False,'moduleRoot':'0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086','goVersion':subprocess.run([go,'version'],capture_output=True,text=True,check=True).stdout.strip(),'allExecutionOnRunpod':True,'test':'TestGL3Cursor64ProcessCrashRecovery'}
(o/'build-source.json').write_text(json.dumps(manifest,indent=2)+'\n')
env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'2','NITRO_TEST_L1_GETH':'/root/terminal-acceptance/bin/geth','GL3_PROCESS_RECOVERY_OUT':str(o/'run'),'GL3_PROCESS_RECOVERY_MACHINES':str(b/'machines')}
args=[str(go),'test','-c','-p','2','-mod=readonly','-tags=gl3_acceptance','-ldflags=-extldflags=-Wl,-z,noexecstack','-o',str(o/'system_tests.test'),'./system_tests'];t=time.monotonic()
with (o/'build.log').open('w') as log:p=subprocess.run(args,cwd=src,env=env,stdout=log,stderr=subprocess.STDOUT)
(o/'build-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t,'args':args})+'\n')
if p.returncode:raise SystemExit(p.returncode)
manifest['binarySHA256']=sha(o/'system_tests.test');manifest['sourceAfterBuild']={f:sha(src/f) for f in files};assert manifest['sourceAfterBuild']==before;(o/'build-source.json').write_text(json.dumps(manifest,indent=2)+'\n')
args=[str(o/'system_tests.test'),'-test.run=^TestGL3Cursor64ProcessCrashRecovery$','-test.v','-test.timeout=15m'];t=time.monotonic()
with (o/'test.log').open('w') as log:
 p=subprocess.Popen(args,cwd=src,env=env,stdout=log,stderr=subprocess.STDOUT)
 (o/'test-process.json').write_text(json.dumps({'pid':p.pid,'args':args,'startedAt':time.time(),'scope':'short cursor64 genuine private process crash only'})+'\n')
 code=p.wait()
(o/'test-exit.json').write_text(json.dumps({'exitCode':code,'seconds':time.monotonic()-t})+'\n')
manifest['sourceAfterTest']={f:sha(src/f) for f in files};manifest['binaryUnchanged']=sha(o/'system_tests.test')==manifest['binarySHA256'];manifest['sourceUnchanged']=manifest['sourceAfterTest']==before;(o/'build-source.json').write_text(json.dumps(manifest,indent=2)+'\n')
