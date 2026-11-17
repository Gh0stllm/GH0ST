"""Isolated Linux-only verification; no replay, model/source change or lifecycle."""
from pathlib import Path
import hashlib
import json
import os
import platform
import shutil
import subprocess
import time

root = Path(__file__).resolve().parent
if platform.system() != "Linux" or not str(root).startswith("/root/gl3-selected865-steps/"):
    raise RuntimeError("Use the isolated Runpod prefix")
cpus = sorted(os.sched_getaffinity(0))[:2]
os.sched_setaffinity(0, cpus)
out = root / "evidence"
out.mkdir(exist_ok=False)
inputs = root / "inputs"
inputs.mkdir(exist_ok=False)
producer = Path("/root/bounded-restore/fast-comparison/C-combined/interpreter")
module_root = "0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086"
contracts = Path("/root/dispute/repo/research/chess/l3/nitro/.cache/contracts-provenance")


def sha(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def save(name, value):
    (out / name).write_text(json.dumps(value, indent=2) + "\n")


names = ["selected-proofs.json", "selected-proof-manifest.json", "replay-result.json", "exit.json", "prover.log"]
producer_before = {name: sha(producer / name) for name in names}
for name in names:
    shutil.copy2(producer / name, inputs / name)
if sha(inputs / "selected-proofs.json") != "86f5b309042eadf10293f5868305859c26f67bc5edb588a0f660625544a90e18":
    raise RuntimeError("Wrong authentic proof selection")
copies = {name: sha(inputs / name) for name in names}
if copies != producer_before:
    raise RuntimeError("Input copy mismatch")
artifacts = {
    "machine": Path("/root/gl3-selected865-boundary/machines") / module_root / "machine.v2.wavm.br",
    "guest": Path("/root/bounded-restore/fast-comparison/C-combined/replay.wasm"),
    "companion": Path("/root/bounded-restore/machine-inputs/gl3aot.wasm"),
    "originalInput": Path("/root/terminal-acceptance/evidence/terminal-input.json"),
    "wrapper": Path("/root/gl3-selected865-boundary/native/validator/server_arb/bold_machine.go"),
    "contractManifest": contracts / "../../evidence/contract-source-compilation.json",
}
# The earlier source layout keeps the compilation manifest outside the cache.
artifacts["contractManifest"] = Path("/root/dispute/repo/research/chess/l3/nitro/evidence/contract-source-compilation.json")
expected = {
    "machine": "4bf7fe54c28ad0b6f2620df3ee6b4c6d87452f9ab76ec8be294eb7d4c934770e",
    "guest": "8d18145460e5f4c649895728fa089a52a04ead2c3fa5e7d10789d72d7de42fbd",
    "companion": "b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555",
    "originalInput": "bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90",
    "wrapper": "101e7ef583fc7b6c734b8effd496e3d914a7ad5afcbf45b96bd7faf427460664",
}
before = {name: sha(path) for name, path in artifacts.items()}
for name, expected_hash in expected.items():
    if before[name] != expected_hash:
        raise RuntimeError("Pinned artifact mismatch: " + name)
save("identities-before.json", {"artifacts": before, "producer": producer_before, "copiedInputs": copies,
     "sources": {name: sha(root / name) for name in ["run.py", "run.mjs", "TerminalChallengeHarness.sol"]},
     "compileCPUAffinity": cpus, "allExecutionOnRunpod": True})
env = {**os.environ, "GL3_DISPUTE_PACKAGE": "/root/dispute",
       "GL3_CONTRACT_SOURCE": str(contracts / "git/nitro-contracts-4341b132cfbdcc980ead03765ca5224ff6cb5d97"),
       "GL3_CONTRACT_ARTIFACTS": str(contracts / "compiled-main/build/contracts"),
       "GL3_CONTRACT_DEPS": "/root/dispute/deps", "GL3_CONTRACT_MANIFEST": str(artifacts["contractManifest"]),
       "GL3_SELECTED_PROOFS": str(inputs / "selected-proofs.json"),
       "GL3_SELECTED_MANIFEST": str(inputs / "selected-proof-manifest.json"),
       "GL3_REPLAY_RESULT": str(inputs / "replay-result.json"),
       "GL3_RAW_PROVER_LOG": str(inputs / "prover.log"),
       "GL3_TERMINAL_REPORT": str(out / "solidity-report.json")}
started = time.monotonic()
with (out / "solidity.log").open("w") as log:
    process = subprocess.Popen(["node", "--max-old-space-size=2048", str(root / "run.mjs")],
                               cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
    save("process.json", {"PID": process.pid, "allExecutionOnRunpod": True})
    try:
        actual_exit = process.wait(timeout=600)
    except subprocess.TimeoutExpired:
        process.kill()
        actual_exit = process.wait()
        save("timeout.json", {"timedOut": True, "seconds": 600})
save("exit.json", {"exitCode": actual_exit, "seconds": time.monotonic() - started,
     "allExecutionOnRunpod": True})
after = {name: sha(path) for name, path in artifacts.items()}
producer_after = {name: sha(producer / name) for name in names}
save("identities-after.json", {"artifacts": after, "producer": producer_after,
     "artifactsUnchanged": before == after, "producerFilesUnchanged": producer_before == producer_after,
     "allExecutionOnRunpod": True})
if before != after or producer_before != producer_after:
    raise RuntimeError("Frozen inputs changed")
raise SystemExit(actual_exit)
