"""Read-only owned private Geth/ordinary CLI identity collector. Runpod only."""
from pathlib import Path
import hashlib,json,os,platform,time
if platform.system()!='Linux':raise RuntimeError('Runpod Linux only')
root=Path(__file__).resolve().parent.parent
started=time.monotonic();attempt=None;seen={}
def proc(pid):
 try:
  raw=Path('/proc',str(pid),'stat').read_text();f=raw[raw.rfind(')')+2:].split();args=Path('/proc',str(pid),'cmdline').read_bytes().split(b'\0');args=[a.decode() for a in args if a]
  return {'PID':pid,'PPID':int(f[1]),'startTicks':f[19],'args':args}
 except (OSError,ValueError):return None
while time.monotonic()-started<1200:
 if attempt is None:
  choices=[p for p in root.glob('attempt-*') if (p/'test-process.json').exists() and not (p/'test-exit.json').exists()]
  if choices:attempt=max(choices,key=lambda p:p.stat().st_mtime)
 if attempt:
  test=json.loads((attempt/'test-process.json').read_text());rows=[proc(int(p.name)) for p in Path('/proc').iterdir() if p.name.isdigit()];rows=[p for p in rows if p];children={test['PID']};changed=True
  while changed:
   changed=False
   for p in rows:
    if p['PPID'] in children and p['PID'] not in children:children.add(p['PID']);changed=True
  for p in rows:
   if p['PID'] in children and p['args'] and Path(p['args'][0]).name in {'nitro','geth'}:
    key=str(p['PID'])+'/'+p['startTicks']
    if key not in seen:
     try:
      with Path('/proc',str(p['PID']),'exe').open('rb') as f:p['executableSHA256']=hashlib.file_digest(f,'sha256').hexdigest()
     except OSError:continue
     p['firstSeenUTC']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());seen[key]=p
  report={'allExecutionOnRunpod':True,'readOnly':True,'signalsSent':0,'testPID':test['PID'],'observed':list(seen.values()),'scope':'Owned descendant process identity observations, not independent chain-state acceptance'}
  out=attempt/'owned-processes.json';tmp=out.with_suffix('.tmp');tmp.write_text(json.dumps(report,indent=2)+'\n');tmp.replace(out)
  if (attempt/'test-exit.json').exists():break
 time.sleep(.1)
if attempt:
 (attempt/'process-observer-exit.json').write_text(json.dumps({'exitCode':0,'seconds':time.monotonic()-started,'deadlineExpired':time.monotonic()-started>=1200,'signalsSent':0},indent=2)+'\n')
