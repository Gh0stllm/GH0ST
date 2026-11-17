"""Build only a print-only pristine genesis diagnostic on the assigned old worker."""
from pathlib import Path
import hashlib,json,os,platform,signal,subprocess,time
assert platform.system()=='Linux'
ROOT=Path('/root/gl3-base-withdrawal');SOURCE=Path('/root/gl3-base-launch/nitro-clean');OUT=ROOT/'genesis-build';OUT.mkdir(parents=True,exist_ok=True)
GO='/root/bounded-restore/toolchain/go/bin/go'
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def save(name,x):(OUT/name).write_text(json.dumps(x,indent=2)+'\n')
def allocated():return sum(p.stat().st_blocks*512 for p in ROOT.rglob('*') if p.is_file() and not p.is_symlink())
def free():s=os.statvfs(ROOT);return s.f_bavail*s.f_frsize
assert free()>6_800_000_000,'Root authorized one warm cached retry at a 6.8GB start threshold'
original=SOURCE/'cmd/genesis-generator/genesis-generator.go'
assert sha(original)=='39e352017f9ff25145d8b4e608ff2716a983aac9e1a60de6a881147a95d28a92'
text=original.read_text();assert text.count('fmt.Print(globalState)')==1
p=ROOT/'genesis-diagnostics.go';p.write_text(text.replace('fmt.Print(globalState)','fmt.Print(globalState); fmt.Printf("\\nGenesisStateRoot: %s\\n", genesisBlock.Root().Hex())'))
assert sha(p)=='d4cbdebbbff806134ab9391d7f8ff04df5dcf29f42f395d689ac57150b7fd41b'
assert not list((SOURCE/'precompiles').glob('*Ghost*'))
assert 'makeGhost' not in (SOURCE/'precompiles/precompile.go').read_text()
assert sha(SOURCE/'target/lib/libstylus.a')=='42cc75b003aaab6686620da6ec947bb475fe221b605bd0ac1bf417a171f4546c'
inputs={str(x):sha(x) for x in [original,p,SOURCE/'go.mod',SOURCE/'go.sum',SOURCE/'target/lib/libstylus.a']}
tmp=ROOT/'buildtmp';tmp.mkdir(exist_ok=True)
output=ROOT/'bin/genesis-diagnostics';output.parent.mkdir(exist_ok=True)
cmd=[GO,'build','-p','2','-mod=readonly','-o',str(output),str(p)]
os.nice(10);os.sched_setaffinity(0,set(sorted(os.sched_getaffinity(0))[:2]))
env={**os.environ,'GOTOOLCHAIN':'local','GOMAXPROCS':'2','GOTMPDIR':str(tmp)}
save('source-manifest.json',{'inputSHA256':inputs,'command':cmd,'sourceScope':'Pristine upstream generator; sole addition prints existing computed header state root','noNodeBuild':True,'GOCACHE':subprocess.check_output([GO,'env','GOCACHE'],env=env,text=True).strip()})
log=(OUT/'build.log').open('w');start=time.monotonic();worker=subprocess.Popen(cmd,cwd=SOURCE,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);save('process.json',{'pid':worker.pid,'startUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
reason=None;peak=0;minfree=free();got=0
try:
 while True:
  got,status,usage=os.wait4(worker.pid,os.WNOHANG)
  if got:break
  size=allocated();available=free();peak=max(peak,size);minfree=min(minfree,available)
  if size>2_000_000_000:reason='2GB owned allocation limit'
  if available<6_000_000_000:reason='6GB free floor'
  if time.monotonic()-start>1200:reason='20min compile limit'
  if reason:os.killpg(worker.pid,signal.SIGTERM);got,status,usage=os.wait4(worker.pid,0);break
  time.sleep(.2)
finally:
 if not got:
  try:os.killpg(worker.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  got,status,usage=os.wait4(worker.pid,0)
 code=os.waitstatus_to_exitcode(status);worker.returncode=code;log.close()
 result={'exitCode':code,'seconds':time.monotonic()-start,'maxRSSKiB':usage.ru_maxrss,'reason':reason,'peakOwnedBytes':peak,'minimumFreeBytes':minfree,'inputHashesUnchanged':all(sha(Path(x))==h for x,h in inputs.items())}
 save('actual-exit.json',result)
assert code==0 and reason is None and result['inputHashesUnchanged']
save('binary-manifest.json',{'path':str(output),'bytes':output.stat().st_size,'SHA256':sha(output),'sourceManifestSHA256':sha(OUT/'source-manifest.json'),'printOnlyGenesisDiagnostic':True,'noCustomSTF':True})
print(json.dumps(json.loads((OUT/'binary-manifest.json').read_text())))
