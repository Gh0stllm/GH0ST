"""Linux-only ELF hardening for the legacy embedded-network object.

This changes assembler section metadata, not network bytes, Stockfish source,
the portable engine program, the search policy, or the proof machine.
Run only inside the isolated Runpod acceptance tree.
"""
from pathlib import Path
import argparse
import hashlib
import json
import platform
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--root", type=Path, required=True)
parser.add_argument("--verify-binary", type=Path)
args = parser.parse_args()
assert platform.system() == "Linux" and platform.machine() == "x86_64"
root = args.root.resolve()
assert str(root).startswith("/root/") and root != Path("/root")
cache = root / "chess/engine/.cache"
objects = cache / "linux-native"
asm = objects / "weights.s"
obj = objects / "weights.o"
archive = cache / "libgl3chess.a"
network_sha = "1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2"
note = '.section .note.GNU-stack,"",@progbits\n'

def command(argv):
    return subprocess.check_output([str(x) for x in argv], text=True)

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

assert asm.is_file() and archive.is_file()
source = asm.read_text()
assert '.rodata.gEmbeddedNNUEData' in source
before = hashlib.sha256(source.encode()).hexdigest()
if ".note.GNU-stack" not in source:
    asm.write_text(source + note)
compiler = shutil.which("clang++")
assert compiler
subprocess.run([compiler, "-c", str(asm), "-o", str(obj)], check=True)
subprocess.run(["ar", "rcs", str(archive), str(obj)], check=True)
sections = command(["readelf", "-SW", obj])
assert ".note.GNU-stack" in sections
network_dump = objects / "network-acceptance.bin"
subprocess.run(["objcopy", "--dump-section", ".rodata.gEmbeddedNNUEData=" + str(network_dump), str(obj)], check=True)
assert network_dump.stat().st_size == 98511183
assert digest(network_dump) == network_sha, "network bytes changed"
network_dump.unlink()
report = {
    "objectMetadataHardened": True,
    "networkBytesUnchanged": True,
    "networkSHA256": network_sha,
    "networkBytes": 98511183,
    "assemblerBeforeSHA256": before,
    "assemblerAfterSHA256": digest(asm),
    "weightsObjectSHA256": digest(obj),
    "librarySHA256": digest(archive),
    "nativeBinaryRebuildRequired": True,
    "scope": "ELF stack permission metadata only; no chess policy or STF change",
    "publicDeployment": False,
}
if args.verify_binary:
    binary = args.verify_binary.resolve()
    headers = command(["readelf", "-lW", binary])
    stack = [line.split() for line in headers.splitlines() if "GNU_STACK" in line]
    assert len(stack) == 1 and "E" not in stack[0][-2], "executable process stack"
    report.update(
        nativeBinaryRebuildRequired=False,
        nativeBinarySHA256=digest(binary),
        nativeGNUStackFlags=stack[0][-2],
        nativeStackNonExecutable=True,
    )
out = root / "production-evidence"
out.mkdir(exist_ok=True)
(out / "native-stack-hardening.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
