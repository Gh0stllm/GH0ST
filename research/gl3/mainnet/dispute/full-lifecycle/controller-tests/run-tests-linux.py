"""Run syntax and pure-predicate tests on an isolated Runpod directory only."""
from pathlib import Path
import hashlib
import json
import platform
import subprocess
import sys
import time

if platform.system() != "Linux":
    raise RuntimeError("This verification must run on the Runpod Linux worker")
kit = Path(__file__).resolve().parents[1]
if not str(kit).startswith("/root/lifecycle-controller-tests/"):
    raise RuntimeError("Use a fresh subdirectory of /root/lifecycle-controller-tests")
out = kit / "controller-tests/evidence"
out.mkdir(exist_ok=False)
files = [kit / "acceptance_guards.py", kit / "run-linux.py", Path(__file__).resolve(),
         kit / "controller-tests/test_acceptance_guards.py"]
manifest = {"sources": {str(p.relative_to(kit)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
            "platform": platform.platform(), "python": sys.version, "allExecutionOnRunpod": True,
            "remoteDirectory": str(kit), "engineExecuted": False, "activeFixtureModified": False}
(out / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
steps = [("syntax", [sys.executable, "-m", "py_compile", *map(str, files)]),
         ("unit", [sys.executable, "-m", "unittest", "discover", "-v", "-s", str(kit / "controller-tests")]),
         ("optimized-unit", [sys.executable, "-O", "-m", "unittest", "discover", "-v", "-s", str(kit / "controller-tests")])]
overall = 0
for name, command in steps:
    started = time.monotonic()
    with (out / (name + ".log")).open("w") as log:
        result = subprocess.run(command, cwd=kit, stdout=log, stderr=subprocess.STDOUT)
    report = {"exitCode": result.returncode, "seconds": time.monotonic() - started,
              "command": command, "allExecutionOnRunpod": True}
    (out / (name + "-exit.json")).write_text(json.dumps(report, indent=2) + "\n")
    if result.returncode:
        overall = result.returncode
        break
(out / "result.json").write_text(json.dumps({"passed": overall == 0, "exitCode": overall,
    "scope": "Future controller syntax and pure false-pass guard regressions only; no engine or chain test",
    "allExecutionOnRunpod": True, "engineExecuted": False}, indent=2) + "\n")
raise SystemExit(overall)
