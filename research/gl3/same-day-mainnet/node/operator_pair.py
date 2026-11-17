#!/usr/bin/env python3
"""Hash-gated, loopback-only private GL3 bootstrap supervisor. No wallet import."""
import argparse,base64,ctypes,fcntl,hashlib,hmac,json,os,pathlib,signal,stat,subprocess,time,urllib.request

ROOT='0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97'
NODE='/workspace/gl3/durable/bin/nitro';BACKEND='/workspace/gl3/same-day-mainnet/node/bin/nitro-val'
PINS={NODE:'d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed',BACKEND:'3e95c6e37739b01162a01f1ff82c2646916eecf9ec7286deae9a9fdb67fe150f','/workspace/gl3/same-day-mainnet/node/bin/jit':'ae83e777fc05aad03f6ab929da74444b22839e4000759c30bf82774123967703'}
PINS.update({'/workspace/gl3/durable/machines/latest/replay.wasm':'9d6d28c4810cfc220b5fdbc4a7a675ee333dc86a5e998a6380c1c62a59b260af','/workspace/gl3/durable/machines/latest/machine.v2.wavm.br':'791073b628dee37ed5faccb43841dc317dc24e21bd0bb0b7d38c08e652cd78a5','/workspace/gl3/durable/machines/latest/module-root.txt':'31ea9746e168fe49059a1bf7a49509a2827d48a07444cc97618d1b0c01351306'})
class GateError(Exception):pass
def need(v,code):
 if not v:raise GateError(code)
