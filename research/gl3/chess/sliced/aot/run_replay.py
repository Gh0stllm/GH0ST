"""Freeze one isolated AOT machine and replay a complete corrected block.

Optionally suspend only the known owned R23 reference experiment while running,
then restore its original running state in finally. No live service is touched.
"""
from pathlib import Path
import argparse, hashlib, json, os, re, shutil, signal, subprocess, time
HERE=Path(__file__).resolve().parent;CHESS=HERE.parents[1];REPO=CHESS.parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--next',action='store_true');parser.add_argument('--reference-pid',type=int,default=0);options=parser.parse_args()
CACHE=HERE/'.cache';OUT=CACHE/('proof-next' if options.next else 'proof-first');OUT.mkdir(exist_ok=True)
assert not (OUT/'proof-run.json').exists(), 'refuse to overwrite a completed experiment'
source=CHESS/'sliced/.cache/blocks-cachefix'/('input-next.json' if options.next else 'input.json')
shutil.copyfile(source,OUT/'input.json')
machine=CHESS/'.cache/machine-sliced-aot';binaries=CHESS/'.cache/bin-sliced-aot'
for name in ['machine.v2.wavm.br','module-root.txt']:shutil.copyfile(machine/name,OUT/name)
for name in ['replay.wasm','gl3aot.wasm']:shutil.copyfile(binaries/name,OUT/name)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest={'moduleRoot':(OUT/'module-root.txt').read_text().strip(),'canonicalReplayWasm':str(OUT/'replay.wasm'),'canonicalReplayWasmSHA256':sha(OUT/'replay.wasm'),'companionWasm':str(OUT/'gl3aot.wasm'),'companionSHA256':sha(OUT/'gl3aot.wasm'),'inputSHA256':sha(OUT/'input.json'),'scope':'complete corrected recorded block, isolated AOT proof machine; not an entire24m WAVM move or BoLD dispute','interval':100000000}
(OUT/'proof-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
reference='';suspended=False;p=None
if options.reference_pid:
 try:
  reference=subprocess.check_output(['ps','-p',str(options.reference_pid),'-o','command='],text=True).strip()
  state=subprocess.check_output(['ps','-p',str(options.reference_pid),'-o','stat='],text=True).strip()
  assert '/.cache/machine-sliced/machine.v2.wavm.br' in reference and '/sliced/.cache/blocks/input.json' in reference,'not the owned R23 reference'
  if 'T' not in state:os.kill(options.reference_pid,signal.SIGSTOP);suspended=True
 except subprocess.CalledProcessError:reference=''
def interrupted(_sig,_frame):
 if p is not None and p.poll() is None:p.terminate()
 raise SystemExit(130)
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
start=time.monotonic();report={**manifest,'completed':False,'referenceTemporarilySuspended':suspended,'publicDeployment':False,'realSpend':0}
try:
 with (OUT/'prover.log').open('w') as log:
  args=[REPO/'research/chess/l3/nitro/.cache/stylus-target/release/prover',OUT/'machine.v2.wavm.br','--json-inputs',OUT/'input.json','--proving-interval',str(manifest['interval']),'--require-success','-o',OUT/'full-proofs.json']
  p=subprocess.Popen([str(a) for a in args],stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'RAYON_NUM_THREADS':'2'})
  (OUT/'process.json').write_text(json.dumps({'runnerPID':os.getpid(),'proverPID':p.pid},indent=2)+'\n')
  report['exitCode']=p.wait()
 log=re.sub(r'\x1b\[[0-9;]*m','',(OUT/'prover.log').read_text());expected=json.loads((OUT/'input.json').read_text())['ExpectedEndState']
 actual=re.search(r'End GlobalState:\s+BlockHash: (0x[0-9a-f]{64})\s+SendRoot: (0x[0-9a-f]{64})\s+Batch: (\d+)\s+PosInBatch: (\d+)',log)
 report['completed']=report['exitCode']==0 and 'End machine status: Finished' in log and 'Computed state matches the expected one' in log and actual is not None and actual.groups()==(expected['BlockHash'],expected['SendRoot'],str(expected['Batch']),str(expected['PosInBatch']))
 report['allFourGlobalStateFieldsMatch']=report['completed'];report['expectedEnd']=expected
 assert report['completed'],'complete expected replay end not reached'
finally:
 if suspended:
  try:
   command=subprocess.check_output(['ps','-p',str(options.reference_pid),'-o','command='],text=True).strip()
   if command==reference:os.kill(options.reference_pid,signal.SIGCONT)
  except (ProcessLookupError,subprocess.CalledProcessError):pass
 report['seconds']=time.monotonic()-start
 (OUT/'proof-run.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2),flush=True)
