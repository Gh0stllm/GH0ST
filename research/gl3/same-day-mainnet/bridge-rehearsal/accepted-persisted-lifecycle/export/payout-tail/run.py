"""Bounded copied closed-DB payout continuation; private Runpod only."""
from pathlib import Path
import json,subprocess,socket,os,time,shutil,hashlib,signal,urllib.request
B=Path('/workspace/gl3/same-day-mainnet/bridge-rehearsal');S=B/'final-fee-profile-v4/evidence';R=B/'payout-resume';R.mkdir(exist_ok=True)
assert socket.gethostname()=='cc91695a75f7';assert not(R/'result.json').exists()
report=json.loads((S/'base-withdrawal-report.json').read_text());assert report['ownedProcessesRemaining']==0
assert all(not Path('/proc',str(x['pid'])).exists()for x in report['ownedProcessExits'])
os.sched_setaffinity(0,set(sorted(os.sched_getaffinity(0))[-2:]));os.nice(10)
def port():
 with socket.socket()as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def rpc(url,m,p=[]):
 req=urllib.request.Request(url,data=json.dumps({'jsonrpc':'2.0','id':1,'method':m,'params':p}).encode(),headers={'content-type':'application/json'});v=json.load(urllib.request.urlopen(req,timeout=3));assert'error'not in v,v;return v['result']
def wait(url,n):
 for i in range(200):
  try:
   if int(rpc(url,'eth_chainId'),16)==n:return
  except Exception:pass
  time.sleep(.1)
 raise RuntimeError('Read-only copied node startup deadline')
def filehash(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for v in iter(lambda:f.read(1048576),b''):h.update(v)
 return h.hexdigest()
def hashes():
 return{str(x.relative_to(S)):filehash(x)for folder in ['geth-data','parent-chain','parent-config','child-chain','child-config']for x in(S/folder).rglob('*')if x.is_file()and x.name!='LOCK'}
initial=hashes();(R/'origin-file-hashes.json').write_text(json.dumps(initial,indent=2)+'\n');owned=[];fds=[];urls={}
try:
 for name in ['geth-data','parent-chain','parent-config','child-chain','child-config']:shutil.copytree(S/name,R/name)
 copied={str(x.relative_to(R)):filehash(x)for folder in ['geth-data','parent-chain','parent-config','child-chain','child-config']for x in(R/folder).rglob('*')if x.is_file()and x.name!='LOCK'};assert copied==initial;(R/'copied-origin-verified.json').write_text(json.dumps({'passed':True,'fileCount':len(copied),'sourceHashesEqualCopiedBeforeOpen':True}));
 gp,ap=port(),port();glog=(R/'geth.log').open('w');fds.append(glog);g=subprocess.Popen(['/workspace/gl3/durable/bin/geth','--cache','16','--dev','--dev.period','1','--datadir',str(R/'geth-data'),'--http','--http.addr','127.0.0.1','--http.port',str(gp),'--http.api','eth,net,web3','--authrpc.addr','127.0.0.1','--authrpc.port',str(ap),'--port','0','--nodiscover','--maxpeers','0','--ipcdisable','--nat','none'],stdout=glog,stderr=subprocess.STDOUT,start_new_session=False);owned.append(g);url='http://127.0.0.1:'+str(gp);wait(url,1337)
 for label,id in [('parent',4663),('child',4663001)]:
  c=json.loads((S/(label+'.private.json')).read_text());p=port();c['parent-chain']['connection']['url']=url;c['http']['port']=p;c['ipc']['path']='';c['persistent']['chain']=str(R/(label+'-chain'));c['persistent']['global-config']=str(R/(label+'-config'));c['node']['staker']={'enable':False};
  if label=='child':c['node']['sequencer']=False;c['execution']['sequencer']['enable']=False;c['execution']['forwarding-target']='null';c['node']['batch-poster']={'enable':False};c['node']['delayed-sequencer']['enable']=False
  f=R/(label+'.json');f.write_text(json.dumps(c));f.chmod(0o600);log=(R/(label+'.log')).open('w');fds.append(log);n=subprocess.Popen(['/workspace/gl3/durable/bin/nitro','--conf.file',str(f)],cwd='/workspace/gl3/durable/nitro-clean',stdout=log,stderr=subprocess.STDOUT,start_new_session=False);owned.append(n);url='http://127.0.0.1:'+str(p);wait(url,id);urls[label]=url
 query=R/'query-config.json';query.write_text(json.dumps({'url':urls['parent'],'childURL':urls['child'],'source':str(S)}));at=time.monotonic();f=(R/'query.log').open('w');p=subprocess.Popen(['node',str(R/'query.mjs'),str(query),str(R/'result.json')],stdout=f,stderr=subprocess.STDOUT);_,status,usage=os.wait4(p.pid,0);p.returncode=os.waitstatus_to_exitcode(status);f.close();(R/'actual-query-exit.json').write_text(json.dumps({'actualWait4':True,'exitCode':p.returncode,'seconds':time.monotonic()-at,'maxRSSKiB':usage.ru_maxrss}));assert p.returncode==0;print((R/'result.json').read_text())
finally:
 exits=[]
 for p in reversed(owned):
  if p.poll()is None:
   p.send_signal(signal.SIGINT)
   try:p.wait(timeout=8)
   except subprocess.TimeoutExpired:p.kill();p.wait(timeout=5)
  exits.append({'pid':p.pid,'actualExitCode':p.returncode})
 for f in fds:f.close()
 (R/'cleanup.json').write_text(json.dumps({'exits':exits,'allStopped':all(not Path('/proc',str(x['pid'])).exists()for x in exits)}))

 final=hashes();(R/'origin-file-hashes-after.json').write_text(json.dumps(final,indent=2)+'\n');(R/'source-DB-unchanged.json').write_text(json.dumps({'passed':final==initial,'fileCount':len(initial),'allSourceFileHashesUnchanged':final==initial}));assert final==initial
