"""Read-only transfer of small isolated Runpod receipts/sources; no test execution."""
from pathlib import Path
import argparse
import base64
import hashlib
import io
import json
import subprocess
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument("--continuation", action="store_true")
parser.add_argument("--refresh-sources", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parent
workspace = root.parents[4]
helper = workspace.parent / "output/gl3-parallel-20261117/remote.py"
remote = "/root/gl3-checkpoint-integration/546810a186d247fe8d7bbf170d401ea3"
groups = ["preflight-v3", "native-v4", "native-v5", "native-v6", "native-v7", "native-v8", "disabled-v8", "native-v10"]
if args.continuation:
    groups.append("continuation-v9")
code = r'''
from pathlib import Path
import base64,hashlib,io,json,tarfile
root=Path(REMOTE)
groups=GROUPS
buffer=io.BytesIO()
with tarfile.open(fileobj=buffer,mode="w:gz") as archive:
 for name in ["source-manifest.json","baseline-after.json","compile-exit.json","compile.log"]:
  path=root/"evidence"/name
  if path.exists():archive.add(path,arcname="evidence/bootstrap/"+name,recursive=False)
 for group in groups:
  for path in sorted((root/"evidence"/group).glob("*")):
   if path.is_file() and path.stat().st_size<=1000000:archive.add(path,arcname="evidence/"+group+"/"+path.name,recursive=False)
  path=root/(group+"-controller.log")
  if path.exists():archive.add(path,arcname="evidence/controllers/"+path.name,recursive=False)
 for path in sorted((root/"nitro/precompiles").glob("*Checkpoint*.go")):
  archive.add(path,arcname="compiled-source/"+path.name,recursive=False)
 for path in sorted((root/"nitro/precompiles").glob("checkpoint_profile*.go")):
  archive.add(path,arcname="compiled-source/"+path.name,recursive=False)
 for name in ["precompile.go","ArbGhostChessSlices.go","ArbGhostChessSliceDelta.go","ArbGhostChessSlicesHistory.go"]:
  path=root/"nitro/precompiles"/name
  archive.add(path,arcname="compiled-source/pinned/"+name,recursive=False)
data=buffer.getvalue()
print(json.dumps({"archiveSHA256":hashlib.sha256(data).hexdigest(),"archiveBytes":len(data),"archiveBase64":base64.b64encode(data).decode()}))
'''.replace("REMOTE", repr(remote)).replace("GROUPS", repr(groups))
result = subprocess.run(["python3", str(helper), "dispute"], input=code, text=True, capture_output=True, check=True)
payload = json.loads(result.stdout)
data = base64.b64decode(payload.pop("archiveBase64"))
if hashlib.sha256(data).hexdigest() != payload["archiveSHA256"]:
    raise RuntimeError("Transfer digest mismatch")
name = "continuation-evidence.tar.gz" if args.continuation else "native-evidence.tar.gz"
(root / name).write_bytes(data)
with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
    for member in archive.getmembers():
        target = (root / member.name).resolve()
        if not member.isfile() or not target.is_relative_to(root):
            raise RuntimeError("Unexpected archive path or type")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.extractfile(member).read())
if args.refresh_sources:
    for path in (root / "compiled-source").glob("*.go"):
        (root / path.name).write_bytes(path.read_bytes())
payload.update({"allTestsExecutedOnRunpod": True, "transferIsReadOnly": True, "groups": groups})
(root / (name + ".json")).write_text(json.dumps(payload, indent=2) + "\n")
print(json.dumps(payload))
