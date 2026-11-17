#!/usr/bin/env python3
"""Private Runpod /root checkpoint. Never prints file contents or private inventory."""
from pathlib import Path
import ctypes,fcntl,hashlib,json,os,select,signal,socket,stat,subprocess,time
ROOT=Path('/root');BASE=Path('/workspace/gl3/mainnet/private');assert socket.gethostname()=='cc91695a75f7';assert Path('/sys/fs/cgroup/memory.max').read_text().strip()=='64000000000'
BASE.mkdir(parents=True,exist_ok=True,mode=0o700);assert not BASE.is_symlink();BASE.chmod(0o700)
D=BASE/('root-checkpoint-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime()));D.mkdir(mode=0o700);os.umask(0o077);os.sched_setaffinity(0,set(sorted(os.sched_getaffinity(0))[-2:]));os.nice(10)
lease=(BASE/'root-checkpoint.lock').open('a');fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
started=time.monotonic();cancel=None;children=[];exits={};stages=[];reason=None
save=lambda n,x:(D/n).write_text(json.dumps(x,indent=2)+'\n')
def stop_signal(n,_):
 global cancel
 cancel=signal.Signals(n).name
signal.signal(signal.SIGTERM,stop_signal);signal.signal(signal.SIGINT,stop_signal)
def inventory():
 out={};top={};rootdev=ROOT.stat().st_dev
 for folder,dirs,files in os.walk(ROOT,followlinks=False):
  dirs[:]=[n for n in dirs if not Path(folder,n).is_symlink()and Path(folder,n).stat().st_dev==rootdev]
  names=files+[n for n in os.listdir(folder)if Path(folder,n).is_symlink()]
  for name in set(names):
   p=Path(folder,name);s=p.lstat();r=str(p.relative_to(ROOT));out[r]={'mode':stat.S_IFMT(s.st_mode),'size':s.st_size,'mtimeNS':s.st_mtime_ns,'inode':s.st_ino,'link':os.readlink(p)if stat.S_ISLNK(s.st_mode)else None};k=r.split('/')[0];v=top.setdefault(k,{'files':0,'logicalBytes':0,'allocatedBytes':0});v['files']+=1;v['logicalBytes']+=s.st_size;v['allocatedBytes']+=s.st_blocks*512
 return out,top
def writers():
 found=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   for fd in(p/'fd').iterdir():
    try:
     target=os.readlink(fd)
     if not target.startswith('/root/'):continue
     info=(p/'fdinfo'/fd.name).read_text();flags=int(next(x.split()[1]for x in info.splitlines()if x.startswith('flags:')),8)
     if flags&os.O_ACCMODE in[os.O_WRONLY,os.O_RDWR]:found.append({'pid':int(p.name),'file':target,'fd':fd.name})
    except(FileNotFoundError,ProcessLookupError,PermissionError,StopIteration):pass
  except(FileNotFoundError,ProcessLookupError,PermissionError):pass
 return found
def guard():
 if cancel:raise RuntimeError('cancelled '+cancel)
 if time.monotonic()-started>360:raise RuntimeError('six-minute guard')
 fs=os.statvfs('/root')
 if fs.f_bavail*fs.f_frsize<6000000000:raise RuntimeError('root free floor')
 s=dict(x.split()for x in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines());working=int(Path('/sys/fs/cgroup/memory.current').read_text())-int(s.get('inactive_file','0'))
 if working>=56000000000:raise RuntimeError('shared working-memory reserve')
 return fs.f_bavail*fs.f_frsize,working
def spawn(args,**kw):
 parent=os.getpid()
 def death():
  ctypes.CDLL(None,use_errno=True).prctl(1,signal.SIGKILL)
  if os.getppid()!=parent:os._exit(126)
 p=subprocess.Popen(args,start_new_session=True,preexec_fn=death,**kw);children.append(p);return p
def collect(p,block=False):
 if p.pid in exits:return True
 got,s,u=os.wait4(p.pid,0 if block else os.WNOHANG)
 if got:p.returncode=os.waitstatus_to_exitcode(s);exits[p.pid]={'pid':p.pid,'exitCode':p.returncode,'maxRSSKiB':u.ru_maxrss};return bool(got)
 return False
archive=D/'root.tar.zst.partial';sha=hashlib.sha256();written=0;report={'passed':False,'privateArchive':True,'publishArchive':False,'noSymlinkDereference':True,'operatorKeyFilesRead':False,'scope':'Entire ephemeral /root only, including practical caches; workspace symlink targets not read','sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'directory':str(D),'startedUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
try:
 guard();before,summary=inventory();save('source-inventory.private.json',before);save('source-summary.private.json',summary);active=writers();save('writers-before.private.json',active);assert not active,'Live /root writers present'
 save('intent.private.json',{'CPU':2,'nice':10,'wallSeconds':360,'rootFreeFloor':6000000000,'sharedWorkingCeiling':56000000000,'sourceLogicalBytes':sum(x['logicalBytes']for x in summary.values()),'sourceAllocatedBytes':sum(x['allocatedBytes']for x in summary.values()),'sourceFiles':len(before),'symlinkDereference':False})
 err=(D/'archive-stderr.private.log').open('wb');tar=spawn(['tar','--one-file-system','--numeric-owner','--acls','--xattrs','--sparse','-cf','-','-C','/','root'],stdout=subprocess.PIPE,stderr=err);z=spawn(['zstd','-T2','-1','-q','-c'],stdin=tar.stdout,stdout=subprocess.PIPE,stderr=err);tar.stdout.close();os.set_blocking(z.stdout.fileno(),False);f=archive.open('xb');eof=False
 while not eof:
  guard();ready,_,_=select.select([z.stdout],[],[],.2)
  if ready:
   v=os.read(z.stdout.fileno(),1048576)
   if not v:eof=True
   else:f.write(v);sha.update(v);written+=len(v)
  for p in[tar,z]:collect(p)
  if written>32*1024**3:raise RuntimeError('archive32GiB guard')
 f.flush();os.fsync(f.fileno());f.close();z.stdout.close()
 for p in[tar,z]:
  while not collect(p):guard();time.sleep(.05)
  assert exits[p.pid]['exitCode']==0,'Archive process failed'
 err.close();stages.append({'stage':'archive','seconds':time.monotonic()-started,'compressedBytes':written})
 verifylog=(D/'verify-stderr.private.log').open('wb');v=spawn(['zstd','-t','-T2','-q',str(archive)],stdout=subprocess.DEVNULL,stderr=verifylog)
 while not collect(v):guard();time.sleep(.1)
 verifylog.close();assert exits[v.pid]['exitCode']==0,'Compressed archive checksum failed'
 after,afterSummary=inventory();save('source-inventory-after.private.json',after);save('writers-after.private.json',writers());assert before==after,'Source metadata changed during archive'
 target=D/'root.tar.zst';archive.rename(target);target.chmod(0o600);report.update({'passed':True,'archive':str(target),'archiveSHA256':sha.hexdigest(),'archiveBytes':written,'sourceFiles':len(before),'sourceLogicalBytes':sum(x['logicalBytes']for x in summary.values()),'sourceAllocatedBytes':sum(x['allocatedBytes']for x in summary.values()),'sourceMetadataUnchanged':True,'liveWritersBefore':0,'liveWritersAfter':len(writers()),'zstdChecksumVerified':True,'archiveMode':oct(stat.S_IMODE(target.stat().st_mode)),'directoryMode':oct(stat.S_IMODE(D.stat().st_mode))})
except Exception as e:reason=type(e).__name__+':'+str(e);report['error']=reason
finally:
 for p in reversed(children):
  if not collect(p):
   try:os.killpg(p.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   until=time.monotonic()+3
   while time.monotonic()<until and not collect(p):time.sleep(.05)
   if not collect(p):
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    collect(p,True)
 report.update({'seconds':time.monotonic()-started,'actualChildExits':list(exits.values()),'stages':stages,'terminationReason':reason});save('result.private.json',report)
 print(json.dumps({k:report.get(k)for k in['passed','directory','archive','archiveSHA256','archiveBytes','sourceFiles','sourceLogicalBytes','sourceAllocatedBytes','sourceMetadataUnchanged','liveWritersBefore','liveWritersAfter','archiveMode','directoryMode','seconds','error','actualChildExits']}));raise SystemExit(0 if report['passed']else 1)
