"""Owned Runpod replay; preserve real exit before optional analysis/metrics."""
from pathlib import Path
import csv,hashlib,json,os,re,subprocess,time,traceback
r=Path('/root/bounded-restore');out=r/'guarded-replay';out.mkdir(exist_ok=True)
assert os.uname().sysname=='Linux'
report=json.loads((r/'evidence/guard-machine-build-result.json').read_text());inp=Path('/root/terminal-acceptance/evidence/terminal-input.json')
assert hashlib.file_digest(inp.open('rb'),'sha256').hexdigest()=='bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90'
expected=json.loads((r/'evidence/native-terminal-result.json').read_text())['expected']
args=['/root/prover',str(r/'machine-guard/machine.v2.wavm.br'),'--json-inputs',str(inp),'--proving-interval','100000000','--require-success','-o',str(out/'full-proofs.json')]
started=time.monotonic()
with (out/'prover.log').open('w') as log:
 p=subprocess.Popen(args,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'RAYON_NUM_THREADS':'8','MALLOC_ARENA_MAX':'2'})
 (out/'process.json').write_text(json.dumps({'pid':p.pid,'args':args,'moduleRoot':report['moduleRoot'],'startedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},indent=2)+'\n')
 peakrss=0;kernelhwm=0;observerErrors=[]
 with (out/'resources.csv').open('w',buffering=1) as f:
  writer=csv.writer(f);writer.writerow(['elapsedSeconds','VmRSSKiB','VmHWMKiB','userTicks','systemTicks'])
  while p.poll() is None:
   try:
    status=Path('/proc/'+str(p.pid)+'/status').read_text();rss=int(re.search(r'^VmRSS:\s+(\d+)',status,re.M)[1]);hwm=int(re.search(r'^VmHWM:\s+(\d+)',status,re.M)[1]);peakrss=max(peakrss,rss);kernelhwm=max(kernelhwm,hwm)
    fields=Path('/proc/'+str(p.pid)+'/stat').read_text().rsplit(') ',1)[1].split();writer.writerow([time.monotonic()-started,rss,hwm,fields[11],fields[12]])
   except Exception as e:observerErrors.append(repr(e))
   time.sleep(5)
 code=p.wait()
 # Never place optional metrics or report parsing before preserving the exit.
 (out/'exit.json').write_text(json.dumps({'exitCode':code,'seconds':time.monotonic()-started,'exitRetrieval':'Popen.wait direct child'})+'\n')
s=(out/'prover.log').read_text();clean=re.sub(r'\x1b\[[0-9;]*m','',s)
m=re.search(r'End GlobalState:\s+BlockHash: (0x[0-9a-f]{64})\s+SendRoot: (0x[0-9a-f]{64})\s+Batch: (\d+)\s+PosInBatch: (\d+)',clean)
actual=list(m.groups()) if m else None
finished='End machine status: Finished' in clean
result={'passed':code==0 and finished and actual==expected,'exitCode':code,'moduleRoot':report['moduleRoot'],'actualEnd':actual,'expectedEnd':expected,'machineFinished':finished,'allFourGlobalStateFieldsMatch':actual==expected,'inputSHA256':hashlib.file_digest(inp.open('rb'),'sha256').hexdigest(),'machineSHA256':report['artifacts']['machine-guard/machine.v2.wavm.br']['SHA256'],'guestSoftMemoryLimitBytes':3*1024**3,'observedKernelVmHWMKiB':kernelhwm,'sampledPeakRSSKiB':peakrss,'observerErrors':observerErrors,'allExecutionOnRunpod':True,'enginePolicyChanged':False,'fullBoLDDisputeExecuted':False,'entire24mWAVMMoveExecuted':False}
(out/'replay-result.json').write_text(json.dumps(result,indent=2)+'\n')
assert result['passed'],result
