"""Bounded, isolated offline measurement. Never launches engine or pruner code."""
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
if not str(root).startswith("/root/gl3-checkpoint-study/"):
    raise RuntimeError("A fresh isolated study directory is required")
out = root / "evidence"
out.mkdir(exist_ok=False)
cpus = sorted(os.sched_getaffinity(0))[:2]
os.sched_setaffinity(0, cpus)
env = {**os.environ, "GOTOOLCHAIN": "local", "GOMAXPROCS": "2", "GOMEMLIMIT": "1200MiB",
       "GOFLAGS": "", "PATH": "/root/bounded-restore/toolchain/go/bin:" + os.environ["PATH"]}


def write(name, value):
    (out / name).write_text(json.dumps(value, indent=2) + "\n")


def resources(pid):
    rows = {}
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            raw = (proc / "stat").read_text()
            fields = raw[raw.rfind(")") + 2:].split()
            rows[int(proc.name)] = (int(fields[1]), int(fields[21]) * os.sysconf("SC_PAGE_SIZE"))
        except (OSError, ValueError):
            pass
    owned = {pid}
    while True:
        expanded = owned | {p for p, (parent, _) in rows.items() if parent in owned}
        if expanded == owned:
            break
        owned = expanded
    return sum(rows.get(p, (0, 0))[1] for p in owned)


def step(name, command, cwd, timeout):
    started = time.monotonic()
    peak = 0
    stopped = None
    with (out / (name + ".log")).open("w") as log:
        child = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
        write("phase.json", {"phase": name, "childPID": child.pid, "sourceDirectory": str(root)})
        while child.poll() is None:
            rss = resources(child.pid)
            peak = max(peak, rss)
            if rss > 2 * 1024**3 or time.monotonic() - started > timeout:
                stopped = "owned_child_rss_limit" if rss > 2 * 1024**3 else "owned_child_deadline"
                os.killpg(child.pid, signal.SIGTERM)
                break
            time.sleep(.2)
        code = child.wait(timeout=30)
    result = {"exitCode": code, "seconds": time.monotonic() - started,
              "sampledOwnedProcessTreePeakRSSBytes": peak, "samplePeriodSeconds": .2,
              "cpuAffinity": cpus, "extraRSSLimitBytes": 2 * 1024**3, "stoppedReason": stopped,
              "allExecutionOnRunpod": True}
    write(name + "-exit.json", result)
    if code or stopped:
        raise RuntimeError(name + " failed; preserve actual exit and log")


write("source-manifest.json", {"sources": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
     for p in [root / "measure.go", Path(__file__)]}, "allExecutionOnRunpod": True,
     "engineExecuted": False, "prunerExecuted": False, "sourceDirectory": str(root)})
go = "/root/bounded-restore/toolchain/go/bin/go"
step("build", [go, "build", "-p", "2", "-mod=readonly", "-o", str(root / "measure"),
               str(root / "measure.go")], "/root/bounded-restore/nitro", 180)
step("measurement", [str(root / "measure"), str(out / "measurement.json")], root, 240)
write("phase.json", {"phase": "COMPLETE", "passed": True, "allExecutionOnRunpod": True})
