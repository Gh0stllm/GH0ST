from pathlib import Path
import os,time,json,hashlib,subprocess,signal
b=Path('/workspace/gl3/zk-tests/stylus-source');out=b/'image-loader-diagnostic/execution';out.mkdir(exist_ok=True)
while not(b/'image-loader/wavm-host-build-result.json').exists():time.sleep(.5)
build=json.loads((b/'image-loader/wavm-host-build-result.json').read_text());assert build['actualExitCode']==0,build
exe=Path('/root/gl3-sp1-build/target/release/gl3-image-execute-probe');elf=Path('/root/gl3-stylus-portable/target/riscv32im-succinct-zkvm-elf/release/gl3-image-loader-diagnostic');assert hashlib.sha256(elf.read_bytes()).hexdigest()=='189c5788663501def4d26bc349f43f06cfe5cc5adba0c151c91e3ecf9db3e1f1';start=time.time();r={'phase':'phase-observable bounded SP1 official image loader; no STF transition or proof','proofGenerated':False,'fullSTF':False,'fullStylus':False,'fullLLM':False,'cycleLimit':1000000000,'guestSHA256':hashlib.sha256(elf.read_bytes()).hexdigest(),'hostSHA256':hashlib.sha256(exe.read_bytes()).hexdigest()};p=None;os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[:16]);env=dict(os.environ,SP1_PROVER='cpu',RAYON_NUM_THREADS='16')
try:
 with(out/'execute.log').open('w')as log:
  p=subprocess.Popen([str(exe),str(elf),str(out)],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);(out/'process.json').write_text(json.dumps({'controllerPID':os.getpid(),'childPID':p.pid},indent=2)+'\n')
  while p.poll()is None:
   rss=0
   for d in Path('/proc').glob('[0-9]*'):
    try:
     v=(d/'stat').read_text().rsplit(')',1)[1].split()
     if int(v[2])!=p.pid:continue
     for l in(d/'status').read_text().splitlines():
      if l.startswith('VmRSS:'):rss+=int(l.split()[1])*1024
    except OSError:pass
   st=dict(x.split()for x in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines());ws=int(Path('/sys/fs/cgroup/memory.current').read_text())-int(st['inactive_file']);r['peakSampledOwnedRSS']=max(r.get('peakSampledOwnedRSS',0),rss)
   if rss>=24*1024**3 or ws>=56000000000 or os.statvfs('/root').f_bavail*os.statvfs('/root').f_frsize<6000000000 or time.time()-start>300:raise RuntimeError('resource/deadline guard')
   time.sleep(.1)
  r['actualExitCode']=p.returncode;(out/'actual-exit.json').write_text(json.dumps({'actualExitCode':p.returncode},indent=2)+'\n')
 assert p.returncode==0
 r['execution']=json.loads((out/'execution.json').read_text());assert r['execution']['executionPassed']and not r['execution']['proofGenerated'];r['passed']=True
except BaseException as e:
 r['passed']=False;r['error']=repr(e)
 if p and p.poll()is None:os.killpg(p.pid,signal.SIGTERM);p.wait()
 r['actualExitCode']=None if p is None else p.returncode;(out/'actual-exit.json').write_text(json.dumps({'actualExitCode':r['actualExitCode']},indent=2)+'\n')
r['outerSeconds']=time.time()-start;(out/'result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r),flush=True)
