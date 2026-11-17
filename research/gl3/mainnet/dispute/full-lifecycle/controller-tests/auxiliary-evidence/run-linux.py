"""Isolated, cloud-only full assertion/challenge acceptance candidate.

Never interpret this script's existence or a compiler success as a passed test.
The final report requires an actual honest one-step win, assertion confirmation
and a confirmed honest edge's stake refund. Private test allocations only.
"""
from pathlib import Path
import argparse
import fcntl
import hashlib
import json
import os
import platform
import shutil
import subprocess
import time
import uuid
from acceptance_guards import require, validate_acceptance, validate_reuse

require(platform.system() == "Linux" and platform.machine() == "x86_64", "Linux x86_64 is required")
kit = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--reuse-build", action="store_true")
parser.add_argument("--audit-runner", type=Path, required=True,
                    help="Read-only strict audit CLI; starts with the test and requires exact target/refund binding")
args = parser.parse_args()
require(args.audit_runner.is_file() and args.audit_runner.suffix == ".mjs",
        "The strict Node .mjs auditor must be staged before starting a long fixture")
audit_support = args.audit_runner.with_name("terminal-transition.mjs")
require(audit_support.is_file(), "Stage the strict auditor's terminal-transition module before starting")
root = Path("/root/full-lifecycle")
root.mkdir(exist_ok=True)
lock = (root / "runner.lock").open("w")
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
legacy_phase = root / "evidence/phase.json"
if legacy_phase.exists():
    previous_pid = json.loads(legacy_phase.read_text()).get("testPID")
    require(not previous_pid or not Path(f"/proc/{previous_pid}/cmdline").exists(),
            "Do not alter an active legacy fixture")
source = root / "nitro"
run_id = uuid.uuid4().hex
out = root / "runs" / run_id / "evidence"
out.mkdir(parents=True, exist_ok=False)
build_manifest = root / "native-build-manifest.json"
machine_root = "0xc03cf6f44fe1ca3c0826064ba7e5a3c134dc0013a9b994f3355f2ba185116c00"
machine_source = Path("/root/bounded-restore/machine-guard")
require((machine_source / "module-root.txt").read_text().strip() == machine_root,
        "Guarded machine source root mismatch")
machines = root / "machines"
machines.mkdir(exist_ok=True)
for name, target in [(machine_root, machine_source), ("latest", machines / machine_root)]:
    link = machines / name
    if not link.exists():
        link.symlink_to(target, target_is_directory=True)

def save(name, value):
    (out / name).write_text(json.dumps(value, indent=2) + "\n")

def phase(name, **extra):
    save("phase.json", {"phase": name, "runID": run_id, **extra})
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
# Freeze the actual compiled fixture and native inputs, including the shared
# engine source. Hashes are identities, not claims that unexecuted tests passed.
suffixes = {".go", ".c", ".cc", ".cpp", ".h", ".hpp", ".s", ".S", ".a", ".syso", ".wasm", ".nnue", ".mod", ".sum"}
inputs = {}
for label, directory in [("nitro", source), ("engine", Path("/root/bounded-restore/chess"))]:
    for directory_path, dirs, names in os.walk(directory):
        dirs[:] = sorted(d for d in dirs if d not in {".git", "node_modules"})
        for name in sorted(names):
            p = Path(directory_path) / name
            if p.suffix in suffixes:
                inputs[label + "/" + str(p.relative_to(directory))] = hashlib.sha256(p.read_bytes()).hexdigest()
inputs["toolchain/go"] = hashlib.sha256(go.read_bytes()).hexdigest()
inputs["buildOptions"] = "tags=gl3_acceptance,challengetest;mod=mod;noexecstack;linux/amd64"
for name in ["CGO_ENABLED", "CC", "CXX", "CGO_CFLAGS", "CGO_CPPFLAGS", "CGO_CXXFLAGS", "CGO_LDFLAGS",
             "GOAMD64", "GOEXPERIMENT", "GOOS", "GOARCH", "GOFLAGS", "GOTOOLCHAIN", "GOROOT", "GOWORK",
             "PKG_CONFIG", "AR", "PATH"]:
    inputs["env/" + name] = env.get(name, "")
frozen = out / "frozen"
frozen.mkdir()
for name in ["gl3_terminal_fixture_test.go", "gl3_terminal_challenge_test.go", "gl3_mint_controls_test.go"]:
    shutil.copy2(source / "system_tests" / name, frozen / name)
