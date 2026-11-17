from pathlib import Path
import subprocess,os,signal,time,json,hashlib,socket
assert socket.gethostname()=='cc91695a75f7';assert Path('/sys/fs/cgroup/memory.max').read_text().strip()=='64000000000'
R=Path('/workspace/gl3/same-day-mainnet/bridge-rehearsal/payout-resume');assert not(R/'controller-exit.json').exists();os.sched_setaffinity(0,set(sorted(os.sched_getaffinity(0))[-2:]));os.nice(10);f=(R/'controller.log').open('w');p=subprocess.Popen(['python3',str(R/'run.py')],stdout=f,stderr=subprocess.STDOUT,start_new_session=True);at=time.monotonic();got=0;reason=None
try:
 while True:
  got,status,usage=os.wait4(p.pid,os.WNOHANG)
  if got:break
  rss=0
  for d in Path('/proc').iterdir():
   if not d.name.isdigit():continue
   try:
    t=(d/'stat').read_text();a=t[t.rfind(')')+2:].split()
    if int(a[2])==p.pid:rss+=int(a[21])*os.sysconf('SC_PAGE_SIZE')
   except(FileNotFoundError,ProcessLookupError):pass
  size=sum(x.stat().st_size for x in R.rglob('*')if x.is_file()and not x.is_symlink());mem=int(Path('/sys/fs/cgroup/memory.current').read_text());st=os.statvfs('/root')
  if rss>2147483648 or size>8589934592 or mem>=56000000000 or st.f_bavail*st.f_frsize<6000000000 or time.monotonic()-at>300:reason='diagnostic resource/time guard'
  if reason:
   os.killpg(p.pid,signal.SIGTERM);end=time.monotonic()+5
   while time.monotonic()<end:
    got,status,usage=os.wait4(p.pid,os.WNOHANG)
    if got:break
    time.sleep(.05)
   if not got:os.killpg(p.pid,signal.SIGKILL);got,status,usage=os.wait4(p.pid,0)
   break
  time.sleep(.2)
finally:
 if not got:
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  got,status,usage=os.wait4(p.pid,0)
 p.returncode=os.waitstatus_to_exitcode(status);f.close();(R/'controller-exit.json').write_text(json.dumps({'actualWait4':True,'exitCode':p.returncode,'seconds':time.monotonic()-at,'maxRSSKiB':usage.ru_maxrss,'terminationReason':reason}));
 try:os.killpg(p.pid,signal.SIGTERM)
 except ProcessLookupError:pass
print('diagnostic exit',p.returncode)
