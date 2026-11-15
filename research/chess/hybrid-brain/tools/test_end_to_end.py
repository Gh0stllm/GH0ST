#!/usr/bin/env python3
"""Actual coordinator + full Stockfish24m + local management ECDSA + real native EVM rules.

All execution is isolated local testing. HTTPS responses are explicitly mocked from an
isolated EVM chain4663 with a synthetic ERC20 fixture; no mainnet state, funds or signer.
"""
import base64, datetime, gzip, hashlib, json, subprocess, time,sys
from pathlib import Path
import requests, ic
from ic.candid import Types
from pocket_ic import PocketIC
from pocket_ic.pocket_ic_server import PocketICServer
from pocket_ic.subnet_config import SubnetConfig,SubnetKind

ROOT=Path(__file__).resolve().parents[1];CHESS=ROOT.parent;ENGINE=CHESS/'engine'
WORK=ROOT/('target/signing-recovery' if '--signing-recovery'in sys.argv else 'target/full-integration');WORK.mkdir(parents=True,exist_ok=True)
B=Types.Vec(Types.Nat8);T=Types.Text;N32=Types.Nat32;N64=Types.Nat64
CONFIG=Types.Record({'engine_canister':Types.Principal,'relay_canister':Types.Principal,'engine_module_hash':B,'game_contract':B,'game_runtime_hash':B,'rpc_url':T,'confirmations':N64,'key_name':T,'reviewed_release':Types.Bool})
BINDING=Types.Record({'game_contract':B,'game_runtime_hash':B})
MOVE=Types.Record({'game_id':B,'player':B,'ply':N32,'position_hash':B,'transcript_hash':B,'encoded_move':Types.Nat16,'engine_config_hash':B,'valid_until':N64})
SIGNED=Types.Record({'move':MOVE,'signature':B})
JOB=Types.Record({'job_id':B,'game_id':B,'ply':N32,'position_hash':B,'step':N32,'phase':T,'error':Types.Opt(T),'actual_nodes':N64,'requested_nodes':N64,'depth':N32,'instructions':N64,'stop_reason':T,'bestmove':T,'signed_move':Types.Opt(SIGNED),'in_flight':Types.Bool,'updated_at':N64})
JR=Types.Variant({'Ok':JOB,'Err':T});TR=Types.Variant({'Ok':T,'Err':T});RR=Types.Variant({'Ok':Types.Reserved,'Err':T})
REQUEST=Types.Record({'game_id':B,'expected_ply':N32,'expected_position_hash':B,'request_id':B,'moves':Types.Vec(T)})
ADVANCE=Types.Record({'job_id':B,'expected_step':N32})
STATUS=Types.Record({'relay_canister':Types.Principal,'production_ready':Types.Bool,'paid_entries_enabled':Types.Bool,'engine_config_hash':B,'attestor_address':T,'game_contract':T,'nodes':N64})
SR=Types.Variant({'Ok':STATUS,'Err':T})
def enc(t,v):return ic.encode([{'type':t,'value':v}])
def dec(raw,t):return ic.decode(bytes(raw),[t])[0]['value']
def field(v):return len(v).to_bytes(4,'big')+v
def blob(s):return bytes.fromhex(s.removeprefix('0x'))
def plain(v):
 if isinstance(v,bytes):return '0x'+v.hex()
 if isinstance(v,dict):return{k:plain(x) for k,x in v.items()}
 if isinstance(v,list):return[plain(x) for x in v]
 return v
report={'scope':'isolated local end-to-end execution: real coordinator/fullStockfish24m/local management ECDSA/native Solidity game',
 'mocked':['HTTPS responses from isolated EVM chain4663','synthetic ERC20 fixture at canonical GH0ST address'],
 'not_proven':['Robinhood mainnet deployment or RPC provider access from ICP','mainnet threshold signer','public paid gameplay or real GH0ST transfer','human win probability or unbeatable engine'],
 'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':[]}
