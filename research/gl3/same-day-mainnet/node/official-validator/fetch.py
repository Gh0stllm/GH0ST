from pathlib import Path
import urllib.request,json,hashlib,os,shutil,tarfile,subprocess,time,concurrent.futures
p=Path('/workspace/gl3/same-day-mainnet/node/official-validator');dest=p.parent/'bin';dest.mkdir(exist_ok=True);os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[-2:]);repo='offchainlabs/nitro-node';rows=json.loads((p/'layer-inventory.json').read_text());token=json.load(urllib.request.urlopen('https://auth.docker.io/token?service=registry.docker.io&scope=repository:'+repo+':pull',timeout=20))['token'];headers={'Authorization':'Bearer '+token};selected={name:next(x for x in rows if x['createdBy'].startswith('COPY ')and ('/bin/'+name+' ')in x['createdBy'])for name in ['nitro-val','prover','jit']};start=time.time()
def sha(f):
 h=hashlib.sha256()
 with f.open('rb')as s:
  for c in iter(lambda:s.read(1048576),b''):h.update(c)
 return h.hexdigest()
def floor():
 if shutil.disk_usage('/root').free<6000000000:raise RuntimeError('diskfloor')
def get(item):
 name,row=item;f=p/(name+'-layer.tar.gz');part=Path(str(f)+'.partial')
 if not f.exists():
  req=urllib.request.Request('https://registry-1.docker.io/v2/'+repo+'/blobs/'+row['digest'],headers=headers)
  with urllib.request.urlopen(req,timeout=60)as response,part.open('wb')as out:
   for c in iter(lambda:response.read(1048576),b''):floor();out.write(c)
  assert part.stat().st_size==row['bytes'];assert sha(part)==row['digest'][7:];part.rename(f)
 assert sha(f)==row['digest'][7:]
 with tarfile.open(f)as arc:
  member=arc.getmember('usr/local/bin/'+name);assert member.isfile()and member.size<500000000
  with arc.extractfile(member)as inp,(dest/name).open('wb')as out:shutil.copyfileobj(inp,out)
 (dest/name).chmod(0o755);smoke=subprocess.run([str(dest/name),'--version'if name=='nitro-val'else'--help'],capture_output=True,text=True,timeout=20);(p/(name+'-smoke.stdout')).write_text(smoke.stdout);(p/(name+'-smoke.stderr')).write_text(smoke.stderr)
 return {'name':name,'path':str(dest/name),'bytes':(dest/name).stat().st_size,'SHA256':sha(dest/name),'layer':row,'smokeExitCode':smoke.returncode,'smokeScope':'version'if name=='nitro-val'else'help'}
try:
 with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:r=list(pool.map(get,selected.items()))
 report={'actualExitCode':0,'seconds':time.time()-start,'officialImageDigest':'sha256:c908f324a08b7332d1fa031b83b071cfa2d9edd8a364c4344d7c34b665bf08e9','binaries':r,'privateKeysRead':False,'publicWrites':False,'serviceStarted':False};assert all(x['smokeExitCode']==0 for x in r)
except BaseException as e:report={'actualExitCode':1,'seconds':time.time()-start,'error':repr(e),'serviceStarted':False}
(p/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
