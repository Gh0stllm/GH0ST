#!/usr/bin/env python3
"""Check the first full pinned engine move in a private stock-Stylus rehearsal.

The evidence uses raw JSON-RPC receipts. Progress and terminal events emitted by
the reviewed Stylus contract bind the saved trace to the job, quantum range and
canonical checkpoint. The on-node check also requires separately supplied
runtime code identity and the actual checkpoint file. Offline mode checks
consistency only. Neither mode independently proves instrumentation, measured
wall times, code semantics or public deployment readiness.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


SCHEMA = "gh0st.gl3.stylus.full-move.v1"
GUEST_SHA = "1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc"
MODEL_SHA = "1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2"
CHECKPOINT_SHA = "5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6"
CHECKPOINT_BYTES = 163_085_439
PUBLIC_GL3_GENESIS = "0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483"
PROGRESS_TOPIC = "0x77bc4aa1ec05f0291c5d92eb052d8c0a5105cda48e1a66708557190b518e90cc"
DECISION_TOPIC = "0x4873a8c49ff63c83db54a63b7684299f7176b524d343aa9aba21473c8d777f41"
ARB_SYS = "0x0000000000000000000000000000000000000064"
ARB_WASM = "0x0000000000000000000000000000000000000071"
QUANTA = 9_853
GROUP = 40
MAX_GAS = 32_000_000
MAX_PAGES = 128
RPC_CHUNK_SIZE = 32


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fixed_hex(value, length, label, *, prefixed=True):
    pattern = ("0x" if prefixed else "") + rf"[0-9a-fA-F]{{{length * 2}}}"
    require(isinstance(value, str) and re.fullmatch(pattern, value), f"Invalid {label}")
    return value.lower()


def quantity(value, label):
    require(isinstance(value, str) and re.fullmatch(r"0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)", value), f"Invalid {label}")
    return int(value, 16)


def data_bytes(value, label):
    require(isinstance(value, str) and re.fullmatch(r"0x(?:[0-9a-fA-F]{2})*", value), f"Invalid {label}")
    return bytes.fromhex(value[2:])


def integer(value, label):
    require(type(value) is int and value >= 0, f"Invalid {label}")
    return value


def duration(value, label):
    require(type(value) in (int, float) and math.isfinite(value) and value > 0, f"Invalid {label}")
    return value


def receipt_fields(receipt):
    require(isinstance(receipt, dict), "Missing raw transaction receipt")
    require(quantity(receipt.get("status"), "receipt status") == 1, "Transaction reverted")
    gas_used = quantity(receipt.get("gasUsed"), "receipt gasUsed")
    l1_used = quantity(receipt.get("gasUsedForL1", "0x0"), "receipt gasUsedForL1")
    require(0 <= l1_used < gas_used, "Invalid receipt gas components")
    require(isinstance(receipt.get("logs"), list), "Missing raw receipt logs")
    return {
        "hash": fixed_hex(receipt.get("transactionHash"), 32, "receipt transaction hash"),
        "blockHash": fixed_hex(receipt.get("blockHash"), 32, "receipt block hash"),
        "block": quantity(receipt.get("blockNumber"), "receipt block number"),
        "position": quantity(receipt.get("transactionIndex"), "receipt transaction index"),
        "sender": fixed_hex(receipt.get("from"), 20, "receipt sender"),
        "target": fixed_hex(receipt.get("to"), 20, "receipt target"),
        "gasUsed": gas_used,
        "computeGas": gas_used - l1_used,
    }


def emitted(receipt, contract, topic, job):
    matches = []
    for log in receipt["logs"]:
        if not isinstance(log, dict) or str(log.get("address", "")).lower() != contract:
            continue
        topics = log.get("topics", [])
        if isinstance(topics, list) and topics and str(topics[0]).lower() == topic:
            require(log.get("removed", False) is False and len(topics) == 2, "Malformed or removed chess event")
            if fixed_hex(topics[1], 32, "event job") == job:
                matches.append(data_bytes(log.get("data"), "chess event data"))
    return matches


def validate(evidence, max_operation_ms, max_transfer_p95_ms):
    require(evidence.get("schema") == SCHEMA, "Unknown evidence schema")
    require(evidence.get("opening") == ["e2e4"], "Wrong reference opening")
    require(evidence.get("publicDeployment") is False, "Expected a private fixture, not public deployment evidence")
    require(evidence.get("offchainCompute") is False, "Evidence does not declare stock Stylus execution")
    network = evidence["network"]
    require(network.get("privateFixture") is True and network.get("standardNitro") is True and network.get("arbOSVersion") == 61,
            "Expected standard Nitro ArbOS 61 in a private fixture")
    chain_id = integer(network.get("chainId"), "chain ID")
    genesis = fixed_hex(network.get("genesisHash"), 32, "private genesis hash")
    require(chain_id > 0 and genesis not in (PUBLIC_GL3_GENESIS, "0x" + "00" * 32), "Refusing public GL3 or missing private genesis")
    engine = evidence["engine"]
    require(engine.get("guestSHA256") == GUEST_SHA and engine.get("modelSHA256") == MODEL_SHA,
            "Portable SIMD guest or full NNUE identity differs from the reference")
    contract = fixed_hex(engine.get("contract"), 20, "Stylus contract address")
    job = fixed_hex(evidence.get("jobId"), 32, "chess job ID")
    require(int(contract, 16) > 0xFFFF and int(job, 16) != 0, "Reserved contract address or empty job ID")

    result = evidence["result"]
    require(result.get("move") == "e7e5" and result.get("nodes") == 24_000_033 and result.get("depth") == 38
            and result.get("checkpointSHA256") == CHECKPOINT_SHA, "Full decision differs from the pinned reference")
    expected_decision = (b"e7e5".ljust(32, b"\x00") + (24_000_033).to_bytes(32, "big")
                         + (38).to_bytes(32, "big") + bytes.fromhex(CHECKPOINT_SHA))

    operations = evidence["operations"]
    require(isinstance(operations, list) and len(operations) == math.ceil(QUANTA / GROUP),
            f"Expected {math.ceil(QUANTA / GROUP)} group receipts")
    initial_state = fixed_hex(evidence.get("initialStateSHA256"), 32, "initial state", prefixed=False)
    last_end, last_state, last_location = 0, initial_state, (-1, -1)
    all_receipts, operations_fields, transfer_fields = {}, [], []
    for index, operation in enumerate(operations):
        r = receipt_fields(operation.get("receipt"))
        start = integer(operation.get("startQuantum"), "start quantum")
        end = integer(operation.get("endQuantum"), "end quantum")
        before = fixed_hex(operation.get("preStateSHA256"), 32, "pre-state hash", prefixed=False)
        after = fixed_hex(operation.get("postStateSHA256"), 32, "post-state hash", prefixed=False)
        location = (r["block"], r["position"])
        require(r["target"] == contract, f"Operation {index} receipt does not target the Stylus contract")
        require(r["hash"] not in all_receipts and location > last_location, f"Duplicate or out-of-order operation {index}")
        require(start == last_end and end == min(start + GROUP, QUANTA)
                and before == last_state and before != after, f"Broken quantum or state continuity at operation {index}")

        expected_progress = start.to_bytes(32, "big") + end.to_bytes(32, "big") + bytes.fromhex(before + after)
        require(emitted(operation["receipt"], contract, PROGRESS_TOPIC, job) == [expected_progress],
                f"Operation {index} has no matching progress event")
        decisions = emitted(operation["receipt"], contract, DECISION_TOPIC, job)
        require(decisions == ([expected_decision] if end == QUANTA else []), f"Invalid terminal event at operation {index}")

        require(integer(operation.get("computeGas"), "recorded compute gas") == r["computeGas"] <= MAX_GAS,
                f"Compute gas differs from receipt or exceeds {MAX_GAS} at operation {index}")
        require(0 < integer(operation.get("physicalPages"), "recorded physical pages") <= MAX_PAGES,
                f"Invalid or excess physical pages at operation {index}")
        require(duration(operation.get("wallMs"), "operation wall time") <= max_operation_ms,
                f"Operation {index} exceeded the declared wall-time limit")
        all_receipts[r["hash"]] = operation["receipt"]
        operations_fields.append(r)
        last_end, last_state, last_location = end, after, location

    require(last_end == QUANTA and last_state == fixed_hex(result.get("finalStateSHA256"), 32, "final state", prefixed=False),
            "Missing full search or inconsistent final state")
    transfers = evidence["transfers"]
    require(isinstance(transfers, list) and transfers, "Missing ordinary transfers during the search")
    for transfer in transfers:
        r = receipt_fields(transfer.get("receipt"))
        location = (r["block"], r["position"])
        require(r["target"] != contract and r["hash"] not in all_receipts, "Transfer duplicates or targets the engine")
        first = operations_fields[0]
        require((first["block"], first["position"]) < location < last_location, "Transfer was outside the running search")
        duration(transfer.get("wallMs"), "transfer wall time")
        all_receipts[r["hash"]] = transfer["receipt"]
        transfer_fields.append(r)
    walls = sorted(transfer["wallMs"] for transfer in transfers)
    p95 = walls[math.ceil(len(walls) * 0.95) - 1]
    require(p95 <= max_transfer_p95_ms, "Ordinary-transfer p95 exceeded the declared limit")
    return {
        "chainId": chain_id,
        "genesisHash": genesis,
        "contract": contract,
        "operations": len(operations),
        "quanta": QUANTA,
        "transferCount": len(transfers),
        "transferP95Ms": p95,
        "maxOperationWallMs": max(row["wallMs"] for row in operations),
        "maxOperationComputeGas": max(row["computeGas"] for row in operations),
        "maxPhysicalPagesReported": max(row["physicalPages"] for row in operations),
        "checkpointSHA256": CHECKPOINT_SHA,
    }, all_receipts, operations_fields, transfer_fields


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise ValueError("Private RPC redirects are not allowed")


def rpc_call_batches(url, requests):
    endpoint = urlsplit(url)
    require(endpoint.scheme in ("http", "https") and endpoint.hostname in ("127.0.0.1", "::1", "localhost")
            and endpoint.port is not None and not (endpoint.username or endpoint.password or endpoint.query or endpoint.fragment),
            "Private RPC must use a loopback URL with an explicit port")
    opener = build_opener(ProxyHandler({}), NoRedirect())
    for offset in range(0, len(requests), RPC_CHUNK_SIZE):
        chunk = requests[offset:offset + RPC_CHUNK_SIZE]
        body = json.dumps([
            {"jsonrpc": "2.0", "id": i, "method": method, "params": params}
            for i, (method, params) in enumerate(chunk)
        ]).encode()
        req = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        with opener.open(req, timeout=15) as response:
            reply = json.load(response)
        require(isinstance(reply, list) and len(reply) == len(chunk), "Invalid private RPC batch response")
        indexed = {}
        for row in reply:
            index = row.get("id")
            require(type(index) is int and 0 <= index < len(chunk) and index not in indexed
                    and "result" in row and "error" not in row, "Private RPC request failed or returned duplicate responses")
            indexed[index] = row["result"]
        for i in range(len(chunk)):
            yield indexed[i]


def rpc_verify(url, expected_code_sha, summary, evidence_receipts, operations, transfers, job):
    contract = summary["contract"]
    first, last = operations[0]["block"], operations[-1]["block"]
    binding = [("eth_chainId", []), ("eth_getBlockByNumber", ["0x0", False])]
    for block in (first, last):
        binding.extend([
            ("eth_getCode", [contract, hex(block)]),
            ("eth_call", [{"to": ARB_SYS, "data": "0x051038f2"}, hex(block)]),
            ("eth_call", [{"to": ARB_WASM, "data": "0xcc8f4e88" + contract[2:].rjust(64, "0")}, hex(block)]),
        ])
    chain_id, genesis, *ends = rpc_call_batches(url, binding)
    require(quantity(chain_id, "RPC chain ID") == summary["chainId"] and isinstance(genesis, dict)
            and genesis.get("hash", "").lower() == summary["genesisHash"], "Private RPC chain identity differs from evidence")
    for code, version, program_version in (ends[:3], ends[3:]):
        require(hashlib.sha256(data_bytes(code, "deployed contract code")).hexdigest() == expected_code_sha,
                "Private RPC contract code differs from independently reviewed digest")
        # The ArbSys API reports Nitro's internal ArbOS version with a fixed +55.
        require(int.from_bytes(data_bytes(version, "ArbOS version"), "big") == 116
                and int.from_bytes(data_bytes(program_version, "Stylus activation version"), "big") > 0,
                "Private RPC does not confirm ArbOS 61 and active Stylus code")

    receipts = operations + transfers
    block_numbers = sorted({r["block"] for r in receipts})
    blocks = dict(zip(block_numbers, rpc_call_batches(url, [
        ("eth_getBlockByNumber", [hex(block), False]) for block in block_numbers
    ])))
    transaction_checks = [("eth_getTransactionReceipt", [r["hash"]]) for r in receipts]
    for expected, actual in zip(receipts, rpc_call_batches(url, transaction_checks)):
        require(receipt_fields(actual) == expected, f"Private RPC receipt mismatch for {expected['hash']}")
        b = blocks[expected["block"]]
        index = expected["position"]
        require(isinstance(b, dict) and b.get("hash", "").lower() == expected["blockHash"]
                and index < len(b.get("transactions", [])) and b["transactions"][index].lower() == expected["hash"],
                f"Private canonical block does not contain {expected['hash']} at its recorded position")
        if expected["target"] == contract:
            saved = evidence_receipts[expected["hash"]]
            for topic in (PROGRESS_TOPIC, DECISION_TOPIC):
                require(emitted(actual, contract, topic, job) == emitted(saved, contract, topic, job),
                        f"Private RPC chess event mismatch for {expected['hash']}")

    # Verify that the timed load sent simple, plain-data transactions to addresses
    # without code at each receipt's block. Their timing is still instrumentation.
    transfer_checks = []
    for transfer in transfers:
        transfer_checks.extend([
            ("eth_getTransactionByHash", [transfer["hash"]]),
            ("eth_getCode", [transfer["target"], hex(transfer["block"])]),
        ])
    transfer_results = iter(rpc_call_batches(url, transfer_checks))
    for expected in transfers:
        tx, code = next(transfer_results), next(transfer_results)
        require(isinstance(tx, dict) and tx.get("hash", "").lower() == expected["hash"]
                and tx.get("from", "").lower() == expected["sender"] and tx.get("to", "").lower() == expected["target"]
                and tx.get("input") == "0x" and code == "0x", "Ordinary-transfer load does not match private RPC")


def validate_checkpoint(path):
    require(path.stat().st_size == CHECKPOINT_BYTES, "Wrong canonical checkpoint byte length")
    with path.open("rb") as source:
        actual = hashlib.file_digest(source, "sha256").hexdigest()
    require(actual == CHECKPOINT_SHA, "Canonical checkpoint file does not match reference")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--max-operation-ms", type=float, required=True)
    parser.add_argument("--max-transfer-p95-ms", type=float, required=True)
    parser.add_argument("--checkpoint", type=Path, help="Complete canonical checkpoint output, required for private RPC comparison")
    parser.add_argument("--expected-code-sha256", help="Separately reviewed deployed Stylus code digest")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--private-rpc", help="Loopback RPC URL with explicit port for the private rehearsal")
    mode.add_argument("--offline", action="store_true", help="Check evidence consistency without claiming private receipt verification")
    args = parser.parse_args()
    try:
        duration(args.max_operation_ms, "maximum operation wall time")
        duration(args.max_transfer_p95_ms, "maximum transfer p95")
        if args.private_rpc:
            require(args.checkpoint is not None, "Private RPC comparison requires the actual canonical checkpoint file")
            expected_code_sha = fixed_hex(args.expected_code_sha256, 32, "reviewed code digest", prefixed=False)
        with args.evidence.open(encoding="utf-8") as source:
            evidence = json.load(source)
        summary, saved, operations, transfers = validate(evidence, args.max_operation_ms, args.max_transfer_p95_ms)
        if args.checkpoint:
            validate_checkpoint(args.checkpoint)
        if args.private_rpc:
            rpc_verify(args.private_rpc, expected_code_sha, summary, saved, operations, transfers, evidence["jobId"].lower())
        print(json.dumps({
            **summary,
            "scope": "private-rpc-corroborated-evidence" if args.private_rpc else "offline-evidence-consistency-only",
            "privateReceiptsCorroborated": bool(args.private_rpc),
            "checkpointFileVerified": args.checkpoint is not None,
            "timingAndMemoryScope": "Recorded instrumentation. Review harness, private node, and execution semantics independently.",
            "publicDeploymentVerified": False,
        }, indent=2))
    except (AttributeError, KeyError, OSError, OverflowError, TypeError, ValueError) as exc:
        parser.exit(1, f"Evidence rejected: {exc}\n")


if __name__ == "__main__":
    main()
