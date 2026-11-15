#!/usr/bin/env python3
"""Isolated local Wasm gate/upgrade check. No public deployment, real funds or fixtures admitted.

Uses the sibling engine lane's pinned PocketIC installation/Python environment. Each run owns
and terminates its own local server; no other process or canister is touched.
"""
import base64
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
ENGINE = ROOT.parent / "engine"
WORK = ROOT / "target" / "pocketic-gate"
WORK.mkdir(parents=True, exist_ok=True)
BLOB = Types.Vec(Types.Nat8)
ENGINE_CONFIG = Types.Record({"engine_canister": Types.Principal, "stockfish_commit": Types.Text,
    "nnue_sha256": Types.Text, "nodes": Types.Nat64, "hash_mb": Types.Nat32, "cycles_per_search": Types.Nat64})
CONFIG = Types.Record({"entry_attestor": Types.Principal, "rh_vault": BLOB, "engine": ENGINE_CONFIG})
STATUS = Types.Record({"schema_version": Types.Nat32, "production_ready": Types.Bool,
    "paid_entries_enabled": Types.Bool, "engine_config": ENGINE_CONFIG,
    "engine_config_hash": BLOB, "blockers": Types.Vec(Types.Text)})
ENTRY = Types.Record({"game_id": BLOB, "player": BLOB, "player_principal": Types.Principal,
    "principal_hash": BLOB, "nonce": BLOB, "engine_config_hash": BLOB, "chain_id": Types.Nat64,
    "vault": BLOB, "transaction_hash": BLOB, "log_index": Types.Nat32, "opened_at": Types.Nat64,
    "game_deadline": Types.Nat64, "reconciliation_deadline": Types.Nat64})
ERROR = Types.Variant({name: Types.Null for name in ["Unauthorized", "Anonymous", "InvalidConfiguration",
    "InvalidEntry", "EntryAlreadyUsed", "UnknownGame", "Capacity", "WrongPhase", "Expired",
    "StalePosition", "IllegalMove", "RequestConflict", "InvalidEngineResponse", "NoDrawClaim",
    "SearchAlreadyRunning", "ChallengeInactive"]})
RESULT = Types.Variant({"Err": ERROR, "Ok": Types.Null})
def arg(t, value): return [{"type": t, "value": value}]
def decode(raw, t): return ic.decode(bytes(raw), [t])[0]["value"]
def encoded(t, value): return ic.encode(arg(t, value))
def field(value): return len(value).to_bytes(4, "big") + value
def plain(value):
    if isinstance(value, ic.Principal): return value.to_str()
    if isinstance(value, bytes): return value.hex()
    if isinstance(value, dict): return {k: plain(v) for k, v in value.items()}
    if isinstance(value, list): return [plain(v) for v in value]
    return value

report = {"scope": "isolated local PocketIC gate/upgrade execution; no public deployment or paid game",
    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "checks": []}
port_file = WORK / "port"
port_file.unlink(missing_ok=True)
log = (WORK / "server.log").open("w")
server = subprocess.Popen([str(ENGINE / ".cache/pocket-ic"), "--port-file", str(port_file)], stdout=log, stderr=subprocess.STDOUT)
pic = None
try:
    for _ in range(300):
        if port_file.exists() and port_file.read_text().strip(): break
        if server.poll() is not None: raise RuntimeError("PocketIC exited during startup")
        time.sleep(.1)
    else: raise TimeoutError("PocketIC startup")
    url = "http://127.0.0.1:" + port_file.read_text().strip()
    def connect(self):
        self.url = url
        self.request_client = requests.session()
    PocketICServer.__init__ = connect
    pic = PocketIC()
    attestor = ic.Principal.self_authenticating(b"gh0st-local-authority-gate-test")
    pic.set_sender(attestor)
    authority = pic.create_canister()
    engine = pic.create_canister()
    pic.add_cycles(authority, 10_000_000_000_000)  # Synthetic local balance, no monetary value.
    config = {"entry_attestor": attestor.bytes, "rh_vault": bytes([2] * 20), "engine": {
        "engine_canister": engine.bytes, "stockfish_commit": "edb0d9db6731067ec50ce619ff372b463bc4dd5d",
        "nnue_sha256": "1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2",
        "nodes": 10_000, "hash_mb": 128, "cycles_per_search": 1_000_000_000}}
    wasm = (ROOT / "target/wasm32-unknown-unknown/release/gh0st_chess_protocol.wasm").read_bytes()
    report.update({"authority_wasm_sha256": hashlib.sha256(wasm).hexdigest(), "authority_wasm_bytes": len(wasm)})
    pic.install_code(authority, wasm, arg(CONFIG, config))
    status = decode(pic.query_call(authority, "get_status", ic.encode([])), STATUS)
    assert status["production_ready"] is False and status["paid_entries_enabled"] is False
    expected = hashlib.sha256(b"GH0ST_ENGINE_CONFIG_V1\0" + field(engine.bytes)
        + field(config["engine"]["stockfish_commit"].encode()) + field(config["engine"]["nnue_sha256"].encode())
        + (10_000).to_bytes(8, "big") + (128).to_bytes(4, "big")
        + (1_000_000_000).to_bytes(8, "big") + bytes([1, 20, 0, 1, 1])).digest()
    assert bytes(status["engine_config_hash"]) == expected
    report["checks"].append("installed authority Wasm; ready=false; paid entries=false; independent config hash matches")
    entry = {"game_id": bytes([1] * 32), "player": bytes([3] * 20), "player_principal": attestor.bytes,
        "principal_hash": hashlib.sha256(attestor.bytes).digest(), "nonce": bytes([0] * 32),
        "engine_config_hash": expected, "chain_id": 4663, "vault": config["rh_vault"],
        "transaction_hash": bytes([4] * 32), "log_index": 0, "opened_at": 1_000,
        "game_deadline": 87_400, "reconciliation_deadline": 692_200}
    reply = decode(pic.update_call(authority, "accept_entry", encoded(ENTRY, entry)), RESULT)
    assert reply == {"Err": {"ChallengeInactive": None}}, reply
    report["checks"].append("configured attestor cannot bypass entry gate with a supplied receipt blob")
    pic.set_anonymous_sender()
    reply = decode(pic.update_call(authority, "accept_entry", encoded(ENTRY, entry)), RESULT)
    assert reply == {"Err": {"Unauthorized": None}}, reply
    report["checks"].append("anonymous caller rejected")
    pic.set_sender(attestor)
    upgrade_type = Types.Record({"wasm_module": BLOB, "canister_id": Types.Principal, "arg": BLOB,
        "mode": Types.Variant({"upgrade": Types.Null})})
    pic.update_call_with_effective_principal(None, {"CanisterId": base64.b64encode(authority.bytes).decode()}, "install_code",
        encoded(upgrade_type, {"wasm_module": wasm, "canister_id": authority.bytes,
            "arg": ic.encode([]), "mode": {"upgrade": None}}))
    after = decode(pic.query_call(authority, "get_status", ic.encode([])), STATUS)
    assert plain(after) == plain(status)
    report["checks"].append("stable configuration and entry gate survive same-source upgrade")
    report["passed"] = True
    print(json.dumps(report, indent=2), flush=True)
finally:
    if pic is not None:
        pic.server.delete_instance(pic.instance_id)
        pic.__class__.__del__ = lambda self: None
    server.terminate()
    server.wait(timeout=20)
    log.close()
    (ROOT / "evidence/pocketic-authority-gate.json").write_text(json.dumps(report, indent=2) + "\n")
