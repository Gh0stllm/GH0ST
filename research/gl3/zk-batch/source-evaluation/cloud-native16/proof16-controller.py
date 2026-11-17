from pathlib import Path
import os,sys,json,time,signal,subprocess,hashlib
B=Path('/workspace/gl3/zk-tests/evm-proof');I=B/'proof16-intent.json';O=B/'proof16';R=B/'proof16-controller';R.mkdir(exist_ok=True)
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def now():return time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
def stats():
 cur=int(Path('/sys/fs/cgroup/memory.current').read_text());st=dict(x.split()for x in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines());return {'memoryCurrentBytes':cur,'workingSetBytes':cur-int(st['inactive_file']),'wholePodMemoryPeakBytes':int(Path('/sys/fs/cgroup/memory.peak').read_text()),'rootFreeBytes':os.statvfs('/root').f_bavail*os.statvfs('/root').f_frsize}
def owned(pgid):
 rss=0;cpu=0.;rows=[]
 for d in Path('/proc').glob('[0-9]*'):
  try:
   v=(d/'stat').read_text().rsplit(')',1)[1].split()
   if int(v[2])!=pgid:continue
   m=0
   for l in(d/'status').read_text().splitlines():
    if l.startswith('VmRSS:'):m=int(l.split()[1])*1024
   ticks=int(v[11])+int(v[12]);rows.append({'pid':int(d.name),'RSSBytes':m,'cpuTicks':ticks});rss+=m;cpu+=ticks/os.sysconf('SC_CLK_TCK')
  except (OSError,ValueError):pass
 return rss,cpu,rows
