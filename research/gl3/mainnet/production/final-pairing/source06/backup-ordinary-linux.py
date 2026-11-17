"""Private streamed source06 backup and member verification, Runpod only."""
from pathlib import Path
import datetime,hashlib,json,os,shutil,signal,subprocess,sys,tarfile,time
BASE=Path('/root/gl3-final-pairing');OUT=BASE/'ordinary06';PROFILE=BASE/'source06';PRIVATE=Path('/root/gl3-private-selected-backup');ARCHIVE=PRIVATE/'source06-node-validator-host-overlay.tar.gz';PART=Path(str(ARCHIVE)+'.partial');MANIFEST=OUT/'backup-member-manifest.json';MIN_FREE=6000000000;MAX_ARCHIVE=750000000;MAX_OWNED=3000000000

def sha(q):
 h=hashlib.sha256()
 with q.open('rb') as f:
  for chunk in iter(lambda:f.read(1048576),b''):h.update(chunk)
 return h.hexdigest()

def compress():
 manifest=json.loads(MANIFEST.read_text());os.umask(0o077)
 with tarfile.open(PART,'w:gz',compresslevel=1) as archive:
  for row in manifest['members']:
   archive.add(row['source'],arcname=row['archiveName'],recursive=False)
  archive.add(MANIFEST,arcname='ordinary06/backup-member-manifest.json',recursive=False)

def main():
 os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[-2:]);PRIVATE.mkdir(exist_ok=True);PRIVATE.chmod(0o700)
 if ARCHIVE.exists() or PART.exists():raise RuntimeError('Refusing to overwrite backup/partial attempt')
 if shutil.disk_usage(BASE).free<MIN_FREE:raise RuntimeError('disk floor before backup')
 lock=json.loads((OUT/'artifact-lock.json').read_text())
 assert sha(OUT/'artifact-lock.json')=='b11c065939bb6deaa22fe69cc4efcb92db5ee2ffc70ca8cc1acb077d89a18fc4'
 paths=[OUT/'bin/nitro',OUT/'bin/nitro-val',OUT/'artifact-lock.json',OUT/'native-inputs.json',PROFILE/'manifest.json',PROFILE/'source06.patch',PROFILE/'make-overlay.py',PROFILE/'build-ordinary-linux.py',PROFILE/'evidence/ordinary06-source-files.json',PROFILE/'evidence/ordinary06-source-pairing.json']
 paths+=sorted(p for p in (PROFILE/'frozen').rglob('*') if p.is_file())
 paths+=sorted(p for p in (OUT/'evidence').glob('*') if p.is_file())
 rows=[]
 for q in paths:
  if q.is_symlink():raise RuntimeError('Unexpected symlink in backup source')
  rows.append({'source':str(q),'archiveName':str(q.relative_to(BASE)),'bytes':q.stat().st_size,'SHA256':sha(q)})
 for name,row in lock['artifacts'].items():
  match=next(x for x in rows if x['source']==row['path']);assert match['bytes']==row['bytes'] and match['SHA256']==row['SHA256']
 manifest={'UTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'members':rows,'manifestSelfIsAdditionalArchiveMember':True,'rawInputBytes':sum(x['bytes'] for x in rows),'immutableSelectedMachineBackupDependency':lock['selectedImmutableMachineBackupAlreadyVerified'],'containsNoWalletOrAuthenticationSecret':True}
 MANIFEST.write_text(json.dumps(manifest,indent=2)+'\n');MANIFEST.chmod(0o600)
 expected={row['archiveName']:row for row in rows};expected['ordinary06/backup-member-manifest.json']={'bytes':MANIFEST.stat().st_size,'SHA256':sha(MANIFEST)}
 start=time.time();minimum=shutil.disk_usage(BASE).free;peak=0;reason=None
 with (OUT/'backup-compress.stdout').open('w') as stdout,(OUT/'backup-compress.stderr').open('w') as stderr:
  child=subprocess.Popen([sys.executable,__file__,'--compress'],stdout=stdout,stderr=stderr,start_new_session=True)
  while child.poll() is None:
   free=shutil.disk_usage(BASE).free;minimum=min(minimum,free)
   size=PART.stat().st_size if PART.exists() else 0;peak=max(peak,size)
   owned=sum(q.stat().st_size for q in OUT.rglob('*') if q.is_file() and not q.is_symlink())+size
   if free<MIN_FREE or size>MAX_ARCHIVE or owned>MAX_OWNED or time.time()-start>600:
    reason='disk/archive/owned-scratch/deadline guard';os.killpg(child.pid,signal.SIGTERM)
    try:child.wait(10)
    except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL)
    break
   time.sleep(.25)
  code=child.wait()
 phase={'actualExitCode':code,'seconds':time.time()-start,'stopReason':reason,'minimumSampledDiskFreeBytes':minimum,'peakSampledArchiveBytes':peak}
 (OUT/'backup-compress-exit.json').write_text(json.dumps(phase,indent=2)+'\n')
 if code:raise RuntimeError('Backup compression failed; partial and exit retained')
 PART.rename(ARCHIVE);ARCHIVE.chmod(0o600)
 verified=[];verifyStart=time.time()
 with tarfile.open(ARCHIVE,'r|gz') as archive:
  for member in archive:
   if not member.isfile() or member.name not in expected:raise RuntimeError('Unexpected backup member')
   wanted=expected.pop(member.name);stream=archive.extractfile(member);h=hashlib.sha256();size=0
   for data in iter(lambda:stream.read(1048576),b''):h.update(data);size+=len(data)
   if size!=wanted['bytes'] or h.hexdigest()!=wanted['SHA256']:raise RuntimeError('Backup member mismatch: '+member.name)
   verified.append({'archiveName':member.name,'bytes':size,'SHA256':h.hexdigest()})
 if expected:raise RuntimeError('Missing backup members')
 receipt={'status':'SOURCE06_PRIVATE_BACKUP_COMPRESSED_AND_ALL_MEMBERS_VERIFIED_ON_RUNPOD','UTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'archivePath':str(ARCHIVE),'bytes':ARCHIVE.stat().st_size,'SHA256':sha(ARCHIVE),'mode':oct(ARCHIVE.stat().st_mode&0o777),'manifestSHA256':sha(MANIFEST),'memberCount':len(verified),'verifiedMembers':verified,'streamDecompressionAndMemberHashSeconds':time.time()-verifyStart,'compression':phase,'raw06ELFsRetained':True,'oldSelectedMachineArchiveRetained':True,'offPodTransferState':'PENDING_ROOT_TRANSFER_COMPRESSED_HASH_ONLY','noLocalDecompressionOrTests':True,'allExecutionOnRunpod':True,'diskFreeAfterBytes':shutil.disk_usage(BASE).free}
 (OUT/'backup-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({k:v for k,v in receipt.items() if k!='verifiedMembers'}))

if __name__=='__main__':
 if len(sys.argv)==2 and sys.argv[1]=='--compress':compress()
 else:main()
