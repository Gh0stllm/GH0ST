#!/usr/bin/env python3
"""Run the stock and candidate proof roots in an isolated Nitro validator."""

import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request


STOCK_ROOT = "0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def rpc(url, secret, method, params, timeout):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=")
    message = encode({"alg": "HS256", "typ": "JWT"}) + b"." + encode({"iat": int(time.time())})
    signature = base64.urlsafe_b64encode(hmac.digest(secret, message, "sha256")).rstrip(b"=")
    token = (message + b"." + signature).decode()
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(url, payload, headers={
        "Content-Type": "application/json", "Authorization": "Bearer " + token,
    })
    with urllib.request.urlopen(request, timeout=timeout) as response:
        result = json.load(response)
    if "error" in result:
        raise RuntimeError(f"{method}: {result['error']['message']}")
    return result["result"]


def run(args):
    candidate = json.loads((args.candidate / "assembly.json").read_text())
    root = candidate["moduleRoot"]
    if root == STOCK_ROOT or (args.candidate / "module-root.txt").read_text().strip() != root:
        raise ValueError("Candidate root mismatch")
    if (args.stock / "module-root.txt").read_text().strip() != STOCK_ROOT:
        raise ValueError("Stock module root mismatch")
    if digest(args.candidate / "machine.v2.wavm.br") != candidate["artifacts"]["machine.v2.wavm.br"]["sha256"]:
        raise ValueError("Candidate machine checksum mismatch")
    verified = json.loads(args.verified_report.read_text())["privateProofReplay"]
    if verified["moduleRoot"] != root or not verified["activationBoundaryReplayVerified"]:
        raise ValueError("The fixture report does not match the verified candidate")
    for label in ("before", "after", "bootstrap"):
        source = args.records / f"input-{label}.json"
        expected = verified["checks"][label]
        if digest(source) != expected["inputSHA256"]:
            raise ValueError(f"Unverified input for {label}")
        if json.loads(source.read_text())["ExpectedEndState"] != expected["expectedEndState"]:
            raise ValueError(f"Unverified expected end state for {label}")

    os.umask(0o077)
    work = args.new_workdir.resolve()
    work.mkdir()
    layout = work / "machines"
    layout.mkdir()
    for name, path in [(STOCK_ROOT, args.stock), (root, args.candidate), ("latest", args.stock)]:
        (layout / name).symlink_to(path.resolve(), target_is_directory=True)
    secret = secrets.token_bytes(32)
    jwt = work / "jwt"
    jwt.write_text(secret.hex())
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    config = {
        "log-level": "WARN",
        "validation": {
            "use-jit": not args.arbitrator, "api-auth": True, "api-public": False,
            "jit": {"workers": 2, "jit-path": str(args.jit)},
            "arbitrator": {"workers": 2},
            "wasm": {"root-path": str(layout), "allowed-wasm-module-roots": [STOCK_ROOT, root]},
        },
        "auth": {"addr": "127.0.0.1", "port": port, "jwtsecret": str(jwt)},
        "http": {"addr": ""}, "ws": {"addr": ""}, "ipc": {"path": ""},
        "persistent": {"global-config": str(work / "config")},
    }
    config_path = work / "validator.json"
    config_path.write_text(json.dumps(config, indent=2) + "\n")

    results = []
    with (work / "validator.log").open("xb") as log:
        process = subprocess.Popen([args.validator, "--conf.file", config_path], cwd=work,
                                   stdout=log, stderr=log, start_new_session=True)
        try:
            for _ in range(30):
                if process.poll() is not None:
                    raise RuntimeError("Isolated validator exited during startup")
                try:
                    roots = rpc(url, secret, "validation_wasmModuleRoots", [], 3)
                    break
                except (TimeoutError, urllib.error.URLError):
                    time.sleep(1)
            else:
                raise RuntimeError("Timed out waiting for isolated validator")
            if not {STOCK_ROOT, root}.issubset(roots):
                raise RuntimeError("The isolated validator did not advertise both roots")
            for label, machine in [("before", STOCK_ROOT), ("before", root), ("after", root), ("bootstrap", root)]:
                source = args.records / f"input-{label}.json"
                fixture = json.loads(source.read_text())
                out = rpc(url, secret, "validation_validate", [fixture, machine], 180)
                if out != fixture["ExpectedEndState"]:
                    mismatch = {"fixture": label, "moduleRoot": machine,
                                "expected": fixture["ExpectedEndState"], "actual": out,
                                "passedEarlier": results}
                    (work / "mismatch.json").write_text(json.dumps(mismatch, indent=2) + "\n")
                    raise ValueError(f"Validator global state mismatch for {label} and {machine}")
                results.append({"fixture": label, "moduleRoot": machine, "endState": out, "inputSHA256": digest(source)})
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            jwt.unlink()
    report = {"scope": "Authenticated isolated Nitro validation",
              "mode": "arbitrator" if args.arbitrator else "jit",
              "validated": results, "validatorSHA256": digest(args.validator),
              "productionChanged": False}
    if not args.arbitrator:
        report["jitSHA256"] = digest(args.jit)
    output = json.dumps(report, indent=2) + "\n"
    (work / "result.json").write_text(output)
    print(output, end="")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("validator", "jit", "stock", "candidate", "records", "new_workdir", "verified_report"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--arbitrator", action="store_true", help="Validate with the WAVM proof interpreter")
    run(parser.parse_args())
