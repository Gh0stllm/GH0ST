"""Read-only regression run against the selected native tree, on Runpod only."""
from pathlib import Path
import hashlib
import json
import os
import platform
import signal
import subprocess
import time

assert platform.system() == "Linux" and platform.machine() == "x86_64"
root = Path("/root/bounded-restore")
source = root / "fast-comparison/C-combined/native"
out = root / "ethereum-state-regression"
out.mkdir(exist_ok=False)
go = root / "toolchain/go/bin/go"
tracked = [
    source / "go.mod", source / "go.sum",
    source / "go-ethereum/go.mod", source / "go-ethereum/go.sum",
    source / "go-ethereum/core/state/state_object.go",
    source / "go-ethereum/core/state/statedb.go",
    source / "go-ethereum/core/state/journal.go",
]


def identities():
    return {str(p.relative_to(source)): hashlib.file_digest(p.open("rb"), "sha256").hexdigest() for p in tracked}


before = identities()
args = [str(go), "test", "-p", "2", "-mod=readonly", "-count=1", "-timeout=25m", "-json", "github.com/ethereum/go-ethereum/core/state"]
env = {**os.environ, "GOTOOLCHAIN": "local", "GOMAXPROCS": "2", "PATH": str(go.parent) + ":" + os.environ["PATH"]}
started = time.monotonic()
timed_out = False
kill_after = None
with (out / "go-test.jsonl").open("w") as log:
    child = subprocess.Popen(args, cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    (out / "process.json").write_text(json.dumps({"pid": child.pid, "collectorPID": os.getpid(), "args": args, "cwd": str(source), "startedAtUTC": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "sourceSHA256Before": before, "allExecutionOnRunpod": True}, indent=2) + "\n")
    while True:
        pid, status, usage = os.wait4(child.pid, os.WNOHANG)
        if pid:
            code = os.waitstatus_to_exitcode(status)
            child.returncode = code
            exit_record = {"exitCode": code, "seconds": time.monotonic() - started, "timedOut": timed_out, "kernelMaxChildRSSKiB": usage.ru_maxrss, "retrieval": "os.wait4 direct child"}
            (out / "exit.json").write_text(json.dumps(exit_record, indent=2) + "\n")
            break
        if not timed_out and time.monotonic() - started > 1800:
            timed_out = True
            kill_after = time.monotonic() + 15
            os.killpg(child.pid, signal.SIGTERM)
        elif timed_out and kill_after is not None and time.monotonic() > kill_after:
            os.killpg(child.pid, signal.SIGKILL)
            kill_after = None
        time.sleep(2)
events = []
unparsed = []
for line in (out / "go-test.jsonl").read_text().splitlines():
    try:
        events.append(json.loads(line))
    except json.JSONDecodeError:
        unparsed.append(line)
passed = [e["Test"] for e in events if e.get("Action") == "pass" and "Test" in e]
failed = [e for e in events if e.get("Action") == "fail"]
skipped = [e["Test"] for e in events if e.get("Action") == "skip" and "Test" in e]
packages = [e for e in events if e.get("Action") == "pass" and "Test" not in e]
after = identities()
report = {**exit_record, "passed": code == 0 and not timed_out and len(passed) > 0 and len(packages) == 1 and not failed and before == after, "namedTestAndSubtestPassCount": len(passed), "topLevelTestPassCount": sum("/" not in t for t in passed), "passedTests": passed, "failedEvents": failed, "skippedTests": skipped, "packagePassEvents": packages, "unparsedLines": unparsed, "sourceUnchanged": before == after, "sourceSHA256Before": before, "sourceSHA256After": after, "allExecutionOnRunpod": True, "engineExecuted": False, "scope": "Full non-short upstream core/state package plus selected code-cache regressions; not all Geth packages, node crash recovery, an engine proof, or mainnet acceptance."}
(out / "result.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({k: v for k, v in report.items() if k not in ["passedTests", "sourceSHA256Before", "sourceSHA256After"]}), flush=True)
raise SystemExit(0 if report["passed"] else 1)
