"""Download pinned public teacher weights; no credentials or blockchain calls."""
import hashlib,json,os,urllib.request
from pathlib import Path
os.environ['HF_HUB_DISABLE_XET']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
from huggingface_hub import snapshot_download

here=Path(__file__).resolve().parent
repo='Qwen/Qwen3-0.6B'
with urllib.request.urlopen('https://huggingface.co/api/models/'+repo,timeout=30)as r:
    metadata=json.load(r)
revision=metadata['sha']
destination=here/'qwen-cache'
path=snapshot_download(repo_id=repo,revision=revision,local_dir=destination,
    cache_dir=here/'download-cache',allow_patterns=['*.json','*.safetensors','*.txt','*.model','LICENSE','README.md'],max_workers=4)
files={str(p.relative_to(destination)):{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
       for p in destination.rglob('*')if p.is_file()and '.cache'not in p.parts}
report={'repository':repo,'revision':revision,'source':'https://huggingface.co/'+repo,
        'purpose':'Offline training teacher only; never the swap runtime','files':files,'mainnet_actions':0}
(here/'qwen-source.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'repository':repo,'revision':revision,'files':len(files),'bytes':sum(x['bytes']for x in files.values())}))
