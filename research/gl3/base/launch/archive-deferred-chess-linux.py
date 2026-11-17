"""Archive only: preserve deferred chess bytes; never place them in active GL3 paths."""
from pathlib import Path
import os,subprocess,shlex,json,time,hashlib,datetime
os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[-2:])
t=Path('/root/gl3-base-launch/big-transfer'); b=Path('/root/gl3-full-checkpoint-guest')
paths=[Path('/root/future-lifecycle-865-hostcache-v2/runs/c1af59a6b57f48d3a268f8b4ec6ee2a4/evidence/terminal-input.json'),b/'replay.wasm',b/'capture/evidence/begin-input.json',b/'terminal-native/full-capture.test']
paths+=sorted(p for p in (b/'machine-generation/machine').rglob('*') if p.is_file())
paths += [b/x for x in ['export-manifest.json','capture-export-manifest.json','machine-generation/input-manifest.json','machine-generation/machine-manifest.json','terminal-native/draft-source-manifest.json','terminal-native/compile-authorization.json','terminal-native/compile-controller.log','terminal-native/build/source-manifest.json'] if (b/x).is_file()]
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for a in iter(lambda:f.read(8*1024*1024),b''): h.update(a)
 return h.hexdigest()
rows=[]
for p in paths:
 s=p.stat();rows.append({'member':str(p).lstrip('/'),'bytes':s.st_size,'sha256':sha(p)})
assert rows[0]['bytes']==2575003779
assert next(x for x in rows if x['member'].endswith('terminal-native/full-capture.test'))['sha256']=='5e240e1117461c6633b460cf2622c57fe948bf4b58859236ad60e89d60709a3f'
manifest={'createdUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'DEFERRED_CHESS_ARCHIVE_ONLY_NEVER_ACTIVATED','members':rows,'noWalletsOrPrivateKeys':True,'sourceRoot':'old128','activeBaseUntouched':True}
mp=t/'deferred-chess-source-manifest.json';mp.write_text(json.dumps(manifest,indent=2)+'\n');paths.append(mp)
(t/'deferred-chess-members.txt').write_text('\n'.join(str(p).lstrip('/') for p in paths)+'\n')
receiver=r'''from pathlib import Path
import sys,hashlib,json,tarfile,time,os
b=Path('/workspace/gl3/archive/chess');b.mkdir(parents=True,exist_ok=True);os.chmod(b,0o700)
a=b/'deferred-c1af-checkpoint.tar.gz';tmp=b/(a.name+'.incoming');assert not a.exists();h=hashlib.sha256();n=0
with tmp.open('xb') as f:
 os.chmod(tmp,0o600)
 while True:
  z=sys.stdin.buffer.read(8*1024*1024)
  if not z:break
  f.write(z);h.update(z);n+=len(z)
tmp.rename(a)
manifestmember='root/gl3-base-launch/big-transfer/deferred-chess-source-manifest.json'
with tarfile.open(a,'r:gz') as tar:m=json.load(tar.extractfile(manifestmember))
expected={r['member']:r for r in m['members']};seen=set();rows=[]
with tarfile.open(a,'r|gz') as tar:
 for ent in tar:
  if ent.name==manifestmember:continue
  assert ent.name in expected and ent.isfile(),ent.name
  x=expected[ent.name];assert ent.size==x['bytes'];q=tar.extractfile(ent);v=hashlib.sha256();count=0
  for z in iter(lambda:q.read(8*1024*1024),b''):v.update(z);count+=len(z)
  assert count==x['bytes'] and v.hexdigest()==x['sha256'],ent.name
  seen.add(ent.name);rows.append({'member':ent.name,'bytes':count,'sha256':v.hexdigest(),'verified':True})
assert seen==set(expected)
r={'scope':'DEFERRED_CHESS_ARCHIVE_ONLY_NEVER_ACTIVATED','archive':str(a),'archiveBytes':n,'archiveSHA256':h.hexdigest(),'sourceManifest':m,'verifiedMembers':rows,'allMembersStreamDecompressedAndHashVerifiedOnRunpod':True,'noExtractionOrExecution':True,'permissions':oct(a.stat().st_mode&0o777)}
p=b/'deferred-c1af-checkpoint-receipt.json';p.write_text(json.dumps(r,indent=2)+'\n');os.chmod(p,0o600);print(json.dumps({'complete':True,'archiveBytes':n,'archiveSHA256':h.hexdigest(),'receipt':str(p)}),flush=True)
'''
opts=['-i',str(t/'source-only-ed25519'),'-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(t/'known_hosts'),'-p','10748','root@185.226.156.233']
start=time.time()
with (t/'chess-archive-source.stderr').open('w') as e1,(t/'chess-archive-gzip.stderr').open('w') as e2,(t/'chess-archive-target.stderr').open('w') as e3,(t/'chess-archive-target.stdout').open('w') as out:
 a=subprocess.Popen(['tar','-C','/','-cf','-','-T',str(t/'deferred-chess-members.txt')],stdout=subprocess.PIPE,stderr=e1)
 g=subprocess.Popen(['gzip','-1'],stdin=a.stdout,stdout=subprocess.PIPE,stderr=e2);a.stdout.close()
 c=subprocess.Popen(['ssh',*opts,'python3 -c '+shlex.quote(receiver)],stdin=g.stdout,stdout=out,stderr=e3);g.stdout.close()
 cr=c.wait();gr=g.wait();ar=a.wait()
r={'tarExitCode':ar,'gzipExitCode':gr,'targetExitCode':cr,'seconds':time.time()-start,'memberCount':len(paths),'sourceBytes':sum(r['bytes']for r in rows),'noOldArchiveWritten':True}
(t/'chess-archive-exit.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r),flush=True)
raise SystemExit(0 if ar==gr==cr==0 else 1)
