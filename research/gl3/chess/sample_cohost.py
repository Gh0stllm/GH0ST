"""Sample the held local node/prover overlap; never claim a whole-life RAM cap."""
from pathlib import Path
import csv,json,subprocess,sys,time

HERE=Path(__file__).resolve().parent
OUT=HERE/'.cache/cohost24'
prover_pid=int(sys.argv[1]);assert prover_pid>0
deadline=time.monotonic()+180
while not (OUT/'hold-ready.json').exists():
 if time.monotonic()>deadline:raise RuntimeError('no live node ready')
 time.sleep(1)
node_pid=json.loads((OUT/'hold-ready.json').read_text())['pid']
rows=[];start=time.monotonic()
with (OUT/'samples.csv').open('w') as f:
 w=csv.writer(f,lineterminator='\n');w.writerow(['elapsedSeconds','nodeFixturePID','nodeFixtureRSSKiB','proverRSSKiB','localParentRSSKiB','combinedRSSKiB','nodeHoldReady'])
 while time.monotonic()-start<60:
  raw=subprocess.check_output(['ps','-axo','pid=,ppid=,rss=,command='],text=True);procs={}
  for line in raw.splitlines():
   v=line.strip().split(None,3)
   if len(v)==4:procs[int(v[0])]=(int(v[1]),int(v[2]))
  if node_pid not in procs:break
  nr=procs[node_pid][1];pr=procs.get(prover_pid,(0,0))[1];parent=sum(v[1] for v in procs.values() if v[0]==node_pid)
  row=[round(time.monotonic()-start,3),node_pid,nr,pr,parent,nr+pr+parent,1];rows.append(row);w.writerow(row);f.flush();time.sleep(1)
(OUT/'release-hold').touch(mode=0o600)
report={'scope':'Bounded post-recording live node/game plus actual prover overlap; not whole node lifecycle, hard24GB limit or Linux acceptance','samples':len(rows),'heldNodeFixtureObservedPeakGiB':max((x[2] for x in rows),default=0)/1024**2,'overlapCombinedObservedPeakGiB':max((x[5] for x in rows if x[3]>0),default=0)/1024**2,'overlapSamples':sum(x[3]>0 for x in rows),'publicDeployment':False,'realSpend':0}
(OUT/'resource-screen.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
