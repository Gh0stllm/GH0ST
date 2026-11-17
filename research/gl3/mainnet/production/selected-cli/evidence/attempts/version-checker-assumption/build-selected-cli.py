"""Build the selected native CLI on Runpod; no chain or engine is started."""
from pathlib import Path
import hashlib
import json
import os
import platform
import subprocess
import time

assert platform.system() == "Linux" and platform.machine() == "x86_64"
root = Path("/root/bounded-restore")
source = root / "fast-comparison/C-combined/native"
out = root / "selected-cli"
out.mkdir(exist_ok=False)
go = root / "toolchain/go/bin/go"
runtime = root / "chess/sliced/runtime"
native_archive = root / "chess/engine/.cache/libgl3chess.a"
suffixes = {".go", ".c", ".cc", ".cpp", ".h", ".hpp", ".s", ".S", ".rs", ".mod", ".sum", ".toml", ".lock"}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def identities():
    files = {str(p): digest(p) for folder in [source, runtime] for p in folder.rglob("*") if p.is_file() and p.suffix in suffixes}
    for p in [runtime / ".cache/sliced.wasm", native_archive, source / "target/lib/libstylus.a", go]:
        files[str(p)] = digest(p)
    optional_jit = source / "target/bin/jit"
    if optional_jit.is_file():
        files[str(optional_jit)] = digest(optional_jit)
    return files


before = identities()
(out / "source-before.json").write_text(json.dumps(before, indent=2, sort_keys=True) + "\n")
assert before[str(runtime / ".cache/sliced.wasm")] == "1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc"
args = [str(go), "build", "-p", "2", "-mod=readonly", "-ldflags=-extldflags=-Wl,-z,noexecstack", "-o", str(out / "nitro"), "./cmd/nitro"]
env = {**os.environ, "GOTOOLCHAIN": "local", "GOMAXPROCS": "2", "PATH": str(go.parent) + ":" + os.environ["PATH"]}
(out / "build-process.json").write_text(json.dumps({"collectorPID": os.getpid(), "args": args, "cwd": str(source), "goVersion": (go.parent.parent / "VERSION").read_text(), "resolvedNativeTarget": str((source / "target").resolve()), "resolvedRuntime": str(runtime.resolve()), "optionalTargetBinJITPresent": (source / "target/bin/jit").is_file(), "allExecutionOnRunpod": True}, indent=2) + "\n")
started = time.monotonic()
with (out / "build.log").open("w") as log:
    result = subprocess.run(args, cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=1200)
(out / "build-exit.json").write_text(json.dumps({"exitCode": result.returncode, "seconds": time.monotonic() - started}) + "\n")
assert result.returncode == 0, "preserve failed build log and exit"
binary = out / "nitro"
headers = subprocess.check_output(["readelf", "-lW", str(binary)], text=True)
(out / "elf-program-headers.txt").write_text(headers)
stacks = [line.split() for line in headers.splitlines() if "GNU_STACK" in line]
assert len(stacks) == 1 and "E" not in stacks[0][-2]
version = subprocess.run([str(binary), "--version"], env=env, capture_output=True, text=True, timeout=30)
(out / "version.stdout").write_text(version.stdout)
(out / "version.stderr").write_text(version.stderr)
(out / "version-exit.json").write_text(json.dumps({"exitCode": version.returncode}) + "\n")
assert version.returncode == 0 and "nitro" in (version.stdout + version.stderr).lower()
metadata = subprocess.run([str(go), "version", "-m", str(binary)], env=env, capture_output=True, text=True, timeout=30)
(out / "go-build-metadata.txt").write_text(metadata.stdout + metadata.stderr)
assert metadata.returncode == 0
obj = out / "weights.o"
with obj.open("wb") as stream:
    subprocess.run(["ar", "p", str(native_archive), "weights.o"], stdout=stream, check=True)
network = out / "network-private.bin"
subprocess.run(["objcopy", "--dump-section", ".rodata.gEmbeddedNNUEData=" + str(network), str(obj)], check=True)
network_sha = digest(network)
network_bytes = network.stat().st_size
assert network_sha == "1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2" and network_bytes == 98511183
network.unlink()
obj.unlink()
after = identities()
(out / "source-after.json").write_text(json.dumps(after, indent=2, sort_keys=True) + "\n")
assert before == after
report = {"passed": True, "buildExitCode": result.returncode, "versionExitCode": version.returncode, "sourceUnchanged": True, "sourceFilesAndDependenciesHashed": len(before), "nativeBinarySHA256": digest(binary), "nativeBinaryBytes": binary.stat().st_size, "nativeGNUStackFlags": stacks[0][-2], "nativeStackNonExecutable": True, "portableEngineSHA256": before[str(runtime / ".cache/sliced.wasm")], "nativeEngineArchiveSHA256": before[str(native_archive)], "networkSHA256": network_sha, "networkBytes": network_bytes, "selectedModuleRoot": "0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086", "allExecutionOnRunpod": True, "enginePolicyChanged": False, "pairedGenesisAccepted": False, "nodeStarted": False, "publicDeployment": False, "scope": "Matching selected native source CLI build, version and non-executable-stack checks with unchanged module/network identities. No engine execution, node recovery or native/machine/genesis release acceptance."}
(out / "result.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report), flush=True)
