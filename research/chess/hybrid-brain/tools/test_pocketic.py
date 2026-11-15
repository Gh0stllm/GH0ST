#!/usr/bin/env python3
"""Actual hybrid coordinator Wasm: closed release gate, authentication and stable upgrade.

Isolated local PocketIC only. No Stockfish inference, RH RPC, threshold signature, funding,
public deployment or paid game is asserted by this harness. Every local server is owned here.
"""
import base64
import datetime
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import time

import ic
from ic.candid import Types
from pocket_ic import PocketIC
from pocket_ic.pocket_ic_server import PocketICServer
from pocket_ic.subnet_config import SubnetConfig
import requests

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT.parent / "engine"
WORK = ROOT / "target/pocketic-gate"
WORK.mkdir(parents=True, exist_ok=True)
BLOB = Types.Vec(Types.Nat8)
CONFIG = Types.Record({"engine_canister": Types.Principal, "relay_canister": Types.Principal, "engine_module_hash": BLOB,
    "game_contract": BLOB, "game_runtime_hash": BLOB, "rpc_url": Types.Text,
    "confirmations": Types.Nat64, "key_name": Types.Text, "reviewed_release": Types.Bool})
STATUS = Types.Record({"production_ready": Types.Bool, "paid_entries_enabled": Types.Bool,
    "blockers": Types.Vec(Types.Text), "engine_config_hash": BLOB,
    "engine_canister": Types.Principal, "stockfish_commit": Types.Text,
    "nnue_sha256": Types.Text, "nodes": Types.Nat64, "hash_mb": Types.Nat32,
    "cache_policy": Types.Text, "attestor_address": Types.Text,
    "chain_id": Types.Nat64, "game_contract": Types.Text})
REQUEST = Types.Record({"game_id": BLOB, "expected_ply": Types.Nat32,
    "expected_position_hash": BLOB, "request_id": BLOB, "moves": Types.Vec(Types.Text)})
BINDING = Types.Record({"game_contract": BLOB, "game_runtime_hash": BLOB})
RESULT = Types.Variant({"Ok": Types.Reserved, "Err": Types.Text})
TEXT_RESULT = Types.Variant({"Ok": Types.Text, "Err": Types.Text})
HTTP = Types.Record({"status": Types.Nat, "body": BLOB,
    "headers": Types.Vec(Types.Record({"name": Types.Text, "value": Types.Text}))})
TRANSFORM = Types.Record({"response": HTTP, "context": BLOB})

def arg(t, value): return [{"type": t, "value": value}]
def encoded(t, value): return ic.encode(arg(t, value))
def decode(raw, t): return ic.decode(bytes(raw), [t])[0]["value"]
def field(value): return len(value).to_bytes(4, "big") + value
def plain(value):
    if isinstance(value, ic.Principal): return value.to_str()
    if isinstance(value, bytes): return value.hex()
    if isinstance(value, dict): return {k: plain(v) for k, v in value.items()}
    if isinstance(value, list): return [plain(v) for v in value]
    return value

