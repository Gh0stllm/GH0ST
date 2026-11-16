"""Replay the captured last computing block on its owned Linux proof worker.

This is one recorded block completing the fixed decision, not a complete
24m-move interpreter trace and not a complete BoLD dispute.
"""
from pathlib import Path
import csv,hashlib,json,os,platform,re,resource,subprocess,time

assert platform.system()=='Linux','All execution belongs on Runpod'
ROOT=Path('/root/terminal-acceptance')
OUT=Path('/root/terminal-wavm');OUT.mkdir(exist_ok=True)
meta=json.loads((ROOT/'evidence/terminal-input-manifest.json').read_text())
assert meta['completed'] and meta['moduleRoot']=='0xd45324627b0b3118dfdf1ad585769024cfa6008da8cdcaa745de32edc724613b'
input_file=ROOT/'evidence/terminal-input.json'
machine=ROOT/'custom-machines'/meta['moduleRoot']/'machine.v2.wavm.br'
prover=Path('/root/prover')
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(4*1024*1024),b''):h.update(chunk)
 return h.hexdigest()
assert input_file.stat().st_size==meta['bytes'] and sha(input_file)==meta['SHA256']
assert sha(machine)=='d10be7f7579fed93d17de5ed0cf024343f1f753ac2682b07d68c63dbefd6770b'
manifest={'scope':__doc__,'inputSHA256':meta['SHA256'],'inputBytes':meta['bytes'],
 'moduleRoot':meta['moduleRoot'],'machineSHA256':sha(machine),'proverSHA256':sha(prover),
 'expectedEnd':meta['expectedEndState'],'engineSearchThreads':1,'hostHashingThreads':8,
 'publicDeployment':False,'fullBoLDDisputeExecuted':False,'entire24mWAVMMoveExecuted':False,
 'allExecutionOnRunpod':True,'enginePolicyChanged':False}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
def integer(*names):
 for n in names:
  p=Path(n)
  if p.exists():
   try:return int(p.read_text()),n
   except ValueError:pass
 return None,None
started=time.monotonic();timeout=False
args=[str(prover),str(machine),'--json-inputs',str(input_file),'--proving-interval','100000000','--require-success','-o',str(OUT/'full-proofs.json')]
with (OUT/'prover.log').open('w') as log,(OUT/'resources.csv').open('w') as f:
 p=subprocess.Popen(args,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'RAYON_NUM_THREADS':'8','MALLOC_ARENA_MAX':'2'},start_new_session=True)
 (OUT/'process.json').write_text(json.dumps({'pid':p.pid,'args':args,'startedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})+'\n')
 writer=csv.writer(f);writer.writerow(['seconds','RSSKiB','kernelVmHWMKiB','cgroupBytes'])
 while p.poll() is None:
  try:
   status={}
   for line in Path(f'/proc/{p.pid}/status').read_text().splitlines():
    k,_,v=line.partition(':');a=v.split()
    if a:status[k]=a[0]
   mem,_=integer('/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory/memory.usage_in_bytes')
   writer.writerow([time.monotonic()-started,status.get('VmRSS'),status.get('VmHWM'),mem]);f.flush()
  except FileNotFoundError:pass
  if time.monotonic()-started>7200:
   timeout=True;p.terminate()
   try:p.wait(timeout=15)
   except subprocess.TimeoutExpired:p.kill();p.wait()
   break
  time.sleep(1)
 code=p.wait()
 # Preserve real exit status before optional metrics and log processing.
 (OUT/'exit.json').write_text(json.dumps({'exitCode':code,'timedOut':timeout,'seconds':time.monotonic()-started})+'\n')
text=re.sub(r'\x1b\[[0-9;]*m','',(OUT/'prover.log').read_text())
end=re.search(r'End GlobalState:\s+BlockHash: (0x[0-9a-f]{64})\s+SendRoot: (0x[0-9a-f]{64})\s+Batch: (\d+)\s+PosInBatch: (\d+)',text)
e=meta['expectedEndState'];matched=end is not None and end.groups()==(e['BlockHash'],e['SendRoot'],str(e['Batch']),str(e['PosInBatch']))
peak,source=integer('/sys/fs/cgroup/memory.peak','/sys/fs/cgroup/memory/memory.max_usage_in_bytes')
report={**manifest,'passed':code==0 and matched and 'End machine status: Finished' in text and 'Computed state matches the expected one' in text,
 'exitCode':code,'timedOut':timeout,'seconds':time.monotonic()-started,'allFourGlobalStateFieldsMatch':matched,
 'kernelMaxChildRSSKiB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
 'wholePodCgroupPeakBytes':peak,'wholePodCgroupPeakSource':source,'wholePodPeakIncludesPriorWork':True}
(OUT/'replay-result.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
raise SystemExit(0 if report['passed'] else 1)
