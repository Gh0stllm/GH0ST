"""Bounded disposable parent-contract units, all execution on the owned Runpod."""
from pathlib import Path
import csv,fcntl,hashlib,json,os,signal,socket,subprocess,time
assert socket.gethostname()=='cc91695a75f7'
R=Path(os.environ.get('GL3_COORDINATOR_TEST_ROOT','/workspace/gl3/zk-rollup/coordinator'));O=R/'evidence';O.mkdir(exist_ok=True)
assert R.stat().st_dev==Path('/workspace').stat().st_dev!=Path('/root').stat().st_dev
assert not (O/'actual-exit.json').exists(),'Preserve prior attempt before running'
lease=(R/'unit.lock').open('a');fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
os.sched_setaffinity(0,set(sorted(os.sched_getaffinity(0))[-2:]));os.nice(10)
def save(n,o):(O/n).write_text(json.dumps(o,indent=2)+'\n')
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
assert Path('/sys/fs/cgroup/memory.max').read_text().strip()=='64000000000'
source={str(p.relative_to(R)):sha(p) for p in (R/'source').rglob('*') if p.is_file()}
save('source-manifest.json',source)
save('environment.json',{'podID':'9fu9ldfpioy14f','host':socket.gethostname(),'cpuAffinity':sorted(os.sched_getaffinity(0)),'nice':os.getpriority(os.PRIO_PROCESS,0),'wallSeconds':300,'ownedFileCapBytes':1073741824,'ownedGroupRSSCapBytes':1073741824,'rootWorkingFreeFloorBytes':6000000000,'sharedCgroupCeilingBytes':56000000000,'cgroupMemoryMaxBytes':64000000000,'scope':'State/data registry and codec units only; synthetic accumulator fixture, no proof or public writes'})
cancel=None
def cancelled(n,_):
 global cancel
 cancel=signal.Signals(n).name
signal.signal(signal.SIGINT,cancelled);signal.signal(signal.SIGTERM,cancelled)
log=(O/'runner.log').open('w');csvfile=(O/'resources.csv').open('w');rows=csv.writer(csvfile);rows.writerow(['seconds','workingFreeBytes','ownedFileBytes','ownedGroupRSSBytes','sharedCgroupBytes'])
p=None;got=0;reason=None;started=time.monotonic()
try:
 p=subprocess.Popen(['node',str(R/'source/tests/run-registry.mjs')],stdout=log,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'GOMAXPROCS':'2'})
 save('process.json',{'pid':p.pid,'UTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
 while True:
  got,status,usage=os.wait4(p.pid,os.WNOHANG)
  if got:break
  try:
   assert Path('/sys/fs/cgroup/memory.max').read_text().strip()=='64000000000'
   st=os.statvfs('/root');free=st.f_bavail*st.f_frsize;owned=sum(max(x.stat().st_size,x.stat().st_blocks*512) for x in R.rglob('*') if x.is_file() and not x.is_symlink())
   rss=0
   for d in Path('/proc').iterdir():
    if not d.name.isdigit():continue
    try:
     s=(d/'stat').read_text();f=s[s.rfind(')')+2:].split()
     if int(f[2])==p.pid:rss+=int(f[21])*os.sysconf('SC_PAGE_SIZE')
    except (FileNotFoundError,ProcessLookupError):pass
   memory=int(Path('/sys/fs/cgroup/memory.current').read_text());elapsed=time.monotonic()-started;rows.writerow([elapsed,free,owned,rss,memory]);csvfile.flush()
   if cancel:reason='requested '+cancel
   if free<6000000000:reason='working disk floor'
   if owned>1073741824:reason='owned file cap'
   if rss>1073741824:reason='owned group RSS cap'
   if memory>=56000000000:reason='shared memory reserve'
   if elapsed>=300:reason='wall limit'
  except Exception as e:reason='guard read failed: '+type(e).__name__
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
  code=os.waitstatus_to_exitcode(status);p.returncode=code;elapsed=time.monotonic()-started
  save('actual-exit.json',{'actualWait4':True,'exitCode':code,'seconds':elapsed,'maxRSSKiB':usage.ru_maxrss,'terminationReason':reason})
  try:os.killpg(p.pid,signal.SIGTERM)
  except ProcessLookupError:pass
 log.close();csvfile.close()
result=O/'result.json';passed=code==0 and reason is None and elapsed<=300 and result.exists() and json.loads(result.read_text())['passed'] is True
save('controller-result.json',{'passed':passed,'exitCode':code,'scope':'Coordinator source compilation and registry/codec units only, not full ZK/native end-to-end acceptance'})
raise SystemExit(0 if passed else 1)
