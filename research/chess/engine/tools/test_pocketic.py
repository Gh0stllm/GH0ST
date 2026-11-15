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

ROOT = Path(__file__).resolve().parents[1]
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
parser.add_argument("--budgets",default="10000,100000,1000000")
parser.add_argument("--extended",action="store_true")
parser.add_argument("--cold-tactical",action="store_true")
parser.add_argument("--threat-stress",action="store_true")
parser.add_argument("--output",default="pocketic-verification.json")
options=parser.parse_args()

def encode(t, value): return ic.encode([{"type":t,"value":value}])
def decode(b, t): return ic.decode(bytes(b), [t])[0]["value"]
def plain(x):
    if isinstance(x, bytes): return x.hex()
    if isinstance(x, dict): return {k:plain(v) for k,v in x.items()}
    if isinstance(x, list): return [plain(v) for v in x]
    return x

report = {"scope":"isolated local PocketIC 16.1.0 execution, not mainnet", "generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat(), "tests":[]}
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
    wasm = (ROOT/"build/gh0st_stockfish19.wasm").read_bytes()
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
    # Each budget is a separately committed canister configuration.
    for nodes in [int(x) for x in options.budgets.split(",")]:
        target = pic.create_canister()
        pic.add_cycles(target,100_000_000_000_000)
        config = hashlib.sha256(f"local-feasibility-only:{nodes}:128".encode()).digest()
        args = ic.encode([{"type":Types.Text,"value":authority.to_str()},{"type":BLOB,"value":config},
            {"type":Types.Nat64,"value":nodes},{"type":Types.Nat32,"value":128}])
        start=time.monotonic()
        pic.update_call_with_effective_principal(None,{"CanisterId":base64.b64encode(target.bytes).decode()},"install_chunked_code",encode(install_type,{"mode":{"install":None},"target_canister":target.bytes,
            "store_canister":[store.bytes],"chunk_hashes_list":hashes,"wasm_module_hash":hashlib.sha256(wasm).digest(),"arg":args}))
        print("installed budget",nodes,round(time.monotonic()-start,3),flush=True)
        cases=[("tactical-cold",TACTICAL,[])] if options.cold_tactical else [("start-cold",START,[])]
        if options.threat_stress:
            cases=[("many-changed-threats-cold","k7/2n1n3/1nbNbn2/2NbRBn1/1nbRQR2/2NBRBN1/3N1N2/7K w - - 0 1",[]),
              ("many-changed-threats-2","K7/8/8/BNQNQNB1/N5N1/R1Q1q2r/n5n1/bnqnqnbk w - - 0 1",[])]
        cases += [("start-warm",START,[]),("opening-history",START,"e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6".split())]
        if options.extended:
            cases += [("castling-tactics",TACTICAL,[]),
              ("mate-in-one","7k/5K2/6Q1/8/8/8/8/8 w - - 0 1",[]),
              ("promotion","8/6P1/8/8/8/3k4/8/4K3 w - - 0 1",[]),
              ("endgame","8/2p5/1p1p4/pP1P4/P1P1k3/4P3/4K3/8 w - - 0 1",[])]
        for label, fen, moves in cases:
            req={"job_id":hashlib.sha256(f"{nodes}:{label}".encode()).digest(),"config_hash":config,
                "initial_fen":fen,"moves":moves,"nodes":nodes,"hash_mb":128}
            row={"budget":nodes,"case":label}
            start=time.monotonic()
            try:
                result=decode(pic.update_call(target,"search",encode(REQUEST,req)),RESULT)
                row["result"]=plain(result)
                if "Ok" in result:
                    native=subprocess.run([str(CACHE/"native_probe"),fen,str(nodes),"128"," ".join(moves)],capture_output=True,text=True,timeout=120)
                    parsed=json.loads(native.stdout.strip().splitlines()[-1])
                    expected={k:result["Ok"][k] for k in ["bestmove","actual_nodes","depth"]}
                    assert {k:parsed[k] for k in expected}==expected,("native/ICP divergence",label,parsed,expected)
                    row["native_exact_match"]=True
            except Exception as exc:
                row["error"]=str(exc)
            row["elapsed_seconds"]=round(time.monotonic()-start,3)
            report["tests"].append(row)
            print(json.dumps(row),flush=True)
            (ROOT/"evidence"/options.output).write_text(json.dumps(report,indent=2)+"\n")
            if "error" in row: break
        # Unauthorized callers are rejected before request decoding/search.
        pic.set_anonymous_sender()
        unauthorized=decode(pic.update_call(target,"search",encode(REQUEST,req)),RESULT)
        assert unauthorized == {"Err":"unauthorized authority"}
        pic.set_sender(authority)
        report["tests"].append({"budget":nodes,"case":"unauthorized","result":unauthorized})
    report["completed"]=True
finally:
    if pic is not None:
        pic.server.delete_instance(pic.instance_id)
        pic.__class__.__del__ = lambda self: None
    server.terminate()
    server.wait(timeout=20)
    log.close()
    (ROOT/"evidence"/options.output).write_text(json.dumps(report,indent=2)+"\n")
