from pathlib import Path
import subprocess,os,time,json,shutil,signal,hashlib
b=Path('/root/gl3-final-pairing');o=b/'operator-tests05';sdk=b/'source05';g='/root/bounded-restore/toolchain/go/bin/go';env=os.environ.copy();env['PATH']=str(Path(g).parent)+':'+env['PATH'];env['GOMAXPROCS']='2';env['TMPDIR']=str(o/'tmp');cpus=sorted(os.sched_getaffinity(0))[-2:]
def scratch():return sum(p.stat().st_size for p in b.rglob('*') if p.is_file() and not p.is_symlink())
def execute(cmd,logname):
 if shutil.disk_usage(b).free<6_000_000_000:raise RuntimeError('disk safety floor before new process')
 t=time.time();reason=None
 with (o/logname).open('w') as log:
  p=subprocess.Popen(cmd,cwd=sdk,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=lambda:os.sched_setaffinity(0,cpus))
  while p.poll() is None:
   if shutil.disk_usage(b).free<6_000_000_000 or scratch()>3*1024**3:
    reason='disk safety floor or task scratch guard';os.killpg(p.pid,signal.SIGTERM)
    try:p.wait(timeout=10)
    except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL)
    break
   time.sleep(.25)
  code=p.wait()
 r={'command':cmd,'actualExitCode':code,'seconds':time.time()-t,'stoppedReason':reason,'affinityCPUs':cpus,'diskFreeAfter':shutil.disk_usage(b).free,'taskScratchBytesAfter':scratch()}
 (o/(logname+'.exit.json')).write_text(json.dumps(r,indent=2)+'\n');return r
results=[]
for profile,flags in [('normal',[]),('race',['-race'])]:
 binary=o/(profile+'.test')
 r=execute([g,'test','-c','-p','2','-mod=readonly','-buildvcs=false']+flags+['-ldflags=-extldflags=-Wl,-z,noexecstack','-o',str(binary),'./staker'],profile+'-compile.log');results.append(r)
 (o/'results.json').write_text(json.dumps({'results':results,'complete':False},indent=2)+'\n')
 if r['actualExitCode']!=0:raise SystemExit(1)
 r=execute([str(binary),'-test.v','-test.timeout=30s','-test.run=^TestGL3Operator'],profile+'-tests.log');results.append(r)
 (o/'results.json').write_text(json.dumps({'results':results,'complete':False},indent=2)+'\n')
 if r['actualExitCode']!=0:raise SystemExit(1)
(o/'results.json').write_text(json.dumps({'results':results,'complete':True,'passed':True,'allExecutionOnRunpod':True,'engineOrProverExecuted':False},indent=2)+'\n')
