#!/usr/bin/env python3
"""Timer -> frozen genuine24m brain result -> independent ECDSA EIP1559 -> native EVM.

Local-only: the coordinator fixture replays the genuine signed move captured by the real
coordinator/Stockfish test. It does not run new inference or create production endpoints.
HTTPS replies come from an isolated EVM with a synthetic token. No mainnet funds move.
"""
import base64,datetime,gzip,hashlib,json,subprocess,time
from pathlib import Path
import ic,requests
from ic.candid import Types
from pocket_ic import PocketIC
from pocket_ic.pocket_ic_server import PocketICServer
from pocket_ic.subnet_config import SubnetConfig,SubnetKind
ROOT=Path(__file__).resolve().parents[1];CHESS=ROOT.parent;ENGINE=CHESS/'engine';WORK=ROOT/'target/end-to-end';WORK.mkdir(parents=True,exist_ok=True)
B=Types.Vec(Types.Nat8);T=Types.Text;N32=Types.Nat32;N64=Types.Nat64
MOVE=Types.Record({'game_id':B,'player':B,'ply':N32,'position_hash':B,'transcript_hash':B,'encoded_move':Types.Nat16,'engine_config_hash':B,'valid_until':N64})
SIGNED=Types.Record({'move':MOVE,'signature':B})
GAME=Types.Record({'player':B,'nonce':B,'opened_at':N64,'turn_deadline':N64,'result':Types.Nat8,'ply':N32,'position_hash':B,'transcript_hash':B,'board':B,'castling':Types.Nat8,'en_passant':Types.Nat8,'halfmove_clock':Types.Nat16,'black_to_move':Types.Bool})
JOB=Types.Record({'job_id':B,'game_id':B,'ply':N32,'position_hash':B,'step':N32,'phase':T,'error':Types.Opt(T),'actual_nodes':N64,'requested_nodes':N64,'depth':N32,'instructions':N64,'stop_reason':T,'bestmove':T,'signed_move':Types.Opt(SIGNED),'engine_job_id':B,'moves':Types.Vec(T),'game':Types.Opt(GAME),'in_flight':Types.Bool,'created_at':N64,'updated_at':N64})
FIXTURE=Types.Record({'job':JOB,'game_contract':B,'bot_attestor':B})
CONFIG=Types.Record({'coordinator':Types.Principal,'coordinator_module_hash':B,'engine_config_hash':B,'game_contract':B,'game_runtime_hash':B,'bot_attestor':B,'rpc_url':T,'key_name':T,'confirmations':N64,'idle_poll_seconds':N64,'max_gas_limit':N64,'max_fee_per_gas_wei':N64,'max_tx_cost_wei':Types.Nat,'lifetime_gas_budget_wei':Types.Nat})
STATUS=Types.Record({'ready':Types.Bool,'enabled':Types.Bool,'blockers':Types.Vec(T),'relayer_address':T,'pending':Types.Bool,'remaining_gas_budget_wei':Types.Nat,'completed_transactions':N64,'last_error':Types.Opt(T),'pending_hash':T,'gas_balance_wei':Types.Nat})
PENDING=Types.Record({'phase':T,'raw':B,'hash':B,'broadcasts':N32,'created_at':N64,'broadcast_at':N64})
RESULT=Types.Variant({'Ok':STATUS,'Err':T});TR=Types.Variant({'Ok':T,'Err':T})
def enc(t,v):return ic.encode([{'type':t,'value':v}])
def dec(raw,t):return ic.decode(bytes(raw),[t])[0]['value']
def blob(s):return bytes.fromhex(s.removeprefix('0x'))
def plain(v):
 if isinstance(v,bytes):return '0x'+v.hex()
 if isinstance(v,dict):return{k:plain(x) for k,x in v.items()}
 if isinstance(v,list):return[plain(x) for x in v]
 return v
