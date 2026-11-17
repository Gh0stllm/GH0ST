from pathlib import Path
import os,subprocess,time,json,signal
b=Path('/workspace/gl3/zk-tests/stylus-source/image-loader');tool=Path('/workspace/gl3/zk-tests/evm-proof');os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[:16]);env=dict(os.environ,RUSTUP_HOME=str(tool/'toolchains/rustup'),CARGO_HOME=str(tool/'toolchains/cargo'),CARGO_TARGET_DIR='/root/gl3-sp1-build/target',CARGO_NET_GIT_FETCH_WITH_CLI='true',CARGO_BUILD_JOBS='16',SP1_SKIP_PROGRAM_BUILD='true',SP1_PROVER='cpu',RAYON_NUM_THREADS='16');env['PATH']=str(tool/'toolchains/sp1/bin')+':'+str(tool/'toolchains/cargo/bin')+':/workspace/gl3/durable/toolchain/go/bin:'+env['PATH'];start=time.time();r={'stage':'canonical image loader CPU execute-only host build','realProofStarted':False,'CPUCap':16,'ownedRSSCap':24*1024**3};p=None
try:
 with(b/'wavm-host-build.log').open('w')as log:
  p=subprocess.Popen([str(tool/'toolchains/cargo/bin/cargo'),'build','--release','-j16'],cwd='/root/gl3-stylus-portable/host-image',env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);(b/'wavm-host-build-process.json').write_text(json.dumps({'controllerPID':os.getpid(),'childPID':p.pid},indent=2));print('COMPILING_NATIVE_HOST',p.pid,flush=True)
  while p.poll()is None:
   sv=os.statvfs('/root');mem=int(Path('/sys/fs/cgroup/memory.current').read_text());st=dict(x.split()for x in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines());ws=mem-int(st['inactive_file']);rss=0
   for q in Path('/proc').glob('[0-9]*'):
    try:
     fields=(q/'stat').read_text().rsplit(')',1)[1].split()
     if int(fields[2])==p.pid:
      for l in(q/'status').read_text().splitlines():
       if l.startswith('VmRSS:'):rss+=int(l.split()[1])*1024
    except OSError:pass
   r['peakRSS']=max(r.get('peakRSS',0),rss)
   if sv.f_bavail*sv.f_frsize<6000000000 or ws>=56000000000 or rss>=24*1024**3 or time.time()-start>1200:raise RuntimeError('resource/deadline guard')
   time.sleep(1)
  r['actualExitCode']=p.returncode
except BaseException as e:
 r['error']=repr(e)
 if p and p.poll()is None:os.killpg(p.pid,signal.SIGTERM);p.wait()
 r['actualExitCode']=None if p is None else p.returncode
r['seconds']=time.time()-start;(b/'wavm-host-build-result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r),flush=True)
