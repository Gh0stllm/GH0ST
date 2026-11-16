"""Read-only sampled resource monitor for explicitly registered owned processes."""
from pathlib import Path
import json,time,subprocess,sys,os
r=Path(__file__).resolve().parent;session=Path(sys.argv[1]);records=[]
try:
 for _ in range(3600):
  if (session/'STOP_METRICS').exists():break
  targets=json.loads((session/'metrics-targets.json').read_text()) if (session/'metrics-targets.json').exists() else {}
  phase=(session/'metrics-phase.txt').read_text().strip() if (session/'metrics-phase.txt').exists() else 'setup'
  pids=[str(x['pid']) for x in targets.values() if x.get('pid')]
  values={}
  if pids:
   p=subprocess.run(['ps','-o','pid=,rss=,vsz=','-p',','.join(pids)],capture_output=True,text=True)
   for line in p.stdout.splitlines():
    row=line.split()
    if len(row)==3:values[int(row[0])]={'rssKiB':int(row[1]),'vszKiB':int(row[2])}
  records.append({'unixTime':time.time(),'phase':phase,'processes':{name:{'pid':x['pid'],**values[x['pid']]} for name,x in targets.items() if x.get('pid') in values}})
  (session/'metrics-samples.json').write_text(json.dumps({'scope':'Read-only1sec processRSS samples; virtualsize is notphysicalmemory','samples':records},indent=2)+'\n')
  time.sleep(1)
finally:
 summary={}
 targets=json.loads((session/'metrics-targets.json').read_text()) if (session/'metrics-targets.json').exists() else {}
 for name,target in targets.items():
  rows=[(x['phase'],x['processes'][name]['rssKiB']) for x in records if name in x['processes']]
  if not rows:continue
  d=target.get('dataDir');du=subprocess.run(['du','-sk',d],capture_output=True,text=True) if d and Path(d).exists() else None
  summary[name]={'pid':target['pid'],'sampleCount':len(rows),'sampledPeakRSSKiB':max(v for _,v in rows),'idleSamplesRSSKiB':[v for phase,v in rows if phase=='idle'],'dataDirKiB':int(du.stdout.split()[0]) if du and du.returncode==0 else None,'dataDirScope':target.get('scope'),'proverPeakMeasured':False,'LLMLoadIncluded':False}
 (session/'resource-summary.json').write_text(json.dumps({'roles':summary,'sampledPeaksAreNotOSLifetimeMaxima':True,'allLocalOnly':True,'productionServerSizingProven':False},indent=2)+'\n');print(json.dumps({k:{a:b for a,b in v.items() if a!='idleSamplesRSSKiB'} for k,v in summary.items()},indent=2))
