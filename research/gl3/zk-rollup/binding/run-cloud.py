from pathlib import Path
import subprocess,os,json,time,signal
R=Path('/root/gl3-zk-binding');D=Path('/workspace/gl3/zk-rollup/binding/evidence');T=Path('/workspace/gl3/zk-tests/evm-proof/toolchains');os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[-2:]);os.nice(10)
env={**os.environ,'RUSTUP_HOME':str(T/'rustup'),'CARGO_HOME':str(T/'cargo'),'CARGO_TARGET_DIR':str(R/'target'),'CARGO_BUILD_JOBS':'2','GL3_SOLIDITY_VECTORS':'/workspace/gl3/zk-rollup/coordinator-v2/evidence/vectors.json'};env['PATH']=str(T/'cargo/bin')+':'+env['PATH']
start=time.monotonic();log=(D/'test.log').open('w');p=subprocess.Popen([str(T/'cargo/bin/cargo'),'test','--offline','-j2','--','--nocapture'],cwd=R,stdout=log,stderr=subprocess.STDOUT,env=env,start_new_session=True);(D/'process.json').write_text(json.dumps({'childPID':p.pid,'controllerPID':os.getpid(),'scope':'Rust/Solidity codec compatibility tests only','CPUCap':2,'ownedRSSCapBytes':1073741824})+'\n');reason=None;peak=0
while p.poll() is None:
 rss=0
 for q in Path('/proc').glob('[0-9]*'):
  try:
   fields=(q/'stat').read_text().rsplit(')',1)[1].split()
   if int(fields[2])==p.pid:rss+=int(fields[21])*os.sysconf('SC_PAGE_SIZE')
  except OSError:pass
 peak=max(peak,rss);st=os.statvfs('/root');mem=int(Path('/sys/fs/cgroup/memory.current').read_text());ms=dict(x.split() for x in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines());working=mem-int(ms['inactive_file'])
 if rss>1073741824 or st.f_bavail*st.f_frsize<6000000000 or working>=56000000000 or time.monotonic()-start>300:
  reason='resource/deadline guard';os.killpg(p.pid,signal.SIGTERM);p.wait();break
 time.sleep(.2)
result={'passed':p.returncode==0 and reason is None,'actualExitCode':p.returncode,'seconds':time.monotonic()-start,'peakSampledRSSBytes':peak,'terminationReason':reason,'scope':'Host codec/wire cross-language tests against actual Solidity vectors; not full canonical guest execution or proof'};(D/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));raise SystemExit(0 if result['passed'] else 1)
