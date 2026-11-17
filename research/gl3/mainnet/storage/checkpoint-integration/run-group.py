"""Compile/run a named test group in the already isolated A15 source tree."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument("--label", required=True)
parser.add_argument("--pattern")
parser.add_argument("--disabled", action="store_true")
parser.add_argument("--next-decision", action="store_true")
args = parser.parse_args()
if platform.system() != "Linux" or not re.fullmatch(r"[a-z0-9-]+", args.label):
    raise RuntimeError("Runpod Linux and a simple evidence label required")
root = Path(__file__).resolve().parent
if not str(root).startswith("/root/gl3-checkpoint-integration/"):
    raise RuntimeError("Isolated prefix required")
source = root / "nitro"
out = root / "evidence" / args.label
out.mkdir(parents=True, exist_ok=False)
cpus = sorted(os.sched_getaffinity(0))[:4]
os.sched_setaffinity(0, cpus)
go = Path("/root/bounded-restore/toolchain/go/bin/go")
env = {**os.environ, "GOTOOLCHAIN": "local", "GOMAXPROCS": "4", "GOMEMLIMIT": "6GiB",
       "GOCACHE": "/root/gl3-checkpoint-integration/go-cache", "GOPROXY": "off", "GOSUMDB": "off",
       "GL3_CHECKPOINT_EVIDENCE": str(out), "PATH": str(go.parent) + ":" + os.environ["PATH"]}
if args.next_decision:
    env["GL3_CHECKPOINT_NEXT_DECISION"] = "1"


def save(name, value):
    (out / name).write_text(json.dumps(value, indent=2) + "\n")


files = sorted(root.glob("*.go"))
for p in files:
    shutil.copy2(p, source / "precompiles" / p.name)
subprocess.run([str(go.parent / "gofmt"), "-w",
               *[str(source / "precompiles" / p.name) for p in files]], check=True)
save("source-manifest.json", {"sources": {p.name: hashlib.sha256((source / "precompiles" / p.name).read_bytes()).hexdigest()
     for p in files}, "compileCPUAffinity": cpus, "allExecutionOnRunpod": True,
     "baselineEdited": False, "profileEnabled": not args.disabled,
     "nextDecisionRequested": args.next_decision,
     "explicitBuildEnvironment": {k: env[k] for k in ["GOTOOLCHAIN", "GOMAXPROCS", "GOMEMLIMIT", "GOPROXY", "GOSUMDB"]}})
binary = root / (args.label + ".test")
command = [str(go), "test", "-c", "-p", "4", "-mod=readonly", "-o", str(binary)]
if not args.disabled:
    command += ["-tags", "gl3_checkpoint_integration"]
command += ["./precompiles"]
started = time.monotonic()
with (out / "compile.log").open("w") as log:
    compiled = subprocess.run(command, cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
save("compile-exit.json", {"exitCode": compiled.returncode, "seconds": time.monotonic() - started,
     "allExecutionOnRunpod": True, "command": command})
if compiled.returncode:
    raise SystemExit(compiled.returncode)
save("binary.json", {"SHA256": hashlib.sha256(binary.read_bytes()).hexdigest()})
if args.pattern:
    started = time.monotonic()
    with (out / "test.log").open("w") as log:
        tested = subprocess.Popen([str(binary), "-test.run", args.pattern, "-test.v", "-test.timeout", "15m"],
                cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
        save("test-process.json", {"PID": tested.pid, "allExecutionOnRunpod": True})
        peak_rss = 0
        with (out / "resources.csv").open("w") as samples:
            samples.write("seconds,VmRSSKiB,VmHWMKiB\n")
            while tested.poll() is None:
                try:
                    fields = dict(line.split(":", 1) for line in Path(f"/proc/{tested.pid}/status").read_text().splitlines() if ":" in line)
                    rss, hwm = [int(fields.get(k, "0").split()[0]) for k in ["VmRSS", "VmHWM"]]
                    peak_rss = max(peak_rss, rss)
                    samples.write(f"{time.monotonic()-started:.6f},{rss},{hwm}\n")
                    samples.flush()
                except FileNotFoundError:
                    pass
                time.sleep(0.1)
        tested.wait()
    save("test-exit.json", {"exitCode": tested.returncode, "seconds": time.monotonic() - started,
         "allExecutionOnRunpod": True, "pattern": args.pattern, "sampledPeakRSSKiB": peak_rss})
    text = (out / "test.log").read_text()
    named = re.findall(r"^--- PASS: (Test\S+) \(", text, flags=re.M)
    if tested.returncode or not named or "\nPASS\n" not in text:
        raise RuntimeError("Actual named test completion required")
    save("result.json", {"passed": True, "namedTests": named, "allExecutionOnRunpod": True,
         "scope": "Isolated opt-in native EVM test group; not deployment or guest proof"})
