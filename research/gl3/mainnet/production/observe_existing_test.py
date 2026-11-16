"""Recover observability for an owned, still-running terminal acceptance test.

Only the original metrics collector is paused. The Go test and its child nodes
continue untouched. A stopped parent leaves the exited child waitable, so its
actual kernel exit status can be saved before optional metric reads/reaping.
"""
from pathlib import Path
import argparse
import csv
import json
import os
import signal
import time

parser = argparse.ArgumentParser()
parser.add_argument("--test-pid", type=int, required=True)
parser.add_argument("--collector-pid", type=int, required=True)
parser.add_argument("--root", type=Path, required=True)
args = parser.parse_args()
assert args.root.resolve() == Path("/root/terminal-acceptance")
out = args.root / "evidence"
assert "run-terminal-capture.py" in Path(f"/proc/{args.collector_pid}/cmdline").read_text()
assert "system_tests.test" in Path(f"/proc/{args.test_pid}/cmdline").read_text()
initial = Path(f"/proc/{args.test_pid}/stat").read_text().rsplit(")", 1)[1].split()
assert int(initial[1]) == args.collector_pid and initial[0] != "Z"

def optional_integer(*names):
    for name in names:
        p = Path(name)
        if p.exists():
            return int(p.read_text()), name
    return None, None

started = time.monotonic()
metadata = {"testPID": args.test_pid, "pausedCollectorPID": args.collector_pid, "testAndNodeProcessesPaused": False, "observerStartedAfterTestLaunch": True, "actualExitStatusSource": "/proc/<testPID>/stat field52 while original parent is stopped; no guessed exit code"}
os.kill(args.collector_pid, signal.SIGSTOP)
(out / "observer-attachment.json").write_text(json.dumps(metadata, indent=2) + "\n")
try:
    with (out / "terminal-observer-resources.csv").open("w") as f:
        writer = csv.writer(f)
        writer.writerow(["secondsSinceAttach", "testRSSKiB", "kernelTestVmHWMKiB", "cgroupMemoryBytes"])
        while True:
            stat = Path(f"/proc/{args.test_pid}/stat").read_text().rsplit(")", 1)[1].split()
            if stat[0] == "Z":
                raw = int(stat[49])
                code = -(raw & 127) if raw & 127 else raw >> 8
                # Preserve the actual wait status before any optional metrics.
                result = {"exitCode": code, "exitCodeUnavailable": False, "kernelExitStatusRaw": raw, **metadata}
                (out / "terminal-capture-exit.json").write_text(json.dumps(result, indent=2) + "\n")
                break
            values = {}
            for line in Path(f"/proc/{args.test_pid}/status").read_text().splitlines():
                key, _, value = line.partition(":")
                parts = value.split()
                if parts:
                    values[key] = parts[0]
            current, _ = optional_integer("/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes")
            writer.writerow([time.monotonic() - started, values.get("VmRSS", 0), values.get("VmHWM", 0), current])
            f.flush()
            assert time.monotonic() - started < 2400, "observer deadline exceeded"
            time.sleep(1)
    peak, peak_source = optional_integer("/sys/fs/cgroup/memory.peak", "/sys/fs/cgroup/memory/memory.max_usage_in_bytes")
    result.update(cgroupPeakBytes=peak, cgroupPeakSource=peak_source, cgroupPeakIncludesOtherWork=True, secondsSinceObserverAttach=time.monotonic() - started)
    (out / "terminal-capture-exit.json").write_text(json.dumps(result, indent=2) + "\n")
    (out / "phase.json").write_text(json.dumps({"phase": "TERMINAL_CAPTURE_PROCESS_EXITED", **result}, indent=2) + "\n")
finally:
    os.kill(args.collector_pid, signal.SIGCONT)
    metadata.update(originalCollectorResumed=True)
    (out / "observer-attachment.json").write_text(json.dumps(metadata, indent=2) + "\n")
