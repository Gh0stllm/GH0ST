#!/usr/bin/env python3
"""Actual local ICP API/retry/upgrade tests plus an immutable24m search. No real funds."""
from pathlib import Path
import base64,datetime,hashlib,json,subprocess,time,argparse
import requests,ic
from ic.candid import Types
from pocket_ic import PocketIC
from pocket_ic.pocket_ic_server import PocketICServer
HERE=Path(__file__).resolve().parent;ENGINE=HERE.parent;CACHE=ENGINE/'.cache/optimized-volume/teststate';CACHE.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser();parser.add_argument('--quick',action='store_true');options=parser.parse_args()
B=Types.Vec(Types.Nat8);N32=Types.Nat32;N64=Types.Nat64;T=Types.Text
JOB=Types.Record({'game_id':B,'position_hash':B,'ply':N32,'initial_fen':T,'moves':Types.Vec(T)})
ERR=Types.Record({'code':T,'message':T,'refundable':Types.Bool})
PROGRESS=Types.Record({'game_id':B,'job_id':B,'position_hash':B,'config_hash':B,'ply':N32,'step':N32,'phase':T,'bestmove':T,'actual_nodes':N64,'observed_nodes':N64,'depth':N32,'stop_reason':T,'instructions':N64,'instructions_total':N64,'engine_commit':T,'nnue_sha256':T})
INFO=Types.Record({'coordinator':Types.Principal,'reserved_game':B,'active_job':B,'config_hash':B,'faulted':Types.Bool,'fault_reason':T,'capacity':N32,'cycle_balance':Types.Nat,'retained_jobs':N32,'max_jobs':N32,'nodes':N64,'hash_mb':N32,'quantum':N32,'yield_policy':T,'instruction_target':N64,'engine_commit':T,'nnue_sha256':T})
PR=Types.Variant({'Ok':PROGRESS,'Err':ERR});IR=Types.Variant({'Ok':INFO,'Err':ERR})
def encode(t,v):return ic.encode([{'type':t,'value':v}])
def decode(raw,t):return ic.decode(bytes(raw),[t])[0]['value']
def plain(x):
 if isinstance(x,bytes):return x.hex()
 if isinstance(x,dict):return{k:plain(v) for k,v in x.items()}
 if isinstance(x,list):return[plain(v) for v in x]
 return x
