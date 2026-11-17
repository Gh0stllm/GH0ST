#!/usr/bin/env python3
"""Private Runpod-only standard Nitro validator rehearsal; never a mainnet launcher."""
import argparse, copy, hashlib, json, os, pathlib, signal, socket, subprocess, time, urllib.parse

BASE=pathlib.Path('/workspace/gl3/same-day-mainnet/node')
MACHINES='/workspace/gl3/durable/machines'
ROOT='0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97'
PINS={
 '/workspace/gl3/durable/bin/nitro':'d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed',
 str(BASE/'bin/nitro-val'):'3e95c6e37739b01162a01f1ff82c2646916eecf9ec7286deae9a9fdb67fe150f',
 str(BASE/'bin/jit'):'ae83e777fc05aad03f6ab929da74444b22839e4000759c30bf82774123967703',
}
def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''): h.update(b)
 return h.hexdigest()
def save(p,x,private=False):
 p=pathlib.Path(p); p.write_text(json.dumps(x,indent=2)+'\n');p.chmod(0o600 if private else 0o644)
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def processes(pid):
 rows={}
 for p in pathlib.Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   st=(p/'stat').read_text();i=st.rfind(')');a=st[i+2:].split();rows[int(p.name)]=(int(a[1]),int(a[21])*os.sysconf('SC_PAGE_SIZE'))
  except (OSError,ValueError,IndexError):pass
 ids={pid}
 for _ in range(20):
  n={p for p,(pp,_) in rows.items() if pp in ids}
  if n<=ids:break
  ids|=n
 return {p:rows[p][1] for p in ids if p in rows}
def shared_working():
 d=pathlib.Path('/sys/fs/cgroup');stat=dict(x.split() for x in (d/'memory.stat').read_text().splitlines())
 return int((d/'memory.current').read_text())-int(stat.get('inactive_file',0))
def stop(p):
 if p.poll() is None:
  os.killpg(p.pid,signal.SIGINT)
  try:p.wait(timeout=15)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
 return p.returncode
