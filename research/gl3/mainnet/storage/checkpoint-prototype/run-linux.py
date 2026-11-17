"""Isolated native prototype checks. No current STF or engine execution."""
from pathlib import Path
import hashlib
import json
import os
import platform
import signal
import subprocess
import time

if platform.system() != "Linux":
    raise RuntimeError("Runpod Linux only")
root = Path(__file__).resolve().parent
if not str(root).startswith("/root/gl3-checkpoint-prototype/"):
    raise RuntimeError("Fresh isolated prototype directory required")
out = root / "evidence"
out.mkdir(exist_ok=False)
fixture = root / "fixture"
cpus = sorted(os.sched_getaffinity(0))[:4]
os.sched_setaffinity(0, cpus)
go = Path("/root/bounded-restore/toolchain/go/bin/go")
env = {**os.environ, "GOTOOLCHAIN": "local", "GOMAXPROCS": "4", "GOMEMLIMIT": "2500MiB",
       "GOCACHE": "/root/gl3-checkpoint-prototype/go-build-cache", "GOPROXY": "off", "GOSUMDB": "off",
       "GL3_CHECKPOINT_FIXTURE": str(fixture), "GL3_CHECKPOINT_EVIDENCE": str(out),
       "PATH": str(go.parent) + ":" + os.environ["PATH"]}


def save(name, value):
    (out / name).write_text(json.dumps(value, indent=2) + "\n")


def rss_tree(pid):
    rows = {}
    for p in Path("/proc").iterdir():
        if not p.name.isdigit():
            continue
        try:
            s = (p / "stat").read_text()
            values = s[s.rfind(")") + 2:].split()
            rows[int(p.name)] = (int(values[1]), int(values[21]) * os.sysconf("SC_PAGE_SIZE"))
        except (OSError, ValueError):
            pass
    owned = {pid}
    while True:
        new = owned | {p for p, (parent, _) in rows.items() if parent in owned}
        if new == owned:
            break
        owned = new
    return sum(rows.get(p, (0, 0))[1] for p in owned)


def run(name, command, cwd, timeout):
    started, peak, stopped = time.monotonic(), 0, None
    with (out / (name + ".log")).open("w") as log:
        child = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
        save("phase.json", {"phase": name, "childPID": child.pid, "directory": str(root)})
        while child.poll() is None:
            peak = max(peak, rss_tree(child.pid))
            if peak > 4 * 1024**3 or time.monotonic() - started > timeout:
                stopped = "owned_child_memory" if peak > 4 * 1024**3 else "owned_child_deadline"
                os.killpg(child.pid, signal.SIGTERM)
                break
            time.sleep(.25)
        code = child.wait(timeout=30)
    save(name + "-exit.json", {"exitCode": code, "seconds": time.monotonic() - started,
        "sampledOwnedProcessTreePeakRSSBytes": peak, "sampleIntervalSeconds": .25,
        "cpuAffinity": cpus, "stoppedReason": stopped, "allExecutionOnRunpod": True})
    if code or stopped:
        raise RuntimeError(name + " failed; preserve actual log/exit")


extractor = root / "extractor"
extractor.mkdir()
(extractor / "main.go").write_text((root / "extract_fixture.go.txt").read_text())
run("format", [str(go.parent / "gofmt"), "-w", *map(str, sorted(root.glob("*.go"))),
               str(extractor / "main.go")], root, 30)
save("source-manifest.json", {"sources": {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
     for p in [*sorted(root.glob("*.go")), root / "go.mod", Path(__file__), extractor / "main.go"]},
     "allExecutionOnRunpod": True, "engineExecuted": False, "currentSTFChanged": False})
reuse = os.environ.get("GL3_CHECKPOINT_REUSE_FIXTURE")
if reuse:
    prior = Path(reuse).resolve(strict=True)
    if not str(prior).startswith("/root/gl3-checkpoint-prototype/") or prior.name != "fixture":
        raise RuntimeError("Only a previous isolated immutable prototype fixture can be reused")
    metadata = json.loads((prior / "fixture.json").read_text())
    if metadata.get("Completed") is not False or metadata.get("PrestateBlockNumber") != 4916:
        raise RuntimeError("The reused fixture must remain explicitly authenticated preterminal data")
    fixture.symlink_to(prior, target_is_directory=True)
    save("fixture-reuse.json", {"source": str(prior), "sourceMetadataSHA256":
         hashlib.sha256((prior / "fixture.json").read_bytes()).hexdigest(),
         "allBytesAndRootReverificationRequiredByNamedTest": True, "engineExecuted": False})
else:
    run("extractor-build", [str(go), "build", "-p", "4", "-mod=readonly", "-o", str(root / "extract-fixture"),
                           str(extractor / "main.go")], "/root/bounded-restore/nitro", 300)
    run("fixture-extraction", [str(root / "extract-fixture"), str(fixture)], root, 120)
run("prototype-tests", [str(go), "test", "-p", "4", "-json", "-count=1", "."], root, 240)
actions = []
for line in (out / "prototype-tests.log").read_text().splitlines():
    try:
        actions.append(json.loads(line))
    except json.JSONDecodeError:
        pass
passed = [x["Test"] for x in actions if x.get("Action") == "pass" and x.get("Test")]
failed = [x.get("Test", "package") for x in actions if x.get("Action") == "fail"]
if not passed or failed or "TestFrozenAuthenticatedPreterminalCodec" not in passed:
    raise RuntimeError("Actual named prototype/frozen tests must pass")
save("result.json", {"passed": True, "testsAndSubtestsPassed": len(passed), "passedTests": passed,
    "allExecutionOnRunpod": True, "currentSTFChanged": False, "engineExecuted": False,
    "nativeCompletedDecisionCheckpointPassed": False, "guestProofPassed": False,
    "productionAccepted": False, "scope": "Isolated bitmap codec/authenticated-blob emulator and transaction-state harness; authenticated PRETERMINAL bytes plus synthetic completed-state transitions"})
save("phase.json", {"phase": "COMPLETE", "passed": True})
