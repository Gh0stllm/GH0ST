#!/usr/bin/env python3
"""Artificial isolated PocketIC billing/memory observations, not a public bill.

Reads the existing tested continuation artifact. No identity, mint, transfer,
mainnet canister, baseline source edit, or actual cycles funding is used.
"""
from pathlib import Path
import argparse, base64, datetime, hashlib, json, subprocess, time
import requests, ic
from ic.candid import Types
from pocket_ic import PocketIC
from pocket_ic.pocket_ic_server import PocketICServer

ROOT=Path(__file__).resolve().parent
ENGINE=ROOT.parents[1]
CACHE=ENGINE/'.cache/retained-engine/teststate'
CACHE.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser()
parser.add_argument('--decisions',type=int,default=4)
options=parser.parse_args()
BLOB=Types.Vec(Types.Nat8)
def encode(t,v):return ic.encode([{'type':t,'value':v}])
def decode(b,t):return ic.decode(bytes(b),[t])[0]['value']

inputs=json.loads((ROOT/'inputs.json').read_text())
reference=json.loads((ROOT/'evidence/native-reference.json').read_text())
assert len(reference['cases'])==4 and reference['new_game_reset_matches_original']
report={'scope':'Artificial isolated local PocketIC cycle-balance and memory observations. Not public mainnet cycles, a funded deployment, a complete game or guaranteed current billing. Isolated retained-game engine, four consecutive Black decisions from a saved native game plus new-game reset. No full-game ICP or universal-strength claim.', 'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cases':[]}
port=CACHE/'pocketic.port';port.unlink(missing_ok=True)
log=(CACHE/'pocketic.log').open('w')
server=subprocess.Popen([str(ENGINE/'.cache/pocket-ic'),'--port-file',str(port)],stdout=log,stderr=subprocess.STDOUT)
pic=None
try:
 for _ in range(300):
  if port.exists() and port.read_text().strip():break
  assert server.poll() is None,'PocketIC startup failed'
  time.sleep(.1)
 else:raise TimeoutError('PocketIC startup')
 url='http://127.0.0.1:'+port.read_text().strip()
 def connect(self):self.url=url;self.request_client=requests.session()
 PocketICServer.__init__=connect
 pic=PocketIC();authority=ic.Principal.self_authenticating(b'gh0st-chess-local-engine-test');pic.set_sender(authority)
 topology=pic._instance_get('read/topology')
 report['localTopology']=topology
 wasm=(ENGINE/'.cache/retained-engine/engine.asyncify.wasm').read_bytes()
 report['wasmSha256']=hashlib.sha256(wasm).hexdigest();report['wasmBytes']=len(wasm)
 report['inputsGameSha256']=inputs['game_json_sha256']
 store=pic.create_canister();pic.add_cycles(store,100_000_000_000_000)
 upload=Types.Record({'canister_id':Types.Principal,'chunk':BLOB});hashes=[]
 for offset in range(0,len(wasm),1024*1024):
  chunk=wasm[offset:offset+1024*1024]
  value=decode(pic.update_call(None,'upload_chunk',encode(upload,{'canister_id':store.bytes,'chunk':chunk})),Types.Record({'hash':BLOB}))
  assert bytes(value['hash'])==hashlib.sha256(chunk).digest();hashes.append({'hash':value['hash']})
 install=Types.Record({'mode':Types.Variant({'install':Types.Null}),'target_canister':Types.Principal,'store_canister':Types.Opt(Types.Principal),'chunk_hashes_list':Types.Vec(Types.Record({'hash':BLOB})),'wasm_module_hash':BLOB,'arg':BLOB})
 statusType=Types.Record({'memory_size':Types.Nat,'cycles':Types.Nat,'memory_metrics':Types.Record({'wasm_memory_size':Types.Nat,'stable_memory_size':Types.Nat,'global_memory_size':Types.Nat,'wasm_binary_size':Types.Nat,'custom_sections_size':Types.Nat,'wasm_chunk_store_size':Types.Nat,'snapshots_size':Types.Nat})})
 def status(cid):return decode(pic.update_call(None,'canister_status',encode(Types.Record({'canister_id':Types.Principal}),{'canister_id':cid.bytes})),statusType)
 progress=Types.Record({'pending':Types.Bool,'step':Types.Nat32,'bestmove':Types.Text,'actual_nodes':Types.Nat64,'observed_nodes':Types.Nat64,'depth':Types.Nat32,'code':Types.Int32,'instructions':Types.Nat64})
 target=pic.create_canister();pic.add_cycles(target,100_000_000_000_000)
 beforeInstall=pic.get_cycles_balance(target)
 config=hashlib.sha256(b'local-retained-game-test-only').digest()
 args=ic.encode([{'type':Types.Text,'value':authority.to_str()},{'type':BLOB,'value':config},{'type':Types.Nat64,'value':3000000},{'type':Types.Nat32,'value':128}])
 pic.update_call_with_effective_principal(None,{'CanisterId':base64.b64encode(target.bytes).decode()},'install_chunked_code',encode(install,{'mode':{'install':None},'target_canister':target.bytes,'store_canister':[store.bytes],'chunk_hashes_list':hashes,'wasm_module_hash':hashlib.sha256(wasm).digest(),'arg':args}))
 report['localInstallCyclesDebited']=beforeInstall-pic.get_cycles_balance(target)
 report['installedStatus']=status(target)
 def newgame(label):
  before=pic.get_cycles_balance(target)
  raw=pic.update_call(target,'prototype_new_game',ic.encode([]))
  after=pic.get_cycles_balance(target)
  r=decode(raw,Types.Record({'generation':Types.Nat32,'ready':Types.Bool,'instructions':Types.Nat64}))
  row={'label':label,'result':r,'localCyclesDebited':before-after,'statusAfter':status(target)}
  report.setdefault('newGameCalls',[]).append(row);print('new game',label,r,'cycles',before-after,flush=True)
  return r
 def decision(index,label):
  before=pic.get_cycles_balance(target);calls=[];started=time.monotonic()
  begin=ic.encode([{'type':Types.Nat32,'value':3000000},{'type':Types.Nat32,'value':100000},{'type':Types.Nat32,'value':index}]);r=None
  while r is None or r['pending']:
   b=pic.get_cycles_balance(target)
   raw=pic.update_call(target,'prototype_begin' if r is None else 'prototype_advance',begin if r is None else ic.encode([]))
   a=pic.get_cycles_balance(target);r=decode(raw,progress)
   calls.append({'step':r['step'],'sampledInstructions':r['instructions'],'localCyclesDebited':b-a})
   assert len(calls)<100 and r['instructions']<40_000_000_000
  after=pic.get_cycles_balance(target)
  expected=reference['cases'][index]['result'];result={k:r[k] for k in ['bestmove','actual_nodes','depth']}
  assert r['code']==0 and result==expected,(label,result,expected)
  saved=inputs['cases'][index]['saved_native'];assert result=={'bestmove':saved['uci'],'actual_nodes':saved['actual_nodes'],'depth':saved['depth']}
  row={'label':label,'decisionIndex':index,'ply':inputs['cases'][index]['ply'],'fullMoves':inputs['cases'][index]['moves'],'targetNodes':3000000,'quantum':100000,'updates':len(calls),'final':result,'freshRetainedNative':expected,'matchesSavedNative':True,'nativeExact':True,'sampledInstructionsTotal':sum(x['sampledInstructions'] for x in calls),'largestSampledUpdate':max(x['sampledInstructions'] for x in calls),'localCyclesDebitedTotal':before-after,'statusAfter':status(target),'calls':calls,'localWallSeconds':time.monotonic()-started}
  report['cases'].append(row);(ROOT/'evidence/pocketic-retained.json').write_text(json.dumps(report,indent=2)+'\n')
  print(json.dumps({k:v for k,v in row.items() if k not in ['calls','statusAfter','fullMoves']}),flush=True)
  return result
 newgame('first-game-initialization')
 for index in range(options.decisions):decision(index,'consecutive-retained-black')
 # A new game clears TT/history, while keeping initialized NNUE memory.
 newgame('explicit-second-game-reset')
 reset=decision(0,'reset-reproduces-first-decision')
 report['newGameResetMatchesOriginal']=reset==report['cases'][0]['final']
 pic.set_anonymous_sender()
 try:
  pic.update_call(target,'prototype_new_game',ic.encode([]));raise AssertionError('unauthorized reset accepted')
 except ValueError as exc:
  assert 'test-only authority' in str(exc);report['unauthorizedResetRejected']=True
 pic.set_sender(authority)
 report['completed']=True
finally:
 if pic is not None:pic.server.delete_instance(pic.instance_id);pic.__class__.__del__=lambda self:None
 server.terminate();server.wait(timeout=20);log.close()
 (ROOT/'evidence/pocketic-retained.json').write_text(json.dumps(report,indent=2)+'\n')
