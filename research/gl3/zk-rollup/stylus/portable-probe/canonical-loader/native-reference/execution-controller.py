from pathlib import Path
import subprocess,os,signal,time,json,hashlib
b=Path('/workspace/gl3/zk-tests/stylus-source/native-reference');exe=Path('/root/gl3-stylus-portable/target/release/gl3-native-reference');image=Path('/root/gl3-base-launch/machines/0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97/machine.v2.wavm.br');os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[:16]);results=[]
for mode,args in [('arithmetic',[]),('official-image',[str(image)])]:
 start=time.time();r={'mode':mode,'proofGenerated':False,'fullSTFExecuted':False,'binarySHA256':hashlib.sha256(exe.read_bytes()).hexdigest()};p=None
 try:
  with(b/(mode+'.log')).open('w')as log:
   p=subprocess.Popen([str(exe)]+args,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);(b/(mode+'-process.json')).write_text(json.dumps({'controllerPID':os.getpid(),'childPID':p.pid}));
   while p.poll()is None:
    rss=0
    for d in Path('/proc').glob('[0-9]*'):
     try:
      st=(d/'stat').read_text().rsplit(')',1)[1].split()
      if int(st[2])!=p.pid:continue
      for l in(d/'status').read_text().splitlines():
       if l.startswith('VmRSS:'):rss+=int(l.split()[1])*1024
     except OSError:pass
    ms=dict(x.split()for x in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines());ws=int(Path('/sys/fs/cgroup/memory.current').read_text())-int(ms['inactive_file']);r['peakSampledOwnedRSS']=max(r.get('peakSampledOwnedRSS',0),rss)
    if rss>=24*1024**3 or ws>=56000000000 or os.statvfs('/root').f_bavail*os.statvfs('/root').f_frsize<6000000000 or time.time()-start>300:raise RuntimeError('guard')
    time.sleep(.1)
   r['actualExitCode']=p.returncode;(b/(mode+'-actual-exit.json')).write_text(json.dumps({'actualExitCode':p.returncode}));assert p.returncode==0
  text=(b/(mode+'.log')).read_text().splitlines();actual=json.loads(text[-1]);r['output']=actual
  if mode=='arithmetic':
   assert actual['moduleRoot']=='5d70cc58f8935dfefbadb5585fe6d51d45bf87f2b8ed2e7485e8d5de65c70e41'
   assert actual['machineHash']=='946a06ac8584f720f99f6c452a12dd14e4c18e08ca5c4d94aee84a938387af9d';assert actual['result']==19
  r['passed']=True
 except BaseException as e:
  r['passed']=False;r['error']=repr(e)
  if p and p.poll()is None:os.killpg(p.pid,signal.SIGTERM);p.wait()
  r['actualExitCode']=None if p is None else p.returncode
 r['outerSeconds']=time.time()-start;(b/(mode+'-result.json')).write_text(json.dumps(r,indent=2)+'\n');results.append(r)
 if not r.get('passed'):break
print(json.dumps(results),flush=True)
