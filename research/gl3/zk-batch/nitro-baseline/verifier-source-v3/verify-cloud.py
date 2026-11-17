"""One reviewed private matched-batch benchmark. No public RPC/real wallets."""
from pathlib import Path
import csv,fcntl,hashlib,json,os,signal,socket,subprocess,time
assert socket.gethostname()=='cc91695a75f7'
R=Path('/workspace/gl3/zk-tests/verifier-parent');O=R/'evidence';O.mkdir(parents=True,exist_ok=True,mode=0o700)
assert R.stat().st_dev==Path('/workspace').stat().st_dev!=Path('/root').stat().st_dev
assert not (O/'actual-exit.json').exists(),'Preserve prior attempt first'
lease=(R/'benchmark.lock').open('a');fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
os.sched_setaffinity(0,set(sorted(os.sched_getaffinity(0))[-2:]));os.nice(10)
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as stream:
  for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def save(name,value):(O/name).write_text(json.dumps(value,indent=2)+'\n')
bundle=Path(os.environ['GL3_PROOF_BUNDLE']);bindingPath=Path(os.environ['GL3_PROOF_BINDING']);binding=json.loads(bindingPath.read_text());assert sha(bundle)==binding['bundleSHA256'] and binding['sdkProofVerified'] is True and binding['workloadTransactions']==16
assert Path('/sys/fs/cgroup/memory.max').read_text().strip()=='64000000000'
lock=json.loads(Path('/root/gl3-base-launch/artifact-lock.json').read_text())
assert sha('/workspace/gl3/durable/bin/nitro')=='d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed'
for row in lock['machineFiles']:assert sha(row['path'])==row['SHA256']
source={str(p.relative_to(R)):sha(p) for p in (R/'source').rglob('*') if p.is_file() and '__pycache__' not in p.parts}
save('source-manifest.json',source);save('environment.json',{'podID':'9fu9ldfpioy14f','host':socket.gethostname(),'CPUaffinity':sorted(os.sched_getaffinity(0)),'clockTicksPerSecond':os.sysconf('SC_CLK_TCK'),'cgroupMemoryMaxBytes':64000000000,'wallBudgetSeconds':300,'ownedFileBudgetBytes':1073741824,'workingFreeFloorBytes':6000000000,'sharedMemoryCeilingBytes':56000000000,'SDKVerifiedProofBinding':binding,'protocol':'Private official Nitro4663 parent, actual SP1v5 Groth16 verifier, no production changes'})
for p in (R/'source').rglob('*.mjs'):subprocess.run(['node','--check',str(p)],check=True)
env={**os.environ,'GOMAXPROCS':'2'}
cancel=None
def cancelled(signum,frame):
 global cancel
 cancel=signal.Signals(signum).name
signal.signal(signal.SIGTERM,cancelled);signal.signal(signal.SIGINT,cancelled)
log=(O/'runner.log').open('w');f=(O/'resources.csv').open('w');writer=csv.writer(f);writer.writerow(['seconds','workingFreeBytes','ownedFileBytes','sharedCgroupBytes'])
p=None;got=0;reason=None;start=time.monotonic()
try:
 p=subprocess.Popen(['node',str(R/'source/verify-parent.mjs'),str(bundle),str(bindingPath)],stdout=log,stderr=subprocess.STDOUT,env=env,start_new_session=True)
 save('process.json',{'pid':p.pid,'UTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
 while True:
  got,status,usage=os.wait4(p.pid,os.WNOHANG)
  if got:break
  try:
   assert Path('/sys/fs/cgroup/memory.max').read_text().strip()=='64000000000'
   stat=os.statvfs('/root');free=stat.f_bavail*stat.f_frsize
   owned=0
   for x in R.rglob('*'):
    try:
     if x.is_file() and not x.is_symlink():owned+=max(x.stat().st_size,x.stat().st_blocks*512)
    except FileNotFoundError:pass
   memory=int(Path('/sys/fs/cgroup/memory.current').read_text());writer.writerow([time.monotonic()-start,free,owned,memory]);f.flush()
   if cancel:reason='requested '+cancel
   if free<6000000000:reason='working disk floor'
   if owned>1073741824:reason='owned file budget'
   if memory>=56000000000:reason='shared cgroup reserve'
   if time.monotonic()-start>=300:reason='wall limit'
  except Exception:reason='guard read failed'
  if reason:
   os.killpg(p.pid,signal.SIGTERM);until=time.monotonic()+5
   while time.monotonic()<until:
    got,status,usage=os.wait4(p.pid,os.WNOHANG)
    if got:break
    time.sleep(.1)
   if not got:os.killpg(p.pid,signal.SIGKILL);got,status,usage=os.wait4(p.pid,0)
   break
  time.sleep(.2)
finally:
 if p is not None:
  if not got:
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   got,status,usage=os.wait4(p.pid,0)
  code=os.waitstatus_to_exitcode(status);p.returncode=code;elapsed=time.monotonic()-start
  save('actual-exit.json',{'exitCode':code,'seconds':elapsed,'maxRSSKiB':usage.ru_maxrss,'terminationReason':reason,'actualWait4':True})
  try:os.killpg(p.pid,signal.SIGTERM)
  except ProcessLookupError:pass
 log.close();f.close()
assert p is not None
result=O/'verifier-result.json';passed=code==0 and reason is None and elapsed<=300 and result.exists() and json.loads(result.read_text())['passed'] is True
save('controller-result.json',{'passed':passed,'exitCode':code,'scope':'Actual private Nitro-parent Solidity verification of preverified16tx full-EVM proof; no production acceptance'})
raise SystemExit(0 if passed else 1)
