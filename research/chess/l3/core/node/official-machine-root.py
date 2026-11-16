"""Read the canonical machine root from a pinned official image, no Docker run."""
from pathlib import Path
import urllib.request,json,hashlib,tarfile
r=Path(__file__).resolve().parent;b=r/'.cache';b.mkdir(exist_ok=True);repo='offchainlabs/nitro-node'
image='sha256:c908f324a08b7332d1fa031b83b071cfa2d9edd8a364c4344d7c34b665bf08e9';layer='sha256:f772eaa7929d2587bf080df6719bfca524a5803eabe6d3423760a15f46ae6b5b'
token=json.load(urllib.request.urlopen('https://auth.docker.io/token?service=registry.docker.io&scope=repository:'+repo+':pull'))['token']
def request(endpoint):return urllib.request.urlopen(urllib.request.Request('https://registry-1.docker.io/v2/'+repo+'/'+endpoint,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'}),timeout=90)
raw=request('manifests/'+image).read();assert 'sha256:'+hashlib.sha256(raw).hexdigest()==image;manifest=json.loads(raw);assert any(x['digest']==layer and x['size']==62155691 for x in manifest['layers'])
a=b/'official-machines-layer.tar.gz'
if not a.exists():
 with request('blobs/'+layer) as response,a.open('wb') as out:
  while True:
   chunk=response.read(1024*1024)
   if not chunk:break
   out.write(chunk)
assert 'sha256:'+hashlib.sha256(a.read_bytes()).hexdigest()==layer
roots={};latest=None
with tarfile.open(a) as t:
 for m in t.getmembers():
  if m.name.endswith('module-root.txt') and m.isfile():roots[m.name.rsplit('/',1)[0].rsplit('/',1)[-1]]=t.extractfile(m).read().decode().strip()
  if m.name=='home/user/target/machines/latest' and m.issym():latest=m.linkname
assert latest in roots and roots[latest]==latest
report={'officialImageDigest':image,'machineLayerDigest':layer,'registryDigestVerified':True,'officialLatestMachineRoot':latest,'containerExecuted':False,'financialActions':False}
(b/'official-machine-root-reproduction.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