quorum_only='--quorum-only'in sys.argv
recovery_mode='--signing-recovery'in sys.argv
output_name='signing-recovery.json' if recovery_mode else 'quorum-transport.json' if quorum_only else 'end-to-end.json'
genuine=None
if recovery_mode:
 source=(ROOT/'evidence/end-to-end-optimized-pre-isolation.json').read_bytes();genuine=json.loads(source);assert genuine['passed']
 report['scope']='actual coordinator Signing retry with replayed genuine completed24m engine reply; no fresh inference'
 report['mocked'].append('separate TEST-ONLY engine fixture replays genuine recorded completed search metadata')
 report['genuine_source_evidence']='end-to-end-optimized-pre-isolation.json'
 report['fresh_inference']=False;report['genuine_source_sha256']=hashlib.sha256(source).hexdigest()
def save():(ROOT/'evidence'/output_name).write_text(json.dumps(plain(report),indent=2)+'\n')
def check(name,yes):
 assert yes,name
 report['checks'].append(name);save();print('pass',name,flush=True)

def native_reference():
 p=subprocess.Popen([str(ENGINE/'.cache/Stockfish/src/stockfish')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
 def cmd(s):p.stdin.write(s+'\n');p.stdin.flush()
 def until(prefix):
  rows=[]
  while True:
   s=p.stdout.readline();assert s,'native EOF';rows.append(s.strip())
   if s.startswith(prefix):return rows
 try:
  cmd('uci');until('uciok')
  for k,v in [('NumaPolicy','none'),('Threads','1'),('Hash','128'),('Skill Level','20'),('UCI_LimitStrength','false'),('MultiPV','1'),('Ponder','false'),('SyzygyPath','<empty>')]:cmd('setoption name '+k+' value '+v)
  cmd('ucinewgame');cmd('isready');until('readyok');cmd('position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves e2e4');cmd('go nodes 24000000');rows=until('bestmove');s=[x for x in rows if x.startswith('info depth ')][-1].split()
  return {'bestmove':rows[-1].split()[1],'actual_nodes':int(s[s.index('nodes')+1]),'depth':int(s[s.index('depth')+1])}
 finally:cmd('quit');p.communicate(timeout=30)

port=WORK/'port';port.unlink(missing_ok=True);log=(WORK/'server.log').open('w')
server=subprocess.Popen([str(ENGINE/'.cache/pocket-ic'),'--port-file',str(port)],stdout=log,stderr=subprocess.STDOUT)
pic=None;bridge=None
try:
 for _ in range(300):
  if port.exists() and port.read_text().strip():break
  if server.poll() is not None:raise RuntimeError('PocketIC exited')
  time.sleep(.1)
 else:raise TimeoutError('PocketIC startup')
 url='http://127.0.0.1:'+port.read_text().strip()
 def connect(self):self.url=url;self.request_client=requests.session()
 PocketICServer.__init__=connect;pic=PocketIC(SubnetConfig(application=1,fiduciary=True))
 # Establish synthetic time before any canister memory exists. Explicitly place both
 # execution canisters on Application; key_1 remains available through the fiduciary subnet.
 pic.set_time(int(datetime.datetime(2026,1,1,tzinfo=datetime.timezone.utc).timestamp())*1_000_000_000)
 app=next(s for s,k in pic.topology().items() if k==SubnetKind.APPLICATION)
 controller=ic.Principal.self_authenticating(b'gh0st-hybrid-e2e-admin');pic.set_sender(controller)
 coordinator=pic.create_canister(subnet=app);engine=pic.create_canister(subnet=app);store=pic.create_canister(subnet=app);relay=pic.create_canister(subnet=app)
 report['topology']=pic._instance_get('read/topology')
 report['engine_subnet']=pic.get_subnet(engine).to_str();report['coordinator_subnet']=pic.get_subnet(coordinator).to_str()
 report['application_subnet']=app.to_str()
 assert report['engine_subnet']==report['coordinator_subnet']==report['application_subnet']
 for c in [coordinator,engine,store,relay]:pic.add_cycles(c,100_000_000_000_000)
 relay_wasm=(ROOT/'tests/relay-driver/target/wasm32-unknown-unknown/release/gh0st_chess_test_relay_driver.wasm').read_bytes()
 pic.install_code(relay,relay_wasm,[{'type':Types.Principal,'value':coordinator.bytes}])
 engine_path=ROOT/'tests/frozen-engine/target/wasm32-unknown-unknown/release/gh0st_chess_frozen_engine_fixture.wasm' if recovery_mode else ENGINE/'.cache/optimized-engine/engine.asyncify.wasm'
 engine_wasm=engine_path.read_bytes();engine_hash=hashlib.sha256(engine_wasm).digest()
 report['engine_wasm_sha256']=engine_hash.hex();report['engine_wasm_bytes']=len(engine_wasm)
 config_hash=hashlib.sha256(b'GH0ST_ENGINE_CONFIG_V2_RETAINED\0'+field(engine.bytes)+field(b'edb0d9db6731067ec50ce619ff372b463bc4dd5d')+field(b'1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2')+(24_000_000).to_bytes(8,'big')+(128).to_bytes(4,'big')+bytes([1,20,0,1,1])).digest()
 upload=Types.Record({'canister_id':Types.Principal,'chunk':B});hashes=[]
 for off in range(0,len(engine_wasm),1024*1024):
  chunk=engine_wasm[off:off+1024*1024];r=dec(pic.update_call(None,'upload_chunk',enc(upload,{'canister_id':store.bytes,'chunk':chunk})),Types.Record({'hash':B}));assert bytes(r['hash'])==hashlib.sha256(chunk).digest();hashes.append({'hash':r['hash']})
 install=Types.Record({'mode':Types.Variant({'install':Types.Null}),'target_canister':Types.Principal,'store_canister':Types.Opt(Types.Principal),'chunk_hashes_list':Types.Vec(Types.Record({'hash':B})),'wasm_module_hash':B,'arg':B})
 init_args=[{'type':Types.Principal,'value':coordinator.bytes},{'type':B,'value':config_hash}]
 if recovery_mode:
  reply_type=Types.Record({'bestmove':T,'actual_nodes':N64,'depth':N32,'instructions':N64})
  init_args.append({'type':reply_type,'value':{k:genuine['search'][k] for k in ['bestmove','actual_nodes','depth','instructions']}})
 engine_args=ic.encode(init_args)
 pic.update_call_with_effective_principal(None,{'CanisterId':base64.b64encode(engine.bytes).decode()},'install_chunked_code',enc(install,{'mode':{'install':None},'target_canister':engine.bytes,'store_canister':[store.bytes],'chunk_hashes_list':hashes,'wasm_module_hash':engine_hash,'arg':engine_args}))
 c={'engine_canister':engine.bytes,'relay_canister':relay.bytes,'engine_module_hash':engine_hash,'game_contract':bytes(20),'game_runtime_hash':bytes(32),'rpc_url':'https://rpc.mainnet.chain.robinhood.com','confirmations':12,'key_name':'key_1','reviewed_release':False}
 wasm=(ROOT/'target/wasm32-unknown-unknown/release/gh0st_chess_hybrid_brain.wasm').read_bytes();gz=gzip.compress(wasm,mtime=0)
 report['coordinator_raw_sha256']=hashlib.sha256(wasm).hexdigest();report['coordinator_installed_gzip_sha256']=hashlib.sha256(gz).hexdigest()
 pic.install_code(coordinator,gz,[{'type':CONFIG,'value':c}])
 def canister_status(target):
  saved=pic.sender;pic.set_sender(controller)
  try:
   return dec(pic.update_call_with_effective_principal(None,{'CanisterId':base64.b64encode(target.bytes).decode()},'canister_status',enc(Types.Record({'canister_id':Types.Principal}),{'canister_id':target.bytes})),Types.Record({'cycles':Types.Nat,'reserved_cycles':Types.Nat,'memory_size':Types.Nat}))
  finally:pic.set_sender(saved)
 def stage(name):
  row={'name':name,'time':pic.get_time(),'engine':canister_status(engine),'coordinator':canister_status(coordinator)}
  report.setdefault('accounting_stages',[]).append(row);save();return row
 stage('installed_before_signer_or_deployment')
 signer=dec(pic.update_call(coordinator,'prepare_signer',ic.encode([])),TR);assert 'Ok'in signer,signer
 status=dec(pic.query_call(coordinator,'get_status',ic.encode([])),STATUS)
 check('real coordinator derives local management ECDSA signer and matches independent retained24m config hash',status['relay_canister'].bytes==relay.bytes and bytes(status['engine_config_hash'])==config_hash and status['attestor_address']==signer['Ok'] and not status['production_ready'])
 bridge_log=(WORK/'evm-bridge.log').open('w')
 bridge=subprocess.Popen(['node',str(ROOT/'tools/evm-bridge.mjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=bridge_log,text=True,bufsize=1,cwd=CHESS)
 def evm(command,**kwargs):
  bridge.stdin.write(json.dumps({'command':command,**kwargs})+'\n');bridge.stdin.flush();line=bridge.stdout.readline();assert line,'EVM bridge exited';r=json.loads(line);assert r['ok'],r;return r.get('result')
 deployment=evm('setup',attestor=signer['Ok'],engine_config_hash='0x'+config_hash.hex());report['local_evm_deployment']=deployment
 pic.set_time(int(deployment['block']['timestamp'],16)*1_000_000_000)
 http_calls=[];bad_quorum_once=True;bad_signing_once=recovery_mode;use_relay=False
 def call(method,payload,typ):
  target=relay if use_relay else coordinator
  wire=ic.encode([{'type':T,'value':method},{'type':B,'value':payload}]) if use_relay else payload
  body={'sender':base64.b64encode(pic.sender.bytes).decode(),'effective_principal':'None','canister_id':base64.b64encode(target.bytes).decode(),'method':'drive' if use_relay else method,'payload':base64.b64encode(wire).decode()}
  mid=pic._get_ok(pic._instance_post('update/submit_ingress_message',body))
  for _ in range(2000):
   pic.tick();result=pic._ingress_status(mid)
   if result:
    raw=pic._get_ok_data(result)
    if use_relay:
     forwarded=dec(raw,Types.Variant({'Ok':B,'Err':T}));assert 'Ok'in forwarded,forwarded;raw=forwarded['Ok']
    return dec(raw,typ)
   for pending in pic._instance_get('read/get_canister_http'):
    assert pending['url']==c['rpc_url'],'outcall target changed'
    request=json.loads(base64.b64decode(pending['body']));response=evm('rpc',body=request)
    flexible=isinstance(pending.get('replication'),dict) and 'Flexible'in pending['replication']
    http_calls.append({'method':method,'request_id':pending['request_id'],'flexible':flexible,'jsonrpc_methods':[r['method'] for r in request] if isinstance(request,list) else[request['method']]})
    if flexible:
     global bad_quorum_once,bad_signing_once
     assert pending['replication']['Flexible']=={'total_requests':13,'min_responses':9,'max_responses':13},pending
     head=int(next(x['result'] for x in response if x['id']==2),16)
     # Independent committee observations span8successive fast-chain heads. Build those
     # blocks locally so the later chosen fixed-height state actually exists.
     for _ in range(8):evm('rpc',body={'jsonrpc':'2.0','id':1,'method':'evm_mine','params':[]})
     responses=[]
     heights=list(range(head,head+9))+[0,1,2**64-2,2**64-1]
     inject_signing=recovery_mode and method=='advance_job' and bad_signing_once
     for i,h in enumerate(heights):
      chain=4663
      if (bad_quorum_once or inject_signing) and i>=8:chain=1
      body=[{'jsonrpc':'2.0','id':1,'result':hex(chain)},{'jsonrpc':'2.0','id':2,'result':hex(h)}]
      responses.append({'CanisterHttpReply':{'status':200,'headers':[],'body':base64.b64encode(json.dumps(body).encode()).decode()}})
     pic._instance_post('update/mock_flexible_canister_http',{'subnet_id':pending['subnet_id'],'request_id':pending['request_id'],'responses':responses})
     bad_quorum_once=False
     if inject_signing:bad_signing_once=False
    else:
     # Fixed-state batches can be returned in arbitrary response order. Include a
     # different ordering from6committee nodes:7/6split lacks a quorum without normalization.
     extra=[]
     if isinstance(response,list):
      reversed_body=base64.b64encode(json.dumps(list(reversed(response))).encode()).decode()
      extra=[{'CanisterHttpReply':{'status':200,'headers':[],'body':reversed_body}}for _ in range(6)]
      if extra:extra.extend([{'CanisterHttpReply':{'status':200,'headers':[],'body':base64.b64encode(json.dumps(response).encode()).decode()}}for _ in range(6)])
     pic._instance_post('update/mock_canister_http',{'subnet_id':pending['subnet_id'],'request_id':pending['request_id'],'response':{'CanisterHttpReply':{'status':200,'headers':[],'body':base64.b64encode(json.dumps(response).encode()).decode()}},'additional_responses':extra})
  raise TimeoutError('coordinator '+method)
 binding={'game_contract':blob(deployment['contract']),'game_runtime_hash':blob(deployment['runtime_hash'])}
 rejected=call('seal_release',enc(BINDING,binding),SR)
 check('flexible committee with only8validRobinhood responses cannot seal or open entry','Err'in rejected and '9'in rejected['Err'])
 blocked=dec(pic.query_call(coordinator,'get_status',ic.encode([])),STATUS);check('insufficient quorum leaves the immutable deployment unbound',not blocked['production_ready'] and blocked['game_contract']=='0x'+'00'*20)
 retry_block=evm('mine',seconds=35)['block'];pic.set_time(int(retry_block['timestamp'],16)*1_000_000_000)
 sealed=call('seal_release',enc(BINDING,binding),SR);assert 'Ok'in sealed,sealed
 stage('sealed_idle_before_retained_engine_initialization')
 check('one-time sealing verifies real engine and local native EVM runtime/config/token/signer while entries stay paused',sealed['Ok']['production_ready'] and not sealed['Ok']['paid_entries_enabled'])
 second=call('seal_release',enc(BINDING,binding),RR)
 check('rebinding an already sealed deployment rejects',second=={'Err':'deployment is already bound; rebinding is forbidden'})
 if quorum_only:
  report['passed']=True;report['check_count']=len(report['checks']);report['http_outcalls']=http_calls
  print(json.dumps({'passed':True,'scope':'actual flexible13/9head and static replicated batch normalization only','checks':len(report['checks'])},indent=2),flush=True)
  raise SystemExit(0)
 if recovery_mode:
  pic.set_anonymous_sender()
  report['public_budget_drain_caller']='anonymous'
  # Spend only synthetic local outcall cycles while paused; force the real public
  # lane to its configured limit without adding a production budget-seed endpoint.
  for attempts in range(1500):
   advanced=evm('mine',seconds=35)['block'];pic.set_time(int(advanced['timestamp'],16)*1_000_000_000)
   exhausted=call('refresh_status',ic.encode([]),SR)
   if attempts%40==0:print('public quota drain',attempts+1,flush=True)
   if 'Err'in exhausted and 'daily public'in exhausted['Err']:break
  else:raise AssertionError('public quota did not exhaust in bounded local test')
  report['public_budget_drain_attempts']=attempts+1
  check('anonymous callers exhaust only their public canonical quota','daily public'in exhausted['Err'])
 use_relay=True
 protected=call('refresh_status',ic.encode([]),SR)
 check('actual pinned relay can refresh independently of public quota and lease','Ok'in protected and protected['Ok']['production_ready'])
 state=evm('fund_enter');report['local_entry']=state;pic.set_time(int(state['block']['timestamp'],16)*1_000_000_000)
 # The public lease is30s. Advance only local chain/ICP test time between independent admission stages.
 state_block=evm('mine',seconds=35)['block'];pic.set_time(int(state_block['timestamp'],16)*1_000_000_000)
 request={'game_id':blob(state['game_id']),'expected_ply':1,'expected_position_hash':blob(state['game']['position_hash']),'request_id':bytes([1]*32),'moves':['e2e4']}
 before_engine=pic.get_cycles_balance(engine);before_coordinator=pic.get_cycles_balance(coordinator)
 pic.set_anonymous_sender();r=call('request_bot',enc(REQUEST,request),JR);assert 'Ok'in r,r;job=r['Ok']
 reserved_stage=stage('canonical_game_verified_engine_reserved_and_initialized')
 check('permissionless request verifies actual paid native game and full standardstart UCI history before reserving real engine',job['phase']=='BeginEngine' and job['requested_nodes']==24_000_000)
 duplicate=call('request_bot',enc(REQUEST,{**request,'request_id':bytes([2]*32)}),JR)
 check('duplicate canonical turn returns same durable job instead of another inference',bytes(duplicate['Ok']['job_id'])==bytes(job['job_id']))
 steps=0;started=time.monotonic();signing_lease_checked=False;recovery_proved=False
 while job['phase'] not in ['Completed','Faulted']:
  r=call('advance_job',enc(ADVANCE,{'job_id':job['job_id'],'expected_step':job['step']}),JR);assert 'Ok'in r,r;job=r['Ok'];steps+=1
  if steps==1:
   stage('first_adaptive_search_chunk_committed')
   replay=call('advance_job',enc(ADVANCE,{'job_id':job['job_id'],'expected_step':0}),JR)
   check('stale coordinator advance returns current step without repeating search work',replay['Ok']['step']==job['step'])
  if steps%20==0:print('engine progress',steps,job['step'],job['phase'],round(time.monotonic()-started,1),flush=True)
  if recovery_mode and job['phase']=='Signing' and job['error'] and not recovery_proved:
   check('transient insufficient Signing quorum preserves completed search and does not authorize a move',job['actual_nodes']==genuine['search']['actual_nodes'] and job['bestmove']==genuine['search']['bestmove'] and not job['signed_move'])
   stats=dec(pic.query_call(engine,'stats',ic.encode([])),Types.Record({'begins':N32,'advances':N32}))
   check('Signing failure does not restart or advance the frozen engine reply',stats=={'begins':1,'advances':0})
   recovery_proved=True
  if job['phase']=='Signing' and not signing_lease_checked:
   advanced=evm('mine',seconds=35)['block'];pic.set_time(int(advanced['timestamp'],16)*1_000_000_000)
   refreshed=call('refresh_status',ic.encode([]),SR)
   check('active paid game remains ready while new entry is occupied', 'Ok'in refreshed and refreshed['Ok']['production_ready'] and not refreshed['Ok']['paid_entries_enabled'])
   signing_lease_checked=True
  assert steps<260,job
 assert job['phase']=='Completed',job
 if recovery_mode:check('retry verifies canonical quorum and signs the same full-budget result with cleared error',recovery_proved and not job['error'])
 report['search']={'bestmove':job['bestmove'],'actual_nodes':job['actual_nodes'],'depth':job['depth'],'instructions':job['instructions'],'stop_reason':job['stop_reason'],'engine_steps':job['step'],'coordinator_updates':steps,'local_wall_seconds':time.monotonic()-started,'engine_cycles_debit':before_engine-pic.get_cycles_balance(engine),'coordinator_cycles_debit':before_coordinator-pic.get_cycles_balance(coordinator)}
 # Flexible outcall prepayment refunds may arrive asynchronously up to60seconds later.
 # Settle those before quoting balance debits; no new inference is run during this wait.
 pic.advance_time(65_000_000_000)
 for _ in range(10):pic.tick()
 report['search']['engine_cycles_debit']=before_engine-pic.get_cycles_balance(engine)
 report['search']['coordinator_cycles_debit']=before_coordinator-pic.get_cycles_balance(coordinator)
 final_stage=stage('full_search_and_threshold_signature_committed_after_http_refunds')
 report['search']['warm_engine_balance_debit']=reserved_stage['engine']['cycles']-final_stage['engine']['cycles']
 report['search']['warm_engine_reserved_cycles_increase']=final_stage['engine']['reserved_cycles']-reserved_stage['engine']['reserved_cycles']
 report['native_reference']=genuine['native_reference'] if recovery_mode else native_reference()
 check('frozen genuine result metadata remains exact through Signing recovery' if recovery_mode else 'actual full-budget ICP Stockfish matches fresh native standardstart plus complete e2e4 history exactly',all(report['search'][k]==report['native_reference'][k] for k in ['bestmove','actual_nodes','depth']) and job['actual_nodes']>=24_000_000)
 signed=job['signed_move'][0];m=signed['move'];m={k:('0x'+bytes(v).hex() if k in ['game_id','player','position_hash','transcript_hash','engine_config_hash'] else v) for k,v in m.items()};signature='0x'+bytes(signed['signature']).hex()
 report['signed_move']={'move':m,'signature':signature}
 result=evm('apply_bot',move=m,signature=signature);report['local_applied_bot']=result
 check('local management ECDSA signature executes Blackmove through actual Solidity legality and keeps full prize reserved',int(result['game']['ply'])==2 and not result['game']['black_to_move'] and int(result['reserved'])==10**24 and result['moves']==['796','3364'])
 again=call('advance_job',enc(ADVANCE,{'job_id':job['job_id'],'expected_step':job['step']}),JR)
 check('completed job returns the same cached signature without fresh search/signing',bytes(again['Ok']['signed_move'][0]['signature'])==bytes(signed['signature']))
 timed=evm('timeout');report['local_timeout']=timed
 check('native service-timeout refunds exactly25k and releases full1m collateral independently of ICP',int(timed['refund'])==25_000*10**18 and int(timed['reserved'])==0 and int(timed['game']['result'])==6)
 advanced=evm('mine')['block'];pic.set_time(int(advanced['timestamp'],16)*1_000_000_000)
 reopened=call('refresh_status',ic.encode([]),SR)
 if recovery_mode:
  check('TEST engine commits terminal release but unavailable acknowledgement leaves jobs unpruned', 'Err'in reopened and 'reply is unavailable'in reopened['Err'] and dec(pic.query_call(coordinator,'get_job',ic.encode([{'type':B,'value':request['game_id']},{'type':N32,'value':1}])),Types.Opt(JOB)))
  closed_status=dec(pic.query_call(coordinator,'get_status',ic.encode([])),STATUS)
  check('unacknowledged terminal cleanup closes readiness and old-game inference',not closed_status['production_ready'] and 'Err'in call('request_bot',enc(REQUEST,request),JR))
  # The engine already released; only coordinator upgrades. Its durable intent
  # must survive and permit a fresh canonical terminal check, never a new search.
  pic.set_sender(controller)
  upgrade=Types.Record({'wasm_module':B,'canister_id':Types.Principal,'arg':B,'mode':Types.Variant({'upgrade':Types.Null})})
  pic.update_call_with_effective_principal(None,{'CanisterId':base64.b64encode(coordinator.bytes).decode()},'install_code',enc(upgrade,{'wasm_module':gz,'canister_id':coordinator.bytes,'arg':ic.encode([]),'mode':{'upgrade':None}}))
  pic.set_anonymous_sender()
  advanced=evm('mine',seconds=35)['block'];pic.set_time(int(advanced['timestamp'],16)*1_000_000_000)
  reopened=call('refresh_status',ic.encode([]),SR)
  pruned=dec(pic.query_call(coordinator,'get_job',ic.encode([{'type':B,'value':request['game_id']},{'type':N32,'value':1}])),Types.Opt(JOB))
  stats=dec(pic.query_call(engine,'stats',ic.encode([])),Types.Record({'release_calls':N32}))
  check('durable cleanup survives coordinator upgrade and prunes only canonically terminal already-released game', 'Ok'in reopened and not pruned and stats['release_calls']==1)
  check('closed-game tombstone rejects replayed old request after cleanup','Err'in call('request_bot',enc(REQUEST,request),JR))
 check('canonical terminal acknowledgement releases retained engine and permits a new funded round', 'Ok'in reopened and reopened['Ok']['production_ready'] and reopened['Ok']['paid_entries_enabled'])
 report['http_outcalls']=http_calls;report['passed']=True;report['check_count']=len(report['checks']);save();print(json.dumps({'passed':True,'checks':len(report['checks']),'search':report['search']},indent=2),flush=True)
finally:
 if bridge is not None:
  try:evm('close')
  except Exception:pass
  try:bridge.wait(timeout=5)
  except subprocess.TimeoutExpired:bridge.terminate();bridge.wait(timeout=5)
  bridge_log.close()
 if pic is not None:pic.server.delete_instance(pic.instance_id);pic.__class__.__del__=lambda self:None
 server.terminate();server.wait(timeout=20);log.close();report['all_owned_processes_stopped']=True;save()
