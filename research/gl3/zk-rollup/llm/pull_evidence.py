"""Retrieve bounded Runpod records and generated hash-only model manifest."""
from pathlib import Path
import base64,json,subprocess
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[3]
remote=REPO.parent/'output/gl3-parallel-20261117/remote.py'
script="""from pathlib import Path
import base64,json
r=Path('/workspace/gl3/zk-rollup/llm');files={}
for p in (r/'evidence').rglob('*'):
 if p.is_file() and p.suffix in {'.json','.log'}:files['evidence/'+str(p.relative_to(r/'evidence'))]=base64.b64encode(p.read_bytes()).decode()
for rel,dest in [('page_manifest.h','page_manifest.h'),('.cache/goldens.json','evidence/numerical-parity.json')]:
 p=r/rel
 if p.exists():files[dest]=base64.b64encode(p.read_bytes()).decode()
print(json.dumps(files))
"""
p=subprocess.run(['python3',str(remote),'big'],input=script,text=True,capture_output=True,check=True)
files=json.loads(p.stdout)
for name,encoded in files.items():
 path=HERE/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(base64.b64decode(encoded))
print(json.dumps({'files':list(files),'bytes':sum(len(base64.b64decode(v)) for v in files.values())}))
