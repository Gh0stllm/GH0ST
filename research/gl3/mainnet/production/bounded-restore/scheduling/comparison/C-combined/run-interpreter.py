"""One four-hour bounded exact-input replay on the owned Linux worker."""
from pathlib import Path
import csv,hashlib,json,os,re,subprocess,time
r=Path('/root/bounded-restore');d=r/'fast-comparison/C-combined';out=d/'interpreter';out.mkdir(exist_ok=True)
tool=Path('/root/gl3-aot-jit/bin/prover-exact-final-steps');inp=Path('/root/terminal-acceptance/evidence/terminal-input.json')
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
manifest=json.loads((d/'machine-manifest.json').read_text());expected=json.loads((r/'evidence/native-terminal-result.json').read_text())['expected']
assert sha(tool)==manifest['proverSHA256']=='cc5c9de07b2a739978e383cd4ac4baee3a1d49761c5c75ad414e12056cd7ab27'
assert sha(d/'replay.wasm')==manifest['guestWasmSHA256']=='8d18145460e5f4c649895728fa089a52a04ead2c3fa5e7d10789d72d7de42fbd'
assert sha(inp)=='bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90'
assert sha(r/'machine-inputs/gl3aot.wasm')==manifest['companionSHA256']=='b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555'
assert sha(d/'machine/machine.v2.wavm.br')==manifest['machineSHA256']
args=[str(tool),str(d/'machine/machine.v2.wavm.br'),'--json-inputs',str(inp),'--proving-interval','100000000','--require-success','-o',str(out/'full-proofs.json')]
started=time.monotonic();deadline=4*60*60;timed_out=False;warnings=[];observed_hwm=0;rss_peak=0;termination_at=None
with (out/'prover.log').open('w') as log,(out/'resources.csv').open('w',buffering=1) as metrics:
 p=subprocess.Popen(args,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'RAYON_NUM_THREADS':'8','MALLOC_ARENA_MAX':'2'})
 (out/'process.json').write_text(json.dumps({'pid':p.pid,'collectorPID':os.getpid(),'args':args,'moduleRoot':manifest['moduleRoot'],'deadlineSeconds':deadline,'startedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'allExecutionOnRunpod':True},indent=2)+'\n')
 writer=csv.writer(metrics);writer.writerow(['seconds','VmRSSKiB','VmHWMKiB','userTicks','systemTicks'])
 while True:
  pid,status,usage=os.wait4(p.pid,os.WNOHANG)
  if pid:
   code=os.waitstatus_to_exitcode(status);p.returncode=code
   # This required record precedes every optional metric/report operation.
   (out/'exit.json').write_text(json.dumps({'exitCode':code,'seconds':time.monotonic()-started,'timedOut':timed_out,'exitRetrieval':'os.wait4 direct child'})+'\n')
   break
  try:
   s=Path('/proc/'+str(p.pid)+'/status').read_text();rm=re.search(r'^VmRSS:\s+(\d+)',s,re.M);hm=re.search(r'^VmHWM:\s+(\d+)',s,re.M)
   if rm and hm:
    rss,hwm=int(rm[1]),int(hm[1]);rss_peak=max(rss_peak,rss);observed_hwm=max(observed_hwm,hwm);fields=Path('/proc/'+str(p.pid)+'/stat').read_text().rsplit(') ',1)[1].split();writer.writerow([time.monotonic()-started,rss,hwm,fields[11],fields[12]])
  except Exception as e:
   if len(warnings)<20:warnings.append(repr(e))
  if not timed_out and time.monotonic()-started>deadline:
   timed_out=True;termination_at=time.monotonic();p.terminate()
  elif timed_out and termination_at is not None and time.monotonic()-termination_at>15:
   p.kill();termination_at=None
  time.sleep(5)
s=re.sub(r'\x1b\[[0-9;]*m','',(out/'prover.log').read_text());m=re.search(r'End GlobalState:\s+BlockHash: (0x[0-9a-f]{64})\s+SendRoot: (0x[0-9a-f]{64})\s+Batch: (\d+)\s+PosInBatch: (\d+)',s);actual=list(m.groups()) if m else None
counter=re.search(r'GL3_EXACT_FINAL_STEPS\s+(\d+)',s);steps=int(counter[1]) if counter else None
finished='End machine status: Finished' in s;passed=code==0 and not timed_out and finished and actual==expected and steps is not None
report={'passed':passed,'exitCode':code,'timedOut':timed_out,'seconds':time.monotonic()-started,'machineFinished':finished,'actualEnd':actual,'expectedEnd':expected,'allFourGlobalStateFieldsMatch':actual==expected,'rawExactFinalSteps':steps,'rawCounterPlusOne':steps+1 if steps is not None else None,'currentPrivateGeometryStepsPerBlock':1<<40,'rawCounterPlusOneFitsPrivateGeometry':steps is not None and steps+1<=(1<<40),'geometryAccepted':False,'counterScope':'Raw full-machine CLI trace. Real BoLD kickoff/start offset requires separate binding review.','kernelMaxChildRSSKiB':usage.ru_maxrss,'observedKernelVmHWMKiB':observed_hwm,'sampledPeakRSSKiB':rss_peak,'observerWarnings':warnings,'moduleRoot':manifest['moduleRoot'],'machineSHA256':manifest['machineSHA256'],'guestWasmSHA256':manifest['guestWasmSHA256'],'proverSHA256':manifest['proverSHA256'],'companionSHA256':manifest['companionSHA256'],'inputSHA256':sha(inp),'enginePolicyChanged':False,'oneTerminalBlockOnly':True,'entire24mWAVMMoveExecuted':False,'fullBoLDDisputeExecuted':False,'productionAccepted':False,'allExecutionOnRunpod':True}
if (out/'full-proofs.json').exists():report.update({'fullProofFileSHA256':sha(out/'full-proofs.json'),'fullProofFileBytes':(out/'full-proofs.json').stat().st_size})
(out/'replay-result.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
