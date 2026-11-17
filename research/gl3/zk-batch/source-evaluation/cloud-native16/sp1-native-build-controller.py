from pathlib import Path
import os,subprocess,time,json,signal
b=Path('/workspace/gl3/zk-tests/evm-proof');os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[:16]);env=dict(os.environ,RUSTUP_HOME=str(b/'toolchains/rustup'),CARGO_HOME=str(b/'toolchains/cargo'),CARGO_TARGET_DIR='/root/gl3-sp1-build/target',CARGO_NET_GIT_FETCH_WITH_CLI='true',CARGO_BUILD_JOBS='16',SP1_SKIP_PROGRAM_BUILD='true',SP1_PROVER='cpu',RAYON_NUM_THREADS='16');env['PATH']=str(b/'toolchains/sp1/bin')+':'+str(b/'toolchains/cargo/bin')+':/workspace/gl3/durable/toolchain/go/bin:'+env['PATH'];start=time.time();r={'stage':'selected-SP1-native-gnark-full-EVM-host-and-guest-build','realProofStarted':False,'CPUCap':16,'ownedRSSCap':40*1024**3};p=None
try:
 with(b/'sp1-native-build.log').open('w')as log:
  p=subprocess.Popen([str(b/'toolchains/cargo/bin/cargo'),'build','--release','--locked','--features','sp1','-j16'],cwd=b/'source/replay-sp1-native',env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);(b/'sp1-native-build-process.json').write_text(json.dumps({'controllerPID':os.getpid(),'childPID':p.pid},indent=2));print('COMPILING_NATIVE_HOST',p.pid,flush=True)
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
   if sv.f_bavail*sv.f_frsize<6000000000 or ws>=56000000000 or rss>=40*1024**3 or time.time()-start>3600:raise RuntimeError('resource/deadline guard')
   time.sleep(1)
  r['actualExitCode']=p.returncode
except BaseException as e:
 r['error']=repr(e)
 if p and p.poll()is None:os.killpg(p.pid,signal.SIGTERM);p.wait()
 r['actualExitCode']=None if p is None else p.returncode
r['seconds']=time.time()-start;(b/'sp1-native-build-result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r),flush=True)
