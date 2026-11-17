from pathlib import Path
import os,json,hashlib,subprocess,time,signal,socket
b=Path('/workspace/gl3/zk-tests/stylus-source/base-capture');source=b.parent/'gl3_base_capture_test.go';sdk=Path('/root/gl3-base-launch/nitro-clean');assert socket.gethostname()=='cc91695a75f7';assert Path('/sys/fs/cgroup/memory.max').read_text().strip()=='64000000000';assert hashlib.sha256(source.read_bytes()).hexdigest()=='f70fec35602661e41fd4ee9205ede704c12e82499e911e9f267dbfec92fc6088'
# No concurrent guest execution/proof; wait only for our bounded phase diagnostic.
p=Path('/workspace/gl3/zk-tests/stylus-source/image-loader-diagnostic/execution/result.json')
while not p.exists():time.sleep(.2)
os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[:8]);tmp=Path('/root/gl3-canonical-capture-tmp');tmp.mkdir(exist_ok=True)
env=dict(os.environ,GOMAXPROCS='8',GOTOOLCHAIN='local',CGO_ENABLED='1',PWD=str(sdk),LD_LIBRARY_PATH=str(sdk/'target/lib'),NITRO_TEST_L1_GETH='/workspace/gl3/durable/base-dispute/parent-geth/bin/geth',TMPDIR=str(tmp),GOTMPDIR=str(tmp),GOCACHE='/root/gl3-base-dispute-compile/go-cache',GL3_CANONICAL_CAPTURE_DIR=str(b/'captured'))
assert hashlib.sha256(Path(env['NITRO_TEST_L1_GETH']).read_bytes()).hexdigest()=='ea7c86a51c9fef2f278d29b967113015bc317482dd32e2ed82201728279bf88f'
assert hashlib.sha256((sdk/'target/lib/libstylus.a').read_bytes()).hexdigest()=='42cc75b003aaab6686620da6ec947bb475fe221b605bd0ac1bf417a171f4546c'
(b/'overlay.json').write_text(json.dumps({'Replace':{str(sdk/'system_tests/gl3_canonical_base_capture_test.go'):str(source)}}))
exe=b/'base-capture.test';commands=[('compile',['/root/bounded-restore/toolchain/go/bin/go','test','-c','-mod=readonly','-p','8','-tags=blst_enabled','-overlay='+str(b/'overlay.json'),'-o',str(exe),'./system_tests']),('capture',[str(exe),'-test.run=^TestGL3CanonicalBaseCapture$','-test.v','-test.timeout=150s'])]
for phase,args in commands:
 r={'phase':phase,'sourceSHA256':'f70fec35602661e41fd4ee9205ede704c12e82499e911e9f267dbfec92fc6088','publicWrites':False,'proofGenerated':False,'peakSampledOwnedRSS':0,'argv':args};start=time.time();proc=None
 try:
  with(b/(phase+'.log')).open('w')as log:
   proc=subprocess.Popen(args,cwd=sdk,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);(b/(phase+'-process.json')).write_text(json.dumps({'controllerPID':os.getpid(),'childPID':proc.pid}))
   while proc.poll()is None:
    rss=0
    for q in Path('/proc').glob('[0-9]*'):
     try:
      fields=(q/'stat').read_text().rsplit(')',1)[1].split()
      if int(fields[2])!=proc.pid:continue
      for line in(q/'status').read_text().splitlines():
       if line.startswith('VmRSS:'):rss+=int(line.split()[1])*1024
     except OSError:pass
    r['peakSampledOwnedRSS']=max(r['peakSampledOwnedRSS'],rss);ms=dict(x.split()for x in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines());ws=int(Path('/sys/fs/cgroup/memory.current').read_text())-int(ms['inactive_file']);free=os.statvfs('/root').f_bavail*os.statvfs('/root').f_frsize
    if rss>=24*1024**3 or ws>=56000000000 or free<6000000000 or time.time()-start>(1200 if phase=='compile'else180):raise RuntimeError('resource/deadline guard')
    time.sleep(.25)
   r['actualExitCode']=proc.returncode
  assert proc.returncode==0
  r['passed']=True
  if phase=='compile':r['binarySHA256']=hashlib.sha256(exe.read_bytes()).hexdigest()
 except BaseException as e:
  r['passed']=False;r['error']=repr(e)
  if proc and proc.poll()is None:os.killpg(proc.pid,signal.SIGTERM);proc.wait()
  r['actualExitCode']=None if proc is None else proc.returncode
 r['seconds']=time.time()-start;(b/(phase+'-result.json')).write_text(json.dumps(r,indent=2)+'\n')
 if not r['passed']:break
