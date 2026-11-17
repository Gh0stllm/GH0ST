#!/usr/bin/env python3
"""Owns one read-only packet verification; never a deployment process."""
from pathlib import Path
import os,json,time,subprocess,signal,hashlib
B=Path('/workspace/gl3/same-day-mainnet/deployment-packet/receipt-derived')
assert os.uname().nodename=='cc91695a75f7'
result=Path('/workspace/gl3/mainnet/identities/deployment-result.json')
started=time.monotonic();waiting=started
while True:
 try:
  j=json.loads(result.read_text())
  if j.get('passed') is True:break
 except (FileNotFoundError,json.JSONDecodeError):pass
 if time.monotonic()-waiting>900:raise SystemExit('Final deployment result not ready; no verification started.')
 time.sleep(5)
def free():
 s=os.statvfs('/root');return s.f_bavail*s.f_frsize
def working():
 r=Path('/sys/fs/cgroup');v=int((r/'memory.current').read_text());s=dict(l.split()for l in(r/'memory.stat').read_text().splitlines());return v-int(s.get('inactive_file','0'))
def owned_rss(group):
 total=0
 for d in Path('/proc').iterdir():
  if not d.name.isdigit():continue
  try:
   stat=(d/'stat').read_text().split(') ',1)[1].split()
   if int(stat[2])!=group:continue
   for l in(d/'status').read_text().splitlines():
    if l.startswith('VmRSS:'):total+=int(l.split()[1])*1024
  except (FileNotFoundError,ProcessLookupError,PermissionError,ValueError):pass
 return total
assert free()>6000000000 and working()<56000000000
src=B/'build-packet.mjs';pins={'sourceSHA256':hashlib.sha256(src.read_bytes()).hexdigest(),'controllerSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
run=time.monotonic();out=(B/'verification.stdout').open('x');err=(B/'verification.stderr').open('x')
p=subprocess.Popen(['taskset','-c',','.join(str(x)for x in sorted(os.sched_getaffinity(0))[:2]),'node',str(src)],stdout=out,stderr=err,stdin=subprocess.DEVNULL,start_new_session=True)
(B/'running.json').write_text(json.dumps({'controllerPID':os.getpid(),'readOnlyVerifierPID':p.pid,'sourcePins':pins,'deploymentExecutionProcessOwned':False,'wallLimitSeconds':600,'ownedSampledRSSLimitBytes':2147483648,'rootFreeFloorBytes':6000000000,'sharedWorkingLimitBytes':56000000000},indent=2)+'\n')
reason=None;peak=0;minfree=free();maxworking=0
while p.poll() is None:
 rss=owned_rss(p.pid);peak=max(peak,rss);f=free();w=working();minfree=min(minfree,f);maxworking=max(maxworking,w)
 if time.monotonic()-run>600 or rss>2147483648 or f<6000000000 or w>56000000000:
  reason='owned-verifier-resource-or-wall-guard';os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL)
  break
 time.sleep(1)
code=p.wait();(B/'actual-exit.json').write_text(json.dumps({'actualExitCode':code,'seconds':time.monotonic()-run,'waitForDeploymentResultSeconds':run-started,'reason':reason,'sourcePins':pins,'sampledAggregateRSSUpperBoundBytes':peak,'minimumRootFreeBytes':minfree,'maximumSharedWorkingBytes':maxworking,'publicTransactionsSubmitted':0,'servicesStarted':0},indent=2)+'\n')
out.close();err.close()
