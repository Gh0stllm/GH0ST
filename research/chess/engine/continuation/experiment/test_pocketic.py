#!/usr/bin/env python3
"""Install and execute the real ICP Wasm locally. No network identity/funds used.

PocketIC is an isolated local IC execution test, not a public deployment.
The harness owns and terminates its server. Large Wasm uses the real IC chunked
install API; an artificial local cycles balance has no monetary value.
"""
import base64
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import time
import requests
import ic
from ic.candid import Types
from pocket_ic import PocketIC
from pocket_ic.pocket_ic_server import PocketICServer

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT/".cache"
BLOB = Types.Vec(Types.Nat8)
REQUEST = Types.Record({"job_id": BLOB, "config_hash": BLOB, "initial_fen": Types.Text,
    "moves": Types.Vec(Types.Text), "nodes": Types.Nat64, "hash_mb": Types.Nat32})
RESPONSE = Types.Record({"job_id": BLOB, "config_hash": BLOB, "bestmove": Types.Text,
    "actual_nodes": Types.Nat64, "depth": Types.Nat32, "engine_commit": Types.Text,
    "nnue_sha256": Types.Text, "instructions": Types.Nat64, "stop_reason": Types.Text})
RESULT = Types.Variant({"Ok": RESPONSE, "Err": Types.Text})
START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
TACTICAL = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"
parser=argparse.ArgumentParser()
parser.add_argument("--nodes",type=int,default=1000000)
parser.add_argument("--quantum",type=int,default=20000)
parser.add_argument("--positions",default="0,1,2")
parser.add_argument("--output",default="pocketic-1m-evidence.json")
options=parser.parse_args()

def encode(t, value): return ic.encode([{"type":t,"value":value}])
def decode(b, t): return ic.decode(bytes(b), [t])[0]["value"]
def plain(x):
    if isinstance(x, bytes): return x.hex()
    if isinstance(x, dict): return {k:plain(v) for k,v in x.items()}
    if isinstance(x, list): return [plain(v) for v in x]
    return x

report = {"scope":"test-only whole-Stockfish Asyncify across actual local PocketIC update calls; no production adapter, financial action, or mainnet deployment", "generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(), "tests":[]}
port_file = CACHE/"engine-test.port"
port_file.unlink(missing_ok=True)
log = (CACHE/"engine-pocketic.log").open("w")
server = subprocess.Popen([str(CACHE/"pocket-ic"),"--port-file",str(port_file)], stdout=log, stderr=subprocess.STDOUT)
pic = None
try:
    for _ in range(300):
        if port_file.exists() and port_file.read_text().strip(): break
        if server.poll() is not None: raise RuntimeError("PocketIC exited during startup")
        time.sleep(.1)
    else: raise TimeoutError("PocketIC startup")
    url = "http://127.0.0.1:"+port_file.read_text().strip()
    def connect(self):
        self.url = url
        self.request_client = requests.session()
    PocketICServer.__init__ = connect
    pic = PocketIC()
    authority = ic.Principal.self_authenticating(b"gh0st-chess-local-engine-test")
    pic.set_sender(authority)
    store = pic.create_canister()
    pic.add_cycles(store, 100_000_000_000_000)
    wasm = (ROOT/".cache/asyncify-engine/engine.asyncify.wasm").read_bytes()
    report["wasm_sha256"] = hashlib.sha256(wasm).hexdigest()
    report["wasm_bytes"] = len(wasm)
    hashes=[]
    upload_type = Types.Record({"canister_id":Types.Principal,"chunk":BLOB})
    for i, offset in enumerate(range(0,len(wasm),1024*1024)):
        chunk = wasm[offset:offset+1024*1024]
        raw = pic.update_call(None,"upload_chunk",encode(upload_type,{"canister_id":store.bytes,"chunk":chunk}))
        value=decode(raw,Types.Record({"hash":BLOB}))
        assert bytes(value["hash"]) == hashlib.sha256(chunk).digest()
        hashes.append({"hash":value["hash"]})
        if i % 20 == 0: print("uploaded chunks",i+1,flush=True)
    install_type=Types.Record({"mode":Types.Variant({"install":Types.Null}),"target_canister":Types.Principal,
        "store_canister":Types.Opt(Types.Principal),"chunk_hashes_list":Types.Vec(Types.Record({"hash":BLOB})),
        "wasm_module_hash":BLOB,"arg":BLOB})
    progress_type=Types.Record({"pending":Types.Bool,"step":Types.Nat32,"bestmove":Types.Text,"actual_nodes":Types.Nat64,"observed_nodes":Types.Nat64,"depth":Types.Nat32,"code":Types.Int32,"instructions":Types.Nat64})
    for position in [int(x) for x in options.positions.split(",")]:
        target=pic.create_canister();pic.add_cycles(target,100_000_000_000_000)
        config=hashlib.sha256(b"local-asyncify-prototype-only").digest()
        args=ic.encode([{"type":Types.Text,"value":authority.to_str()},{"type":BLOB,"value":config},{"type":Types.Nat64,"value":options.nodes},{"type":Types.Nat32,"value":128}])
        pic.update_call_with_effective_principal(None,{"CanisterId":base64.b64encode(target.bytes).decode()},"install_chunked_code",encode(install_type,{"mode":{"install":None},"target_canister":target.bytes,"store_canister":[store.bytes],"chunk_hashes_list":hashes,"wasm_module_hash":hashlib.sha256(wasm).digest(),"arg":args}))
        budget=options.nodes;every=options.quantum;calls=[];start=time.monotonic()
        begin=ic.encode([{"type":Types.Nat32,"value":budget},{"type":Types.Nat32,"value":every},{"type":Types.Nat32,"value":position}])
        r=decode(pic.update_call(target,"prototype_begin",begin),progress_type);calls.append(r)
        while r["pending"]:
            r=decode(pic.update_call(target,"prototype_advance",ic.encode([])),progress_type);calls.append(r)
            assert len(calls)<2000
            if len(calls)%10==0:print("case",position,"steps",len(calls),"observed",r['observed_nodes'],flush=True)
        fen=START;moves="e2e4" if position==1 else ""
        if position==2:fen=TACTICAL
        n=subprocess.run([str(CACHE/"native_probe"),fen,str(budget),"128",moves],capture_output=True,text=True,check=True,timeout=120)
        native=json.loads(n.stdout.strip().splitlines()[-1])
        exact=all(r[k]==native[k] for k in ['bestmove','actual_nodes','depth'])
        row={"position":position,"target_nodes":budget,"quantum":every,"calls":calls,"native":native,"exact_native_match":exact,"total_instructions":sum(x['instructions'] for x in calls),"maximum_call_instructions":max(x['instructions'] for x in calls),"elapsed_seconds":time.monotonic()-start}
        report['tests'].append(row)
        print({k:v for k,v in row.items() if k!='calls'},flush=True)
        (Path(__file__).resolve().parent/'evidence'/options.output).write_text(json.dumps(report,indent=2)+'\n')
        assert exact and r['code']==0 and len(calls)>1 and row['maximum_call_instructions']<40000000000
    report['completed']=True
finally:
    if pic is not None:
        pic.server.delete_instance(pic.instance_id);pic.__class__.__del__=lambda self:None
    server.terminate();server.wait(timeout=20);log.close()
    (Path(__file__).resolve().parent/'evidence'/options.output).write_text(json.dumps(report,indent=2)+'\n')
