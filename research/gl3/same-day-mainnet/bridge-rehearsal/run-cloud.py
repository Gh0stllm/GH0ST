"""Private standard Nitro bridge scenario; guarded chain lifetime, no public RPC."""
from pathlib import Path
import csv,ctypes,fcntl,hashlib,json,os,signal,socket,subprocess,time
assert socket.gethostname()=='cc91695a75f7'
R=Path('/workspace/gl3/same-day-mainnet/bridge-rehearsal/final-fee-profile-v5');O=R/'evidence';O.mkdir(exist_ok=True,parents=True)
assert not(O/'actual-exit.json').exists();lease=(R/'scenario.lock').open('a');fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert R.stat().st_dev==Path('/workspace').stat().st_dev!=Path('/root').stat().st_dev
os.sched_setaffinity(0,set(sorted(os.sched_getaffinity(0))[-2:]));os.nice(10)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def save(n,o):(O/n).write_text(json.dumps(o,indent=2)+'\n')
assert sha(Path('/workspace/gl3/durable/bin/nitro'))=='d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed'
assert sha(Path('/workspace/gl3/durable/bin/geth'))=='daec86c874d2f31d70784f4c8e15faf786e8eebd3cd23e77be744c2c42273119'
assert sha(Path('/workspace/gl3/testnet/withdrawal-recovery/bin/genesis-diagnostics'))=='0c797bd8ecf079669ade4ddcd34d2000ec263c51e21831cea3fec71f0618e678'
assert sha(Path(os.environ['GL3_COLD_OWNER_GENESIS']))=='2b199bb88d307aac0f25bffb26154ec1a02b43541f7f0d1bf551b9980983c8dc'
for f in(R/'source').rglob('*.mjs'):subprocess.run(['node','--check',str(f)],check=True)
save('source-manifest.json',{str(p.relative_to(R)):sha(p)for p in(R/'source').rglob('*')if p.is_file()})
save('resource-intent.json',{'wallSeconds':1200,'ownCPU':2,'ownGroupRSSCapBytes':2147483648,'ownDBFilesCapBytes':8589934592,'workingFreeFloorBytes':6000000000,'sharedCgroupCeilingBytes':56000000000,'cgroupMemoryMaxBytes':64000000000,'privateConfirmPeriodBlocks':2000,'publicConfirmationTimingTested':False,'historySource':'Actual standard validator handoff; actual SDK history then operator-fast existing assertion; no manual zero/fake execution history','validatorAuxiliariesOwnedSeparately':True})
reason=None;cancel=None
parentPID=os.getpid()
def parent_death_guard():
 if ctypes.CDLL(None,use_errno=True).prctl(1,signal.SIGKILL)!=0:os._exit(125)
 if os.getppid()!=parentPID:os._exit(126)
def stop(n,_):
 global cancel
 cancel=signal.Signals(n).name
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
f=(O/'runner.log').open('w');c=(O/'resources.csv').open('w');rows=csv.writer(c);rows.writerow(['seconds','workingFreeBytes','ownAllocatedBytes','ownLogicalBytes','ownGroupRSSBytes','sharedMemoryBytes']);got=0;p=None;t=time.monotonic()
try:
 p=subprocess.Popen(['node',str(R/'source/run.mjs')],env={**os.environ,'GL3_PARITY_BASE':str(R),'GL3_PRIVATE_OUTPUT':str(O),'GL3_NODE_PACKAGE':'/root/dispute/package.json','GOMAXPROCS':'2','GL3_COLD_OWNER_GENESIS':os.environ['GL3_COLD_OWNER_GENESIS']},stdout=f,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=parent_death_guard,pass_fds=(lease.fileno(),));save('process.json',{'pid':p.pid,'UTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
 while True:
  got,s,u=os.wait4(p.pid,os.WNOHANG)
  if got:break
  try:
   assert Path('/sys/fs/cgroup/memory.max').read_text().strip()=='64000000000';st=os.statvfs('/root');free=st.f_bavail*st.f_frsize;allocated=logical=0
   for x in R.rglob('*'):
    try:
     if x.is_file()and not x.is_symlink():z=x.stat();allocated+=z.st_blocks*512;logical+=z.st_size
    except FileNotFoundError:pass
   rss=0
   for d in Path('/proc').iterdir():
    if not d.name.isdigit():continue
    try:
     text=(d/'stat').read_text();v=text[text.rfind(')')+2:].split()
     if int(v[2])==p.pid:rss+=int(v[21])*os.sysconf('SC_PAGE_SIZE')
    except(FileNotFoundError,ProcessLookupError):pass
   mem=int(Path('/sys/fs/cgroup/memory.current').read_text());elapsed=time.monotonic()-t;rows.writerow([elapsed,free,allocated,logical,rss,mem]);c.flush()
   if cancel:reason='requested '+cancel
   if free<6000000000:reason='root free floor'
   if max(allocated,logical)>8589934592:reason='owned8GiB runtime disk limit'
   if rss>2147483648:reason='owned2GiB group RSS limit'
   if mem>=56000000000:reason='shared memory reserve'
   if elapsed>=1200:reason='20min runtime limit'
  except Exception as e:reason='guard read failed:'+type(e).__name__
  if reason:
   os.killpg(p.pid,signal.SIGTERM);until=time.monotonic()+10
   while time.monotonic()<until:
    got,s,u=os.wait4(p.pid,os.WNOHANG)
    if got:break
    time.sleep(.1)
   if not got:os.killpg(p.pid,signal.SIGKILL);got,s,u=os.wait4(p.pid,0)
   break
  time.sleep(.2)
finally:
 if p is not None:
  if not got:
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   got,s,u=os.wait4(p.pid,0)
  code=os.waitstatus_to_exitcode(s);p.returncode=code;elapsed=time.monotonic()-t;save('actual-exit.json',{'actualWait4':True,'exitCode':code,'seconds':elapsed,'maxRSSKiB':u.ru_maxrss,'terminationReason':reason})
  try:os.killpg(p.pid,signal.SIGTERM)
  except ProcessLookupError:pass
 f.close();c.close()
r=O/'base-withdrawal-report.json';passed=code==0 and reason is None and elapsed<=1200 and r.exists()and json.loads(r.read_text())['passed'];save('controller-result.json',{'passed':passed,'scope':'Private standard Nitro operator-fast native-GH0ST bridge with genuine validator; no public chain/funds/ZK acceptance'})
raise SystemExit(0 if passed else 1)