shutil.copy2(source / "precompiles/gl3_acceptance.go", frozen / "gl3_acceptance.go")
shutil.copy2(Path(__file__), frozen / "run-linux.py")
shutil.copy2(kit / "acceptance_guards.py", frozen / "acceptance_guards.py")
auditor_frozen = frozen / "strict-audit.mjs"
shutil.copy2(args.audit_runner, auditor_frozen)
audit_support_frozen = frozen / "terminal-transition.mjs"
shutil.copy2(audit_support, audit_support_frozen)
phase("BUILDING_ISOLATED_LIFECYCLE_FIXTURE")
started = time.monotonic()
with (out / "build.log").open("w") as log:
    if args.reuse_build:
        previous = json.loads(build_manifest.read_text())
        validate_reuse(previous, inputs, hashlib.sha256(binpath.read_bytes()).hexdigest())
        result = subprocess.CompletedProcess([], 0)
        log.write("Reused previously completed native fixture build; runtime machine layout corrected.\n")
    else:
        result = subprocess.run([str(go), "test", "-c", "-tags", "gl3_acceptance,challengetest",
                             "-p", "4", "-mod=mod", "-ldflags=-extldflags=-Wl,-z,noexecstack",
                             "-o", str(binpath), "./system_tests"],
                            cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
save("build-reuse.json" if args.reuse_build else "build-exit.json",
     {"exitCode": result.returncode, "seconds": time.monotonic() - started,
      "reusedExistingBinary": args.reuse_build})
require(result.returncode == 0, "Preserve failed compiler log; do not launch test")
manifest = {"binarySHA256": hashlib.sha256(binpath.read_bytes()).hexdigest(),
     "buildCompleted": True, "buildExitCode": result.returncode,
     "compiledInputs": inputs,
     "sources": {str(p.relative_to(kit)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in kit.iterdir() if p.is_file()},
     "auditRunnerSHA256": hashlib.sha256(auditor_frozen.read_bytes()).hexdigest(),
     "auditSupportSHA256": hashlib.sha256(audit_support_frozen.read_bytes()).hexdigest(),
     "acceptanceGuardsSHA256": hashlib.sha256((kit / "acceptance_guards.py").read_bytes()).hexdigest(),
     "enginePolicyChanged": False, "allExecutionOnRunpod": True, "publicDeployment": False}
if not args.reuse_build:
    build_manifest.write_text(json.dumps(manifest, indent=2) + "\n")
save("source-manifest.json", manifest)
env.update(GL3_RESTART_EVIDENCE=str(out), GL3_RESTART_CAPTURE_TERMINAL="1",
           GL3_LIFECYCLE_RUN_ID=run_id,
           GL3_SLICES_WASM_ROOT=str(machines),
           NITRO_TEST_L1_GETH="/root/terminal-acceptance/bin/geth")
started = time.monotonic()
with (out / "test.log").open("w") as log:
    child = subprocess.Popen([str(binpath), "-test.run", "^TestGL3TerminalResultBoLDLifecycle$",
                              "-test.v", "-test.timeout", "4h"], cwd=source,
                             env=env, stdout=log, stderr=subprocess.STDOUT)
    phase("FULL_NATIVE_DECISION_AND_REAL_CHALLENGE_RUNNING", testPID=child.pid)
    audit_out = out / "audit"
    audit_log = (out / "audit.log").open("w")
    auditor = subprocess.Popen(["node", str(auditor_frozen),
                                "--fixture-evidence", str(out), "--run-id", run_id,
                                "--test-pid", str(child.pid), "--output-dir", str(audit_out)],
                               stdout=audit_log, stderr=subprocess.STDOUT)
    code = child.wait()
# Persist actual process exit before optional log/resource processing.
save("test-exit.json", {"exitCode": code, "seconds": time.monotonic() - started})
try:
    audit_code = auditor.wait(timeout=120)
except subprocess.TimeoutExpired:
    save("audit-exit.json", {"exitCode": None, "timedOut": True})
    raise
finally:
    audit_log.close()
save("audit-exit.json", {"exitCode": audit_code, "timedOut": False})
report = json.loads((out / "full-lifecycle-result.json").read_text())
audit = json.loads((audit_out / "strict-audit.json").read_text())
terminal = json.loads((out / "terminal-input-manifest.json").read_text())
accepted = validate_acceptance(test_exit=code, test_log=(out / "test.log").read_text(),
    report=report, audit_exit=audit_code, audit=audit, terminal=terminal,
    run_id=run_id, module_root=machine_root)
save("acceptance-result.json", accepted)
phase("STRICT_TERMINAL_LIFECYCLE_PASSED")
