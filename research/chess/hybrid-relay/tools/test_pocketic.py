#!/usr/bin/env python3
"""Real local relay Wasm: no entry, active timer, mainnet RPC or broadcast is enabled here."""
import base64,datetime,gzip,hashlib,json,subprocess,time
from pathlib import Path
import ic,requests
from ic.candid import Types
from pocket_ic import PocketIC
from pocket_ic.pocket_ic_server import PocketICServer
from pocket_ic.subnet_config import SubnetConfig,SubnetKind

ROOT=Path(__file__).resolve().parents[1];ENGINE=ROOT.parent/'engine';WORK=ROOT/'target/pocketic-gates';WORK.mkdir(parents=True,exist_ok=True)
B=Types.Vec(Types.Nat8);T=Types.Text;N64=Types.Nat64;N=Types.Nat
CONFIG=Types.Record({'coordinator':Types.Principal,'coordinator_module_hash':B,'engine_config_hash':B,'game_contract':B,'game_runtime_hash':B,'bot_attestor':B,'rpc_url':T,'key_name':T,'confirmations':N64,'idle_poll_seconds':N64,'max_gas_limit':N64,'max_fee_per_gas_wei':N64,'max_tx_cost_wei':N,'lifetime_gas_budget_wei':N})
STATUS=Types.Record({'ready':Types.Bool,'enabled':Types.Bool,'blockers':Types.Vec(T),'chain_id':N64,'game_contract':T,'coordinator':Types.Principal,'coordinator_module_hash':B,'bot_attestor_address':T,'relayer_address':T,'gas_balance_wei':N,'last_checked_at':N64,'cycles':N,'pending':Types.Bool,'remaining_gas_budget_wei':N,'next_tick_at':N64,'completed_transactions':N64})
RES=Types.Variant({'Ok':STATUS,'Err':T});STR=Types.Variant({'Ok':T,'Err':T})
HTTP=Types.Record({'status':N,'headers':Types.Vec(Types.Record({'name':T,'value':T})),'body':B});TRANSFORM=Types.Record({'response':HTTP,'context':B})
def enc(t,v):return ic.encode([{'type':t,'value':v}])
def dec(b,t):return ic.decode(bytes(b),[t])[0]['value']
def plain(v):
 if isinstance(v,ic.Principal):return v.to_str()
 if isinstance(v,bytes):return v.hex()
 if isinstance(v,dict):return{k:plain(x)for k,x in v.items()}
 if isinstance(v,list):return[plain(x)for x in v]
 return v
