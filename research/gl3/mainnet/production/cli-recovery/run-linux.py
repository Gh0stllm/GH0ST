"""Short ordinary cmd/nitro SIGKILL rehearsal on an isolated Runpod tree."""
from pathlib import Path
import hashlib,json,os,platform,shutil,subprocess,time,uuid
if platform.system()!='Linux':raise RuntimeError('All execution must stay on Runpod Linux')
kit=Path(__file__).resolve().parent
if not str(kit).startswith('/root/gl3-cli-recovery/'):raise RuntimeError('Isolated owned prefix required')
root=kit.parent;out=root/('attempt-'+uuid.uuid4().hex);out.mkdir(exist_ok=False)
base=Path('/root/bounded-restore/fast-comparison/C-combined/native');source=root/'native';go=Path('/root/bounded-restore/toolchain/go/bin/go');cli=Path('/root/bounded-restore/selected-cli/nitro')
def sha(p):
 with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(n,x):(out/n).write_text(json.dumps(x,indent=2)+'\n')
if sha(cli)!='13ba3c913c260c453628f273cfd8dc86f742f291d87e9a9887531e039d351f38':raise RuntimeError('Selected ordinary CLI changed')
if not source.exists():shutil.copytree(base,source,symlinks=True,ignore=shutil.ignore_patterns('.git','node_modules'))
fixture=source/'system_tests/gl3_cli_recovery_test.go';shutil.copy2(kit/'gl3_cli_recovery_test.go',fixture)
env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'2','NITRO_TEST_L1_GETH':'/root/terminal-acceptance/bin/geth','GL3_CLI_RECOVERY_OUT':str(out/'run'),'GL3_CLI_RECOVERY_MACHINES':'/root/future-lifecycle-865-build/machines','GL3_CLI_RECOVERY_BINARY':str(cli)}
# Restrict the controller, Geth and actual CLI descendants to two affinity slots.
cpus=sorted(os.sched_getaffinity(0))[:2];os.sched_setaffinity(0,cpus)
files=['precompiles/ArbGhostChessSlices.go','precompiles/ArbGhostChessSliceDelta.go','go-ethereum/core/state/state_object.go','go-ethereum/core/state/statedb.go','cmd/nitro/nitro.go','cmd/nitro/config/config.go','cmd/nitro/init/init.go','cmd/conf/database.go','cmd/genericconf/server.go','statetransfer/jsondatareader.go','system_tests/common_test.go','system_tests/test_info.go']
before={n:sha(base/n) for n in files};actual={n:sha(source/n) for n in files}
if actual!=before:raise RuntimeError('Native controller source differs from selected C')
subprocess.run([str(go.parent/'gofmt'),'-w',str(fixture)],check=True)
shutil.copy2(fixture,out/'compiled-fixture.go')
manifest={'sourceBefore':before,'fixtureSHA256':sha(fixture),'ordinaryCLISHA256':sha(cli),'allExecutionOnRunpod':True,'compileCPUAffinity':cpus,'scope':'Actual ordinary CLI partial64 crash/restart only; no completed decision or proof'};save('source-manifest.json',manifest)
binary=out/'system_tests.test';args=[str(go),'test','-c','-p','2','-mod=readonly','-tags=gl3_acceptance','-ldflags=-extldflags=-Wl,-z,noexecstack','-o',str(binary),'./system_tests'];start=time.monotonic()
with (out/'build.log').open('w') as log:r=subprocess.run(args,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT)
save('build-exit.json',{'exitCode':r.returncode,'seconds':time.monotonic()-start,'args':args})
if r.returncode:raise SystemExit(r.returncode)
manifest['controllerBinarySHA256']=sha(binary);save('source-manifest.json',manifest)
args=[str(binary),'-test.run=^TestGL3Cursor64CLIProcessCrashRecovery$','-test.v','-test.timeout=15m'];start=time.monotonic()
with (out/'test.log').open('w') as log:
 p=subprocess.Popen(args,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 save('test-process.json',{'PID':p.pid,'args':args,'startedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())});code=p.wait()
save('test-exit.json',{'exitCode':code,'seconds':time.monotonic()-start})
manifest['sourceAfter']={n:sha(base/n) for n in files};manifest['selectedSourceUnchanged']=manifest['sourceAfter']==before;manifest['ordinaryCLIUnchanged']=sha(cli)==manifest['ordinaryCLISHA256'];save('source-manifest.json',manifest)
if code:raise SystemExit(code)
with (out/'test.log').open() as log:markers=''.join(s for s in log if s.startswith(('=== RUN','--- PASS:','--- FAIL:','PASS','FAIL')))
if '--- PASS: TestGL3Cursor64CLIProcessCrashRecovery (' not in markers or '\nPASS\n' not in markers:raise RuntimeError('Named CLI test did not complete')
result=json.loads((out/'run/cli64-result.json').read_text());
if result.get('passed') is not True or not manifest['selectedSourceUnchanged'] or not manifest['ordinaryCLIUnchanged']:raise RuntimeError('No strict CLI pass')
save('acceptance-result.json',{'passed':True,'allExecutionOnRunpod':True,'namedTestMarkers':markers,'scope':result['scope'],'exactLiveConsensusMessageCountAvailable':False,'selectedMachineOrProverModified':False})
