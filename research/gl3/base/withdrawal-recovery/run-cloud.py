"""Bounded official-base rehearsal on the assigned persistent Runpod worker only."""
from pathlib import Path
import csv,fcntl,hashlib,json,os,platform,signal,socket,subprocess,time
assert platform.system()=='Linux'
assert socket.gethostname()=='cc91695a75f7','Run only on root-reviewed BIG worker'
ROOT=Path('/workspace/gl3/testnet/withdrawal-recovery');OUT=ROOT/'evidence'
OUT.mkdir(parents=True,exist_ok=True,mode=0o700)
assert ROOT.resolve().is_relative_to(Path('/workspace/gl3/testnet'))
assert ROOT.stat().st_dev==Path('/workspace').stat().st_dev
assert ROOT.stat().st_dev!=Path('/root').stat().st_dev,'DBs must use the persistent mount'
lease=(ROOT/'scenario.lock').open('a');fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert not (OUT/'actual-exit.json').exists(),'Preserve the previous attempt before another'
os.nice(10);os.sched_setaffinity(0,set(sorted(os.sched_getaffinity(0))[-2:]))
MEM=Path('/sys/fs/cgroup/memory.max');CURRENT=Path('/sys/fs/cgroup/memory.current')
assert MEM.read_text().strip()=='64000000000','Exact reviewed cgroup-v2 memory cap required'
def save(name,x):(OUT/name).write_text(json.dumps(x,indent=2)+'\n')
def file_sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def usage():
 allocated=logical=0
 for p in ROOT.rglob('*'):
  if p.is_symlink():continue
  try:
   s=p.stat()
   if p.is_file():allocated+=s.st_blocks*512;logical+=s.st_size
  except FileNotFoundError:continue # A live Pebble compaction may retire a file.
 return allocated,logical
def guards():
 if MEM.read_text().strip()!='64000000000':raise RuntimeError('cgroup memory.max changed')
 s=os.statvfs('/root');free=s.f_bavail*s.f_frsize
 allocated,logical=usage();memory=int(CURRENT.read_text().strip())
 return free,allocated,logical,memory
lock=json.loads(Path('/root/gl3-base-launch/artifact-lock.json').read_text())
assert lock['officialNode']['SHA256']=='d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed'
assert file_sha(lock['officialNode']['path'])==lock['officialNode']['SHA256']
assert lock['moduleRoot']=='0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97'
for row in lock['machineFiles']:assert file_sha(row['path'])==row['SHA256']
helper=json.loads((ROOT/'genesis-build/binary-manifest.json').read_text())
assert helper['SHA256']=='0c797bd8ecf079669ade4ddcd34d2000ec263c51e21831cea3fec71f0618e678'
assert file_sha(ROOT/'bin/genesis-diagnostics')==helper['SHA256']
save('preflight-identities.json',{'officialNode':lock['officialNode'],'moduleRoot':lock['moduleRoot'],'machineFiles':lock['machineFiles'],'genesisDiagnostic':helper,'actualGenesisDiagnosticPath':str(ROOT/'bin/genesis-diagnostics'),'allFilesVerifiedBeforeScenario':True})
manifest={str(p.relative_to(ROOT)):file_sha(p) for p in ROOT.glob('source/**/*') if p.is_file() and '__pycache__' not in p.parts}
save('source-manifest.json',manifest)
save('runtime-context.json',{'host':socket.gethostname(),'podID':'9fu9ldfpioy14f','CPUaffinity':sorted(os.sched_getaffinity(0)),'nice':os.getpriority(os.PRIO_PROCESS,0),'cgroupV2MemoryMaxBytes':64000000000,'persistentPrefix':str(ROOT),'persistentDevice':ROOT.stat().st_dev,'workingDevice':Path('/root').stat().st_dev,'persistentVolumeID':'hb0wpuifqx','persistentAPIQuotaGB':1000,'quotaAuthority':'Root-verified Runpod API configuration; filesystem df pool is not the quota','ownedLimitBytes':1750000000,'workingDiskFreeFloorBytes':6000000000,'wallSeconds':1200,'cgroupCurrentCeilingBytes':56000000000})
free,allocated,logical,memory=guards()
assert free>=6000000000 and max(allocated,logical)<=1750000000 and memory<56000000000
for p in (ROOT/'source').rglob('*.mjs'):subprocess.run(['node','--check',str(p)],check=True)
env={**os.environ,'GL3_PARITY_BASE':str(ROOT),'GL3_PRIVATE_OUTPUT':str(OUT),'GL3_NODE_PACKAGE':'/root/dispute/package.json','GOMAXPROCS':'2'}
cancelled=None
def cancel(signum,frame):
 global cancelled
 cancelled='controller received '+signal.Signals(signum).name
signal.signal(signal.SIGTERM,cancel);signal.signal(signal.SIGINT,cancel)
log=(OUT/'runner.log').open('w');samples=(OUT/'resources.csv').open('w');writer=csv.writer(samples)
writer.writerow(['seconds','workingFreeBytes','ownedAllocatedBytes','ownedLogicalBytes','cgroupCurrentBytes'])
start=time.monotonic();worker=None;got=0;reason=None
try:
 worker=subprocess.Popen(['node',str(ROOT/'source/run.mjs')],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 save('process.json',{'pid':worker.pid,'UTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'scope':'Private official base only, no public writes','command':['node',str(ROOT/'source/run.mjs')]})
 while True:
  got,status,rusage=os.wait4(worker.pid,os.WNOHANG)
  if got:break
  try:
   free,allocated,logical,memory=guards()
   writer.writerow([time.monotonic()-start,free,allocated,logical,memory]);samples.flush()
   if cancelled:reason=cancelled
   if free<6000000000:reason='6GB working disk free floor'
   if max(allocated,logical)>1750000000:reason='1.75GB owned allocation/logical guard'
   if memory>=56000000000:reason='56GB shared cgroup memory reserve'
   if time.monotonic()-start>1200:reason='20min wall guard'
  except Exception as e:reason='guard read failure '+str(e)
  if reason:
   os.killpg(worker.pid,signal.SIGTERM);until=time.monotonic()+10
   while time.monotonic()<until:
    got,status,rusage=os.wait4(worker.pid,os.WNOHANG)
    if got:break
    time.sleep(.1)
   if not got:os.killpg(worker.pid,signal.SIGKILL);got,status,rusage=os.wait4(worker.pid,0)
   break
  time.sleep(.5)
finally:
 if worker is not None:
  if not got:
   try:os.killpg(worker.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   got,status,rusage=os.wait4(worker.pid,0)
  code=os.waitstatus_to_exitcode(status);worker.returncode=code;elapsed=time.monotonic()-start
  save('actual-exit.json',{'exitCode':code,'seconds':elapsed,'maxRSSKiB':rusage.ru_maxrss,'maxRSSScope':'Kernel rusage of direct Node scenario child; not aggregate cgroup peak','terminationReason':reason})
  try:os.killpg(worker.pid,signal.SIGTERM)
  except ProcessLookupError:pass
 log.close();samples.close()
assert worker is not None
report=OUT/'base-withdrawal-report.json'
passed=code==0 and reason is None and elapsed<=1200 and report.exists() and json.loads(report.read_text()).get('passed') is True
save('controller-result.json',{'passed':passed,'exitCode':code,'reason':reason,'allExecutionOnRunpod':True,'publicWrites':0,'scope':'Official private three-layer withdrawal + same-disk CLI crash +100 light transfers; privileged confirmation and remapped sparse token fixture only'})
raise SystemExit(0 if passed else 1)