def digest(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def load(p):return json.loads(pathlib.Path(p).read_text())
def metadata(p,private=False):
 p=pathlib.Path(p);s=p.lstat();need(stat.S_ISREG(s.st_mode) and not p.is_symlink() and s.st_uid==os.getuid(),'file_metadata_refused');need(s.st_mode&(0o077 if private else 0o022)==0,'file_permissions_refused')
def bound(record):
 p=pathlib.Path(record['path']);need(p.is_absolute() and p.resolve().is_relative_to('/workspace/gl3'),'bundle_path_refused');metadata(p);need(digest(p)==record['SHA256'],'bundle_hash_mismatch');return p
def rpc(url,method,params):
 req=urllib.request.Request(url,data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(),headers={'content-type':'application/json'})
 with urllib.request.urlopen(req,timeout=2) as r:j=json.load(r)
 need(j.get('jsonrpc')=='2.0' and j.get('id')==1 and not j.get('error') and 'result'in j,'health_rpc_failed');return j['result']
def validate(bundle_path):
 b=load(bundle_path);need(b.get('schema')=='gh0st.gl3.private-service-bundle.v1','bundle_schema')
 # Only public receipts are read before explicit operator approval.
 approval=load(bound(b['approval']));need(approval.get('operatorReviewed') is True and approval.get('privateBootstrapStartApproved') is True,'private_start_not_approved');need(approval.get('licenseConfirmed') is True and approval.get('boundedFundingApproved') is True,'license_or_funding_not_approved')
 need(approval.get('supervisorSourceSHA256')==digest(__file__),'supervisor_source_unreviewed')
 records={k:bound(b[k]) for k in ['profile','renderReceipt','deploymentManifest','fundingManifest','nodeConfig','backendConfig','chainInfo','genesis']}
 for k,p in records.items():need(approval.get(k+'SHA256')==digest(p),'approval_binding_mismatch:'+k)
 profile=load(records['profile']);need(profile['chain']['parentChainId']==4663 and profile['chain']['childChainIdProposal']==4663001,'chain_profile_mismatch');need(profile['runtime']['moduleRoot']==ROOT and profile['runtime']['customSTF'] is False,'machine_profile_mismatch')
 render=load(records['renderReceipt']);need(render.get('schema')=='gh0st.gl3.operator-config-rendered.v1','render_schema')
 for k,key in [('nodeConfig','nodeEffectiveSHA256'),('backendConfig','backendEffectiveSHA256'),('chainInfo','chainInfoSHA256'),('genesis','genesisSHA256')]:need(render.get(key)==digest(records[k]),'render_binding_mismatch:'+k)
 for k in ['deploymentManifest','fundingManifest']:need(load(records[k]).get('passed') is True,'receipt_manifest_not_passed:'+k)
 # Root executes this approved path; generated TEST configurations are used in tests.
 for k in ['nodeConfig','backendConfig']:metadata(records[k],private=True)
 node=load(records['nodeConfig']);backend=load(records['backendConfig'])
 need(node['chain']['id']==4663001 and node['parent-chain']['id']==4663,'effective_chain_mismatch');need(node['init']['genesis-json-file']==str(records['genesis']) and node['init']['validate-genesis-assertion'] is True and node['ensure-rollup-deployment'] is True,'strict_genesis_required')
 need(node['persistent']['chain'].startswith('/workspace/gl3/mainnet/data/') and node['persistent']['pebble']['sync-mode'] is True,'durable_sync_required')
 for c in [node,backend]:
  for section in ['http','ws','auth']:need(c.get(section,{}).get('addr','') in ['','127.0.0.1','localhost','::1'],'non_loopback_listener_refused')
 need(backend['validation']['api-auth'] is True and backend['validation']['api-public'] is False,'private_backend_required');need(backend['validation']['wasm']['allowed-wasm-module-roots']==[ROOT] and backend['validation']['wasm']['root-path']=='/workspace/gl3/durable/machines','backend_root_mismatch');need(backend['validation']['jit']['jit-path']=='/workspace/gl3/same-day-mainnet/node/bin/jit','jit_path_mismatch')
 need(node['node']['block-validator']['enable'] is True and node['node']['block-validator']['current-module-root']==ROOT,'real_block_validator_required');need(node['node']['bold']['enable-fast-confirmation'] is True and node['node']['staker']['enable-fast-confirmation'] is True,'reviewed_fast_profile_required')
 need(node['execution']['rpc']['tx-fee-cap']==1000,'native_GH0ST_rpc_fee_cap_mismatch');need(node['node']['block-validator'].get('failure-is-fatal',True) is True,'validation_failure_must_stop')
 need(not node['node'].get('dangerous',{}).get('no-l1-listener',False),'parent_listener_bypass_refused');need(not node['node']['staker'].get('dangerous',{}).get('without-block-validator',False),'block_validator_bypass_refused')
 jwt=pathlib.Path(backend['auth']['jwtsecret']);need(jwt.resolve().is_relative_to('/workspace/gl3/mainnet'),'jwt_path_refused');metadata(jwt,True)
 client=node['node']['block-validator']['validation-server'];need(client['jwtsecret']==str(jwt) and client['url']=='ws://127.0.0.1:'+str(backend['auth']['port']),'backend_client_pair_mismatch')
 for p,h in PINS.items():need(digest(p)==h,'binary_hash_mismatch')
 state=pathlib.Path(b['stateDir']);need(state.is_absolute() and state.resolve().is_relative_to('/workspace/gl3/mainnet'),'state_path_refused')
 return {'bundle':b,'approval':approval,'profile':profile,'node':node,'backend':backend,'records':records,'jwtPath':jwt,'stateDir':state,'publicActivationApproved':approval.get('publicActivationApproved') is True}

class PairSupervisor:
 """Two owned service groups, bounded pair restarts and exact child wait results."""
 def __init__(self,commands,state_dir,check,ready,*,max_restarts=3,backoff=2,grace=20,poll=.2,start_timeout=60):
  self.commands=commands;self.state=pathlib.Path(state_dir);self.check=check;self.ready=ready;self.max_restarts=max_restarts;self.backoff=backoff;self.grace=grace;self.poll=poll;self.start_timeout=start_timeout;self.stop_signal=None;self.children=[];self.events=[];self.log_prefix=str(time.time_ns())+'-'+str(os.getpid())
 def request_stop(self,s,*_):self.stop_signal=s
 def event(self,kind,**fields):
  d={'event':kind,'UTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),**fields};self.events.append(d)
  with (self.state/'lifecycle.jsonl').open('a') as f:os.chmod(f.name,0o600);f.write(json.dumps(d)+'\n')
 def private_output(self,attempt,role):
  need(role in ['backend','node'],'private_log_role_refused')
  s=self.state.lstat();need(stat.S_ISDIR(s.st_mode) and not self.state.is_symlink() and s.st_uid==os.getuid() and s.st_mode&0o077==0,'private_log_directory_refused')
  files=[];paths={}
  try:
   for stream in ['stdout','stderr']:
    p=self.state/(self.log_prefix+'-attempt-'+str(attempt).zfill(2)+'-'+role+'.'+stream+'.log')
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);f=os.fdopen(fd,'wb',buffering=0);files.append(f)
    s=os.fstat(f.fileno());need(stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_mode&0o077==0 and s.st_nlink==1,'private_log_file_refused');paths[stream]=str(p)
   return files,paths
  except Exception:
   for f in files:f.close()
   raise
 @staticmethod
 def child_init(parent):
  libc=ctypes.CDLL(None,use_errno=True)
  if libc.prctl(1,signal.SIGKILL,0,0,0)!=0 or os.getppid()!=parent:os._exit(125)
 def cleanup(self):
  for label,p in reversed(self.children):
   if p.poll() is None:
    try:os.killpg(p.pid,signal.SIGTERM)
    except ProcessLookupError:pass
  deadline=time.monotonic()+self.grace
  while any(p.poll() is None for _,p in self.children) and time.monotonic()<deadline:time.sleep(self.poll)
  for label,p in reversed(self.children):
   if p.poll() is None:
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
   code=p.wait()
   # Also terminate remaining children in this uniquely owned group.
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   self.event('service_exit',role=label,pid=p.pid,actualExitCode=code)
  self.children=[]
 def run(self):
  self.state.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(self.state,0o700);fd=os.open(self.state/'pair.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:os.close(fd);raise GateError('pair_already_running')
  old={s:signal.signal(s,self.request_stop) for s in [signal.SIGTERM,signal.SIGINT]};result={'passed':False,'status':'NOT_STARTED','attempts':0}
  try:
   for attempt in range(1,self.max_restarts+2):
    if self.stop_signal:break
    result['attempts']=attempt
    try:
     self.check();self.event('attempt_checked',attempt=attempt)
     for label,argv in self.commands:
      if self.stop_signal:break
      self.check();parent=os.getpid();outputs,output_paths=self.private_output(attempt,label)
      try:p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=outputs[0],stderr=outputs[1],start_new_session=True,preexec_fn=lambda:self.child_init(parent),cwd='/workspace/gl3',pass_fds=(fd,))
      finally:
       for f in outputs:f.close()
      self.children.append((label,p));self.event('service_started',role=label,pid=p.pid,attempt=attempt,outputLogs=output_paths)
      started=time.monotonic()
      while not self.stop_signal:
       if any(q.poll() is not None for _,q in self.children):raise GateError('peer_exited_during_start')
       if self.ready(label):break
       if time.monotonic()-started>self.start_timeout:raise GateError('service_readiness_timeout')
       time.sleep(self.poll)
     if self.stop_signal:continue
     self.event('pair_healthy',attempt=attempt)
     failures=0;last=0
     while not self.stop_signal:
      if any(p.poll() is not None for _,p in self.children):raise GateError('peer_exited')
      if time.monotonic()-last>10:
       last=time.monotonic();failures=0 if all(self.ready(label) for label,_ in self.children) else failures+1
       if failures>=3:raise GateError('peer_health_failed')
      time.sleep(self.poll)
    except Exception:
     self.event('pair_failed',attempt=attempt,reason='hash_gate_readiness_or_peer_failure')
    finally:self.cleanup()
    if self.stop_signal:break
    if attempt<=self.max_restarts:
     self.event('pair_restart_wait',attempt=attempt,seconds=min(self.backoff*2**(attempt-1),30));end=time.monotonic()+min(self.backoff*2**(attempt-1),30)
     while not self.stop_signal and time.monotonic()<end:time.sleep(self.poll)
   result.update(passed=self.stop_signal is not None,status='STOPPED_BY_OPERATOR' if self.stop_signal else 'RESTART_BUDGET_EXHAUSTED',requestedSignal=self.stop_signal,ownedTopLevelRemaining=len(self.children))
  finally:
   self.cleanup()
   for s,handler in old.items():signal.signal(s,handler)
   os.close(fd);(self.state/'result.json').write_text(json.dumps(result,indent=2)+'\n');os.chmod(self.state/'result.json',0o600)
  return result

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--bundle',required=True);ap.add_argument('--start',action='store_true');a=ap.parse_args();need(os.uname().nodename=='42456c02ced1','Runpod_only');c=validate(a.bundle)
 if not a.start:print(json.dumps({'readyForPrivateBootstrap':True,'publicActivationApproved':c['publicActivationApproved'],'servicesStarted':False}));return 0
 root=pathlib.Path(__file__).parent;probe=root/'backend-auth-probe.cjs';need(digest(probe)==c['bundle']['backendProbeSHA256']==c['approval']['backendProbeSHA256'],'unreviewed_auth_probe')
 def check():validate(a.bundle)
 def ready(role):
  try:
   if role=='backend':
    r=subprocess.run(['node',str(probe),str(c['jwtPath']),'ws://127.0.0.1:'+str(c['backend']['auth']['port']),ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5);return r.returncode==0
   url='http://127.0.0.1:'+str(c['node']['http']['port']);return int(rpc(url,'eth_chainId',[]),16)==4663001 and rpc(url,'eth_getBlockByNumber',['0x0',False])['hash']==c['profile']['deployment']['canonicalGenesisBlockHashProposal']
  except Exception:return False
 pair=PairSupervisor([('backend',[BACKEND,'--conf.file',str(c['records']['backendConfig'])]),('node',[NODE,'--conf.file',str(c['records']['nodeConfig'])])],c['stateDir'],check,ready);r=pair.run();print(json.dumps(r));return 0 if r['passed'] else 1
if __name__=='__main__':
 try:raise SystemExit(main())
 except GateError as e:print(json.dumps({'readyForPrivateBootstrap':False,'reason':str(e),'servicesStarted':False}));raise SystemExit(1)
 except Exception:print(json.dumps({'readyForPrivateBootstrap':False,'reason':'bundle_or_start_failed','servicesStarted':False}));raise SystemExit(1)
