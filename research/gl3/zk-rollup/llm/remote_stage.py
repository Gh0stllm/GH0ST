"""Transfer this isolated source and the already pinned private model to Big.

This controller does no compilation, inference, compression or tests locally.
The model/SDK/binaries remain ignored; evidence is pulled separately.
"""
from pathlib import Path
import base64,json,subprocess
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[3]
REMOTE=REPO.parent/'output/gl3-parallel-20261117/remote.py'
numerical=REPO/'research/chess/l3/llm'
files={p.name:base64.b64encode(p.read_bytes()).decode() for p in HERE.iterdir() if p.is_file() and p.suffix in {'.cpp','.h','.py','.go','.sol'}}
for name in ['model.bin','runtime.wasm']:
    files['.cache/'+name]=base64.b64encode((numerical/'.cache'/name).read_bytes()).decode()
for name in ['model-descriptor.json','reference_oracle.py']:
    files['.cache/reference/'+name]=base64.b64encode((numerical/name).read_bytes()).decode()
payload=json.dumps(files)
script="from pathlib import Path\nimport base64,json\nr=Path('/workspace/gl3/zk-rollup/llm');r.mkdir(parents=True,exist_ok=True)\nfiles=json.loads("+repr(payload)+")\nfor name,data in files.items():\n p=r/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(base64.b64decode(data))\nprint(json.dumps({'files':len(files),'bytes':sum(len(base64.b64decode(x)) for x in files.values()),'path':str(r)}))\n"
subprocess.run(['python3',str(REMOTE),'big'],input=script,text=True,check=True)
