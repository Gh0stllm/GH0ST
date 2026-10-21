"""Compare the identical Solidity workload using read-only mainnet RPC calls.

No private keys, signing or broadcast methods. Runtime and funding overrides
exist only inside the queried node's simulation. Fees are snapshot estimates.
"""
import argparse
import hashlib
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import rlp
from eth_abi import decode, encode
from eth_utils import keccak

ROOT = Path(__file__).resolve().parent
READ_METHODS = frozenset({"eth_chainId", "eth_getBlockByNumber", "eth_gasPrice",
                          "eth_call", "eth_estimateGas"})
GPO = "0x420000000000000000000000000000000000000F"
NETWORKS = {
    "base": (8453, "https://mainnet.base.org"),
    "robinhood": (4663, "https://rpc.mainnet.chain.robinhood.com"),
}
OPERATIONS = {
    "kernel_deployment": "kernel_creation_data",
    "weight_shard_deployment": "shard_creation_data",
    "four_row_dot": "dot_call_data",
    "four_row_dot_and_first_commit": "commit_call_data",
}


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def eth(wei):
    return str(Decimal(wei) / Decimal(10**18))


def calldata(signature, types=(), values=()):
    return "0x" + (keccak(text=signature)[:4] + encode(types, values)).hex()


def unsigned_eip1559(chain, nonce, priority, price, gas, tx):
    """Typed unsigned RLP; the fee oracle accounts for missing signature bytes."""
    to = bytes.fromhex(tx["to"][2:]) if "to" in tx else b""
    body = [chain, nonce, priority, price, gas, to, 0,
            bytes.fromhex(tx["data"][2:]), []]
    payload = b"\x02" + rlp.encode(body)
    assert len(rlp.decode(payload[1:])) == 9
    return payload


