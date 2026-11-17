from pathlib import Path
import os,subprocess,time,json,signal
r=Path('/root/gl3-stylus-portable');b=Path('/workspace/gl3/zk-tests/stylus-source/native-reference');old=Path('/workspace/gl3/zk-tests/evm-proof/toolchains');cargo=old/'rustup/toolchains/1.90.0-x86_64-unknown-linux-gnu/bin/cargo';allowed=sorted(os.sched_getaffinity(0));os.sched_setaffinity(0,allowed[:16]);env=dict(os.environ,CARGO_HOME='/root/gl3-sp1-cargo',CARGO_TARGET_DIR=str(r/'target'),RUSTC=str(r/'toolchain/bin/rustc'),RUSTDOC=str(r/'toolchain/bin/rustdoc'),RUSTC_BOOTSTRAP='1',CARGO_BUILD_JOBS='16');env['PATH']=str(old/'cargo/bin')+':'+env['PATH'];env['CC_riscv32im_succinct_zkvm_elf']='/root/gl3-stylus-portable/c-toolchain/riscv32im-linux-x86_64/bin/riscv32-unknown-elf-gcc';env['CFLAGS_riscv32im_succinct_zkvm_elf']='-march=rv32im -mabi=ilp32 -mno-relax -DBROTLI_BUILD_PORTABLE -D__ILP32__';env['IGNORED_GUEST_RUSTFLAGS']='\x1f'.join(['-C','passes=lower-atomic','-C','link-arg=-Ttext=0x00201000','-C','link-arg=--image-base=0x00200800','-C','panic=abort','--cfg','getrandom_backend="custom"']);start=time.time();rec={'phase':'native canonical differential and authenticated image loader build','CPUCap':16,'ownedRSSCap':24*1024**3,'realProofStarted':False};p=None
try:
 with(b/'portable-build.log').open('w')as log:
  args=[str(cargo),'build','--release','-p','gl3-native-reference','-j16'];rec['argv']=args;p=subprocess.Popen(args,cwd=r/'nitro',env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);(b/'portable-build-process.json').write_text(json.dumps({'controllerPID':os.getpid(),'childPID':p.pid},indent=2)+'\n');print('ACTUAL_CARGO',p.pid,flush=True)
  while p.poll()is None:
   rss=0
   for d in Path('/proc').glob('[0-9]*'):
    try:
     v=(d/'stat').read_text().rsplit(')',1)[1].split()
     if int(v[2])!=p.pid:continue
     for l in(d/'status').read_text().splitlines():
      if l.startswith('VmRSS:'):rss+=int(l.split()[1])*1024
    except OSError:pass
   st=dict(x.split()for x in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines());ws=int(Path('/sys/fs/cgroup/memory.current').read_text())-int(st['inactive_file']);free=os.statvfs('/root').f_bavail*os.statvfs('/root').f_frsize;rec['peakSampledOwnedRSS']=max(rec.get('peakSampledOwnedRSS',0),rss)
   if rss>=24*1024**3 or ws>=56000000000 or free<6000000000 or time.time()-start>1200:raise RuntimeError('resource/deadline guard')
   time.sleep(.5)
  rec['actualExitCode']=p.returncode
except BaseException as e:
 rec['error']=repr(e)
 if p and p.poll()is None:os.killpg(p.pid,signal.SIGTERM);p.wait()
 rec['actualExitCode']=None if p is None else p.returncode
rec['seconds']=time.time()-start;(b/'portable-build-result.json').write_text(json.dumps(rec,indent=2)+'\n');print(json.dumps(rec),flush=True)
