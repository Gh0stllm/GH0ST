"""Download pinned public build inputs into ignored cache; no chain/account action."""
from pathlib import Path
import urllib.request,json,tarfile,hashlib,platform
b=Path(__file__).resolve().parent/'.cache';b.mkdir(exist_ok=True)
def extract(url,name,sha):
 p=b/name
 if not p.exists():urllib.request.urlretrieve(url,p)
 assert hashlib.sha256(p.read_bytes()).hexdigest()==sha,'archive hash mismatch'
 with tarfile.open(p) as t:
  for m in t.getmembers():assert (b/m.name).resolve().is_relative_to(b.resolve())
  t.extractall(b)
extract('https://codeload.github.com/OffchainLabs/nitro/tar.gz/refs/tags/v3.12.2','nitro-v3.12.2.tar.gz','8dabf6d465b25b261333fc6225a1bcda06b59f8a8227ce7ecd8f0bbb6629af4c')
if not (b/'go/bin/go').exists():
 arch={'arm64':'arm64','aarch64':'arm64','x86_64':'amd64'}[platform.machine()]
 os={'Darwin':'darwin','Linux':'linux'}[platform.system()]
 versions=json.load(urllib.request.urlopen('https://go.dev/dl/?mode=json&include=all'))
 f=next(f for v in versions if v['version']=='go1.25.4' for f in v['files'] if f['os']==os and f['arch']==arch and f['kind']=='archive')
 extract('https://go.dev/dl/'+f['filename'],f['filename'],f['sha256'])
print('Pinned public source and verified official Go toolchain ready; no chain started')
