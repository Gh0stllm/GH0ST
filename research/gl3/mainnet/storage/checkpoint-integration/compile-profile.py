"""Compile only the isolated opt-in native profile; never edits baseline source."""
from pathlib import Path
import hashlib
import json
import os
import platform
import shutil
import subprocess
import time

if platform.system() != "Linux":
    raise RuntimeError("Runpod Linux only")
root = Path(__file__).resolve().parent
if not str(root).startswith("/root/gl3-checkpoint-integration/"):
    raise RuntimeError("Isolated source prefix required")
out = root / "evidence"
out.mkdir(exist_ok=False)
source = root / "nitro"
baseline = Path("/root/bounded-restore/nitro")
cpus = sorted(os.sched_getaffinity(0))[:4]
os.sched_setaffinity(0, cpus)
go = Path("/root/bounded-restore/toolchain/go/bin/go")
env = {**os.environ, "GOTOOLCHAIN": "local", "GOMAXPROCS": "4", "GOMEMLIMIT": "2500MiB",
       "GOCACHE": "/root/gl3-checkpoint-integration/go-cache", "GOPROXY": "off", "GOSUMDB": "off",
       "PATH": str(go.parent) + ":" + os.environ["PATH"]}


def save(name, value):
    (out / name).write_text(json.dumps(value, indent=2) + "\n")


def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


legacy = ["precompiles/ArbGhostChessSlices.go", "precompiles/ArbGhostChessSliceDelta.go",
          "precompiles/ArbGhostChessSlicesHistory.go"]
before = {name: digest(baseline / name) for name in legacy}
save("phase.json", {"phase": "COPYING_ISOLATED_SOURCE"})
subprocess.run(["cp", "-a", "--reflink=auto", str(baseline), str(source)], check=True)
for p in root.glob("*.go"):
    shutil.copy2(p, source / "precompiles" / p.name)
registry = source / "precompiles/precompile.go"
text = registry.read_text()
anchor = "insert(makeGhostChessSlicesPrecompile())"
if text.count(anchor) != 1:
    raise RuntimeError("Pinned legacy registry anchor changed")
registry.write_text(text.replace(anchor, anchor + "\n\tinsertGhostChessCheckpointProfile(insert)"))
new_sources = list(root.glob("*.go"))
subprocess.run([str(go.parent / "gofmt"), "-w", str(registry),
                *[str(source / "precompiles" / p.name) for p in new_sources]], check=True)
save("source-manifest.json", {"baseline": before,
     "copiedLegacy": {name: digest(source / name) for name in legacy},
     "newProfileSources": {p.name: digest(source / "precompiles" / p.name) for p in new_sources},
     "registrySHA256": digest(registry), "compileCPUAffinity": cpus,
     "allExecutionOnRunpod": True, "baselineEdited": False, "enginePolicyChanged": False,
     "profileBuildTag": "gl3_checkpoint_integration", "address": "0xa15"})
save("phase.json", {"phase": "COMPILING_OPT_IN_NATIVE_PROFILE"})
started = time.monotonic()
with (out / "compile.log").open("w") as log:
    result = subprocess.run([str(go), "test", "-c", "-tags", "gl3_checkpoint_integration", "-p", "4",
             "-mod=readonly", "-o", str(root / "precompiles.test"), "./precompiles"],
             cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
save("compile-exit.json", {"exitCode": result.returncode, "seconds": time.monotonic() - started,
     "allExecutionOnRunpod": True, "compileCPUAffinity": cpus})
after = {name: digest(baseline / name) for name in legacy}
save("baseline-after.json", {"before": before, "after": after, "unchanged": before == after})
if result.returncode:
    raise RuntimeError("Profile compilation failed; preserve actual exit/log")
save("binary.json", {"SHA256": digest(root / "precompiles.test"), "engineExecuted": False,
     "testsExecuted": False, "productionAccepted": False})
save("phase.json", {"phase": "PROFILE_COMPILED_NOT_TESTED", "passed": True})
