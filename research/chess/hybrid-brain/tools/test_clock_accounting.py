#!/usr/bin/env python3
"""Diagnose synthetic multi-year PocketIC clock jumps without another engine search."""
import base64, datetime, gzip, hashlib, json, subprocess, time
from pathlib import Path
import requests,ic
from ic.candid import Types
from pocket_ic import PocketIC
from pocket_ic.pocket_ic_server import PocketICServer
from pocket_ic.subnet_config import SubnetConfig
ROOT=Path(__file__).resolve().parents[1];ENGINE=ROOT.parent/'engine';WORK=ROOT/'target/clock-accounting';WORK.mkdir(parents=True,exist_ok=True)
B=Types.Vec(Types.Nat8);T=Types.Text
CONFIG=Types.Record({'engine_canister':Types.Principal,'relay_canister':Types.Principal,'engine_module_hash':B,'game_contract':B,'game_runtime_hash':B,'rpc_url':T,'confirmations':Types.Nat64,'key_name':T,'reviewed_release':Types.Bool})
REQ=Types.Record({'game_id':B,'expected_ply':Types.Nat32,'expected_position_hash':B,'request_id':B,'moves':Types.Vec(T)})
req={'game_id':bytes([1]*32),'expected_ply':1,'expected_position_hash':bytes([2]*32),'request_id':bytes([3]*32),'moves':['e2e4']}
def enc(t,v):return ic.encode([{'type':t,'value':v}])
port=WORK/'port';port.unlink(missing_ok=True);log=(WORK/'server.log').open('w');server=subprocess.Popen([str(ENGINE/'.cache/pocket-ic'),'--port-file',str(port)],stdout=log,stderr=subprocess.STDOUT);pic=None
report={'scope':'isolated closed-gate coordinator update cost under old-clock install versus fresh-clock install; no Stockfish search or real funds','generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
try:
 for _ in range(300):
  if port.exists() and port.read_text().strip():break
  assert server.poll() is None;time.sleep(.1)
 url='http://127.0.0.1:'+port.read_text().strip()
 def connect(self):self.url=url;self.request_client=requests.session()
 PocketICServer.__init__=connect;pic=PocketIC(SubnetConfig(application=1,fiduciary=True));admin=ic.Principal.self_authenticating(b'clock-accounting-fixture');pic.set_sender(admin)
 engine=pic.create_canister();relay=pic.create_canister();config={'engine_canister':engine.bytes,'relay_canister':relay.bytes,'engine_module_hash':bytes([3]*32),'game_contract':bytes(20),'game_runtime_hash':bytes(32),'rpc_url':'https://rpc.mainnet.chain.robinhood.com','confirmations':12,'key_name':'key_1','reviewed_release':False}
 wasm=gzip.compress((ROOT/'target/wasm32-unknown-unknown/release/gh0st_chess_hybrid_brain.wasm').read_bytes(),mtime=0)
 def new():
  c=pic.create_canister();pic.add_cycles(c,100_000_000_000_000);pic.install_code(c,wasm,[{'type':CONFIG,'value':config}]);return c
 old=new();before=pic.get_cycles_balance(old);report['initial_time']=pic.get_time();report['old_canister_before_jump']=before
 stamp=int(datetime.datetime(2026,1,1,tzinfo=datetime.timezone.utc).timestamp())*1_000_000_000;pic.set_time(stamp)
 pic.update_call(old,'request_bot',enc(REQ,req));after=pic.get_cycles_balance(old);report['old_canister_after_first_update']=after
 pic.advance_time(61_000_000_000);pic.update_call(old,'request_bot',enc(REQ,req));last=pic.get_cycles_balance(old);report['old_canister_after_periodic_charge']=last
 fresh=new();fresh_before=pic.get_cycles_balance(fresh);pic.update_call(fresh,'request_bot',enc(REQ,req));fresh_after=pic.get_cycles_balance(fresh)
 report['old_install_clock_jump_debit']=before-last;report['fresh_install_one_update_debit']=fresh_before-fresh_after
 report['large_clock_jump_contaminates_cost']=report['old_install_clock_jump_debit']>report['fresh_install_one_update_debit']*1000
 report['conclusion']='Large debit reproduced' if report['large_clock_jump_contaminates_cost'] else 'The small closed-gate coordinator did not reproduce the large debit; engine/subnet/call-path accounting still needs isolation'
 report['passed']=True;print(json.dumps(report,indent=2),flush=True)
finally:
 if pic is not None:pic.server.delete_instance(pic.instance_id);pic.__class__.__del__=lambda self:None
 server.terminate();server.wait(timeout=20);log.close();report['all_owned_processes_stopped']=True;(ROOT/'evidence/clock-accounting.json').write_text(json.dumps(report,indent=2)+'\n')