report = {"scope": "isolated local PocketIC execution of real hybrid coordinator Wasm; closed launch gates only",
    "not_proven": ["Stockfish coordinator integration", "canonical Robinhood HTTPS outcalls",
        "threshold ECDSA signing", "public deployment", "paid entry or GH0ST payout"],
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
    # PocketIC key_1 is enabled on its fiduciary subnet. The application canister
    # uses the actual local management API to derive its own deterministic key.
    pic = PocketIC(SubnetConfig(application=1, fiduciary=True))
    controller = ic.Principal.self_authenticating(b"gh0st-local-hybrid-coordinator-gate")
    pic.set_sender(controller)
    coordinator = pic.create_canister()
    engine = pic.create_canister()
    relay = pic.create_canister()
    pic.add_cycles(coordinator, 10_000_000_000_000)  # Synthetic local cycles, no ICP converted.
    config = {"engine_canister": engine.bytes, "relay_canister": relay.bytes, "engine_module_hash": bytes([3] * 32),
        "game_contract": bytes([0] * 20), "game_runtime_hash": bytes([0] * 32),
        "rpc_url": "https://rpc.mainnet.chain.robinhood.com", "confirmations": 12,
        "key_name": "key_1", "reviewed_release": False}
    wasm = (ROOT / "target/wasm32-unknown-unknown/release/gh0st_chess_hybrid_brain.wasm").read_bytes()
    # Raw Rust module is larger than the ingress envelope. Install its deterministic gzip;
    # the management canister, rather than this harness, performs Wasm decompression.
    installed = gzip.compress(wasm, mtime=0)
    report.update({"coordinator_wasm_sha256": hashlib.sha256(wasm).hexdigest(), "coordinator_wasm_bytes": len(wasm),
        "installed_gzip_sha256": hashlib.sha256(installed).hexdigest(), "installed_gzip_bytes": len(installed)})
    pic.install_code(coordinator, installed, arg(CONFIG, config))
    actual_status = decode(pic.update_call_with_effective_principal(None,
        {"CanisterId": base64.b64encode(coordinator.bytes).decode()}, "canister_status",
        encoded(Types.Record({"canister_id": Types.Principal}), {"canister_id": coordinator.bytes})),
        Types.Record({"module_hash": Types.Opt(BLOB)}))
    report["installed_module_hash"] = bytes(actual_status["module_hash"][0]).hex()
    assert report["installed_module_hash"] == report["installed_gzip_sha256"]
    status = decode(pic.query_call(coordinator, "get_status", ic.encode([])), STATUS)
    assert status["production_ready"] is False and status["paid_entries_enabled"] is False
    assert status["nodes"] == 24_000_000 and status["hash_mb"] == 128
    assert status["cache_policy"] == "retained-per-game"
    assert status["chain_id"] == 4663 and status["game_contract"] == "0x" + config["game_contract"].hex()
    assert status["attestor_address"] == ""
    assert any("reviewed" in b for b in status["blockers"])
    assert any("signer" in b for b in status["blockers"])
    expected = hashlib.sha256(b"GH0ST_ENGINE_CONFIG_V2_RETAINED\0" + field(engine.bytes)
        + field(status["stockfish_commit"].encode()) + field(status["nnue_sha256"].encode())
        + (24_000_000).to_bytes(8, "big") + (128).to_bytes(4, "big")
        + bytes([1, 20, 0, 1, 1])).digest()
    assert bytes(status["engine_config_hash"]) == expected
    report["checks"].append("real installed Wasm reports immutable 24m retained policy and independent V2 config hash; production and entry gates closed")
    pic.set_anonymous_sender()
    key_reply = decode(pic.update_call(coordinator, "prepare_signer", ic.encode([])), TEXT_RESULT)
    assert key_reply == {"Err": "controller required for one-time signer preparation"}, key_reply
    report["checks"].append("anonymous caller cannot prepare or change threshold signer")
    binding = {"game_contract": bytes([0x11] * 20), "game_runtime_hash": bytes([4] * 32)}
    seal_reply = decode(pic.update_call(coordinator, "seal_release", encoded(BINDING, binding)), RESULT)
    assert seal_reply == {"Err": "controller required for one-time deployment sealing"}, seal_reply
    report["checks"].append("anonymous caller cannot bind or activate a deployment")
    pic.set_sender(controller)
    seal_reply = decode(pic.update_call(coordinator, "seal_release", encoded(BINDING, binding)), RESULT)
    assert seal_reply == {"Err": "derive and review the threshold signer before sealing"}, seal_reply
    report["checks"].append("controller cannot seal before threshold signer derivation")
    derived = decode(pic.update_call(coordinator, "prepare_signer", ic.encode([])), TEXT_RESULT)
    assert "Ok" in derived and len(derived["Ok"]) == 42 and derived["Ok"].startswith("0x"), derived
    status = decode(pic.query_call(coordinator, "get_status", ic.encode([])), STATUS)
    assert status["attestor_address"] == derived["Ok"]
    assert status["production_ready"] is False and status["paid_entries_enabled"] is False
    report["checks"].append("actual local management ECDSA public-key derivation succeeds without opening release or entry")
    report["local_attestor_address"] = derived["Ok"]
    request = {"game_id": bytes([1] * 32), "expected_ply": 1,
        "expected_position_hash": bytes.fromhex("c9cb5a6befffbda841c4de418fb4e83666149e3d322713d35b941ce587060c51"),
        "request_id": bytes([2] * 32), "moves": ["e2e4"]}
    for principal, label in [(None, "anonymous"), (controller, "controller")]:
        if principal is None: pic.set_anonymous_sender()
        else: pic.set_sender(principal)
        result = decode(pic.update_call(coordinator, "request_bot", encoded(REQUEST, request)), RESULT)
        assert result == {"Err": "reviewed release gate closed"}, result
        ready = decode(pic.update_call(coordinator, "refresh_status", ic.encode([])), RESULT)
        assert ready == {"Err": "reviewed release gate closed"}, ready
        report["checks"].append(label + " cannot start inference or mark readiness through the closed release gate")
    raw = pic.query_call(coordinator, "get_job", ic.encode([{"type": BLOB, "value": request["game_id"]}, {"type": Types.Nat32, "value": 1}]))
    assert decode(raw, Types.Opt(Types.Reserved)) == []
    report["checks"].append("rejected request creates no durable job and performs no engine or RH RPC request")
    # Public transform is a pure JSON normalizer; it strips provider-specific headers.
    transformed = decode(pic.query_call(coordinator, "transform", encoded(TRANSFORM, {
        "response": {"status": 200, "headers": [{"name": "Date", "value": "varying"}],
            "body": b'{"result":"0x1237","id":1,"jsonrpc":"2.0"}'}, "context": b""})), HTTP)
    assert transformed["status"] == 200 and transformed["headers"] == []
    assert json.loads(bytes(transformed["body"])) == {"jsonrpc": "2.0", "id": 1, "result": "0x1237"}
    report["checks"].append("actual Wasm HTTP transform removes dynamic headers and preserves normalized JSON RPC body")
    pic.set_sender(controller)
    upgrade_type = Types.Record({"wasm_module": BLOB, "canister_id": Types.Principal, "arg": BLOB,
        "mode": Types.Variant({"upgrade": Types.Null})})
    pic.update_call_with_effective_principal(None, {"CanisterId": base64.b64encode(coordinator.bytes).decode()}, "install_code",
        encoded(upgrade_type, {"wasm_module": installed, "canister_id": coordinator.bytes,
            "arg": ic.encode([]), "mode": {"upgrade": None}}))
    after = decode(pic.query_call(coordinator, "get_status", ic.encode([])), STATUS)
    assert plain(after) == plain(status)
    reply = decode(pic.update_call(coordinator, "request_bot", encoded(REQUEST, request)), RESULT)
    assert reply == {"Err": "reviewed release gate closed"}
    report["checks"].append("immutable configuration and closed admission survive actual same-source canister upgrade")
    report["passed"] = True
    report["check_count"] = len(report["checks"])
    print(json.dumps(report, indent=2), flush=True)
finally:
    if pic is not None:
        pic.server.delete_instance(pic.instance_id)
        pic.__class__.__del__ = lambda self: None
    server.terminate()
    server.wait(timeout=20)
    log.close()
    report["all_owned_processes_stopped"] = True
    (ROOT / "evidence/pocketic-coordinator-gates.json").write_text(json.dumps(report, indent=2) + "\n")
