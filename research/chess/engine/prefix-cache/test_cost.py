#!/usr/bin/env python3
"""Actual local13-node IC execution of synthetic stable read/hash/copy costs.

No deployed canister, Stockfish search, key, payment or production cache.
"""
from pathlib import Path
import base64,datetime,gzip,hashlib,json,subprocess,time
import requests,ic
from ic.candid import Types
from pocket_ic import PocketIC
from pocket_ic.pocket_ic_server import PocketICServer
from pocket_ic.subnet_config import SubnetConfig,SubnetKind
HERE=Path(__file__).resolve().parent;ENGINE=HERE.parent;CACHE=ENGINE/'.cache/prefix-cache-cost';CACHE.mkdir(exist_ok=True)
OUT=HERE/'evidence/pocketic-synthetic-cost.json';OUT.parent.mkdir(exist_ok=True)
B=Types.Vec(Types.Nat8);COST=Types.Record({'ok':Types.Bool,'phase':Types.Text,'bytes':Types.Nat32,'checksum':Types.Text,'read_instructions':Types.Nat64,'hash_instructions':Types.Nat64,'copy_instructions':Types.Nat64,'verify_instructions':Types.Nat64,'total_instructions':Types.Nat64})
report={'scope':'Actual isolated13-node PocketIC execution of SYNTHETIC stable snapshot copy/checksum, not a Stockfish cache','generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tests':[],'checks':[],'paid_mainnet_actions':0}
def save():OUT.write_text(json.dumps(report,indent=2)+'\n')
def dec(raw,t):return ic.decode(bytes(raw),[t])[0]['value']
def enc(t,x):return ic.encode([{'type':t,'value':x}])
port=CACHE/'pocketic.port';port.unlink(missing_ok=True);log=(CACHE/'server.log').open('w');server=subprocess.Popen([str(ENGINE/'.cache/pocket-ic'),'--port-file',str(port)],stdout=log,stderr=subprocess.STDOUT);pic=None
try:
 for _ in range(300):
  if port.exists() and port.read_text().strip():break
  if server.poll() is not None:raise RuntimeError('PocketIC startup failure')
  time.sleep(.1)
 else:raise TimeoutError('PocketIC port')
 url='http://127.0.0.1:'+port.read_text().strip()
 def connect(self):self.url=url;self.request_client=requests.session()
 PocketICServer.__init__=connect;pic=PocketIC(SubnetConfig(application=1));pic.set_time(1794700800000000000)
 app=next(s for s,k in pic.topology().items() if k==SubnetKind.APPLICATION);admin=ic.Principal.self_authenticating(b'prefix-cache-cost-only');pic.set_sender(admin)
 target=pic.create_canister(subnet=app);pic.add_cycles(target,100_000_000_000_000)
 wasm=(CACHE/'build/gh0st_prefix_restore_cost.wasm').read_bytes();report['wasm_sha256']=hashlib.sha256(wasm).hexdigest();report['wasm_bytes']=len(wasm);report['application_subnet']=app.to_str();assert pic.get_subnet(target).to_str()==app.to_str()
 installed=gzip.compress(wasm,mtime=0);report['installed_gzip_sha256']=hashlib.sha256(installed).hexdigest();pic.install_code(target,installed,[])
 def call(method,args):
  before=pic.get_cycles_balance(target);started=time.monotonic();raw=pic.update_call(target,method,args);after=pic.get_cycles_balance(target);r=dec(raw,COST)
  r.update(method=method,cycles_debit=before-after,local_wall_seconds=time.monotonic()-started);report['tests'].append(r);save();print(method,r['bytes'],r['phase'],r['cycles_debit'],flush=True);return r
 for size in [32*1024*1024,160*1024*1024]:
  seeded=call('seed',enc(Types.Nat32,size));assert seeded['ok'] and seeded['bytes']==size
  restored=call('restore',ic.encode([]));assert restored['ok'] and restored['checksum']==seeded['checksum']
  report['checks'].append('stable-read plus two SHA256 checks and live copy '+str(size));save()
  if size==160*1024*1024:
   second=call('restore',ic.encode([]));assert second['ok'] and second['checksum']==seeded['checksum'];report['checks'].append('warm160MiB restore repeated')
   call('corrupt',ic.encode([]));bad=call('restore',ic.encode([]));assert not bad['ok'] and bad['phase']=='checksum_rejected_before_mutation';report['checks'].append('corrupt stable payload rejected before live copy')
   live=call('inspect',ic.encode([]));assert live['ok'];report['checks'].append('failed restore preserves live payload')
 status=dec(pic.update_call_with_effective_principal(None,{'CanisterId':base64.b64encode(target.bytes).decode()},'canister_status',enc(Types.Record({'canister_id':Types.Principal}),{'canister_id':target.bytes})),Types.Record({'cycles':Types.Nat,'reserved_cycles':Types.Nat,'memory_size':Types.Nat}))
 assert status['reserved_cycles']==0
 report['final_status']=status;report['replication_basis']='Explicit Application topology; PocketIC16.1 source subnet_size(Application)=13, pinned in ../hybrid-brain/evidence/subnet-sizing.json'
 report['topology']=pic._instance_get('read/topology');report['passed']=True
finally:
 if pic is not None:pic.server.delete_instance(pic.instance_id);pic.__class__.__del__=lambda self:None
 server.terminate();server.wait(timeout=20);log.close();report['all_owned_processes_stopped']=True;save()
