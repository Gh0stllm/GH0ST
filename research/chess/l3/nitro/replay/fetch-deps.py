"""Fetch exact remaining proof dependencies into task-local cache only."""
from pathlib import Path
import json,urllib.request,hashlib,tarfile,subprocess,shutil
r=Path(__file__).resolve().parents[1];b=r/'.cache'
rust=(r/'../../engine/.cache/toolchain/rust/1.93.0-c0f5063e-b788d8d6/toolchains/1.93.0-aarch64-apple-darwin').resolve()
def extract(archive,dest):
 with tarfile.open(archive) as t:
  for f in t.getmembers():assert (dest/f.name).resolve().is_relative_to(dest.resolve())
  t.extractall(dest)
def fetch(name,url,sha):
 a=b/name
 if not a.exists():urllib.request.urlretrieve(url,a)
 assert hashlib.sha256(a.read_bytes()).hexdigest()==sha,'Dependency hash mismatch'
 return a
sha='3100cb920ddac646943243f0eddd331128836b9161dd5f7b0a6c76375d39cc5e'
a=fetch('rust-std-1.93.0-wasm32-unknown-unknown.tar.xz','https://static.rust-lang.org/dist/2026-01-22/rust-std-1.93.0-wasm32-unknown-unknown.tar.xz',sha)
dest=b/'rust-std-unknown';dest.mkdir(exist_ok=True);extract(a,dest);own=b/'rust-1.93.0'
if not own.exists():subprocess.run(['cp','-cR',str(rust),str(own)],check=True)
if not (own/'lib/rustlib/wasm32-unknown-unknown').exists():subprocess.run(['sh',str(next(dest.glob('rust-std-*'))/'install.sh'),'--prefix='+str(own),'--disable-ldconfig'],check=True)
commit='7bf03222ad094ec3441f5c3935eeb1b41ee470ba';sha='eaf47983c7ec8917eb952904c122925fd2a0247dec572523741b9c3cd70302c7'
a=fetch('SoftFloat-'+commit+'.tar.gz','https://codeload.github.com/OffchainLabs/SoftFloat/tar.gz/'+commit,sha);extract(a,b);shutil.copytree(b/('SoftFloat-'+commit),b/'nitro-build/crates/wasm-libraries/soft-float/SoftFloat',dirs_exist_ok=True)
print('Pinned proof dependencies ready locally. No global installation or financial action.')
