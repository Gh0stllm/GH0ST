#!/usr/bin/env python3
"""Six-run, validation-only continuous-corpus pilot. No held-out prompts are read."""
import hashlib,json,shutil,subprocess,sys,time
from pathlib import Path
BASE=Path(__file__).resolve().parents[1]
OUT=BASE/'runs/continuous-sweep'
RUNNER=BASE/'training/train_voice.py'
OUT.mkdir(parents=True,exist_ok=True)
corpus=OUT/'corpus-original';corpus.mkdir(exist_ok=True)
files=[]
for name in ['train.jsonl','validation.jsonl','test.jsonl']:
 source=BASE/'data'/name;destination=corpus/name
 if destination.exists() and destination.read_bytes()!=source.read_bytes():raise ValueError('Refusing to replace frozen sweep corpus')
 if not destination.exists():shutil.copyfile(source,destination)
 files.append({'file':name,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()})
summary={'status':'RUNNING','selection':'Lowest validation loss only; no held-out prompt generations used.','corpus':files,'runner_sha256':hashlib.sha256(RUNNER.read_bytes()).hexdigest(),'runs':[]}
start=time.monotonic()
for mode in ['all','top2']:
 for lr in ['1e-5','3e-5','1e-4']:
  name=mode+'-lr'+lr;output=OUT/name
  command=[sys.executable,str(RUNNER),'--corpus',str(corpus),'--output',str(output),'--continuous-corpus','--trainable-mode',mode,'--learning-rate',lr,'--steps','400','--batch-size','16','--block-size','128','--eval-every','25','--patience','5','--device','cpu','--threads','2']
  print(json.dumps({'starting':name}),flush=True)
  subprocess.run(command,check=True)
  report=json.loads((output/'training-report.json').read_text())
  summary['runs'].append({'name':name,'path':str(output),'mode':mode,'learning_rate':float(lr),'best_step':report['best_step'],'best_validation_loss':report['best_validation_loss'],'baseline_validation_loss':report['baseline_validation']['loss_nats_per_token'],'completed_steps':report['completed_steps'],'early_stopped':report.get('early_stopped',False),'projection_counts':report['projection_counts'],'trainable_parameters':report['architecture']['trainable_parameters'],'training_report_sha256':hashlib.sha256((output/'training-report.json').read_bytes()).hexdigest()})
  (OUT/'sweep-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
summary['selected']=min(summary['runs'],key=lambda r:r['best_validation_loss'])
summary['status']='COMPLETE';summary['elapsed_seconds']=time.monotonic()-start
(OUT/'sweep-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2),flush=True)