p=None;start=time.time();r={'stage':'ONE real16 ERC20 full EVM CPU Groth16 proof','startedUTC':now(),'mainnetWrites':False,'automaticRetry':False,'timedOut':False,'passed':False};intent=None
try:
 assert os.uname().nodename=='cc91695a75f7';assert int(Path('/sys/fs/cgroup/memory.max').read_text())==64000000000
 intent=json.loads(I.read_text());r['intentSHA256']=sha(I);assert intent['transactions']==16 and intent['chainId']==9 and intent['proofKind']=='Groth16'
 for a in intent['artifacts']:
  q=Path(a['path']);assert q.is_file() and q.stat().st_size==a['bytes'] and sha(q)==a['SHA256'],str(q)
 native=json.loads((B/'workload16/native-result.json').read_text());assert native['passed']and native['actualExitCode']==0 and native['transactions']==16
 assert not O.exists()or not any(O.iterdir()),'refuse existing proof output; no automatic retry';O.mkdir(exist_ok=True)
 allowed=sorted(os.sched_getaffinity(0));assert len(allowed)>=30;os.sched_setaffinity(0,allowed[:28]);r['cpuAffinity']=allowed[:28];r['cgroupBefore']=stats()
 assert r['cgroupBefore']['rootFreeBytes']>=6000000000 and r['cgroupBefore']['workingSetBytes']<56000000000
 runtime=Path('/root/gl3-proof16-runtime');runtime.mkdir(exist_ok=True)
 env=dict(os.environ,RAYON_NUM_THREADS='28',GOMAXPROCS='28',SP1_PROVER='cpu',RUST_LOG='info',TMPDIR=str(runtime),NO_COLOR='1')
 for name in ['SP1_PRIVATE_KEY','SP1_NETWORK_PRIVATE_KEY','SP1_MOCK','SP1_DEV','SP1_SKIP_VERIFICATION']:env.pop(name,None)
 args=[intent['executable'],intent['input'],str(O)];r['argv']=args;r['runtimeWorkingDirectory']=str(runtime);r['circuitStorage']='/root/.sp1 (SDK default, fast working disk)';r['CPUCap']=28;r['ownedRSSLimitBytes']=48*1024**3;r['sharedWorkingSetLimitBytes']=56000000000;r['wallLimitSeconds']=7200
 def stop(sig,frame):raise RuntimeError('controlled stop signal '+str(sig))
 signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
 with(R/'proof.log').open('w')as log,(R/'resource-samples.jsonl').open('w')as samples:
  p=subprocess.Popen(args,cwd=runtime,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);(R/'process.json').write_text(json.dumps({'controllerPID':os.getpid(),'childPID':p.pid,'startedUTC':r['startedUTC'],'intentSHA256':r['intentSHA256']},indent=2)+'\n')
  while p.poll()is None:
   st=stats();rss,cpu,rows=owned(p.pid);sample={'UTC':now(),'elapsedSeconds':time.time()-start,'ownedRSSBytes':rss,'ownedCPUSeconds':cpu,'processes':rows,**st};samples.write(json.dumps(sample)+'\n');samples.flush()
   r['peakOwnedRSSBytes']=max(r.get('peakOwnedRSSBytes',0),rss);r['peakSharedWorkingSetBytes']=max(r.get('peakSharedWorkingSetBytes',0),st['workingSetBytes']);r['minRootFreeBytes']=min(r.get('minRootFreeBytes',st['rootFreeBytes']),st['rootFreeBytes'])
   if time.time()-start>7200:r['timedOut']=True;raise RuntimeError('2h wall guard')
   if rss>=48*1024**3 or st['workingSetBytes']>=56000000000 or st['rootFreeBytes']<6000000000:raise RuntimeError('resource guard')
   time.sleep(.5)
  r['actualExitCode']=p.returncode;(R/'actual-exit.json').write_text(json.dumps({'actualExitCode':p.returncode,'UTC':now(),'timedOut':r['timedOut']},indent=2)+'\n')
 assert p.returncode==0,'nonzero child exit'
 bundle=json.loads((O/'evm-proof.json').read_text());pre=json.loads((O/'preproof-execution.json').read_text());assert bundle['proofKind']=='Groth16'and bundle['nativeVerified']and bundle['allFiveFieldsMatch']and not bundle['mockProof']and not bundle['networkProver'];assert bundle['transactions']==16 and bundle['chainId']==9
 pv=bytes.fromhex(bundle['publicValues'][2:]);assert len(pv)==160 and bundle['publicValues']==bundle['nativeExpectedPublicValues']==pre['actualExecutionPublicValues']==pre['nativeExpectedPublicValues'];assert int.from_bytes(pv[96:128],'big')==9 and int.from_bytes(pv[128:160],'big')==16
 assert (O/'public-values.bin').read_bytes()==pv;assert (O/'proof.bin').read_bytes()==bytes.fromhex(bundle['proofBytes'][2:]);assert len((O/'proof.bin').read_bytes())>128
 r['proofOutputs']={q.name:{'bytes':q.stat().st_size,'SHA256':sha(q)}for q in O.iterdir()if q.is_file()};r['passed']=True;r['SolidityVerificationAccepted']=False;r['publicValuesDecoded']={'initialStateRoot':'0x'+pv[:32].hex(),'finalStateRoot':'0x'+pv[32:64].hex(),'lastBlockHash':'0x'+pv[64:96].hex(),'chainId':9,'transactionCount':16};r['timings']={k:v for k,v in bundle.items()if k.endswith('Seconds')or k=='fullProvingSecondsIncludingEVMWrapping'}
except BaseException as e:
 r['error']=repr(e)
 if p and p.poll()is None:
  os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=30)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
 r['actualExitCode']=None if p is None else p.returncode
 (R/'actual-exit.json').write_text(json.dumps({'actualExitCode':r['actualExitCode'],'UTC':now(),'timedOut':r['timedOut'],'error':r['error']},indent=2)+'\n')
r['endedUTC']=now();r['outerSeconds']=time.time()-start
try:r['cgroupAfter']=stats();r['wholePodPeakScope']='entire pod including build cache and parallel Nitro lane; not proof-only'
except BaseException as e:r['optionalMetricsError']=repr(e)
(R/'result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r),flush=True)
