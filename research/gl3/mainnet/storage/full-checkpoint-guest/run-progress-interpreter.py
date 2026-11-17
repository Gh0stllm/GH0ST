"""Bounded real WAVM replay of one captured A15 progress block; no JIT."""
from pathlib import Path
import csv,hashlib,json,os,re,shutil,signal,subprocess,time
R=Path('/root/gl3-full-checkpoint-guest')
if Path(__file__).resolve().parent!=R:raise RuntimeError('Owned Runpod prefix required')
O=R/'interpreter-progress-v1';O.mkdir(exist_ok=False)
T=Path('/root/gl3-aot-jit/bin/prover-exact-final-steps')
M=R/'machine-generation/machine/machine.v2.wavm.br';I=R/'capture/evidence/begin-input.json'
LIB=Path('/root/bounded-restore/machine-inputs')
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save(n,d):(O/n).write_text(json.dumps(d,indent=2)+'\n')
ready=json.loads((R/'ready-for-review.json').read_text())
assert sha(T)==ready['machineGeneratorSHA256']=='cc5c9de07b2a739978e383cd4ac4baee3a1d49761c5c75ad414e12056cd7ab27'
assert sha(M)==ready['machineSHA256']=='9f5ce0c06b01debaf3077c95559d38af11d2d7925f02721742acacfcfb944752'
assert sha(R/'replay.wasm')==ready['guestSHA256']=='fc5645ec7536ca7191c4eaa1db0fa381a67dafb46cdf844eb6403298516fed5d'
assert sha(I)==ready['captureInputSHA256']=='d346eb13ca7edec142088db8e51118f58240310d8d55147bffb1fb1bca56d940'
assert I.stat().st_size==ready['captureInputBytes']==600010302
for name,digest in ready['standardLibrarySHA256'].items():assert sha(LIB/(name+'.wasm'))==digest
assert sha(LIB/'gl3aot.wasm')==ready['companionSHA256']=='b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555'
helptext=subprocess.run([str(T),'--help'],capture_output=True,text=True,check=True).stdout
assert '--max-steps' in helptext and '--json-inputs' in helptext
(O/'prover-help.txt').write_text(helptext)
cpus=sorted(os.sched_getaffinity(0))[-2:];os.sched_setaffinity(0,cpus);os.nice(10)
# The pinned tool checks max_steps at each proof interval boundary, not inside
# step_n. Reserve one complete interval below the authorized1e12 hard envelope.
interval=5_000_000_000;configured_cap=995_000_000_000;authorized_envelope=1_000_000_000_000
args=[str(T),str(M),'--json-inputs',str(I),'--proving-interval',str(interval),'--max-steps',str(configured_cap),'--require-success','-o',str(O/'sparse-proofs.json')]
expected=ready['expectedFourGlobalStateFields'];deadline=45*60
manifest={'status':'RUNNING_NOT_ACCEPTED','moduleRoot':ready['moduleRoot'],'machineSHA256':sha(M),'guestSHA256':sha(R/'replay.wasm'),'companionSHA256':ready['companionSHA256'],'standardLibrarySHA256':ready['standardLibrarySHA256'],'proverSHA256':sha(T),'inputSHA256':sha(I),'inputBytes':I.stat().st_size,'expectedEnd':expected,'nativeHeaderGasUsed':ready['capturedNativeGasUsed'],'nativeStateRoot':ready['capturedNativeStateRoot'],'nativeReceiptHash':ready['capturedNativeReceiptHash'],'cpuAffinity':cpus,'nice':10,'deadlineSeconds':deadline,'configuredMaxSteps':configured_cap,'provingInterval':interval,'authorizedStepUpperEnvelope':authorized_envelope,'stepCapScope':'Pinned loop boundary check; one reserved interval avoids overshooting authorized1e12','sparseProofSamplesUpperEstimate':202,'ownScratchLimitBytes':3*1024**3,'diskFreeFloorBytes':6_000_000_000,'ownRSSGuardKiB':32*1024*1024,'wholeHostMemoryAvailableFloorKiB':8*1024*1024,'rootAuthorizedBoundedTrial':True,'realWAVMInterpreter':True,'JITUsed':False,'progressBlockOnly':True,'full24mSearchOrTerminalOr20GamesAccepted':False,'productionAccepted':False,'allExecutionOnRunpod':True,'controllerSHA256':sha(Path(__file__)),'sourceAndInputUnchanged':True}
save('input-manifest.json',manifest)
def allocation():return sum(p.stat().st_blocks*512 for p in R.rglob('*') if p.is_file() and not p.is_symlink())
if shutil.disk_usage(R).free<6_000_000_000 or allocation()>3*1024**3:raise RuntimeError('Initial resource guard')
start=time.monotonic();timed_out=False;reason=None;term_at=None;warnings=[];rss_peak=0;hwm_peak=0;scratch_peak=allocation();free_min=shutil.disk_usage(R).free
with (O/'prover.log').open('w') as log,(O/'resources.csv').open('w',buffering=1) as stats:
 p=subprocess.Popen(args,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,env={**os.environ,'RAYON_NUM_THREADS':'2','MALLOC_ARENA_MAX':'2'})
 save('process.json',{'pid':p.pid,'collectorPID':os.getpid(),'args':args,'moduleRoot':ready['moduleRoot'],'startedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'deadlineSeconds':deadline,'cpuAffinity':cpus,'allExecutionOnRunpod':True})
 writer=csv.writer(stats);writer.writerow(['seconds','VmRSSKiB','VmHWMKiB','userTicks','systemTicks','hostMemAvailableKiB','ownedAllocatedBytes','diskFreeBytes'])
 while True:
  pid,status,usage=os.wait4(p.pid,os.WNOHANG)
  if pid:
   code=os.waitstatus_to_exitcode(status);p.returncode=code
   # Persist the direct-child actual exit BEFORE any optional postprocessing.
   save('exit.json',{'exitCode':code,'seconds':time.monotonic()-start,'timedOut':timed_out,'terminationReason':reason,'kernelMaxRSSKiB':usage.ru_maxrss,'exitRetrieval':'os.wait4 direct child'})
   break
  try:
   s=Path('/proc/'+str(p.pid)+'/status').read_text();rss=int(re.search(r'^VmRSS:\s+(\d+)',s,re.M)[1]);hwm=int(re.search(r'^VmHWM:\s+(\d+)',s,re.M)[1]);rss_peak=max(rss_peak,rss);hwm_peak=max(hwm_peak,hwm)
   fields=Path('/proc/'+str(p.pid)+'/stat').read_text().rsplit(') ',1)[1].split()
   available=int(re.search(r'^MemAvailable:\s+(\d+)',Path('/proc/meminfo').read_text(),re.M)[1]);scratch=allocation();free=shutil.disk_usage(R).free;scratch_peak=max(scratch_peak,scratch);free_min=min(free_min,free)
   writer.writerow([time.monotonic()-start,rss,hwm,fields[11],fields[12],available,scratch,free])
   if reason is None:
    if free<6_000_000_000:reason='disk free floor'
    elif scratch>3*1024**3:reason='owned3GiB scratch limit'
    elif rss>32*1024*1024:reason='own32GiB RSS guard'
    elif available<8*1024*1024:reason='baseline priority host memory reserve'
  except Exception as e:
   if len(warnings)<20:warnings.append(repr(e))
  if reason is None and time.monotonic()-start>deadline:timed_out=True;reason='45minute wall deadline'
  if reason is not None and term_at is None:p.terminate();term_at=time.monotonic()
  elif term_at is not None and time.monotonic()-term_at>10:
   try:p.kill()
   except ProcessLookupError:pass
  time.sleep(2)
text=re.sub(r'\x1b\[[0-9;]*m','',(O/'prover.log').read_text())
end=re.search(r'End GlobalState:\s+BlockHash: (0x[0-9a-f]{64})\s+SendRoot: (0x[0-9a-f]{64})\s+Batch: (\d+)\s+PosInBatch: (\d+)',text);actual=list(end.groups()) if end else None
counter=re.search(r'GL3_EXACT_FINAL_STEPS\s+(\d+)',text);steps=int(counter[1]) if counter else None
mh=re.search(r'End machine hash:\s+(0x[0-9a-f]{64})',text);finished='End machine status: Finished' in text
passed=code==0 and not timed_out and reason is None and finished and actual==expected and steps is not None and steps<=authorized_envelope
report={**manifest,'status':'PASSED_PROGRESS_BLOCK_ONLY' if passed else 'NOT_ACCEPTED','passed':passed,'exitCode':code,'timedOut':timed_out,'terminationReason':reason,'seconds':time.monotonic()-start,'machineFinished':finished,'actualEnd':actual,'expectedEnd':expected,'allFourGlobalStateFieldsMatch':actual==expected,'rawExactFinalSteps':steps,'actualEndMachineHash':mh[1] if mh else None,'kernelMaxChildRSSKiB':usage.ru_maxrss,'sampledPeakRSSKiB':rss_peak,'observedKernelVmHWMKiB':hwm_peak,'sampledPeakOwnedAllocatedBytes':scratch_peak,'sampledMinimumDiskFreeBytes':free_min,'observerWarnings':warnings,'guestProofForProgressBlockOnly':passed,'engineDecisionStillPending':True,'wholeTerminalMoveAccepted':False,'fullBoLDDisputeExecuted':False,'inputUnchangedAfterRun':sha(I)==manifest['inputSHA256'],'guestUnchangedAfterRun':sha(R/'replay.wasm')==manifest['guestSHA256'],'machineUnchangedAfterRun':sha(M)==manifest['machineSHA256']}
if (O/'sparse-proofs.json').exists():report.update(sparseProofFileSHA256=sha(O/'sparse-proofs.json'),sparseProofFileBytes=(O/'sparse-proofs.json').stat().st_size)
if not all(report[k] for k in ['inputUnchangedAfterRun','guestUnchangedAfterRun','machineUnchangedAfterRun']):report.update(passed=False,status='NOT_ACCEPTED_IMMUTABLE_INPUT_CHANGED')
save('replay-result.json',report);print(json.dumps(report),flush=True)
