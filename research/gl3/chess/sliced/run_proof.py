"""Run the complete recorded step proof without competing with the old reference.

The reference process is only suspended while this owned experiment runs; its
machine state is retained and it resumes even if this proof fails.
"""
from pathlib import Path
import argparse,json,os,signal,subprocess,time
HERE=Path(__file__).resolve().parent;CHESS=HERE.parent;REPO=CHESS.parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--reference-pid',type=int,default=0);options=parser.parse_args()
OUT=HERE/'.cache/blocks';old_pid=options.reference_pid;old_command=''
try:
 if old_pid>0:old_command=subprocess.check_output(['ps','-p',str(old_pid),'-o','command='],text=True).strip()
except subprocess.CalledProcessError:pass
owned='research/gl3/chess/.cache/machine/machine.v2.wavm.br' in old_command and '--json-inputs research/gl3/chess/.cache/block/input.json' in old_command
def interrupted(_sig,_frame):raise SystemExit(130)
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
started=time.time();report={'scope':'Complete sliced block interpreter replay; no BoLD dispute implied','referenceTemporarilySuspended':owned,'completed':False,'publicDeployment':False,'realSpend':0}
if owned:os.kill(old_pid,signal.SIGSTOP)
try:
 with (OUT/'prover.log').open('w') as log:
  args=[REPO/'research/chess/l3/nitro/.cache/stylus-target/release/prover',CHESS/'.cache/machine-sliced/machine.v2.wavm.br','--json-inputs',OUT/'input.json','--proving-interval','1000000000','--require-success','-o',OUT/'full-proofs.json']
  p=subprocess.run([str(x) for x in args],stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'RAYON_NUM_THREADS':'2'})
 report['exitCode']=p.returncode;report['completed']=p.returncode==0
finally:
 if owned:
  try:
   command=subprocess.check_output(['ps','-p',str(old_pid),'-o','command='],text=True).strip()
   if command==old_command:os.kill(old_pid,signal.SIGCONT)
  except ProcessLookupError:pass
  except subprocess.CalledProcessError:pass
 report['seconds']=time.time()-started
 (OUT/'proof-run.json').write_text(json.dumps(report,indent=2)+'\n')
