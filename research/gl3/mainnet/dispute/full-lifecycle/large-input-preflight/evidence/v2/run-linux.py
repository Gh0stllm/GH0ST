"""Private Runpod-only, initialization-only full-size validation transport test."""
from pathlib import Path
import fcntl, hashlib, json, os, platform, shutil, subprocess, time

if platform.system() != "Linux" or platform.machine() != "x86_64":
    raise SystemExit("Run only on the existing Linux x86_64 Runpod")
kit = Path(__file__).resolve().parent
root = Path("/root/gl3-large-input-preflight-v2")
root.mkdir(exist_ok=True)
lock = (root / "runner.lock").open("w")
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
out = root / "evidence"
out.mkdir(exist_ok=True)
source = root / "nitro"
base = Path("/root/future-lifecycle-865-geometry43-build/nitro")
go = Path("/root/bounded-restore/toolchain/go/bin/go")
selected = Path("/root/bounded-restore/fast-comparison/C-combined")
binary = root / "system_tests.test"

def sha(p):
    with Path(p).open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()

def save(name, value):
    (out / name).write_text(json.dumps(value, indent=2) + "\n")

# Hard-link only immutable existing source. The sole new file is created at a
# previously nonexistent path; no inherited inode is opened for writing.
if not source.exists():
    subprocess.run(["cp", "-al", str(base), str(source)], check=True)
target = source / "system_tests/gl3_large_input_transport_test.go"
if target.exists():
    target.unlink()
shutil.copy2(kit / target.name, target)
env = {**os.environ, "GOTOOLCHAIN": "local", "GOMAXPROCS": "4", "PATH": str(go.parent) + ":" + os.environ["PATH"]}
subprocess.run([str(go.parent / "gofmt"), "-w", str(target)], check=True)
shutil.copy2(target, out / "gl3_large_input_transport_test.go")
shutil.copy2(kit / "run-linux.py", out / "run-linux.py")
before = {
    "newTestSHA256": sha(target),
    "controllerSHA256": sha(kit / "run-linux.py"),
    "baselineBuildManifestSHA256": sha(base.parent / "native-build-manifest.json"),
    "goModuleSHA256": sha(source / "go.mod"),
    "goSumSHA256": sha(source / "go.sum"),
    "libstylusSHA256": sha(source / "target/lib/libstylus.a"),
    "machineSHA256": sha(selected / "machine/machine.v2.wavm.br"),
    "guestSHA256": sha(selected / "replay.wasm"),
    "companionSHA256": sha(Path("/root/bounded-restore/machine-inputs/gl3aot.wasm")),
    "immutableSelectedSource": str(selected / "native"),
    "allExecutionOnRunpod": True,
    "noFullReplayOrLifecycle": True,
}
save("source-manifest.json", before)
started = time.monotonic()
with (out / "build.log").open("w") as log:
    result = subprocess.run([str(go), "test", "-c", "-tags", "gl3_acceptance,challengetest", "-p", "4", "-mod=readonly", "-ldflags=-extldflags=-Wl,-z,noexecstack", "-o", str(binary), "./system_tests"], cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
save("build-exit.json", {"exitCode": result.returncode, "seconds": time.monotonic()-started})
if result.returncode:
    raise SystemExit(result.returncode)
before["binarySHA256"] = sha(binary)
save("source-manifest.json", before)

def run(name, expression, extra):
    env_run = {**env, **extra}
    args = [str(binary), "-test.v", "-test.run", expression, "-test.timeout", "18m"]
    started = time.monotonic()
    with (out / (name + ".log")).open("w") as log:
        process = subprocess.Popen(args, cwd=source, env=env_run, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        save(name + "-process.json", {"pid": process.pid, "command": args, "binarySHA256": before["binarySHA256"], "GOMAXPROCS": env_run["GOMAXPROCS"], "startedUTC": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        pid, status, usage = os.wait4(process.pid, 0)
        code = os.waitstatus_to_exitcode(status)
        process.returncode = code
    receipt = {"exitCode": code, "rawWaitStatus": status, "seconds": time.monotonic()-started, "maxRSSKiB": usage.ru_maxrss, "userSeconds": usage.ru_utime, "systemSeconds": usage.ru_stime, "actualChildPID": pid}
    save(name + "-exit.json", receipt)
    if code:
        raise SystemExit(code)

run("small-regressions", "^(TestGL3PayloadLoggingAndAdmission|TestGL3ValidationWSReadLimits)$", {})
run("original-full-input", "^TestGL3OriginalFullInputValidationTransport$", {
    "GL3_TRANSPORT_INPUT": "/root/terminal-acceptance/evidence/terminal-input.json",
    "GL3_TRANSPORT_EVIDENCE": str(out / "transport"),
    "GL3_TRANSPORT_MACHINES": "/root/future-lifecycle-865-geometry43-build/machines",
})
if sha(target) != before["newTestSHA256"]:
    raise SystemExit("test source changed during execution")
save("completed.json", {"completed": True, "allExecutionOnRunpod": True, "fullReplayExecuted": False, "fullLifecycleExecuted": False, "launchAuthorizationGranted": False})