def run_network(name, endpoint, fixture, outdir):
    expected_chain = NETWORKS[name][0]
    report = {
        "network": name, "rpc_endpoint": endpoint, "started_at": utcnow(),
        "status": "running", "transactions_broadcast": 0, "eth_spent": "0",
        "public_contracts_deployed": 0, "temporary_state_overrides": True,
        "input_sha256": hashlib.sha256((ROOT / "simulation-input.json").read_bytes()).hexdigest(),
        "workload": {"rows": 4, "columns": 1024, "multiply_accumulates": 4096,
                     "weight_bytes": 2048, "expected_outputs": fixture["expected_outputs"]},
        "correctness": {}, "estimates": {}, "rpc_observations": [],
        "limitations": [
            "Node simulations are not consensus-recorded transactions or receipts.",
            "Four integer dot products are not a full model block, token or reply.",
            "Input activations are supplied as a fixture, not produced on chain.",
            "Quoted fees can change; dummy addresses and nonce values affect data compression.",
            "No throughput, inclusion latency, full-model cost or Stylus speedup is established.",
            "Different chains use different gas estimators; compare fee estimates, not raw gas counts.",
        ],
    }
    output = outdir / f"comparison-{name}.json"

    def save():
        output.write_text(json.dumps(report, indent=2) + "\n")

    def rpc(method, params):
        if method not in READ_METHODS:
            raise ValueError("Only read-only RPC methods are permitted")
        observed = {"method": method, "requested_at": utcnow()}
        start = time.monotonic()
        try:
            body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
            request = urllib.request.Request(endpoint, data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json", "User-Agent": "OnchainLFM-comparison/0.1"})
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.load(response)
            if "error" in result:
                raise RuntimeError(str(result["error"]))
            observed["ok"] = True
            return result["result"]
        except Exception as error:
            observed.update(ok=False, error=str(error))
            raise
        finally:
            observed["elapsed_seconds"] = round(time.monotonic() - start, 3)
            report["rpc_observations"].append(observed)
            save()

    try:
        chain = int(rpc("eth_chainId", []), 16)
        if chain != expected_chain:
            raise ValueError(f"Unexpected chain {chain}; expected {expected_chain}")
        block = rpc("eth_getBlockByNumber", ["latest", False])
        tag = block["number"]
        quote = int(rpc("eth_gasPrice", []), 16)
        base_fee = int(block["baseFeePerGas"], 16)
        # eth_gasPrice has no block argument. If the latest quote drops below
        # this pinned block's base fee, model a valid price at that base fee.
        price = max(quote, base_fee)
        priority = price - base_fee
        report.update(chain_id=chain, block_number=int(tag, 16), block_hash=block["hash"],
            block_timestamp_utc=datetime.fromtimestamp(int(block["timestamp"], 16), timezone.utc).isoformat(),
            quoted_gas_price_wei=quote, modeled_gas_price_wei=price, block_base_fee_wei=base_fee,
            quote_raised_to_pinned_block_base_fee=quote < base_fee,
            modeled_priority_fee_wei=priority, modeled_max_fee_per_gas_wei=price,
            header_gas_limit=int(block["gasLimit"], 16))
        overrides = {
            fixture["kernel_address"]: {"code": fixture["kernel_runtime"], "state": {}},
            fixture["shard_address"]: {"code": fixture["shard_runtime"]},
            fixture["sender"]: {"balance": hex(10**22), "nonce": "0x0"},
        }

        def oracle(signature, types=(), values=(), result_type="uint256"):
            raw = rpc("eth_call", [{"to": GPO, "data": calldata(signature, types, values)}, tag])
            return decode([result_type], bytes.fromhex(raw[2:]))[0]

        if name == "base":
            report["fee_method"] = "estimateGas * modeledGasPrice + getL1Fee(unsignedType2Tx) + getOperatorFee(estimatedGas)"
            report["fee_oracle"] = GPO
            report["fee_oracle_version"] = oracle("version()", result_type="string")
            report["fjord_enabled"] = oracle("isFjord()", result_type="bool")
        else:
            report["fee_method"] = "estimateGas * modeledGasPrice; Robinhood includes L1 data fees in gas estimate"

        print(json.dumps({"network": name, "block": int(tag, 16), "gas_price_wei": price}), flush=True)
        for index, (op, input_key) in enumerate(OPERATIONS.items()):
            tx = {"from": fixture["sender"], "data": fixture[input_key],
                  "maxFeePerGas": hex(price), "maxPriorityFeePerGas": hex(priority)}
            if op.startswith("four_row"):
                tx["to"] = fixture["kernel_address"]
            try:
                returned = rpc("eth_call", [dict(tx, gas=hex(15_000_000)), tag, overrides])
                if op == "four_row_dot":
                    value = list(decode(["int256[]"], bytes.fromhex(returned[2:]))[0])
                    matches = value == fixture["expected_outputs"]
                elif op == "four_row_dot_and_first_commit":
                    value = returned
                    matches = returned.lower() == fixture["expected_commitment_hex"].lower()
                else:
                    expected = fixture["kernel_runtime" if op == "kernel_deployment" else "shard_runtime"]
                    value = {"runtime_bytes": (len(returned) - 2) // 2,
                             "runtime_sha256": hashlib.sha256(bytes.fromhex(returned[2:])).hexdigest()}
                    matches = returned.lower() == expected.lower()
                report["correctness"][op] = {"matches_reference": matches, "result": value}
                if not matches:
                    raise AssertionError(f"{name}: {op} differs from reference")
                gas = int(rpc("eth_estimateGas", [tx, tag, overrides]), 16)
                item = {"rpc_gas_estimate": gas}
                if name == "base":
                    # Independent transactions: deployments use nonces 0/1; either call uses 2.
                    unsigned = unsigned_eip1559(chain, min(index, 2), priority, price, gas, tx)
                    l1 = oracle("getL1Fee(bytes)", ["bytes"], [unsigned])
                    upper = oracle("getL1FeeUpperBound(uint256)", ["uint256"], [len(unsigned)])
                    operator = oracle("getOperatorFee(uint256)", ["uint256"], [gas])
                    total = gas * price + l1 + operator
                    item.update(l2_execution_fee_wei=gas * price, l1_data_fee_estimate_wei=l1,
                        operator_fee_estimate_wei=operator, l1_data_fee_upper_estimate_wei=upper,
                        total_with_l1_upper_estimate_wei=gas * price + upper + operator,
                        unsigned_transaction_bytes=len(unsigned), unsigned_transaction_hex="0x" + unsigned.hex())
                else:
                    total = gas * price
                    item["bundled_execution_and_data_fee_wei"] = total
                item.update(total_fee_estimate_wei=total, total_fee_estimate_eth=eth(total))
                report["estimates"][op] = item
                print(json.dumps({"network": name, "operation": op, "matches_reference": matches,
                                  "estimated_fee_eth": eth(total)}), flush=True)
            except AssertionError:
                raise
            except Exception as error:
                report["estimates"][op] = {"error": str(error), "total_fee_estimate_wei": None}
                print(json.dumps({"network": name, "operation": op, "error": str(error)}), flush=True)
            save()
        complete = all(report["estimates"].get(op, {}).get("total_fee_estimate_wei") is not None
                       and report["correctness"].get(op, {}).get("matches_reference") is True
                       for op in OPERATIONS)
        report["status"] = "complete_read_only_simulation" if complete else "incomplete"
        if complete:
            names = ["kernel_deployment", "weight_shard_deployment", "four_row_dot_and_first_commit"]
            total = sum(report["estimates"][op]["total_fee_estimate_wei"] for op in names)
            report["tiny_setup_plus_first_commit"] = {"operations": names,
                "total_fee_estimate_wei": total, "total_fee_estimate_eth": eth(total)}
    except Exception as error:
        report.update(status="failed", error=str(error))
        print(json.dumps({"network": name, "error": str(error)}), flush=True)
    finally:
        report["finished_at"] = utcnow()
        save()
    return report


def write_comparison(reports, outdir):
    comparison = {"checked_at": utcnow(), "transactions_broadcast": 0, "eth_spent": "0",
                  "status_by_network": {name: r["status"] for name, r in reports.items()},
                  "operations": {}}
    if reports["base"]["input_sha256"] != reports["robinhood"]["input_sha256"]:
        raise ValueError("Cannot compare different workload inputs")
    if all("block_timestamp_utc" in r for r in reports.values()):
        comparison["snapshot_separation_seconds"] = abs((
            datetime.fromisoformat(reports["base"]["block_timestamp_utc"]) -
            datetime.fromisoformat(reports["robinhood"]["block_timestamp_utc"])).total_seconds())
    for op in OPERATIONS:
        b = reports["base"]["estimates"].get(op, {}).get("total_fee_estimate_wei")
        r = reports["robinhood"]["estimates"].get(op, {}).get("total_fee_estimate_wei")
        if b is not None and r:
            comparison["operations"][op] = {"base_eth": eth(b), "robinhood_eth": eth(r),
                "base_over_robinhood_fee_ratio": str(Decimal(b) / Decimal(r)),
                "base_fee_reduction_percent": str((Decimal(r) - Decimal(b)) * 100 / Decimal(r))}
    (outdir / "chain-comparison.json").write_text(json.dumps(comparison, indent=2) + "\n")
    print(json.dumps(comparison, indent=2), flush=True)
    return comparison


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-rpc", default=NETWORKS["base"][1])
    parser.add_argument("--robinhood-rpc", default=NETWORKS["robinhood"][1])
    parser.add_argument("--output-dir", type=Path, default=ROOT.parent / "results")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    fixture = json.loads((ROOT / "simulation-input.json").read_text())
    reports = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run_network, name, endpoint, fixture, args.output_dir)
                   for name, endpoint in [("base", args.base_rpc), ("robinhood", args.robinhood_rpc)]]
        for future in as_completed(futures):
            report = future.result()
            reports[report["network"]] = report
    write_comparison(reports, args.output_dir)
    if any(r["status"] != "complete_read_only_simulation" for r in reports.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
