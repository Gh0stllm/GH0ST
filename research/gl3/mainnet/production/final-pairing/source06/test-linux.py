from pathlib import Path
import os,json,time,subprocess,shutil,signal,hashlib
base=Path('/root/gl3-final-pairing');out=base/'source06';ev=out/'evidence';ev.mkdir(exist_ok=True)
go='/root/bounded-restore/toolchain/go/bin/go';env=os.environ.copy();env['PATH']=str(Path(go).parent)+':'+env['PATH'];env['GOMAXPROCS']='2';env['TMPDIR']=str(out/'tmp');Path(env['TMPDIR']).mkdir(exist_ok=True)
cpus=sorted(os.sched_getaffinity(0))[-2:]
for mode in ['normal','race']:
 args=[go,'test','-p','2','-mod=readonly','-overlay',str(out/'test-overlay.json'),'-run','^TestGL3(Upload|RequestLimit|Operator)','-count=1','-v']
 if mode=='race':args+=['-race']
 args+=['./validator/client','./validator/valnode','./staker']
 if shutil.disk_usage(base).free<6000000000:raise RuntimeError('disk floor before '+mode)
 started=time.time();reason=None
 with (ev/(mode+'.stdout')).open('w') as stdout,(ev/(mode+'.stderr')).open('w') as stderr:
  p=subprocess.Popen(args,cwd=base/'source05',env=env,stdout=stdout,stderr=stderr,start_new_session=True,preexec_fn=lambda:os.sched_setaffinity(0,cpus))
  (ev/(mode+'-running.json')).write_text(json.dumps({'pid':p.pid,'startUnix':started,'args':args,'CPUs':cpus},indent=2))
  while p.poll() is None:
   scratch=sum(q.stat().st_size for q in out.rglob('*') if q.is_file() and not q.is_symlink())
   if shutil.disk_usage(base).free<6000000000 or scratch>3000000000 or time.time()-started>600:
    reason='disk/scratch/deadline guard';os.killpg(p.pid,signal.SIGTERM)
    try:p.wait(10)
    except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL)
    break
   time.sleep(.3)
  code=p.wait()
 receipt={'mode':mode,'actualExitCode':code,'seconds':time.time()-started,'reason':reason,'diskFreeBytes':shutil.disk_usage(base).free,'args':args}
 (ev/(mode+'-exit.json')).write_text(json.dumps(receipt,indent=2)+'\n')
 if code:raise RuntimeError(mode+' tests failed')
