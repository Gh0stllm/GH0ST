"""Generate this isolated matching machine only; no replay/proof execution."""
from pathlib import Path
import hashlib,json,os,platform,shutil,signal,subprocess,time
R=Path('/root/gl3-full-checkpoint-guest')
if platform.system()!='Linux' or Path(__file__).resolve().parent!=R:raise RuntimeError('Runpod owned prefix only')
D=R/'machine-generation';D.mkdir(exist_ok=False)
T=Path('/root/gl3-aot-jit/bin/prover-exact-final-steps')
I=Path('/root/bounded-restore/machine-inputs')
EXPECTED={'forward':'1c45bf8429ca216ea9fa8b6ef4251e859800f7091f3d5be57a9566ffeeca6c99','soft-float':'eed26863498c0b0a060da3bc42dc09dea84e8872cf763f91598e698fb54b604f','wasi_stub':'03a9679220dc6854bc86abbf9a4138bbd92371d1a77cf2155708d223fa26662c','host_io':'f524b7ca272ded1159c5c287c13c8754f8b10c98f0d31ee854d10096b3e0630f','user_host':'a7a523d2e71ce1a4c7ae7f984032331b0298ea939f1dc6ccdc80ff6135ba34ac','arbcompress':'31c244b2e373e2e6cc189853fb6824a0f1244061b61b9eb27b57df103cf96ada','arbcrypto':'3ca6af8045178453415ed53aaa5a58e789e9a22b97cce0f502cff775576ef094','program_exec':'dbadff49188bbc5a6477d6fef4dec17f210e4e08e9699aec986a050c029a3ecb','gl3aot':'b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555'}
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(n,d):(D/n).write_text(json.dumps(d,indent=2)+'\n')
assert sha(T)=='cc5c9de07b2a739978e383cd4ac4baee3a1d49761c5c75ad414e12056cd7ab27'
assert sha(R/'replay.wasm')=='fc5645ec7536ca7191c4eaa1db0fa381a67dafb46cdf844eb6403298516fed5d'
for n,h in EXPECTED.items():assert sha(I/(n+'.wasm'))==h
cpus=sorted(os.sched_getaffinity(0))[:2];os.sched_setaffinity(0,cpus)
args=[str(T),str(R/'replay.wasm'),'--generate-binaries',str(D/'machine')]
for n in EXPECTED:args+=['-l',str(I/(n+'.wasm'))]
manifest={'guestSHA256':sha(R/'replay.wasm'),'toolSHA256':sha(T),'librarySHA256':EXPECTED,'args':args,'cpuAffinity':cpus,'allExecutionOnRunpod':True,'replayOrProofExecuted':False,'engineSearchExecuted':False,'selected865Modified':False,'productionAccepted':False}
save('input-manifest.json',manifest)
start=time.monotonic()
with (D/'build.log').open('wb') as log:
 p=subprocess.Popen(args,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'RAYON_NUM_THREADS':'2','MALLOC_ARENA_MAX':'2'},start_new_session=True)
 save('process.json',{'pid':p.pid,'args':args})
 error=None
 while True:
  waited,status,usage=os.wait4(p.pid,os.WNOHANG)
  if waited:p.returncode=os.waitstatus_to_exitcode(status);break
  allocated=sum(x.stat().st_blocks*512 for x in R.rglob('*') if x.is_file() and not x.is_symlink())
  if shutil.disk_usage(R).free<6_000_000_000 or allocated>3*1024**3:
   error='6GBfree/3GiBscratch resource guard';os.killpg(p.pid,signal.SIGKILL)
  time.sleep(0.25)
 result={'exitCode':p.returncode,'seconds':time.monotonic()-start,'kernelMaxRSSKiB':usage.ru_maxrss,'resourceGuardFailure':error,'allExecutionOnRunpod':True}
 save('exit.json',result)
 if p.returncode or error:raise RuntimeError('Machine build failed; actual evidence preserved')
M=D/'machine'
manifest.update(moduleRoot=(M/'module-root.txt').read_text().strip(),machineSHA256=sha(M/'machine.v2.wavm.br'),guestSHA256=sha(R/'replay.wasm'),machineBytes=(M/'machine.v2.wavm.br').stat().st_size,status='MATCHING_MACHINE_GENERATED_NOT_REPLAYED',actualExit=result)
save('machine-manifest.json',manifest)
