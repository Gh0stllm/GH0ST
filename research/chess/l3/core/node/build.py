"""Build pristine standard Nitro only; no service start or public transaction.

Reuses separately verified generated bindings and native Rust artifacts as inputs,
then independently clones them so experimental work cannot mutate this core tree.
"""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,tarfile,urllib.request,shutil,time
r=Path(__file__).resolve().parent;b=r/'.cache';b.mkdir(exist_ok=True)
a=argparse.ArgumentParser();a.add_argument('--artifact-root',type=Path,default=(r/'../../nitro/.cache/nitro-build').resolve());opt=a.parse_args()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def tree(root):
 h=hashlib.sha256();files=sorted(p for p in root.rglob('*') if p.is_file())
 for p in files:h.update(str(p.relative_to(root)).encode()+b'\0'+hashlib.sha256(p.read_bytes()).digest())
 return len(files),h.hexdigest()
def fetch(name,url,digest,dest):
 p=b/name
 if not p.exists():urllib.request.urlretrieve(url,p)
 assert sha(p)==digest,'Pinned archive hash mismatch: '+name
 with tarfile.open(p) as t:
  for m in t.getmembers():assert (dest/m.name).resolve().is_relative_to(dest.resolve())
  t.extractall(dest)
sourceSHA='8dabf6d465b25b261333fc6225a1bcda06b59f8a8227ce7ecd8f0bbb6629af4c'
fetch('nitro-v3.12.2.tar.gz','https://codeload.github.com/OffchainLabs/nitro/tar.gz/refs/tags/v3.12.2',sourceSHA,b)
gethCommit='30456d24d3cff444d3b0f246e9c7609477c7d4a1'
fetch('geth-'+gethCommit+'.tar.gz','https://codeload.github.com/OffchainLabs/go-ethereum/tar.gz/'+gethCommit,'264b7c342e58910564f7f70d2975ff455a8293219f1886a32cfd7f4a6799c726',b)
goRoot=b/'go-1.25.12';goRoot.mkdir(exist_ok=True)
fetch('go1.25.12.darwin-arm64.tar.gz','https://go.dev/dl/go1.25.12.darwin-arm64.tar.gz','fa2c88bbcf64bd3b2aef355f026cfec6d3a4a01c132f999c8f8c964eb767164f',goRoot)
inputs=json.loads((r/'evidence/source-integrity.json').read_text());assert tree(opt.artifact_root/'solgen/go')==(inputs['generatedGoBindings']['files'],inputs['generatedGoBindings']['SHA256']),'Generated bindings differ from verified source compilation'
assert sha(opt.artifact_root/'target/include/arbitrator.h')==inputs['nativeHeaderSHA256']
assert sha(opt.artifact_root/'target/lib/libstylus.a')==inputs['nativeLibrarySHA256']
s=b/'nitro-core'
if not s.exists():subprocess.run(['cp','-cR',str(b/'nitro-3.12.2'),str(s)],check=True)
for rel,src in [('go-ethereum',b/('go-ethereum-'+gethCommit)),('solgen/go',opt.artifact_root/'solgen/go'),('target/include',opt.artifact_root/'target/include'),('target/lib',opt.artifact_root/'target/lib')]:
 dst=s/rel
 if dst.exists():shutil.rmtree(dst)
 dst.parent.mkdir(parents=True,exist_ok=True);subprocess.run(['cp','-cR',str(src),str(dst)],check=True)
assert not list((s/'precompiles').glob('*Ghost*'))
assert 'makeGhost' not in (s/'precompiles/precompile.go').read_text()
assert 'Gh0stllm' not in (s/'go.mod').read_text()
pristine=b/'nitro-3.12.2'
for p in pristine.rglob('*'):
 if p.is_file():assert p.read_bytes()==(s/p.relative_to(pristine)).read_bytes(),'Upstream source differs: '+str(p)
started=time.time();p=subprocess.run([str(goRoot/'go/bin/go'),'build','-mod=mod','-o',str(b/'gh0st-core-nitro'),'./cmd/nitro'],cwd=s,env={**os.environ,'GOTOOLCHAIN':'local'},capture_output=True,text=True,timeout=300)
report={'exitCode':p.returncode,'seconds':time.time()-started,'output':p.stdout+p.stderr,'nativeTarget':'darwin/arm64','GoVersion':'1.25.12','sourceArchiveSHA256':sourceSHA,'customSTF':False,'publicChainDeployed':False}
if not p.returncode:report['binarySHA256']=sha(b/'gh0st-core-nitro')
(b/'clean-build-reproduction.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));raise SystemExit(p.returncode)
