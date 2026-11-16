"""Isolated, cloud-only full assertion/challenge acceptance candidate.

Never interpret this script's existence or a compiler success as a passed test.
The final report requires an actual honest one-step win, assertion confirmation
and a confirmed honest edge's stake refund. Private test allocations only.
"""
from pathlib import Path
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import time

assert platform.system() == "Linux" and platform.machine() == "x86_64"
kit = Path(__file__).resolve().parent
root = Path("/root/full-lifecycle")
source = root / "nitro"
out = root / "evidence"
out.mkdir(parents=True, exist_ok=True)
machine_root = "0xc03cf6f44fe1ca3c0826064ba7e5a3c134dc0013a9b994f3355f2ba185116c00"
machine_source = Path("/root/bounded-restore/machine-guard")
assert (machine_source / "module-root.txt").read_text().strip() == machine_root
machines = root / "machines"
machines.mkdir(exist_ok=True)
for name, target in [(machine_root, machine_source), ("latest", machines / machine_root)]:
    link = machines / name
    if not link.exists():
        link.symlink_to(target, target_is_directory=True)

def save(name, value):
    (out / name).write_text(json.dumps(value, indent=2) + "\n")

def phase(name, **extra):
    save("phase.json", {"phase": name, **extra})
    print(name, flush=True)

phase("COPYING_ISOLATED_NATIVE_SOURCE")
if not source.exists():
    shutil.copytree("/root/bounded-restore/nitro", source,
                    ignore=shutil.ignore_patterns(".git", "node_modules"))
for name in ["gl3_terminal_fixture_test.go", "gl3_terminal_challenge_test.go", "gl3_mint_controls_test.go"]:
    shutil.copy2(kit / name, source / "system_tests" / name)
shutil.copy2(kit / "gl3_acceptance.go", source / "precompiles/gl3_acceptance.go")
go = Path("/root/bounded-restore/toolchain/go/bin/go")
binpath = root / "system_tests.test"
env = {**os.environ, "GOTOOLCHAIN": "local", "GOMAXPROCS": "4",
       "PATH": str(go.parent) + ":" + os.environ["PATH"]}
subprocess.run([str(go.parent / "gofmt"), "-w",
                str(source / "system_tests/gl3_terminal_fixture_test.go"),
                str(source / "system_tests/gl3_terminal_challenge_test.go")], check=True)
phase("BUILDING_ISOLATED_LIFECYCLE_FIXTURE")
started = time.monotonic()
with (out / "build.log").open("w") as log:
    if "--reuse-build" in sys.argv:
        previous = json.loads((out / "source-manifest.json").read_text())
        assert hashlib.sha256(binpath.read_bytes()).hexdigest() == previous["binarySHA256"]
        result = subprocess.CompletedProcess([], 0)
        log.write("Reused previously completed native fixture build; runtime machine layout corrected.\n")
    else:
        result = subprocess.run([str(go), "test", "-c", "-tags", "gl3_acceptance,challengetest",
                             "-p", "4", "-mod=mod", "-ldflags=-extldflags=-Wl,-z,noexecstack",
                             "-o", str(binpath), "./system_tests"],
                            cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
save("build-exit.json", {"exitCode": result.returncode, "seconds": time.monotonic() - started})
assert result.returncode == 0, "Preserve failed compiler log; do not launch test"
save("source-manifest.json", {"binarySHA256": hashlib.sha256(binpath.read_bytes()).hexdigest(),
     "sources": {str(p.relative_to(kit)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in kit.iterdir() if p.is_file()},
     "enginePolicyChanged": False, "allExecutionOnRunpod": True, "publicDeployment": False})
env.update(GL3_RESTART_EVIDENCE=str(out), GL3_RESTART_CAPTURE_TERMINAL="1",
           GL3_SLICES_WASM_ROOT=str(machines),
           NITRO_TEST_L1_GETH="/root/terminal-acceptance/bin/geth")
started = time.monotonic()
with (out / "test.log").open("w") as log:
    child = subprocess.Popen([str(binpath), "-test.run", "^TestGL3TerminalResultBoLDLifecycle$",
                              "-test.v", "-test.timeout", "4h"], cwd=source,
                             env=env, stdout=log, stderr=subprocess.STDOUT)
    phase("FULL_NATIVE_DECISION_AND_REAL_CHALLENGE_RUNNING", testPID=child.pid)
    code = child.wait()
# Persist actual process exit before optional log/resource processing.
save("test-exit.json", {"exitCode": code, "seconds": time.monotonic() - started})
assert code == 0, "Preserve failed test evidence; no acceptance"
report = json.loads((out / "full-lifecycle-result.json").read_text())
assert report["passed"] and report["honestOneStepWinner"]
assert report["assertionConfirmationPassed"] and report["stakeSettlementPassed"]
phase("FULL_LIFECYCLE_FIXTURE_PASSED")
