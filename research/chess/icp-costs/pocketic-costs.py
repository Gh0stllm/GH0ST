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
CHESS=ROOT.parent
ENGINE=CHESS/'engine'
CACHE=ROOT/'.cache'
CACHE.mkdir(exist_ok=True)
parser=argparse.ArgumentParser()
parser.add_argument('--budgets',default='3000000,10000000')
options=parser.parse_args()
BLOB=Types.Vec(Types.Nat8)
def encode(t,v):return ic.encode([{'type':t,'value':v}])
def decode(b,t):return ic.decode(bytes(b),[t])[0]['value']
def native(budget):
 p=subprocess.Popen([str(ENGINE/'.cache/Stockfish/src/stockfish')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
 def command(s):p.stdin.write(s+'\n');p.stdin.flush()
 def until(prefix):
  lines=[]
  while True:
   line=p.stdout.readline()
   assert line,'native EOF'
   lines.append(line.strip())
   if line.startswith(prefix):return lines
 command('uci');until('uciok')
 for name,value in [('NumaPolicy','none'),('Threads','1'),('Hash','128'),('Skill Level','20'),('UCI_LimitStrength','false'),('MultiPV','1'),('Ponder','false'),('SyzygyPath','<empty>')]:command('setoption name '+name+' value '+value)
 command('ucinewgame');command('isready');until('readyok');command('position startpos moves e2e4');command(f'go nodes {budget}')
 lines=until('bestmove');command('quit');p.communicate(timeout=30)
 final=[x for x in lines if x.startswith('info depth ')][-1].split()
 return{'bestmove':lines[-1].split()[1],'actual_nodes':int(final[final.index('nodes')+1]),'depth':int(final[final.index('depth')+1])}

report={'scope':'Artificial isolated local PocketIC cycle-balance and memory observations. Not public mainnet cycles, a funded deployment, a complete game or guaranteed current billing. Reads an existing test-only engine with no production adapter.', 'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cases':[]}
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
 wasm=(ENGINE/'.cache/asyncify-engine/engine.asyncify.wasm').read_bytes()
 report['wasmSha256']=hashlib.sha256(wasm).hexdigest();report['wasmBytes']=len(wasm)
 assert report['wasmSha256']=='f37127fa26859386344d02d3786705f97b86f2330879f17c532c612df00a81ee'
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
 for budget in [int(x) for x in options.budgets.split(',')]:
  assert 0<budget<=10_000_000
  target=pic.create_canister();pic.add_cycles(target,100_000_000_000_000)
  beforeInstall=pic.get_cycles_balance(target)
  config=hashlib.sha256(b'local-icp-cost-test-only').digest()
  args=ic.encode([{'type':Types.Text,'value':authority.to_str()},{'type':BLOB,'value':config},{'type':Types.Nat64,'value':budget},{'type':Types.Nat32,'value':128}])
  pic.update_call_with_effective_principal(None,{'CanisterId':base64.b64encode(target.bytes).decode()},'install_chunked_code',encode(install,{'mode':{'install':None},'target_canister':target.bytes,'store_canister':[store.bytes],'chunk_hashes_list':hashes,'wasm_module_hash':hashlib.sha256(wasm).digest(),'arg':args}))
  afterInstall=pic.get_cycles_balance(target)
  cold=status(target);before=pic.get_cycles_balance(target);calls=[];started=time.monotonic()
  begin=ic.encode([{'type':Types.Nat32,'value':budget},{'type':Types.Nat32,'value':100000},{'type':Types.Nat32,'value':1}])
  r=None
  while r is None or r['pending']:
   b=pic.get_cycles_balance(target)
   raw=pic.update_call(target,'prototype_begin' if r is None else 'prototype_advance',begin if r is None else ic.encode([]))
   a=pic.get_cycles_balance(target);r=decode(raw,progress)
   calls.append({'step':r['step'],'sampledInstructions':r['instructions'],'localCycleBalanceBefore':b,'localCycleBalanceAfter':a,'localCyclesDebited':b-a})
   assert len(calls)<500 and r['instructions']<40_000_000_000
  after=pic.get_cycles_balance(target);warm=status(target);reference=native(budget)
  assert r['code']==0 and all(r[k]==reference[k] for k in ['bestmove','actual_nodes','depth'])
  row={'position':'Black after full initial history e2e4','targetNodes':budget,'quantum':100000,'updates':len(calls),'final':{k:r[k] for k in ['bestmove','actual_nodes','depth']},'native':reference,'nativeExact':True,'sampledInstructionsTotal':sum(x['sampledInstructions'] for x in calls),'largestSampledUpdate':max(x['sampledInstructions'] for x in calls),'localCyclesDebitedTotal':before-after,'localInstallCyclesDebited':beforeInstall-afterInstall,'coldStatus':cold,'warmStatus':warm,'calls':calls,'localWallSeconds':time.monotonic()-started}
  report['cases'].append(row)
  (ROOT/'pocketic-costs.json').write_text(json.dumps(report,indent=2)+'\n')
  print(json.dumps({k:v for k,v in row.items() if k!='calls'}),flush=True)
 report['completed']=True
finally:
 if pic is not None:pic.server.delete_instance(pic.instance_id);pic.__class__.__del__=lambda self:None
 server.terminate();server.wait(timeout=20);log.close()
 (ROOT/'pocketic-costs.json').write_text(json.dumps(report,indent=2)+'\n')
