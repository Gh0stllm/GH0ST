"""Historical affine/NF4 export rehearsal; not the selected compact six-bit format.

No external RPC, signing key, or public broadcasting path. The deployment is data
only, not a working LLM. Cancun gas arithmetic excludes L1 data posting charges.
"""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

import requests
from eth_utils import keccak

ROOT = Path(__file__).resolve().parent


def init_code(payload):
    runtime = b"\0" + payload
    assert 0 < len(runtime) < 65536
    # PUSH2 size; DUP1; PUSH1 12; PUSH1 0; CODECOPY; PUSH1 0; RETURN
    init = b"\x61" + len(runtime).to_bytes(2, "big") + bytes.fromhex("80600c6000396000f3") + runtime
    assert len(init) == len(runtime) + 12
    return init, runtime


def cancun_creation_gas(init, runtime):
    words = (len(runtime) + 31) // 32
    return (53000 + sum(4 if b == 0 else 16 for b in init)
            + 2 * ((len(init) + 31) // 32) + 18 + 6 * words + words * words // 512 + 200 * len(runtime))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--export", required=True, type=Path)
    parser.add_argument("--anvil", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "historical-weight-layouts")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((args.export / "manifest.json").read_text())
    data = (args.export / "weights.bin").read_bytes()
    assert hashlib.sha256(data).hexdigest() == manifest["sha256"]
    assert len(data) == manifest["bytes"]
    # Validate every tensor span and digest before creating a deployment plan.
    cursor = 32
    for tensor in manifest["tensors"]:
        assert tensor["offset"] == cursor
        cursor += tensor["byte_count"]
        assert hashlib.sha256(data[tensor["offset"]:cursor]).hexdigest() == tensor["sha256"]
    assert cursor == len(data)
    plans = []
    for name, payload_limit in [("portable_24KiB", 24575), ("robinhood_candidate_60KiB", 61439)]:
        shards = []
        for index, offset in enumerate(range(0, len(data), payload_limit)):
            payload = data[offset:offset + payload_limit]
            init, runtime = init_code(payload)
            shards.append({"index": index, "offset": offset, "payload_bytes": len(payload),
                "runtime_bytes": len(runtime), "runtime_keccak256": "0x" + keccak(runtime).hex(),
                "init_sha256": hashlib.sha256(init).hexdigest(), "cancun_creation_gas_formula": cancun_creation_gas(init, runtime)})
        plans.append({"name": name, "payload_limit": payload_limit, "shard_count": len(shards),
            "estimated_all_weight_shards_cancun_gas": sum(s["cancun_creation_gas_formula"] for s in shards),
            "max_shard_cancun_gas": max(s["cancun_creation_gas_formula"] for s in shards), "shards": shards})
    report = {"status": "prepared", "variant": manifest["variant"], "weights_sha256": manifest["sha256"],
        "weight_bytes": len(data), "tensor_count": len(manifest["tensors"]), "parameters": manifest["elements"],
        "stage": "weight-data deployment only; full Falcon runtime and tokenizer are not implemented",
        "local_model_manifest": "selected-weight-manifest.json", "public_transactions_broadcast": 0,
        "cost_scope": "Cancun code creation, intrinsic/calldata, initcode and memory gas. Excludes tokenizer, engine, address index, agent and L1 fees.",
        "chain_notes": "60KiB contracts fit Robinhood's documented 96KB code limit. Actual chain transaction gas budget and fees need separate verification.",
        "plans": plans, "local_receipts": []}
    session = requests.Session(); session.trust_env = False
    child = subprocess.Popen([str(args.anvil.resolve()), "--host", "127.0.0.1", "--port", "18549", "--chain-id", "31337",
        "--hardfork", "cancun", "--gas-limit", "16777216", "--code-size-limit", "98304", "--silent"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    def rpc(method, params=()):
        result = session.post("http://127.0.0.1:18549", json={"jsonrpc":"2.0", "id":1, "method":method, "params":list(params)}, timeout=30).json()
        if "error" in result: raise RuntimeError(str(result["error"]))
        return result["result"]
    try:
        for _ in range(100):
            try:
                assert int(rpc("eth_chainId"), 16) == 31337
                break
            except requests.ConnectionError: time.sleep(.05)
        else: raise RuntimeError("Local Anvil did not start")
        account = rpc("eth_accounts")[0]
        for plan in plans:
            for index in sorted({0, len(plan["shards"]) // 2, len(plan["shards"]) - 1}):
                shard = plan["shards"][index]
                init, runtime = init_code(data[shard["offset"]:shard["offset"] + shard["payload_bytes"]])
                tx = rpc("eth_sendTransaction", [{"from":account, "data":"0x" + init.hex(), "gas":hex(16000000)}])
                receipt = None
                for _ in range(100):
                    receipt = rpc("eth_getTransactionReceipt", [tx])
                    if receipt is not None: break
                    time.sleep(.02)
                assert receipt is not None, "Local receipt not mined"
                assert int(receipt["status"], 16) == 1
                actual = bytes.fromhex(rpc("eth_getCode", [receipt["contractAddress"], "latest"])[2:])
                assert actual == runtime
                used = int(receipt["gasUsed"], 16)
                assert used == shard["cancun_creation_gas_formula"], (used, shard)
                report["local_receipts"].append({"plan":plan["name"], "shard":index, "gas_used":used,
                    "runtime_bytes":len(actual), "hash_verified":True, "formula_matches_receipt":True})
        report["status"] = "local_sample_rehearsal_passed"
    finally:
        child.terminate()
        try: child.wait(timeout=5)
        except subprocess.TimeoutExpired: child.kill(); child.wait()
        (args.output_dir / "deployment-manifest.json").write_text(json.dumps(report, indent=2) + "\n")
        (args.output_dir / "selected-weight-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({k:v for k,v in report.items() if k not in ["plans", "local_receipts"]}), flush=True)
    print(json.dumps([{k:v for k,v in p.items() if k != "shards"} for p in plans]), flush=True)
    print(json.dumps(report["local_receipts"]), flush=True)


if __name__ == "__main__": main()