START='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
FEN='rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
report={'scope':'isolated PocketIC engine API and complete immutable24m search; no public deployment, paid entry, token transfer or strength guarantee','generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':[]}
def checkpoint():(HERE/'evidence/pocketic-volume.json').write_text(json.dumps(plain(report),indent=2)+'\n')
def native():
 p=subprocess.Popen([str(ENGINE/'.cache/Stockfish/src/stockfish')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
 def cmd(s):p.stdin.write(s+'\n');p.stdin.flush()
 def until(q):
  rows=[]
  while 1:
   s=p.stdout.readline();assert s,'native EOF';rows.append(s.strip())
   if s.startswith(q):return rows
 try:
  cmd('uci');until('uciok')
  for k,v in [('NumaPolicy','none'),('Threads','1'),('Hash','128'),('Skill Level','20'),('UCI_LimitStrength','false'),('MultiPV','1'),('Ponder','false'),('SyzygyPath','<empty>')]:cmd('setoption name '+k+' value '+v)
  cmd('ucinewgame');cmd('isready');until('readyok');cmd('position fen '+FEN);cmd('go nodes 24000000');rows=until('bestmove');s=[x for x in rows if x.startswith('info depth ')][-1].split()
  return{'bestmove':rows[-1].split()[1],'actual_nodes':int(s[s.index('nodes')+1]),'depth':int(s[s.index('depth')+1])}
 finally:cmd('quit');p.communicate(timeout=30)
report['api_only']=options.quick;report['cost_scope']='Search interval includes duplicate/recovery API calls during the test; excludes reserve/model initialization';report['native']=None if options.quick else native();print('native24m',report['native'],flush=True);checkpoint()
port=CACHE/'pocketic.port';port.unlink(missing_ok=True);log=(CACHE/'server.log').open('w');server=subprocess.Popen([str(ENGINE/'.cache/pocket-ic'),'--port-file',str(port)],stdout=log,stderr=subprocess.STDOUT);pic=None
try:
 for _ in range(300):
  if port.exists() and port.read_text().strip():break
  assert server.poll() is None;time.sleep(.1)
 else:raise TimeoutError('PocketIC startup')
 url='http://127.0.0.1:'+port.read_text().strip()
 def connect(self):self.url=url;self.request_client=requests.session()
 PocketICServer.__init__=connect;pic=PocketIC();pic.set_time(1794700800000000000);admin=ic.Principal.self_authenticating(b'hybrid-engine-local-admin');pic.set_sender(admin)
 coordinator=pic.create_canister();target=pic.create_canister();store=pic.create_canister();pic.add_cycles(target,100_000_000_000_000);pic.add_cycles(store,100_000_000_000_000)
 report['coordinator']=coordinator.to_str();report['target']=target.to_str()
 wasm=(ENGINE/'.cache/optimized-volume/engine.asyncify.wasm').read_bytes();report['wasm_sha256']=hashlib.sha256(wasm).hexdigest();report['wasm_bytes']=len(wasm)
 upload=Types.Record({'canister_id':Types.Principal,'chunk':B});hashes=[]
 for off in range(0,len(wasm),1024*1024):
  chunk=wasm[off:off+1024*1024];r=decode(pic.update_call(None,'upload_chunk',encode(upload,{'canister_id':store.bytes,'chunk':chunk})),Types.Record({'hash':B}));assert bytes(r['hash'])==hashlib.sha256(chunk).digest();hashes.append({'hash':r['hash']})
 install=Types.Record({'mode':Types.Variant({'install':Types.Null,'upgrade':Types.Null}),'target_canister':Types.Principal,'store_canister':Types.Opt(Types.Principal),'chunk_hashes_list':Types.Vec(Types.Record({'hash':B})),'wasm_module_hash':B,'arg':B})
 config=hashlib.sha256(b'GH0ST-OPTIMIZED-24M-RETAINED-LOCAL-TEST').digest()
 def install_mode(mode):
  args=ic.encode([{'type':Types.Principal,'value':coordinator.bytes},{'type':B,'value':config}]) if mode=='install' else ic.encode([])
  return pic.update_call_with_effective_principal(None,{'CanisterId':base64.b64encode(target.bytes).decode()},'install_chunked_code',encode(install,{'mode':{mode:None},'target_canister':target.bytes,'store_canister':[store.bytes],'chunk_hashes_list':hashes,'wasm_module_hash':hashlib.sha256(wasm).digest(),'arg':args}))
 install_mode('install')
 def call(name,payload,typ):return decode(pic.update_call(target,name,payload),typ)
 def check(name,ok):assert ok,name;report['checks'].append(name);checkpoint();print('pass',name,flush=True)
 def er(x,code):return 'Err'in x and x['Err']['code']==code
 game=hashlib.sha256(b'hybrid-test-game-A').digest();game2=hashlib.sha256(b'hybrid-test-game-B').digest()
 check('configured caller rejects non-coordinator reserve',er(call('reserve_game',encode(B,game),IR),'Unauthorized'))
 pic.set_sender(coordinator)
 inf=call('get_info',ic.encode([]),IR)['Ok'];check('immutable24m full strength identity',inf['nodes']==24000000 and inf['hash_mb']==128 and inf['quantum']==0 and inf['yield_policy']=='instruction-budget' and inf['instruction_target']==28000000000 and bytes(inf['config_hash'])==config)
 r=call('reserve_game',encode(B,game),IR);check('reserve capacity1',bytes(r['Ok']['reserved_game'])==game)
 check('other game denied before entry',er(call('reserve_game',encode(B,game2),IR),'Busy'))
 seed_before=pic.get_cycles_balance(target);seed_instructions=call('test_seed_volume',ic.encode([]),Types.Nat64);seed_after=pic.get_cycles_balance(target)
 seeded=call('get_info',ic.encode([]),IR)['Ok'];check('worst-case journal seeded512jobs',seeded['retained_jobs']==512)
 report['volume_shape']={'jobs':512,'cached_replies_per_job':256,'moves_per_job':1024,'seed_instructions':seed_instructions,'seed_cycles_debited':seed_before-seed_after}
 request={'game_id':game,'position_hash':hashlib.sha256(b'volume-real-position').digest(),'ply':0,'initial_fen':FEN,'moves':[]}
 before=pic.get_cycles_balance(target);r=call('begin',encode(JOB,request),PR)['Ok'];after=pic.get_cycles_balance(target)
 check('real fixed24m first quantum survives full journal rewrite',r['phase']=='Pending' and r['step']==1 and r['observed_nodes']>=100000 and r['instructions']<40000000000)
 report['combined_engine_step']={'sampled_instructions_before_persist':r['instructions'],'local_cycles_debited_including_persist_and_reply':before-after,'progress':r}
 up=ic.encode([{'type':B,'value':r['job_id']},{'type':N32,'value':1}]);before=pic.get_cycles_balance(target);r=call('advance',up,PR)['Ok'];after=pic.get_cycles_balance(target)
 check('warm engine advance survives maximum journal',r['phase']=='Pending' and r['step']==2 and r['instructions']<40000000000)
 report['combined_warm_step']={'sampled_instructions_before_persist':r['instructions'],'local_cycles_debited_including_persist_and_reply':before-after,'progress':r}
 report['completed']=True
finally:
 if pic is not None:pic.server.delete_instance(pic.instance_id);pic.__class__.__del__=lambda self:None
 server.terminate();server.wait(timeout=20);log.close();checkpoint()
