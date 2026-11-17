"""Replay frozen control/candidate with unchanged C bytes; diagnostic JIT only."""
from pathlib import Path
import hashlib,json,os,platform,re,resource,subprocess,time
assert platform.system()=='Linux'
r=Path('/root/gl3-aot-jit');out=r/'evidence';binary=r/'source/target/release/jit'
sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
inp=Path('/root/terminal-acceptance/evidence/terminal-input.json');comp=Path('/root/bounded-restore/machine-inputs/gl3aot.wasm')
assert sha(inp)=='bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90'
assert sha(comp)=='b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555'
assert json.loads((out/'cross-memory-tests-exit.json').read_text())['exitCode']==0
expected=json.loads(Path('/root/terminal-acceptance/evidence/terminal-input-manifest.json').read_text())['expectedEndState']
reference=json.loads(Path('/root/bounded-restore/evidence/native-guard-comparison.json').read_text())['actualHeader']
specs=[('unchanged-failed-control',Path('/root/bounded-restore/replay-guard.wasm'),'1edf3aa423444d55794c5347cba4b8f93f697981d69d99dd6439a7b18cd40670'),('scheduled-candidate',Path('/root/bounded-restore/scheduled-candidate/replay.wasm'),'cb3e018ec606d1309f99eaf7c44aeffd5bfc46426ad82cbd802552641b093ac0')]
for name,guest,digest in specs:
 d=out/name;d.mkdir(exist_ok=False);assert sha(guest)==digest
 env={**os.environ,'GL3_AOT_COMPANION':str(comp),'GL3_AOT_JIT_REPORT':str(d/'jit-state.json'),'RAYON_NUM_THREADS':'4','MALLOC_ARENA_MAX':'2'}
 cmd=[str(binary),'--binary',str(guest),'--debug','--require-success','json','--inputs',str(inp)]
 start=time.monotonic()
 def limits():resource.setrlimit(resource.RLIMIT_STACK,(128*1024**2,128*1024**2))
 with (d/'jit.log').open('w') as log:
  proc=subprocess.Popen(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,preexec_fn=limits)
  (d/'process.json').write_text(json.dumps({'pid':proc.pid,'args':cmd,'startedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},indent=2)+'\n')
  with (d/'resources.csv').open('w') as res:
   res.write('seconds,rssKiB,virtualKiB,cpuTicks\n')
   while proc.poll() is None:
    try:
     raw=Path(f'/proc/{proc.pid}/stat').read_text();fields=raw[raw.rfind(')')+2:].split();res.write(f'{time.monotonic()-start:.3f},{int(fields[21])*os.sysconf("SC_PAGE_SIZE")//1024},{int(fields[20])//1024},{int(fields[11])+int(fields[12])}\n');res.flush()
    except FileNotFoundError:pass
    time.sleep(.5)
  code=proc.wait()
 seconds=time.monotonic()-start;(d/'exit.json').write_text(json.dumps({'exitCode':code,'seconds':seconds},indent=2)+'\n')
 host=json.loads((d/'jit-state.json').read_text()) if (d/'jit-state.json').exists() else None
 header=None
 with (d/'jit.log').open(errors='replace') as log:
  for line in log:
   if 'GL3_REPLAY_HEADER ' in line:
    try:header=json.loads(line.split('GL3_REPLAY_HEADER ',1)[1])
    except json.JSONDecodeError:pass
 actual=host.get('actual') if host else None;state_equal=actual==expected and host.get('guestError') is None if host else False
 gas_bound=state_equal and actual['BlockHash']==reference['blockHash']
 unchanged=sha(guest)==digest and sha(comp)=='b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555'
 result={'passed':code==0 and state_equal and gas_bound and unchanged,'scope':'Diagnostic native Wasmer JIT execution of exact guest+C bytes; not WAVM interpreter or OSP acceptance','exitCode':code,'seconds':seconds,'actual':actual,'expected':expected,'allFourGlobalFieldsMatch':state_equal,'gasUsedInMatchingNativeHeader':reference['gasUsed'],'gasBoundByIdenticalComputedBlockHash':gas_bound,'guestReportedHeader':header,'gasEvidence':'Matching the computed full block hash binds its gas field to the separately verified native header; not a separate JIT gas meter','guestSHA256':digest,'companionSHA256':sha(comp),'JitSHA256':sha(binary),'inputSHA256':sha(inp),'artifactsUnchangedAfterReplay':unchanged,'allExecutionOnRunpod':True,'enginePolicyChanged':False,'interpreterOrOSPAcceptance':False}
 (d/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(name,json.dumps(result),flush=True)
