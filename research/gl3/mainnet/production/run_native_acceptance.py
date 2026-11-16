"""Build and run production acceptance in an isolated Linux Runpod tree.

Requires the source/artifact bundle, native Rust library and exact custom
machine prepared by the parent orchestration. No wallet or public RPC is used.
"""
from pathlib import Path
import argparse
import json
import os
import platform
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--wasm-root", type=Path, required=True)
parser.add_argument("--capture-terminal", action="store_true")
parser.add_argument("--reuse-native-build", action="store_true")
args = parser.parse_args()
assert platform.system() == "Linux" and platform.machine() == "x86_64"
ROOT = Path("/root/gl3-node")
nitro = ROOT / "nitro"
out = ROOT / "production-evidence"
out.mkdir(exist_ok=True)

def phase(label, **extra):
    (out / "phase.json").write_text(json.dumps({"phase": label, "pid": os.getpid(), **extra}, indent=2) + "\n")
    print(label, flush=True)

phase("BUILDING_NATIVE_ACCEPTANCE")
for relative in ["precompiles/gl3_acceptance.go", "system_tests/gl3_restart_acceptance_test.go", "system_tests/gl3_mint_controls_test.go"]:
    (nitro / relative).write_bytes((HERE / "fixtures" / relative).read_bytes())
source_path = HERE.parent / "native-cloud.py"
if not source_path.exists():
    source_path = Path("/root/native-cloud.py")
source = source_path.read_text()
source = source[:source.index("results=ROOT/")]
marker = "env={**os.environ"
assert source.count(marker) == 1
source = source.replace(marker, "run([sys.executable, '/root/production/harden_native_stack.py', '--root', ROOT])\n\n" + marker)
source = "import sys\n" + source
# Change the link action as well as the source object. Go's package cache does
# not by itself establish that an externally changed archive was relinked.
source = source.replace("'-mod=mod','-o'", "'-mod=mod','-ldflags=-extldflags=-Wl,-z,noexecstack','-o'")
test_marker = "run([go,'test','-c','-p','8','-mod=mod','-ldflags=-extldflags=-Wl,-z,noexecstack','-o',bin_dir/'system_tests.test','./system_tests'],cwd=nitro,env=env)"
assert test_marker in source
source = source.replace(test_marker, test_marker.replace("'test','-c',", "'test','-c','-tags','gl3_acceptance',"))
if args.reuse_native_build:
    assert (ROOT / "bin/nitro").is_file()
    go = ROOT / "toolchain/go/bin/go"
    build_env = {**os.environ, "GOTOOLCHAIN": "local", "GOMAXPROCS": "12", "PATH": str(go.parent) + ":/root/.cargo/bin:" + os.environ["PATH"]}
    subprocess.run([str(go), "test", "-c", "-tags", "gl3_acceptance", "-p", "8", "-mod=mod", "-ldflags=-extldflags=-Wl,-z,noexecstack", "-o", str(ROOT / "bin/system_tests.test"), "./system_tests"], cwd=nitro, env=build_env, check=True)
else:
    namespace = {"__name__": "__main__"}
    exec(compile(source, str(source_path), "exec"), namespace)
subprocess.run([sys.executable, str(HERE / "harden_native_stack.py"), "--root", str(ROOT), "--verify-binary", str(ROOT / "bin/nitro")], check=True)
phase("NATIVE_BUILD_AND_NONEXECUTABLE_STACK_VERIFIED")
assert (ROOT / "bin/geth").is_file(), "build the pinned parent Geth before starting the acceptance fixture"
env = {**os.environ, "GL3_RESTART_EVIDENCE": str(out), "GL3_SLICES_WASM_ROOT": str(args.wasm_root.resolve()), "NITRO_TEST_L1_GETH": str(ROOT / "bin/geth"), "GOMAXPROCS": "12", "MALLOC_ARENA_MAX": "2", "PATH": str(ROOT / "bin") + ":" + os.environ["PATH"]}
if args.capture_terminal:
    env["GL3_RESTART_CAPTURE_TERMINAL"] = "1"
started = time.monotonic()
with (out / "sequencer-restart.log").open("w") as log:
    p = subprocess.Popen([str(ROOT / "bin/system_tests.test"), "-test.run", "^TestGL3SequencerLifecycleRecovery$", "-test.v", "-test.timeout", "40m"], cwd=nitro, env=env, stdout=log, stderr=subprocess.STDOUT)
    phase("RESTART_FIXTURE_RUNNING", testPID=p.pid, terminalCaptureRequested=args.capture_terminal)
    code = p.wait()
(out / "sequencer-restart-exit.json").write_text(json.dumps({"exitCode": code, "seconds": time.monotonic() - started}) + "\n")
assert code == 0, "restart fixture failed; preserve log and explicit exit result"
report = json.loads((out / "sequencer-lifecycle-recovery.json").read_text())
assert report["passed"] and report["canonicalCheckpointSHA256"] == "5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6"
phase("RESTART_ACCEPTANCE_PASSED", fixtureSeconds=report["fixtureSeconds"], terminalCaptureCompleted=report["terminalBlockCapture"]["completed"])
