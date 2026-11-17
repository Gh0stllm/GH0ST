from pathlib import Path
import hashlib,json,subprocess,shlex,shutil,os,time,datetime
ROOT=Path('/root/gl3-base-launch');TASK=ROOT/'direct-transfer';KEY=TASK/'source-only-ed25519';KNOWN=TASK/'known_hosts';TARGET='root@172.22.0.7';PORT='22';OPTS=['-i',str(KEY),'-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(KNOWN),'-o','ConnectTimeout=20'];os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[-2:])
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def remote(code):
 p=subprocess.run(['ssh',*OPTS,'-p',PORT,TARGET,'python3 -c '+shlex.quote(code)],capture_output=True,text=True);p.check_returncode();return p.stdout
archives=[('source05-node-validator-machine.tar.gz',713234002,'67916f26c6e9e0fb9bef689c750d1ca6d25d9c93a9c733e9cf3d6aebf0dc363c'),('source06-node-validator-host-overlay.tar.gz',537032744,'0718be7709f8588bfdd2df620aebb5e87739eb62ae95cc508e3bd95e320f0f48')];rows=[]
for name,size,digest in archives:
 p=Path('/root/gl3-private-selected-backup')/name;st=p.stat();assert st.st_size==size and sha(p)==digest
 subprocess.run(['scp',*OPTS,'-P',PORT,str(p),TARGET+':'+str(p)+'.partial'],check=True)
 code="from pathlib import Path;import hashlib,json; p=Path("+repr(str(p)+'.partial')+");h=hashlib.sha256();f=p.open('rb');\nfor b in iter(lambda:f.read(1048576),b''):h.update(b)\nf.close();assert p.stat().st_size=="+str(size)+" and h.hexdigest()=="+repr(digest)+";p.rename("+repr(str(p))+");Path("+repr(str(p))+").chmod(0o600);print(json.dumps({'path':"+repr(str(p))+",'bytes':"+str(size)+",'SHA256':h.hexdigest(),'verified':True,'mode':'0600'}))"
 receiver=json.loads(remote(code));assert receiver['verified'];rows.append({'sourcePath':str(p),'sourceDevice':st.st_dev,'sourceInode':st.st_ino,**receiver})
(TASK/'archives-receiver.json').write_text(json.dumps({'verified':True,'files':rows},indent=2)+'\n');remote("from pathlib import Path;Path('/root/gl3-base-transfer/archives-receiver.json').write_text("+repr(json.dumps({'verified':True,'files':rows},indent=2)+'\n')+")")
# Root-authorized removal of ONLY the two verified duplicate compressed files.
paths={r['sourcePath'] for r in rows};owners=[]
for proc in Path('/proc').glob('[0-9]*'):
 try:
  for fd in (proc/'fd').iterdir():
   try:
    if os.readlink(fd) in paths:owners.append({'pid':int(proc.name),'fd':fd.name})
   except OSError:pass
 except OSError:pass
assert not owners
for row in rows:
 p=Path(row['sourcePath']);st=p.stat();assert st.st_dev==row['sourceDevice'] and st.st_ino==row['sourceInode'] and st.st_size==row['bytes'] and sha(p)==row['SHA256']
before=shutil.disk_usage('/root').free
for row in rows:Path(row['sourcePath']).unlink()
receipt={'UTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'AUTHORIZED_DUPLICATE_ARCHIVES_RELOCATED_VERIFIED_NO_ARTIFACT_LOSS','receiverPod':'ey9xqf5hl420h4','receiverSSH':'213.173.111.99:33655','directPrivateEndpoint':'172.22.0.7:22','privateIPVerifiedByMCP':True,'files':rows,'sourceNoOpenFDs':True,'oldRaw06AndAllSourcesModelsDBsPreserved':True,'independentOwnerOffPodCopiesAlreadyVerified':True,'diskFreeBefore':before,'diskFreeAfter':shutil.disk_usage('/root').free};receipt['reclaimedObservedBytes']=receipt['diskFreeAfter']-before;(TASK/'archives-relocation-complete.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
