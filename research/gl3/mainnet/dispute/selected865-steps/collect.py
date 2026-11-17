"""Read-only receipt/source transfer from the isolated Runpod witness tests."""
from pathlib import Path
import base64
import hashlib
import io
import json
import subprocess
import tarfile

root = Path(__file__).resolve().parent
helper = root.parents[5] / "output/gl3-parallel-20261117/remote.py"
code = r'''
from pathlib import Path
import base64,hashlib,io,json,tarfile
base=Path('/root/gl3-selected865-steps')
buffer=io.BytesIO()
with tarfile.open(fileobj=buffer,mode='w:gz') as tar:
 for attempt in ['attempt-01','attempt-02']:
  root=base/attempt
  for name in ['run.py','run.mjs','TerminalChallengeHarness.sol']:
   tar.add(root/name,arcname='evidence/'+attempt+'/frozen/'+name,recursive=False)
  for path in sorted((root/'evidence').glob('*')):
   if path.is_file() and path.stat().st_size<=1000000:
    tar.add(path,arcname='evidence/'+attempt+'/'+path.name,recursive=False)
  for name in ['selected-proofs.json','selected-proof-manifest.json','replay-result.json','exit.json']:
   tar.add(root/'inputs'/name,arcname='evidence/'+attempt+'/inputs/'+name,recursive=False)
  log=(root/'inputs/prover.log').read_bytes();excerpt=log[-16384:]
  (root/'cli-log-excerpt.txt').write_bytes(excerpt)
  receipt={'originalFullLogSHA256':hashlib.sha256(log).hexdigest(),'originalFullLogBytes':len(log),'excerptStartOffset':len(log)-len(excerpt),'excerptBytes':len(excerpt),'excerptSHA256':hashlib.sha256(excerpt).hexdigest(),'originalFrozenSource':'/root/bounded-restore/fast-comparison/C-combined/interpreter/prover.log','scope':'Actual unmodified suffix copied from the frozen full CLI log, not a reconstructed statement'}
  (root/'cli-log-excerpt.json').write_text(json.dumps(receipt,indent=2)+'\n')
  tar.add(root/'cli-log-excerpt.txt',arcname='evidence/'+attempt+'/cli-log-excerpt.txt',recursive=False)
  tar.add(root/'cli-log-excerpt.json',arcname='evidence/'+attempt+'/cli-log-excerpt.json',recursive=False)
  tar.add(root/'controller.log',arcname='evidence/'+attempt+'/controller.log',recursive=False)
data=buffer.getvalue()
print(json.dumps({'SHA256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'base64':base64.b64encode(data).decode()}))
'''
result = subprocess.run(["python3", str(helper), "dispute"], input=code,
                        text=True, capture_output=True, check=True)
payload = json.loads(result.stdout)
data = base64.b64decode(payload.pop("base64"))
if hashlib.sha256(data).hexdigest() != payload["SHA256"]:
    raise RuntimeError("Transfer digest mismatch")
(root / "receipts.tar.gz").write_bytes(data)
with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
    for member in archive.getmembers():
        target = (root / member.name).resolve()
        if not member.isfile() or not target.is_relative_to(root):
            raise RuntimeError("Unexpected archive member")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.extractfile(member).read())
(root / "transfer.json").write_text(json.dumps({**payload, "readOnlyTransfer": True,
     "allBuildsAndTestsExecutedOnRunpod": True}, indent=2) + "\n")
print(json.dumps(payload))