def run():
 ap=argparse.ArgumentParser();ap.add_argument('--handoff',required=True);ap.add_argument('--attempt',type=int,default=1);a=ap.parse_args();assert 1<=a.attempt<=3
 assert os.uname().nodename=='cc91695a75f7','Runpod only'
 hp=pathlib.Path(a.handoff).resolve();scope=pathlib.Path('/workspace/gl3/same-day-mainnet/bridge-rehearsal').resolve()
 assert hp.is_relative_to(scope) and hp.name=='validator-handoff.private.json'
 h=json.loads(hp.read_text());out=hp.parent;work=BASE/('private-'+out.parent.name+'-'+out.name+'-attempt'+str(a.attempt));work.mkdir(mode=0o700,exist_ok=False)
 for url in [h['parentRPC'],h['childRPC']]:assert urllib.parse.urlparse(url).hostname in ['127.0.0.1','localhost']
 fast=h.get('confirmationMode')=='operator-fast'
 assert h['chainId']==4663001 and h['parentChainId']==4663
 assert h['fastConfirmer'].lower()==(h['validatorAddress'].lower() if fast else '0x'+'00'*20)
 keypath=pathlib.Path(h['validatorKeyFile']).resolve();assert keypath.is_relative_to(out) and keypath.stat().st_mode&0o077==0
 key=json.loads(keypath.read_text());assert key['address'].lower()==h['validatorAddress'].lower()
 genesis=json.loads(pathlib.Path(h['genesisPath']).read_text());chaincfg=json.loads(genesis['serializedChainConfig'])
 assert chaincfg['chainId']==4663001 and chaincfg['arbitrum']['InitialArbOSVersion']==61 and chaincfg['arbitrum']['AllowDebugPrecompiles'] is False
 assert genesis['alloc']=={} and genesis['arbOSInit']['nativeTokenSupplyManagementEnabled'] is False
 assert str(genesis['arbOSInit']['initialL1BaseFee'])=='1448348398190243'
 assert chaincfg['arbitrum']['InitialChainOwner'].lower()==h.get('temporaryOwner',h['validatorAddress']).lower()
 assert h['genesisSHA256']==sha(h['genesisPath']) and h['temporaryAdminPolicy'] is True
 policyPath=pathlib.Path(h['finalAdminPolicyPath']).resolve();assert policyPath.is_relative_to(out)
 policy=json.loads(policyPath.read_text());assert policy['finalOwners']==['0x'+'00'*20] and policy['formerOwnerMember'] is False and policy['zeroMember'] is True
 assert policy['minters']==[] and policy['nativeManagementFrom']=='0' and policy['scheduledUpgrade']==['0','0']
 assert policy['minimumBaseFee']=='10000000000000' and int(policy['currentBaseFee'])>=10**13 and int(policy['ethGasPrice'])>=10**13
 assert all(policy[x].lower()==chaincfg['arbitrum']['InitialChainOwner'].lower() for x in ['networkFeeAccount','infraFeeAccount','L1RewardRecipient'])
 assert policy['allAdminCompletedBeforePlayerDeposit'] is True and len(policy['actualCalls'])==7
 for p,s in PINS.items():assert sha(p)==s,p
 cpus=sorted(os.sched_getaffinity(0));os.sched_setaffinity(0,cpus[:8]);os.environ['GOMAXPROCS']='8'
 jwt=work/'jwt.private';jwt.write_text(os.urandom(32).hex());jwt.chmod(0o600)
 vp,np=port(),port()
 val={'log-level':'WARN','validation':{'use-jit':True,'api-auth':True,'api-public':False,'wasm':{'root-path':MACHINES,'enable-wasmroots-check':True,'allowed-wasm-module-roots':[ROOT]},'jit':{'workers':2,'jit-path':str(BASE/'bin/jit'),'max-execution-time':'10m'},'arbitrator':{'workers':2}},'auth':{'addr':'127.0.0.1','port':vp,'jwtsecret':str(jwt)},'persistent':{'global-config':str(work/'validator-config')},'http':{'addr':''},'ws':{'addr':''},'ipc':{'path':''},'file-logging':{'enable':False}}
 save(work/'validator.json',val)
 c=json.loads(pathlib.Path(h['childConfigFile']).read_text());c['log-level']='INFO';c['persistent'].update({'chain':str(work/'chain'),'global-config':str(work/'config')});c['http'].update({'port':np,'api':['eth','net','web3','arb']});c['ipc']['path']=str(work/'node.ipc')
 c['node']['sequencer']=False;c['execution']['sequencer']['enable']=False;c['execution']['forwarding-target']='null';c['node']['batch-poster']={'enable':False};c['node']['delayed-sequencer']['enable']=False
 c['node']['staker']={'enable':True,'strategy':'MakeNodes','use-smart-contract-wallet':False,'disable-challenge':False,'enable-fast-confirmation':fast,'start-validation-from-staked':False,'staker-interval':'200ms','make-assertion-interval':'1s','parent-chain-wallet':{'private-key':key['privateKey'].removeprefix('0x')}}
 c['node']['bold']={'assertion-posting-interval':'1s','assertion-scanning-interval':'200ms','assertion-confirming-interval':'200ms','minimum-gap-to-parent-assertion':'0s','check-staker-switch-interval':'200ms','rpc-block-number':'latest','enable-fast-confirmation':fast,'start-validation-from-staked':False,'parent-chain-block-time':'100ms','state-provider-config':{'validator-name':'GL3-private-standard','check-batch-finality':False,'machine-leaves-cache-path':str(work/'machine-hashes')}}
 c['node']['block-validator']={'enable':True,'current-module-root':ROOT,'pending-upgrade-module-root':ROOT,'failure-is-fatal':True,'validation-poll':'100ms','validation-sent-limit':4,'prerecorded-blocks':4,'validation-server':{'url':'ws://127.0.0.1:'+str(vp),'jwtsecret':str(jwt),'timeout':'10m','retries':0,'arg-log-limit':0}}
 save(work/'node.private.json',c,True);pub=copy.deepcopy(c);pub['node']['staker']['parent-chain-wallet']['private-key']='$GENERATED_TEST_KEY_REDACTED';save(work/'node-public.json',pub)
 del key,c
 report={'schema':'gh0st.gl3.standard-validator.private.v1','passed':False,'publicWrites':0,'privateFixtureOnly':True,'officialModuleRoot':ROOT,'artifacts':PINS,'privateGeneratedTestWalletOnly':True,'fastConfirmationEnabled':fast,'confirmationMode':'operator-fast' if fast else 'standard-deadline','dangerousAssumeValidEnabled':False,'genuineHistoryRequiredByBridgeConsumer':True,'genesisJSONSHA256':sha(h['genesisPath']),'initialTestOwner':chaincfg['arbitrum']['InitialChainOwner'],'productionGenesisIdentical':False,'finalOwnerAndFeePolicyEnforcedByBridgeConsumer':True,'fixtureOverrides':{'latestParent':True,'batchFinalityCheck':False,'shortPolling':True,'publicProductionSettingsAccepted':False},'sourceSHA256':sha(__file__),'startedUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'processes':[]}
 report['configureRenouncePolicySHA256']=sha(policyPath)
 owned=[];fds=[];started=time.monotonic();peak=0;reason=None;known={}
 def remember():
  for owner in owned:
   for pid in processes(owner.pid):
    try:known[pid]=pathlib.Path('/proc',str(pid),'stat').read_text().split(') ',1)[1].split()[19]
    except OSError:pass
 def survivors():
  live=[]
  for pid,start in known.items():
   try:
    a=pathlib.Path('/proc',str(pid),'stat').read_text().split(') ',1)[1].split()
    if a[19]==start and a[0]!='Z':live.append(pid)
   except OSError:pass
  return live
 try:
  for label,binary,cfg in [('validator',str(BASE/'bin/nitro-val'),work/'validator.json'),('staker','/workspace/gl3/durable/bin/nitro',work/'node.private.json')]:
   f=open(work/(label+'.log'),'w');fds.append(f);p=subprocess.Popen([binary,'--conf.file',str(cfg)],cwd='/workspace/gl3/durable/nitro-clean',stdout=f,stderr=f,start_new_session=True);owned.append(p);report['processes'].append({'label':label,'pid':p.pid,'configPublicSHA256':sha(work/'node-public.json') if label=='staker' else sha(cfg)})
   time.sleep(1)
   if p.poll() is not None:raise RuntimeError(label+' exited during startup code '+str(p.returncode))
  save(work/'running.json',report)
  while True:
   for p in owned:
    if p.poll() is not None:raise RuntimeError('Owned '+str(p.pid)+' exited '+str(p.returncode))
   remember();rss=sum(sum(processes(p.pid).values()) for p in owned);peak=max(peak,rss)
   if rss>24*1024**3 or shared_working()>56_000_000_000 or os.statvfs('/root').f_bavail*os.statvfs('/root').f_frsize<6_000_000_000:raise RuntimeError('Resource guard')
   if time.monotonic()-started>1200:raise RuntimeError('Private validator wall deadline')
   if (out/'bridge-payout-complete.json').exists():
    done=json.loads((out/'bridge-payout-complete.json').read_text());assert done['replayRejected'] and done['stopValidatorRequested'];report['payoutReceipt']=done;report['passed']=True;break
   time.sleep(1)
 except Exception as e:reason=str(e);report['error']=reason
 finally:
  remember()
  for p in reversed(owned):stop(p)
  leftover=survivors()
  for pid in leftover:
   try:os.kill(pid,signal.SIGTERM)
   except ProcessLookupError:pass
  time.sleep(.5)
  for pid in survivors():
   try:os.kill(pid,signal.SIGKILL)
   except ProcessLookupError:pass
  time.sleep(.2)
  for f in fds:f.close()
  report.update({'seconds':time.monotonic()-started,'sampledAggregateRSSUpperBoundBytes':peak,'actualProcessExits':[{'pid':p.pid,'exitCode':p.returncode} for p in owned],'descendantCleanupRequestedPIDs':leftover,'ownedRemaining':len(survivors()),'finishedUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
  save(work/'result.json',report);save(out/'validator-evidence.json',report);save(out/'validator-stopped.json',{'stopped':report['ownedRemaining']==0,'actualProcessExits':report['actualProcessExits'],'resultSHA256':sha(work/'result.json')})
  for secret in [work/'node.private.json',jwt]:secret.unlink(missing_ok=True)
 return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(run())
