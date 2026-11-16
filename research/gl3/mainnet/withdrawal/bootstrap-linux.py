"""Prepare the disposable Linux withdrawal worker from pinned upstream artifacts.

This extracts the official native node without running Docker, installs only the
test's Node dependencies, and never reads a wallet or sends a chain transaction.
"""
from pathlib import Path
import hashlib,json,os,platform,subprocess,tarfile,time,urllib.request

assert platform.system()=='Linux' and platform.machine()=='x86_64'
root=Path('/root/withdrawal');root.mkdir(exist_ok=True)
downloads=root/'downloads';downloads.mkdir(exist_ok=True)
image='sha256:c908f324a08b7332d1fa031b83b071cfa2d9edd8a364c4344d7c34b665bf08e9'
binary_layer='sha256:e255c16848b4b7911e7160170ac66484ea7caead8c783bd3d5eac6745219df2a'
machine_layer='sha256:f772eaa7929d2587bf080df6719bfca524a5803eabe6d3423760a15f46ae6b5b'
module='0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97'
repo='offchainlabs/nitro-node'
token=json.load(urllib.request.urlopen('https://auth.docker.io/token?service=registry.docker.io&scope=repository:'+repo+':pull'))['token']
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def request(url):return urllib.request.urlopen(urllib.request.Request('https://registry-1.docker.io/v2/'+repo+'/'+url,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'}),timeout=90)
raw=request('manifests/'+image).read();assert 'sha256:'+hashlib.sha256(raw).hexdigest()==image
manifest=json.loads(raw);layers={x['digest']:x for x in manifest['layers']}
assert layers[binary_layer]['size']==104805066 and layers[machine_layer]['size']==62155691
def layer(digest):
 p=downloads/(digest.split(':')[1]+'.tar.gz')
 if not p.exists():
  with request('blobs/'+digest) as response,p.open('wb') as f:
   for b in iter(lambda:response.read(1024*1024),b''):f.write(b)
 assert 'sha256:'+sha(p)==digest
 return p
bin_dir=root/'bin';bin_dir.mkdir(exist_ok=True)
with tarfile.open(layer(binary_layer)) as t:
 m=t.getmember('usr/local/bin/nitro');assert m.isfile()
 with t.extractfile(m) as src,(bin_dir/'nitro').open('wb') as dst:
  for b in iter(lambda:src.read(1024*1024),b''):dst.write(b)
 (bin_dir/'nitro').chmod(0o755)
machines=root/'machines';dest=machines/module;dest.mkdir(parents=True,exist_ok=True)
with tarfile.open(layer(machine_layer)) as t:
 for m in t.getmembers():
  prefix='home/user/target/machines/'+module+'/'
  if m.name.startswith(prefix) and m.isfile():
   rel=Path(m.name[len(prefix):]);assert not rel.is_absolute() and '..' not in rel.parts
   p=dest/rel;p.parent.mkdir(parents=True,exist_ok=True)
   with t.extractfile(m) as src,p.open('wb') as dst:
    for b in iter(lambda:src.read(1024*1024),b''):dst.write(b)
assert (dest/'module-root.txt').read_text().strip()==module
if not (machines/'latest').exists():(machines/'latest').symlink_to(module,target_is_directory=True)
source_archive=downloads/'nitro-v3.12.2.tar.gz'
if not source_archive.exists():urllib.request.urlretrieve('https://codeload.github.com/OffchainLabs/nitro/tar.gz/refs/tags/v3.12.2',source_archive)
source_sha='8dabf6d465b25b261333fc6225a1bcda06b59f8a8227ce7ecd8f0bbb6629af4c'
assert sha(source_archive)==source_sha
with tarfile.open(source_archive) as t:
 member=next(m for m in t.getmembers() if m.isfile() and m.name.endswith('/cmd/chaininfo/arbitrum_chain_info.json'))
 info=root/'source-info/cmd/chaininfo/arbitrum_chain_info.json';info.parent.mkdir(parents=True,exist_ok=True);info.write_bytes(t.extractfile(member).read())
(root/'source-info-manifest.json').write_text(json.dumps({'sourceArchiveSHA256':source_sha,'chainInfoSHA256':sha(info),'onlyStandardChainConfigDataExtracted':True},indent=2)+'\n')
(root/'official-node-manifest.json').write_text(json.dumps({'imageDigest':image,'binaryLayerDigest':binary_layer,'machineLayerDigest':machine_layer,'nativeBinarySHA256':sha(bin_dir/'nitro'),'moduleRoot':module,'containerExecuted':False},indent=2)+'\n')
deadline=time.monotonic()+600
while not Path('/root/APT_READY').exists():
 assert time.monotonic()<deadline,'Root common package setup did not finish'
 time.sleep(1)
(root/'package.json').write_text(json.dumps({'name':'gl3-withdrawal-cloud-test','private':True,'dependencies':{'ethers':'6.13.5','ganache':'7.9.2','solc':'0.8.30'}},indent=2)+'\n')
with (root/'npm-install.log').open('w') as log:subprocess.run(['npm','install','--no-audit','--no-fund'],cwd=root,stdout=log,stderr=subprocess.STDOUT,check=True)
(root/'BASE_READY').write_text('Pinned official binary, machine and Node dependencies are ready\n')
print('WITHDRAWAL_BASE_READY',flush=True)
