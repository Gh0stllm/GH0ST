"""One isolated real-engine JIT profile; independent invocations may run together."""
from pathlib import Path
import argparse,hashlib,json,os,platform,re,resource,subprocess,time
assert platform.system()=='Linux'
parser=argparse.ArgumentParser();parser.add_argument('--name',required=True);parser.add_argument('--guest',required=True);parser.add_argument('--sha256',required=True);args=parser.parse_args()
assert re.fullmatch('[A-Za-z0-9_.-]{1,80}',args.name) and args.name not in ['.','..'];assert re.fullmatch('[0-9a-f]{64}',args.sha256)
r=Path('/root/gl3-aot-jit');d=r/'profiles'/args.name;d.mkdir(parents=True,exist_ok=False)
guest=Path(args.guest);binary=r/'source/target/release/jit';comp=Path('/root/bounded-restore/machine-inputs/gl3aot.wasm');inp=Path('/root/terminal-acceptance/evidence/terminal-input.json');sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
tool=sha(binary);assert tool==json.loads((r/'evidence-metrics-v3/build-result.json').read_text())['jitSHA256'];assert sha(guest)==args.sha256;assert sha(comp)=='b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555';assert sha(inp)=='bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90'
manifest=json.loads(Path('/root/terminal-acceptance/evidence/terminal-input-manifest.json').read_text());expected=manifest['expectedEndState'];reference=json.loads(Path('/root/bounded-restore/evidence/native-guard-comparison.json').read_text())['actualHeader'];env={**os.environ,'GL3_AOT_COMPANION':str(comp),'GL3_AOT_JIT_REPORT':str(d/'jit-state.json'),'RAYON_NUM_THREADS':'4','MALLOC_ARENA_MAX':'2'}
cmd=[str(binary),'--binary',str(guest),'--debug','--require-success','json','--inputs',str(inp)];start=time.monotonic();peak_rss=0
def limits():resource.setrlimit(resource.RLIMIT_STACK,(128*1024**2,128*1024**2))
with (d/'jit.log').open('w') as log:
 proc=subprocess.Popen(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,preexec_fn=limits);(d/'process.json').write_text(json.dumps({'pid':proc.pid,'args':cmd,'startedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},indent=2)+'\n')
 with (d/'resources.csv').open('w') as csv:
  csv.write('seconds,rssKiB,virtualKiB,cpuTicks\n')
  while proc.poll() is None:
   try:
    raw=Path(f'/proc/{proc.pid}/stat').read_text();f=raw[raw.rfind(')')+2:].split();rss=int(f[21])*os.sysconf('SC_PAGE_SIZE')//1024;peak_rss=max(peak_rss,rss);csv.write(f'{time.monotonic()-start:.3f},{rss},{int(f[20])//1024},{int(f[11])+int(f[12])}\n');csv.flush()
   except FileNotFoundError:pass
   time.sleep(.25)
 code=proc.wait()
seconds=time.monotonic()-start;(d/'exit.json').write_text(json.dumps({'exitCode':code,'seconds':seconds})+'\n');host=json.loads((d/'jit-state.json').read_text()) if (d/'jit-state.json').exists() else {};actual=host.get('actual');same=actual==expected and host.get('guestError') is None;unchanged=sha(guest)==args.sha256 and sha(comp)=='b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555' and sha(binary)==tool;gas_bound=same and actual['BlockHash']==reference['blockHash'];go_peak=host.get('goLinearMemoryPeakBytes');c_peak=host.get('companionLinearMemoryPeakBytes')
result={'passed':code==0 and same and unchanged and gas_bound and isinstance(go_peak,int) and isinstance(c_peak,int),'name':args.name,'exitCode':code,'totalSeconds':seconds,'guestSeconds':host.get('runtimeSeconds'),'actual':actual,'expected':expected,'allFourGlobalFieldsMatch':same,'GoLinearMemoryPeakBytes':go_peak,'CLinearMemoryPeakBytes':c_peak,'linearPeakMethod':'Final size of non-shrinking WebAssembly linear memory, separately for Go and C','sampledHostRssPeakKiB':peak_rss,'rssSamplingSeconds':.25,'guestBytes':guest.stat().st_size,'guestSHA256':args.sha256,'companionBytes':comp.stat().st_size,'companionSHA256':sha(comp),'inputBytes':inp.stat().st_size,'inputSHA256':sha(inp),'JitSHA256':tool,'artifactsUnchangedAfterReplay':unchanged,'nativeHeaderGasUsed':reference['gasUsed'],'gasBoundByComputedBlockHash':gas_bound,'independentJitGasMeter':False,'guestError':host.get('guestError'),'scope':'Diagnostic terminal-block JIT execution with real unchanged engine; no interpreter/OSP or complete-search replay acceptance','allExecutionOnRunpod':True,'enginePolicyChanged':False,'interpreterOrOSPAcceptance':False}
(d/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
