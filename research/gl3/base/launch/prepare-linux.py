"""Pinned standard Nitro artifacts/source only; Runpod, no custom STF/build."""
from pathlib import Path
import hashlib,json,os,shutil,tarfile,time,urllib.request,subprocess,datetime
ROOT=Path('/root/gl3-base-launch');ROOT.mkdir(exist_ok=True);DOWNLOADS=ROOT/'downloads';DOWNLOADS.mkdir(exist_ok=True);BIN=ROOT/'bin';BIN.mkdir(exist_ok=True);MIN_FREE=6000000000
os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[-2:])
IMAGE='sha256:c908f324a08b7332d1fa031b83b071cfa2d9edd8a364c4344d7c34b665bf08e9';LAYER='sha256:e255c16848b4b7911e7160170ac66484ea7caead8c783bd3d5eac6745219df2a';MODULE='0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97';REPO='offchainlabs/nitro-node'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for x in iter(lambda:f.read(1048576),b''):h.update(x)
 return h.hexdigest()
def floor():
 if shutil.disk_usage(ROOT).free<MIN_FREE:raise RuntimeError('six-billion-byte disk floor')
def download(url,p,expected,headers=None):
 if not p.exists():
  part=Path(str(p)+'.partial')
  with urllib.request.urlopen(urllib.request.Request(url,headers=headers or {}),timeout=60) as response,part.open('wb') as out:
   for chunk in iter(lambda:response.read(1048576),b''):floor();out.write(chunk)
  if sha(part)!=expected:raise RuntimeError('download digest mismatch')
  part.rename(p)
 if sha(p)!=expected:raise RuntimeError('existing archive digest mismatch')
 return p
floor();token=json.load(urllib.request.urlopen('https://auth.docker.io/token?service=registry.docker.io&scope=repository:'+REPO+':pull',timeout=30))['token'];headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'}
raw=urllib.request.urlopen(urllib.request.Request('https://registry-1.docker.io/v2/'+REPO+'/manifests/'+IMAGE,headers=headers),timeout=30).read();assert 'sha256:'+hashlib.sha256(raw).hexdigest()==IMAGE;manifest=json.loads(raw);assert any(x['digest']==LAYER and x['size']==104805066 for x in manifest['layers']);(ROOT/'official-oci-manifest.json').write_bytes(raw)
layer=download('https://registry-1.docker.io/v2/'+REPO+'/blobs/'+LAYER,DOWNLOADS/'official-binary-layer.tar.gz',LAYER[7:],headers)
node=BIN/'nitro'
if not node.exists():
 with tarfile.open(layer) as archive:
  member=archive.getmember('usr/local/bin/nitro');assert member.isfile();floor()
  with archive.extractfile(member) as inp,node.open('wb') as out:
   for chunk in iter(lambda:inp.read(1048576),b''):floor();out.write(chunk)
 node.chmod(0o755)
assert sha(node)=='d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed'
machines=ROOT/'machines';machines.mkdir(exist_ok=True);members=[]
with tarfile.open('/root/standard-machine.tar') as archive:
 for member in archive:
  if not member.isfile():continue
  path=Path(member.name);assert path.parts[:2]==('machines',MODULE) and '..' not in path.parts;dest=ROOT/path;dest.parent.mkdir(parents=True,exist_ok=True)
  if not dest.exists():
   with archive.extractfile(member) as inp,dest.open('wb') as out:
    for chunk in iter(lambda:inp.read(1048576),b''):floor();out.write(chunk)
  members.append({'path':str(dest),'bytes':dest.stat().st_size,'SHA256':sha(dest)})
assert (machines/MODULE/'module-root.txt').read_text().strip()==MODULE
if not (machines/'latest').exists():(machines/'latest').symlink_to(MODULE,target_is_directory=True)
source=download('https://codeload.github.com/OffchainLabs/nitro/tar.gz/refs/tags/v3.12.2',DOWNLOADS/'nitro-v3.12.2.tar.gz','8dabf6d465b25b261333fc6225a1bcda06b59f8a8227ce7ecd8f0bbb6629af4c')
geth=download('https://codeload.github.com/OffchainLabs/go-ethereum/tar.gz/30456d24d3cff444d3b0f246e9c7609477c7d4a1',DOWNLOADS/'geth.tar.gz','264b7c342e58910564f7f70d2975ff455a8293219f1886a32cfd7f4a6799c726')
def extract(archive,destination,prefix):
 if destination.exists():return
 destination.mkdir()
 with tarfile.open(archive) as arc:
  for member in arc:
   parts=Path(member.name).parts;assert parts and parts[0]==prefix and '..' not in parts and not Path(member.name).is_absolute()
   if len(parts)==1:continue
   target=destination.joinpath(*parts[1:])
   if member.isdir():target.mkdir(parents=True,exist_ok=True)
   elif member.isfile():
    target.parent.mkdir(parents=True,exist_ok=True);floor()
    with arc.extractfile(member) as inp,target.open('wb') as out:
     for data in iter(lambda:inp.read(1048576),b''):floor();out.write(data)
   elif member.issym():target.parent.mkdir(parents=True,exist_ok=True);target.symlink_to(member.linkname)
clean=ROOT/'nitro-clean';extract(source,clean,'nitro-3.12.2');gethdir=clean/'go-ethereum'
if not (gethdir/'go.mod').exists():
 if gethdir.exists():gethdir.rmdir()
 extract(geth,gethdir,'go-ethereum-30456d24d3cff444d3b0f246e9c7609477c7d4a1')
assert not list((clean/'precompiles').glob('*Ghost*'));assert 'makeGhost' not in (clean/'precompiles/precompile.go').read_text();assert 'Gh0stllm' not in (clean/'go.mod').read_text()
shared=Path('/root/gl3-final-pairing/source05')
if not (clean/'solgen/go').exists():shutil.copytree(shared/'solgen/go',clean/'solgen/go')
for name in ['include','lib']:
 dest=clean/'target'/name;dest.parent.mkdir(exist_ok=True)
 if not dest.exists():dest.symlink_to(shared/'target'/name,target_is_directory=True)
r=subprocess.run([str(node),'--version'],capture_output=True,text=True);assert r.returncode==0
report={'status':'OFFICIAL_STANDARD_BASE_ARTIFACTS_AND_PRISTINE_SOURCE_READY_NO_NODE_BUILD','UTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'officialImageDigest':IMAGE,'binaryLayerDigest':LAYER,'officialNode':{'path':str(node),'bytes':node.stat().st_size,'SHA256':sha(node),'versionExitCode':r.returncode,'versionText':r.stdout+r.stderr},'moduleRoot':MODULE,'machineFiles':members,'pristineSourcePath':str(clean),'nitroSourceArchiveSHA256':sha(source),'gethSourceCommit':'30456d24d3cff444d3b0f246e9c7609477c7d4a1','gethSourceArchiveSHA256':sha(geth),'customPrecompileSourceAndRuntimeImportsAbsent':True,'generatedBindingsSource':str(shared/'solgen/go'),'nativeLibraryReadOnlyReuse':str(shared/'target/lib'),'goToolchain':'/root/bounded-restore/toolchain/go/bin/go','financialOrMainnetOrLicenseAction':False,'buildPerformed':False,'allExecutionOnRunpod':True,'diskFreeBytes':shutil.disk_usage(ROOT).free}
(ROOT/'artifact-lock.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