frozen_path=CHESS/'hybrid-brain/evidence/end-to-end.json';frozen=json.loads(frozen_path.read_text());assert frozen['passed'] and frozen['search']['actual_nodes']>=24_000_000
report={'scope':'isolated ICP autonomous timer/transaction-relay execution using captured genuine realStockfish24m signed move',
 'mocked':['fixture coordinator replays one recorded genuine signed result; no fresh inference','HTTPS replies from isolated EVM chain4663','synthetic ERC20 and relay ETH'],
 'not_proven':['Robinhood mainnet transactions','mainnet relayer deployment/key/funding','a second Stockfish inference run','human win odds'],
 'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'genuine_result_source_sha256':hashlib.sha256(frozen_path.read_bytes()).hexdigest(),'checks':[]}
def save():(ROOT/'evidence/relay-end-to-end.json').write_text(json.dumps(plain(report),indent=2)+'\n')
def check(name,yes):assert yes,name;report['checks'].append(name);save();print('pass',name,flush=True)

port=WORK/'port';port.unlink(missing_ok=True);log=(WORK/'server.log').open('w');server=subprocess.Popen([str(ENGINE/'.cache/pocket-ic'),'--port-file',str(port)],stdout=log,stderr=subprocess.STDOUT);pic=None;bridge=None
try:
 for _ in range(300):
  if port.exists() and port.read_text().strip():break
  assert server.poll() is None;time.sleep(.1)
 else:raise TimeoutError('PocketIC startup')
 url='http://127.0.0.1:'+port.read_text().strip()
 def connect(self):self.url=url;self.request_client=requests.session()
 PocketICServer.__init__=connect;pic=PocketIC(SubnetConfig(application=1,fiduciary=True));pic.set_time(int(datetime.datetime(2026,1,1,tzinfo=datetime.timezone.utc).timestamp())*1_000_000_000)
 app=next(s for s,k in pic.topology().items() if k==SubnetKind.APPLICATION);admin=ic.Principal.self_authenticating(b'gh0st-relay-e2e-admin');pic.set_sender(admin)
 fixture=pic.create_canister(subnet=app);relay=pic.create_canister(subnet=app)
 for x in [fixture,relay]:pic.add_cycles(x,100_000_000_000_000)
 bridge_log=(WORK/'evm-bridge.log').open('w');bridge=subprocess.Popen(['node',str(ROOT/'tools/evm-bridge.mjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=bridge_log,text=True,bufsize=1,cwd=CHESS)
 def evm(command,**kw):
  bridge.stdin.write(json.dumps({'command':command,**kw})+'\n');bridge.stdin.flush();line=bridge.stdout.readline();assert line,'bridge exited';r=json.loads(line);assert r['ok'],r;return r.get('result')
 signed=frozen['signed_move'];m=signed['move'];attestor=evm('recover_attestor',move=m,signature=signed['signature'],contract=frozen['local_evm_deployment']['contract'])['address']
 deployment=evm('setup',attestor=attestor,engine_config_hash=m['engine_config_hash']);report['local_evm_deployment']=deployment
 check('recreated native game address exactly matches the genuine captured signed domain',deployment['contract'].lower()==frozen['local_evm_deployment']['contract'].lower())
 pic.set_time(int(deployment['block']['timestamp'],16)*1_000_000_000)
 ms={k:(blob(v) if k in ['game_id','player','position_hash','transcript_hash','engine_config_hash'] else int(v)) for k,v in m.items()}
 job={'job_id':hashlib.sha256(b'GH0ST_HYBRID_JOB_V1'+ms['game_id']+ms['ply'].to_bytes(4,'big')+ms['position_hash']+ms['engine_config_hash']).digest(),'game_id':ms['game_id'],'ply':ms['ply'],'position_hash':ms['position_hash'],'step':frozen['search']['engine_steps'],'phase':'Completed','error':[],'actual_nodes':frozen['search']['actual_nodes'],'requested_nodes':24_000_000,'depth':frozen['search']['depth'],'instructions':frozen['search']['instructions'],'stop_reason':frozen['search']['stop_reason'],'bestmove':frozen['search']['bestmove'],'signed_move':[{'move':ms,'signature':blob(signed['signature'])}],'engine_job_id':b'','moves':['e2e4'],'game':[],'in_flight':False,'created_at':int(frozen['local_entry']['game']['opened_at']),'updated_at':int(frozen['local_entry']['game']['opened_at'])+60}
 fixture_wasm=(ROOT/'tests/fixture-coordinator/target/wasm32-unknown-unknown/release/gh0st_chess_frozen_coordinator_fixture.wasm').read_bytes();fixture_gz=gzip.compress(fixture_wasm,mtime=0)
 pic.install_code(fixture,fixture_gz,[{'type':FIXTURE,'value':{'job':job,'game_contract':blob(deployment['contract']),'bot_attestor':blob(attestor)}}])
 wasm=(ROOT/'target/wasm32-unknown-unknown/release/gh0st_chess_hybrid_relay.wasm').read_bytes();gz=gzip.compress(wasm,mtime=0)
 c={'coordinator':fixture.bytes,'coordinator_module_hash':hashlib.sha256(fixture_gz).digest(),'engine_config_hash':ms['engine_config_hash'],'game_contract':blob(deployment['contract']),'game_runtime_hash':blob(deployment['runtime_hash']),'bot_attestor':blob(attestor),'rpc_url':'https://rpc.mainnet.chain.robinhood.com','key_name':'key_1','confirmations':12,'idle_poll_seconds':15,'max_gas_limit':4_000_000,'max_fee_per_gas_wei':100_000_000,'max_tx_cost_wei':200_000_000_000_000,'lifetime_gas_budget_wei':2_500_000_000_000_000}
 report.update({'relay_wasm_raw_sha256':hashlib.sha256(wasm).hexdigest(),'relay_installed_gzip_sha256':hashlib.sha256(gz).hexdigest(),'fixture_coordinator_gzip_sha256':hashlib.sha256(fixture_gz).hexdigest(),'relay_subnet':pic.get_subnet(relay).to_str(),'source_policy':{'max_gas_limit':c['max_gas_limit'],'max_fee_per_gas_wei':c['max_fee_per_gas_wei'],'max_tx_cost_wei':c['max_tx_cost_wei'],'lifetime_gas_budget_wei':c['lifetime_gas_budget_wei']}})
 pic.install_code(relay,gz,[{'type':CONFIG,'value':c}])
 signer=dec(pic.update_call(relay,'prepare_signer',ic.encode([])),TR);assert 'Ok'in signer,signer;relayer=signer['Ok'];report['relayer_address']=relayer
 check('independent relay key differs from the brain move-attestor key',relayer.lower()!=attestor.lower())
 evm('fund_relayer',address=relayer)
 broadcasts=[];lost_response=False;did_upgrade=False;nonce_conflict_injected=False;receipt_recovered=False
 def status():return dec(pic.query_call(relay,'get_status',ic.encode([])),STATUS)
 def pending():return dec(pic.query_call(relay,'get_pending',ic.encode([])),Types.Opt(PENDING))
 def pump():
  pic.tick()
  global lost_response,nonce_conflict_injected
  for q in pic._instance_get('read/get_canister_http'):
   assert q['url']==c['rpc_url'];request=json.loads(base64.b64decode(q['body']));response=evm('rpc',body=request)
   raw_call=not isinstance(request,list) and request.get('method')=='eth_sendRawTransaction'
   if raw_call:
    assert 'result'in response,response
    tx=evm('decode_transaction',raw=request['params'][0]);broadcasts.append(tx);report['broadcast_transactions']=broadcasts;save()
    check('timer signs fixed-chain zero-value exact-target EIP1559 transaction',int(tx['chainId'])==4663 and tx['type']==2 and tx['from'].lower()==relayer.lower() and tx['to'].lower()==deployment['contract'].lower() and int(tx['value'])==0 and tx['nonce']==0 and int(tx['gasLimit'])*int(tx['maxFeePerGas'])<=c['max_tx_cost_wei'])
    dur=pending()[0];check('raw transaction and exact hash are durable before broadcast reply',dur['phase']=='Submitted' and bytes(dur['raw'])==blob(request['params'][0]) and bytes(dur['hash'])==blob(tx['hash']))
    evm('mine')
    if not lost_response:
     lost_response=True;mock={'CanisterHttpReject':{'reject_code':2,'message':'TEST: reply lost after actual local EVM inclusion'}}
    else:mock={'CanisterHttpReply':{'status':200,'headers':[],'body':base64.b64encode(json.dumps(response).encode()).decode()}}
   else:
    if did_upgrade and not nonce_conflict_injected and isinstance(request,list) and any(x.get('method')=='eth_getTransactionReceipt' for x in request):
     # Model a lagging/inconsistent provider: the real local receipt exists, but one
     # observation returns no transaction while reporting its nonce already consumed.
     for row in response:
      if row['id'] in [1,2]:row['result']=None
     nonce_conflict_injected=True
    mock={'CanisterHttpReply':{'status':200,'headers':[],'body':base64.b64encode(json.dumps(response).encode()).decode()}}
   pic._instance_post('update/mock_canister_http',{'subnet_id':q['subnet_id'],'request_id':q['request_id'],'response':mock,'additional_responses':[]})
 def call(method,payload,typ):
  body={'sender':base64.b64encode(pic.sender.bytes).decode(),'effective_principal':'None','canister_id':base64.b64encode(relay.bytes).decode(),'method':method,'payload':base64.b64encode(payload).decode()};mid=pic._get_ok(pic._instance_post('update/submit_ingress_message',body))
  for _ in range(500):
   pump();r=pic._ingress_status(mid)
   if r:return dec(pic._get_ok_data(r),typ)
  raise TimeoutError('relay '+method)
 enabled=call('set_enabled',enc(Types.Bool,True),RESULT);assert 'Ok'in enabled,enabled
 check('controller enables the funded relay while native entries remain paused',enabled['Ok']['enabled'])
 state=evm('fund_enter');check('recreated paid game matches genuine signature game and position',state['game_id'].lower()==m['game_id'].lower() and state['game']['position_hash'].lower()==m['position_hash'].lower())
 pic.set_time(int(state['block']['timestamp'],16)*1_000_000_000);before=pic.get_cycles_balance(relay)
 for tick in range(500):
  pic.advance_time(2_000_000_000);pump();s=status()
  if lost_response and not did_upgrade and s['last_error'] and 'outcome unavailable'in s['last_error'][0]:
   prior=pending()[0];upgrade=Types.Record({'mode':Types.Variant({'upgrade':Types.Null}),'canister_id':Types.Principal,'wasm_module':B,'arg':B});pic.set_sender(admin)
   pic.update_call_with_effective_principal(None,{'CanisterId':base64.b64encode(relay.bytes).decode()},'install_code',enc(upgrade,{'mode':{'upgrade':None},'canister_id':relay.bytes,'wasm_module':gz,'arg':ic.encode([])}));after=pending()[0]
   check('same-source upgrade preserves submitted raw transaction hash and nonce intent',bytes(after['raw'])==bytes(prior['raw']) and bytes(after['hash'])==bytes(prior['hash']) and after['phase']=='Submitted')
   did_upgrade=True
  if nonce_conflict_injected and not receipt_recovered and s['last_error'] and 'nonce conflict'in s['last_error'][0]:
   check('ambiguous consumed nonce halts new work without replacing the durable transaction',not s['enabled'] and s['pending'] and len(broadcasts)==1)
   recovered=call('reconcile_pending',ic.encode([]),RESULT);assert 'Ok'in recovered,recovered;s=recovered['Ok'];receipt_recovered=True
   check('receipt-only recovery resolves the exact confirmed transaction while keeping sending disabled',s['completed_transactions']==1 and not s['pending'] and not s['enabled'])
  if s['completed_transactions']==1 and not s['pending']:break
  if tick%25==0:print('timer progress',tick,s['pending'],s['last_error'],flush=True)
 else:raise TimeoutError('timer relay did not settle '+str(s))
 final=evm('inspect');report['final_native_state']=final;report['relay_final_status']=s;report['relay_cycles_debit']=before-pic.get_cycles_balance(relay)
 check('timers alone applied the genuine Black move without browser or crank calls',final['moves']==['796','3364'] and int(final['game']['ply'])==2 and not final['game']['black_to_move'])
 check('lost broadcast reply and upgrade reconcile one receipt without a second transaction',lost_response and did_upgrade and len(broadcasts)==1 and s['completed_transactions']==1 and not s['pending'])
 receipt=evm('rpc',body={'jsonrpc':'2.0','id':1,'method':'eth_getTransactionReceipt','params':[broadcasts[0]['hash']]})['result'];report['confirmed_receipt']=receipt
 gas_cost=int(receipt['gasUsed'],16)*int(receipt['effectiveGasPrice'],16)
 check('approved lifetime budget deducts exactly confirmed gas rather than its maximum reserve',c['lifetime_gas_budget_wei']-s['remaining_gas_budget_wei']==gas_cost)
 check('relay sends no token value and preserves the complete native prize reserve',int(final['reserved'])==10**24 and int(final['pool_balance'])==1_025_000*10**18)
 resumed=call('set_enabled',enc(Types.Bool,True),RESULT);assert 'Ok'in resumed,resumed
 for _ in range(30):pic.advance_time(2_000_000_000);pump()
 last=status();nonce=evm('rpc',body={'jsonrpc':'2.0','id':1,'method':'eth_getTransactionCount','params':[relayer,'latest']})['result']
 check('White-turn polling does not replay the signed move or consume a new nonce',last['completed_transactions']==1 and int(nonce,16)==1 and len(broadcasts)==1)
 report['passed']=True;report['check_count']=len(report['checks']);save();print(json.dumps({'passed':True,'checks':len(report['checks']),'tx_hash':broadcasts[0]['hash'],'gas_cost_wei':gas_cost,'relay_cycles_debit':report['relay_cycles_debit']},indent=2),flush=True)
finally:
 if bridge is not None:
  try:evm('close')
  except Exception:pass
  try:bridge.wait(timeout=5)
  except subprocess.TimeoutExpired:bridge.terminate();bridge.wait(timeout=5)
  bridge_log.close()
 if pic is not None:pic.server.delete_instance(pic.instance_id);pic.__class__.__del__=lambda self:None
 server.terminate();server.wait(timeout=20);log.close();report['all_owned_processes_stopped']=True;save()
