"""Reviewed native full24m capture only. No guest replay and no public writes."""
from pathlib import Path
import os,json,hashlib,time,subprocess,signal,fcntl,ctypes,re,shutil,csv
R=Path('/root/gl3-full-checkpoint-guest');D=R/'terminal-native';CG=Path('/sys/fs/cgroup/memory')
if Path(__file__).resolve().parent!=D:raise RuntimeError('Owned checkpoint runtime prefix required')
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
auth=json.loads((D/'execution-authorization.json').read_text());compiled=json.loads((D/'compiled-inputs.json').read_text());T=D/'full-capture.test';gold=D/'golden.json'
assert auth.get('authorized') is True and auth.get('controllerSHA256')==sha(Path(__file__)) and auth.get('compiledManifestSHA256')==sha(D/'compiled-inputs.json') and auth.get('nativeFullELFSHA256')==sha(T), 'Content-bound root native-search review required'
assert auth.get('podID')=='6jynxb4g4s9y6j' and int((CG/'memory.limit_in_bytes').read_text())==64_000_000_000
assert sha(T)==compiled['nativeFullELFSHA256'] and compiled['status']=='COMPILED_NOT_EXECUTED' and not compiled['engineSearchExecuted']
assert sha(gold)==compiled['goldenSHA256']=='2a450f90d70bede6e9202740cb7fb205e359623e7fc11cf96a4fb6a3f1fec71a'
assert compiled['portableEngineSHA256']=='1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc'
assert sha(R/'machine-generation/machine/machine.v2.wavm.br')==compiled['machineSHA256']=='9f5ce0c06b01debaf3077c95559d38af11d2d7925f02721742acacfcfb944752'
assert sha(Path('/root/bounded-restore/preimages.bin'))=='8852477df16204a51a337c1f91023fc46fc052304315b96e91e3f1c4a1369157'
assert sha(Path('/root/terminal-acceptance/bin/geth'))=='daec86c874d2f31d70784f4c8e15faf786e8eebd3cd23e77be744c2c42273119'
lease=(R/'checkpoint-heavy-work.lock').open('a+')
try:fcntl.flock(lease.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:raise RuntimeError('Another checkpoint proof/native search is active; no overlap authorized')
O=D/'evidence';O.mkdir(exist_ok=False);tmp=D/'tmp';tmp.mkdir(exist_ok=True)
def save(n,x):(O/n).write_text(json.dumps(x,indent=2)+'\n')
cpus=sorted(os.sched_getaffinity(0))[:2];os.sched_setaffinity(0,cpus);os.nice(10)
trans=json.loads((R/'runtime-transfer/verified-manifest.json').read_text());extra_path=R/'runtime-transfer/ordinary05-verified-manifest.json';extra=json.loads(extra_path.read_text()) if extra_path.exists() else {'files':[]}
immutable={Path(x['destination']) for x in trans['files']+extra['files']}
def allocated():
 seen=set();n=0;paths={p for p in R.rglob('*') if p.is_file() and not p.is_symlink()}|immutable
 partial=Path('/root/bounded-restore/preimages.bin.unaccepted-scp3')
 if partial.exists():paths.add(partial)
 for p in paths:
  s=p.stat();k=s.st_dev,s.st_ino
  if k not in seen:seen.add(k);n+=s.st_blocks*512
 return n
def cg():
 x={k:int(v) for k,v in (l.split() for l in (CG/'memory.stat').read_text().splitlines())};limit=int((CG/'memory.limit_in_bytes').read_text())
 if limit!=64_000_000_000:raise RuntimeError('Cgroup hard limit changed')
 return int((CG/'memory.usage_in_bytes').read_text()),x.get('total_rss',x.get('rss',0)),x.get('total_inactive_file',x.get('inactive_file',0)),int((CG/'memory.failcnt').read_text())
initial=cg();deadline=7200
if allocated()>24*1024**3 or shutil.disk_usage(R).free<6_000_000_000:raise RuntimeError('Initial dedicated-worker resource guard')
env={**os.environ,'GOMAXPROCS':'2','GOMEMLIMIT':'12GiB','NITRO_TEST_L1_GETH':'/root/terminal-acceptance/bin/geth','TMPDIR':str(tmp),'GL3_CHECKPOINT_EVIDENCE':str(O),'GL3_CHECKPOINT_FULL_CAPTURE_EVIDENCE':str(O),'GL3_CHECKPOINT_CAPTURE_MACHINES':str(R/'machines'),'GL3_CHECKPOINT_GOLDEN':str(gold),'GL3_ALLOW_FULL24M_NATIVE_CAPTURE':'1'}
args=[str(T),'-test.v','-test.timeout=130m','-test.count=1','-test.run=^TestGL3CheckpointedFull24mTerminalCapture$']
save('frozen-inputs.json',{'controllerSHA256':sha(Path(__file__)),'rootAuthorization':auth,'compiledManifest':compiled,'args':args,'cpuAffinity':cpus,'nice':os.getpriority(os.PRIO_PROCESS,0),'deadlineSeconds':deadline,'podHardMemoryBytes':64_000_000_000,'ownRSSGuardBytes':32*1024**3,'podWorkingSetGuardBytes':56_000_000_000,'ownedScratchCapBytes':24*1024**3,'diskFreeFloorBytes':6_000_000_000,'nativeFullSearchOnly':True,'guestReplayPermitted':False,'publicWritesPermitted':False})
parent=os.getpid();libc=ctypes.CDLL(None,use_errno=True);libc.prctl.argtypes=[ctypes.c_int,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong];libc.prctl.restype=ctypes.c_int
reason=None;sent=None;start=time.monotonic();exit_elapsed=None;peak=0
def child_protect():
 if libc.prctl(1,int(signal.SIGKILL),0,0,0)!=0:raise OSError(ctypes.get_errno(),'PR_SET_PDEATHSIG failed')
 if os.getppid()!=parent:os.kill(os.getpid(),signal.SIGKILL)
def stop(signum,frame):
 global reason
 if reason is None:reason='collector received '+signal.Signals(signum).name
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
with (O/'native.log').open('wb') as log,(O/'resources.csv').open('w',buffering=1) as stats:
 p=subprocess.Popen(args,cwd=R,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,pass_fds=(lease.fileno(),),preexec_fn=child_protect)
 save('process.json',{'pid':p.pid,'collectorPID':os.getpid(),'args':args,'startUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
 w=csv.writer(stats);w.writerow(['seconds','VmRSSKiB','cgroupUsageBytes','cgroupRSSBytes','cgroupInactiveFileBytes','cgroupFailcnt','ownedBytes','diskFreeBytes'])
 try:
  while True:
   pid,status,usage=os.wait4(p.pid,os.WNOHANG)
   if pid:
    code=os.waitstatus_to_exitcode(status);p.returncode=code;exit_elapsed=time.monotonic()-start
    save('exit.json',{'exitCode':code,'seconds':exit_elapsed,'completionWithinDeadline':exit_elapsed<=deadline,'terminationReason':reason,'kernelMaxRSSKiB':usage.ru_maxrss,'exitRetrieval':'os.wait4 direct native child'});break
   proc_ok=False
   try:
    ps=Path('/proc/'+str(p.pid)+'/status').read_text();rss=int(re.search(r'^VmRSS:\s+(\d+)',ps,re.M)[1]);peak=max(peak,rss);proc_ok=True
   except Exception as e:
    done,st,us=os.wait4(p.pid,os.WNOHANG)
    if done:
     code=os.waitstatus_to_exitcode(st);p.returncode=code;usage=us;exit_elapsed=time.monotonic()-start
     save('exit.json',{'exitCode':code,'seconds':exit_elapsed,'completionWithinDeadline':exit_elapsed<=deadline,'terminationReason':reason,'kernelMaxRSSKiB':usage.ru_maxrss,'exitRetrieval':'os.wait4 native child after proc-exit race'});break
    if reason is None:reason='native process telemetry failure: '+repr(e)
   if proc_ok:
    try:
     used,cgrss,inactive,fail=cg();disk=allocated();free=shutil.disk_usage(R).free;w.writerow([time.monotonic()-start,rss,used,cgrss,inactive,fail,disk,free])
     if reason is None:
      if disk>24*1024**3:reason='owned24GiB scratch guard'
      elif free<6_000_000_000:reason='disk free floor'
      elif rss>32*1024*1024:reason='own32GiB RSS guard'
      elif used-inactive>56_000_000_000 or fail>initial[3]:reason='pod cgroup memory reserve/failure guard'
    except Exception as e:
     if reason is None:reason='required native resource guard failed: '+repr(e)
   if reason is None and time.monotonic()-start>deadline:reason='native2hour wall deadline'
   if reason and sent is None:
    try:os.killpg(p.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    sent=time.monotonic()
   elif sent is not None and time.monotonic()-sent>10:
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
   time.sleep(2)
 finally:
  if p.returncode is None:
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   _,st,us=os.wait4(p.pid,0);p.returncode=os.waitstatus_to_exitcode(st);exit_elapsed=time.monotonic()-start
   save('exit.json',{'exitCode':p.returncode,'seconds':exit_elapsed,'terminationReason':reason or 'collector exception cleanup','kernelMaxRSSKiB':us.ru_maxrss,'exitRetrieval':'os.wait4 native child in exception cleanup'})
# Read only bounded complete lines; a payload-embedded marker is not completion.
def named_pass(path):
 prefix=bytearray();length=0;named=False;overall=False
 with path.open('rb') as f:
  while True:
   block=f.read(65536)
   if not block:break
   for b in block:
    if b==10:
     if length<=512:
      line=bytes(prefix)
      named|=line.startswith(b'--- PASS: TestGL3CheckpointedFull24mTerminalCapture (')
      overall|=line==b'PASS'
     prefix.clear();length=0
    else:
     length+=1
     if len(prefix)<512:prefix.append(b)
 return named and overall
passed=False;capture=None
if code==0 and reason is None and exit_elapsed<=deadline and named_pass(O/'native.log'):
 capture=json.loads((O/'capture-manifest.json').read_text());canon=json.loads((O/'terminal-canonical.json').read_text());receipt=json.loads((O/'terminal-receipt.json').read_text())
 raw=O/capture['inputFile'];expected=capture['expectedEndState'];n=int(capture['blockNumber'])
 passed=bool(capture['passed'] and capture['fullSearchExecuted'] and capture['parentBatchReceiptEventVerified'] and capture['fullCanonicalExactAtComputeN'] and not capture['guestReplayExecuted'] and capture['move']=='b8c6' and capture['actualNodes']==24000311 and capture['depth']==39 and capture['operationsFromFrozenGolden']==2489 and capture['progressStepFromFrozenGolden']==9955 and canon['canonicalSHA256']=='b06a3f26b0b276c0109fb1888fa32727714ada8abb00cbec8f857bec8308068b' and canon['canonicalBytes']==163085439 and canon['imageRoot']=='472dfc4e1923dcb78bf63c66bf53e08f03d5a50b39fdbf3fe0dc92b1933ad037' and canon['actualComputeBlockHash']==capture['blockHash'] and canon['actualComputeBlockNumber']==n and expected['BlockHash']==capture['blockHash'] and expected['PosInBatch']==0 and expected['Batch']==capture['parentBatch']+1 and capture['parentBatchMetadata']['MessageCount']==capture['messageIndex']+1 and raw.stat().st_size==capture['inputBytes'] and sha(raw)==capture['inputSHA256'])
 if passed:raw.chmod(0o444)
save('result.json',{'passed':passed,'status':'PASSED_NATIVE_FULL24M_CAPTURE_ONLY' if passed else 'NOT_ACCEPTED','exitCode':code,'seconds':exit_elapsed,'terminationReason':reason,'kernelMaxRSSKiB':usage.ru_maxrss,'sampledPeakRSSKiB':peak,'capture':capture,'guestTerminalReplayExecuted':False,'guestProofAccepted':False,'twentyGamesAccepted':False,'productionAccepted':False,'allExecutionOnRunpod':True})
