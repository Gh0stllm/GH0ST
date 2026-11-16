"""Disposable Linux CPU replay comparison; no chain credentials or broadcasts."""
from pathlib import Path
import concurrent.futures,hashlib,json,os,platform,re,resource,subprocess,time
HERE=Path(__file__).resolve().parent
manifest=json.loads((HERE/'bundle.json').read_text())
for name,sha in manifest['artifacts'].items():
 assert hashlib.sha256((HERE/name).read_bytes()).hexdigest()==sha, 'artifact mismatch '+name
prover=HERE/'source/target/release/prover'
output=HERE/'results';output.mkdir(exist_ok=True)
def system_info():
 cpu=next((l.split(':',1)[1].strip() for l in Path('/proc/cpuinfo').read_text().splitlines() if l.startswith('model name')),'unknown')
 limits={}
 for name in ['cpu.max','memory.max']:
  p=Path('/sys/fs/cgroup')/name
  if p.exists():limits[name]=p.read_text().strip()
 return {'platform':platform.platform(),'cpuModel':cpu,'visibleCPUs':os.cpu_count(),'affinity':len(os.sched_getaffinity(0)),'limits':limits}
def case(name,machine,input_file):
 start=time.monotonic();logfile=output/(name+'.log')
 args=[str(prover),str(HERE/machine),'--json-inputs',str(HERE/input_file),'--proving-interval','100000000','--require-success','-o',str(output/(name+'-proofs.json'))]
 with logfile.open('w') as log:
  try:
   p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'RAYON_NUM_THREADS':'2'},timeout=4200)
   code=p.returncode
  except subprocess.TimeoutExpired:code=124
 text=re.sub(r'\x1b\[[0-9;]*m','',logfile.read_text())
 expected=json.loads((HERE/input_file).read_text())['ExpectedEndState']
 m=re.search(r'End GlobalState:\s+BlockHash: (0x[0-9a-f]{64})\s+SendRoot: (0x[0-9a-f]{64})\s+Batch: (\d+)\s+PosInBatch: (\d+)',text)
 match=m is not None and m.groups()==(expected['BlockHash'],expected['SendRoot'],str(expected['Batch']),str(expected['PosInBatch']))
 passed=code==0 and match and 'End machine status: Finished' in text and 'Computed state matches the expected one' in text
 result={'name':name,'passed':passed,'exitCode':code,'seconds':time.monotonic()-start,'allFourGlobalStateFieldsMatch':match,'moduleRoot':manifest['roots'][machine],'inputSHA256':manifest['artifacts'][input_file],'expectedEnd':expected,'completedEntire24mWAVMMove':False,'fullBoLDDispute':False}
 (output/(name+'.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True);return result
started=time.monotonic();print(json.dumps({'system':system_info(),'cases':'two independent corrected-block replays with identical input and unchanged engine; eager and lazy wrappers','publicDeployment':False,'realChainSpend':0}),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 jobs=[pool.submit(case,'first-eager','machine-eager.br','input-first.json'),pool.submit(case,'first-lazy','machine-lazy.br','input-first.json')]
 results=[j.result() for j in jobs]
report={'scope':'paired Linux CPU full WAVM block replay, same captured input; concurrency affects timing','system':system_info(),'results':results,'passed':all(r['passed'] for r in results),'seconds':time.monotonic()-started,'maxChildRSSKiB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,'publicDeployment':False,'realChainSpend':0}
(output/'summary.json').write_text(json.dumps(report,indent=2)+'\n');print('GL3_RUN_FINISHED '+json.dumps(report),flush=True)
raise SystemExit(0 if report['passed'] else 1)
