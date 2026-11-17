"""Compile the isolated full-native capture ELF only; never starts an engine."""
from pathlib import Path
import hashlib,json,os,shutil,signal,subprocess,time
R=Path('/root/gl3-full-checkpoint-guest');D=R/'terminal-native';S=D/'source';B=Path('/root/bounded-restore/fast-comparison/C-combined/native');G=Path('/root/bounded-restore/toolchain/go/bin/go')
if Path(__file__).resolve().parent!=D:raise RuntimeError('Owned old-worker source prefix required')
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
freeze=json.loads((D/'draft-source-manifest.json').read_text());auth=json.loads((D/'compile-authorization.json').read_text())
assert auth.get('authorized') is True and auth.get('controllerSHA256')==sha(Path(__file__)) and auth.get('sourceManifestSHA256')==sha(D/'draft-source-manifest.json'), 'Content-bound root compile review required'
assert int(Path('/sys/fs/cgroup/memory/memory.limit_in_bytes').read_text())==128_000_000_000,'Old warm build worker only'
for name,h in freeze['SHA256'].items():assert sha(S/name)==h
profile=json.loads((R/'evidence/result.json').read_text())
for name,h in profile['profileSources'].items():assert sha(R/'profile'/name)==h
program=Path('/root/bounded-restore/chess/sliced/runtime/.cache/sliced.wasm');assert sha(program)=='1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc'
assert sha(R/'replay.wasm')=='fc5645ec7536ca7191c4eaa1db0fa381a67dafb46cdf844eb6403298516fed5d'
assert sha(R/'machine-generation/machine/machine.v2.wavm.br')=='9f5ce0c06b01debaf3077c95559d38af11d2d7925f02721742acacfcfb944752'
O=D/'build';O.mkdir(exist_ok=False)
def save(n,x):(O/n).write_text(json.dumps(x,indent=2)+'\n')
overlay=json.loads((R/'overlay-native.json').read_text())['Replace']
for virtual,physical in [('precompiles/checkpoint_fixture_export_capture.go','checkpoint_fixture_export.go'),('system_tests/gl3_checkpoint_full24m_capture_test.go','gl3_checkpoint_full24m_capture_test.go'),('system_tests/gl3_checkpoint_terminal_batch_test.go','gl3_checkpoint_terminal_batch_test.go'),('system_tests/external_l1.go','external_l1_capture.go')]:overlay[str(B/virtual)]=str(S/physical)
P=O/'overlay.json';P.write_text(json.dumps({'Replace':overlay},indent=2)+'\n')
cpus=sorted(os.sched_getaffinity(0))[:2];os.sched_setaffinity(0,cpus);os.nice(10)
tmp=D/'build-tmp';tmp.mkdir(exist_ok=True)
env={**os.environ,'GOTOOLCHAIN':'local','GOMAXPROCS':'2','GOMEMLIMIT':'6GiB','GOCACHE':'/root/.cache/go-build','GOPROXY':'off','GOSUMDB':'off','GOTMPDIR':str(tmp),'PATH':str(G.parent)+':'+os.environ['PATH']}
args=[str(G),'test','-c','-overlay',str(P),'-p','2','-mod=readonly','-tags=gl3_acceptance,gl3_checkpoint_integration,gl3_checkpoint_capture','-o',str(D/'full-capture.test'),'./system_tests']
manifest={'nativeHelperSources':freeze['SHA256'],'frozenV1ProfileSources':profile['profileSources'],'unchangedSelectedRestoreSources':profile['baselines']['native']['selectedRestoreSources'],'portableEngineSHA256':sha(program),'engineAndNNUEUnchanged':True,'searchPolicy':'unchanged24m nodes/Hash128MiB/Threads1/Skill20/fullNNUE/retainedTT+history','guestSHA256':sha(R/'replay.wasm'),'moduleRoot':'0x2a423e3e57903ae5bcb7385608d05387201b5cde24a7d4138d5b7ec09cb9e608','machineSHA256':sha(R/'machine-generation/machine/machine.v2.wavm.br'),'companionSHA256':sha(Path('/root/bounded-restore/machine-inputs/gl3aot.wasm')),'libstylusSHA256':sha(B/'target/lib/libstylus.a'),'goModSHA256':sha(B/'go.mod'),'goSumSHA256':sha(B/'go.sum'),'overlaySHA256':sha(P),'compileArgs':args,'cpuAffinity':cpus,'goldenSHA256':'2a450f90d70bede6e9202740cb7fb205e359623e7fc11cf96a4fb6a3f1fec71a','goldenOperations':2489,'goldenProgressStep':9955,'engineSearchExecuted':False,'allExecutionOnRunpod':True,'baselineEdited':False,'productionAccepted':False}
save('source-manifest.json',manifest)
def allocated():return sum(p.stat().st_blocks*512 for p in R.rglob('*') if p.is_file() and not p.is_symlink())
if allocated()>3*1024**3 or shutil.disk_usage(R).free<6_000_000_000:raise RuntimeError('Initial old-worker resource guard')
start=time.monotonic();reason=None;sent=None;peak=allocated();free_min=shutil.disk_usage(R).free
with (O/'compile.log').open('wb') as log:
 p=subprocess.Popen(args,cwd=B,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);save('process.json',{'pid':p.pid,'controllerPID':os.getpid(),'args':args})
 while True:
  pid,status,usage=os.wait4(p.pid,os.WNOHANG)
  if pid:
   code=os.waitstatus_to_exitcode(status);p.returncode=code;save('exit.json',{'exitCode':code,'seconds':time.monotonic()-start,'terminationReason':reason,'kernelMaxRSSKiB':usage.ru_maxrss,'exitRetrieval':'os.wait4 direct compiler child'});break
  used=allocated();free=shutil.disk_usage(R).free;peak=max(peak,used);free_min=min(free_min,free)
  if reason is None and (used>3*1024**3 or free<6_000_000_000):reason='oldworker3GiBowned/6GBfree resource guard'
  if reason and sent is None:os.killpg(p.pid,signal.SIGTERM);sent=time.monotonic()
  elif sent is not None and time.monotonic()-sent>5:
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
  time.sleep(.25)
if code or reason:raise RuntimeError('Compile failed; actual evidence preserved')
for name,h in freeze['SHA256'].items():assert sha(S/name)==h
for name,h in profile['profileSources'].items():assert sha(R/'profile'/name)==h
manifest.update(status='COMPILED_NOT_EXECUTED',nativeFullELFSHA256=sha(D/'full-capture.test'),nativeFullELFBytes=(D/'full-capture.test').stat().st_size,sampledPeakOwnedAllocatedBytes=peak,sampledMinimumFreeBytes=free_min)
save('compiled-inputs.json',manifest);print(json.dumps(manifest),flush=True)
