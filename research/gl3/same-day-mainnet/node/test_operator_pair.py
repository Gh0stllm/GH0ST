#!/usr/bin/env python3
"""Runpod-only dummy processes; never loads operator secrets or starts Nitro."""
import json,pathlib,signal,sys,tempfile,threading,time,unittest
from operator_pair import PairSupervisor,GateError,validate

class PairTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='pair-',dir='/workspace/gl3/same-day-mainnet/node/supervisor-tests');self.p=pathlib.Path(self.tmp.name)
  self.script=self.p/'dummy.py';self.script.write_text("import pathlib,sys,time\np=pathlib.Path(sys.argv[1]);p.write_text('started')\ntime.sleep(float(sys.argv[2]))\n")
 def tearDown(self):self.tmp.cleanup()
 def pair(self,seconds=(10,10),check=lambda:None,restarts=0):
  commands=[(r,[sys.executable,str(self.script),str(self.p/(r+'.started')),str(s)]) for r,s in zip(['backend','node'],seconds)]
  return PairSupervisor(commands,self.p/'state',check,lambda r:(self.p/(r+'.started')).exists(),max_restarts=restarts,backoff=.01,grace=.5,poll=.02,start_timeout=2)
 def test_operator_stop_closes_both_owned_services(self):
  p=self.pair()
  def stop_after_actual_readiness():
   deadline=time.monotonic()+8
   while time.monotonic()<deadline:
    if any(x['event']=='pair_healthy' for x in p.events):break
    time.sleep(.01)
   # Also stop at the deadline so a failed readiness assertion leaves no dummy peer.
   p.request_stop(signal.SIGTERM)
  t=threading.Thread(target=stop_after_actual_readiness);t.start();r=p.run();t.join();self.assertTrue(r['passed']);self.assertEqual(r['ownedTopLevelRemaining'],0);self.assertEqual(len([x for x in p.events if x['event']=='service_exit']),2);self.assertTrue(any(x['event']=='pair_healthy' for x in p.events))
 def test_peer_exit_stops_other_service(self):
  p=self.pair((.3,10));r=p.run();self.assertFalse(r['passed']);self.assertEqual(r['status'],'RESTART_BUDGET_EXHAUSTED');self.assertEqual(len([x for x in p.events if x['event']=='service_exit']),2);self.assertEqual(r['ownedTopLevelRemaining'],0)
 def test_restart_is_bounded_and_rechecked(self):
  checks=[];p=self.pair((.1,10),lambda:checks.append(time.monotonic()),1);r=p.run();self.assertFalse(r['passed']);self.assertEqual(r['attempts'],2);self.assertGreaterEqual(len(checks),4);self.assertEqual(r['ownedTopLevelRemaining'],0)
 def test_hash_gate_failure_prevents_any_child(self):
  def refused():raise GateError('changed_hash')
  p=self.pair(check=refused);r=p.run();self.assertFalse(r['passed']);self.assertFalse(any(x['event']=='service_started' for x in p.events))
 def test_hash_drift_blocks_restart(self):
  n=0
  def check():
   nonlocal n;n+=1
   if n>3:raise GateError('changed_after_first_start')
  p=self.pair((.2,10),check,1);r=p.run();self.assertFalse(r['passed']);self.assertEqual(len([x for x in p.events if x['event']=='service_started']),2);self.assertEqual(r['ownedTopLevelRemaining'],0)
 def test_stop_during_backend_readiness_never_starts_node(self):
  p=self.pair();p.ready=lambda _:False;t=threading.Timer(.2,lambda:p.request_stop(signal.SIGTERM));t.start();r=p.run();t.join();self.assertTrue(r['passed']);self.assertEqual([x['role'] for x in p.events if x['event']=='service_started'],['backend'])
 def test_unapproved_bundle_refuses_before_effective_config_reads(self):
  a=self.p/'approval.json';a.write_text(json.dumps({'operatorReviewed':False}));a.chmod(0o600)
  import hashlib
  b=self.p/'bundle.json';b.write_text(json.dumps({'schema':'gh0st.gl3.private-service-bundle.v1','approval':{'path':str(a),'SHA256':hashlib.sha256(a.read_bytes()).hexdigest()},'nodeConfig':{'path':str(self.p/'MUST_NOT_BE_READ'),'SHA256':'0'*64}}))
  with self.assertRaisesRegex(GateError,'private_start_not_approved'):validate(b)


 def adapter_bundle(self):
  import hashlib,operator_pair
  root=pathlib.Path('/workspace/gl3/mainnet');root.mkdir(exist_ok=True)
  tmp=tempfile.TemporaryDirectory(prefix='TEST-adapter-',dir=root);d=pathlib.Path(tmp.name);d.chmod(0o700)
  template=pathlib.Path('/workspace/gl3/same-day-mainnet/node')
  profile=json.loads((template.parent/'deployment-packet/isolated-deployer/production-profile.json').read_text())
  node=json.loads((template/'node.proposed.json').read_text());backend=json.loads((template/'validator.proposed.json').read_text())
  jwt=d/'TEST.jwt';jwt.write_text('00'*32+'\n');jwt.chmod(0o600)
  backend['auth']['jwtsecret']=str(jwt);node['node']['block-validator']['validation-server']['jwtsecret']=str(jwt)
  node['parent-chain']['connection']['url']='https://test.invalid'
  for role in ['batch-poster','staker']:node['node'][role]['parent-chain-wallet'].update(pathname=str(d/'NO_REAL_KEYSTORE'),password='TEST_ONLY')
  paths={k:d/(k+'.json') for k in ['profile','renderReceipt','deploymentManifest','fundingManifest','nodeConfig','backendConfig','chainInfo','genesis']}
  node['init']['genesis-json-file']=str(paths['genesis'])
  content={'profile':profile,'nodeConfig':node,'backendConfig':backend,'deploymentManifest':{'passed':True,'testOnly':True},'fundingManifest':{'passed':True,'testOnly':True},'chainInfo':{'testOnly':True},'genesis':{'testOnly':True}}
  sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
  for k,v in content.items():paths[k].write_text(json.dumps(v));paths[k].chmod(0o600)
  content['renderReceipt']={'schema':'gh0st.gl3.operator-config-rendered.v1',**{key:sha(paths[k]) for k,key in [('nodeConfig','nodeEffectiveSHA256'),('backendConfig','backendEffectiveSHA256'),('chainInfo','chainInfoSHA256'),('genesis','genesisSHA256')]}}
  paths['renderReceipt'].write_text(json.dumps(content['renderReceipt']));paths['renderReceipt'].chmod(0o600)
  approval={'testOnly':True,'operatorReviewed':True,'privateBootstrapStartApproved':True,'licenseConfirmed':True,'boundedFundingApproved':True,'publicActivationApproved':False,'supervisorSourceSHA256':sha(pathlib.Path(operator_pair.__file__))}
  approval.update({k+'SHA256':sha(p) for k,p in paths.items()});a=d/'TEST-approval.json';a.write_text(json.dumps(approval));a.chmod(0o600)
  b={'schema':'gh0st.gl3.private-service-bundle.v1','approval':{'path':str(a),'SHA256':sha(a)},**{k:{'path':str(p),'SHA256':sha(p)} for k,p in paths.items()},'stateDir':str(d/'state')};bp=d/'bundle.json';bp.write_text(json.dumps(b));bp.chmod(0o600)
  return tmp,bp,paths,approval,a,b,sha
 def test_generated_bundle_accepts_actual_renderer_schema_without_service_start(self):
  tmp,bp,*_=self.adapter_bundle()
  try:
   c=validate(bp);self.assertFalse(c['publicActivationApproved']);self.assertEqual(c['node']['chain']['id'],4663001);self.assertEqual(c['records']['backendConfig'].name,'backendConfig.json');self.assertFalse((c['stateDir']/'lifecycle.jsonl').exists())
  finally:tmp.cleanup()
 def test_hash_valid_but_unpaired_backend_is_rejected(self):
  tmp,bp,paths,approval,a,b,sha=self.adapter_bundle()
  try:
   node=json.loads(paths['nodeConfig'].read_text());node['node']['block-validator']['validation-server']['url']='ws://127.0.0.1:1';paths['nodeConfig'].write_text(json.dumps(node))
   render=json.loads(paths['renderReceipt'].read_text());render['nodeEffectiveSHA256']=sha(paths['nodeConfig']);paths['renderReceipt'].write_text(json.dumps(render))
   for k in ['nodeConfig','renderReceipt']:approval[k+'SHA256']=sha(paths[k]);b[k]['SHA256']=sha(paths[k])
   a.write_text(json.dumps(approval));b['approval']['SHA256']=sha(a);bp.write_text(json.dumps(b))
   with self.assertRaisesRegex(GateError,'backend_client_pair_mismatch'):validate(bp)
  finally:tmp.cleanup()

if __name__=='__main__':
 import os
 assert os.uname().nodename=='42456c02ced1';pathlib.Path('/workspace/gl3/same-day-mainnet/node/supervisor-tests').mkdir(exist_ok=True);unittest.main(verbosity=2)