report={'scope':'Actual isolated PocketIC relay Wasm signer/auth/disabled-timer/transform/upgrade gates; no autonomous game relay is implied by these gate checks','generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':[]}
def check(name,yes):assert yes,name;report['checks'].append(name)
port=WORK/'port';port.unlink(missing_ok=True);log=(WORK/'server.log').open('w');server=subprocess.Popen([str(ENGINE/'.cache/pocket-ic'),'--port-file',str(port)],stdout=log,stderr=subprocess.STDOUT);pic=None
try:
 for _ in range(300):
  if port.exists()and port.read_text().strip():break
  if server.poll()is not None:raise RuntimeError('PocketIC exited')
  time.sleep(.1)
 else:raise TimeoutError('PocketIC startup')
 url='http://127.0.0.1:'+port.read_text().strip()
 def connect(self):self.url=url;self.request_client=requests.session()
 PocketICServer.__init__=connect;pic=PocketIC(SubnetConfig(application=1,fiduciary=True))
 pic.set_time(int(datetime.datetime(2026,1,1,tzinfo=datetime.timezone.utc).timestamp())*1_000_000_000)
 app=next(s for s,k in pic.topology().items()if k==SubnetKind.APPLICATION)
 admin=ic.Principal.self_authenticating(b'gh0st-relay-local-gate-admin');pic.set_sender(admin)
 relay=pic.create_canister(subnet=app);coordinator=pic.create_canister(subnet=app);pic.add_cycles(relay,10_000_000_000_000)
 c={'coordinator':coordinator.bytes,'coordinator_module_hash':bytes([3]*32),'engine_config_hash':bytes([4]*32),'game_contract':bytes([0x11]*20),'game_runtime_hash':bytes([5]*32),'bot_attestor':bytes([0x22]*20),'rpc_url':'https://rpc.mainnet.chain.robinhood.com','key_name':'key_1','confirmations':12,'idle_poll_seconds':15,'max_gas_limit':8_000_000,'max_fee_per_gas_wei':100_000_000,'max_tx_cost_wei':200_000_000_000_000,'lifetime_gas_budget_wei':2_500_000_000_000_000}
 wasm=(ROOT/'target/wasm32-unknown-unknown/release/gh0st_chess_hybrid_relay.wasm').read_bytes();installed=gzip.compress(wasm,mtime=0)
 report.update(raw_wasm_sha256=hashlib.sha256(wasm).hexdigest(),raw_wasm_bytes=len(wasm),installed_gzip_sha256=hashlib.sha256(installed).hexdigest(),installed_gzip_bytes=len(installed),canister=relay.to_str(),subnet=app.to_str())
 pic.install_code(relay,installed,[{'type':CONFIG,'value':c}])
 before=dec(pic.query_call(relay,'get_status',ic.encode([])),STATUS)
 check('installed relay starts disabled, unready and without a pending transaction',not before['enabled']and not before['ready']and not before['pending'])
 check('fixed chain, target, coordinator hash and exact approved gas budget reported',before['chain_id']==4663 and before['game_contract']=='0x'+bytes(c['game_contract']).hex()and bytes(before['coordinator_module_hash'])==bytes(c['coordinator_module_hash'])and before['remaining_gas_budget_wei']==c['lifetime_gas_budget_wei'])
 pic.set_anonymous_sender()
 check('anonymous caller cannot enable spending',dec(pic.update_call(relay,'set_enabled',enc(Types.Bool,True)),RES)=={'Err':'controller required'})
 check('anonymous caller cannot prepare threshold signer',dec(pic.update_call(relay,'prepare_signer',ic.encode([])),STR)=={'Err':'controller required'})
 cranked=dec(pic.update_call(relay,'crank',ic.encode([])),RES);check('permissionless crank cannot bypass disabled relay',not cranked['Ok']['enabled']and not cranked['Ok']['pending'])
 recovered=dec(pic.update_call(relay,'reconcile_pending',ic.encode([])),RES);check('receipt-only reconciliation cannot create an intent or enable spending',not recovered['Ok']['enabled']and not recovered['Ok']['pending'])
 pic.advance_time(120*1_000_000_000);pic.tick();after=dec(pic.query_call(relay,'get_status',ic.encode([])),STATUS)
 check('disabled timers never arm or broadcast',after['next_tick_at']==0 and after['completed_transactions']==0 and not pic._instance_get('read/get_canister_http'))
 pic.set_sender(admin)
 check('controller cannot enable without derived signer',dec(pic.update_call(relay,'set_enabled',enc(Types.Bool,True)),RES)=={'Err':'derive relay signer before enabling'})
 signer=dec(pic.update_call(relay,'prepare_signer',ic.encode([])),STR);check('actual management key_1 relay derivation succeeds', 'Ok'in signer and len(signer['Ok'])==42)
 status=dec(pic.query_call(relay,'get_status',ic.encode([])),STATUS);check('key derivation leaves relay disabled and unfunded',not status['enabled']and not status['ready']and status['gas_balance_wei']==0 and status['relayer_address']==signer['Ok'])
 h=bytes([7]*32)
 def transformed(body,context):return dec(pic.query_call(relay,'transform',enc(TRANSFORM,{'response':{'status':200,'headers':[{'name':'Date','value':'different each node'}],'body':json.dumps(body).encode()},'context':context})),HTTP)
 r=transformed({'jsonrpc':'2.0','id':1,'error':{'code':-32000,'message':'already known'}},h)
 check('known identical raw-transaction replies normalize to exact expected hash',r['headers']==[] and json.loads(bytes(r['body']))['result']=='0x'+h.hex())
 r=transformed({'jsonrpc':'2.0','id':1,'error':{'code':-32000,'message':'nonce too low'}},h)
 check('nonce conflicts are never normalized into successful broadcasts','error'in json.loads(bytes(r['body'])))
 r=transformed({'jsonrpc':'2.0','id':1,'error':{'code':-32000,'message':'unknown transaction'}},h)
 check('unknown transaction is not mistaken for a known identical transaction','error'in json.loads(bytes(r['body'])))
 upgrade=Types.Record({'wasm_module':B,'canister_id':Types.Principal,'arg':B,'mode':Types.Variant({'upgrade':Types.Null})})
 pic.update_call_with_effective_principal(None,{'CanisterId':base64.b64encode(relay.bytes).decode()},'install_code',enc(upgrade,{'wasm_module':installed,'canister_id':relay.bytes,'arg':ic.encode([]),'mode':{'upgrade':None}}))
 final=dec(pic.query_call(relay,'get_status',ic.encode([])),STATUS)
 check('actual same-source upgrade preserves disabled policy, signer and lifetime budget',not final['ready']and not final['enabled']and final['relayer_address']==status['relayer_address']and final['remaining_gas_budget_wei']==status['remaining_gas_budget_wei']and final['next_tick_at']==0)
 report['passed']=True;report['check_count']=len(report['checks']);report['actual_local_relayer_address']=signer['Ok'];print(json.dumps(report,indent=2),flush=True)
finally:
 if pic is not None:pic.server.delete_instance(pic.instance_id);pic.__class__.__del__=lambda self:None
 server.terminate();server.wait(timeout=20);log.close();report['all_owned_processes_stopped']=True
 (ROOT/'evidence/pocketic-gates.json').write_text(json.dumps(plain(report),indent=2)+'\n')
