#!/usr/bin/env python3
"""Preserve public system runtimes/dependencies only; never accesses wallet files."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys,sysconfig,time
assert os.uname().nodename=='cc91695a75f7';os.sched_setaffinity(0,set(sorted(os.sched_getaffinity(0))[-2:]));os.nice(10)
B=Path('/workspace/gl3/durable/reset-runtime-v1');assert not B.exists();(B/'bin').mkdir(parents=True);(B/'lib').mkdir();started=time.monotonic()
def sha(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for x in iter(lambda:f.read(1048576),b''):h.update(x)
 return h.hexdigest()
def guard():
 s=os.statvfs('/root');assert s.f_bavail*s.f_frsize>=6000000000;assert time.monotonic()-started<180
 s=dict(x.split()for x in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines());assert int(Path('/sys/fs/cgroup/memory.current').read_text())-int(s.get('inactive_file','0'))<56000000000
 if sum(x.stat().st_size for x in B.rglob('*')if x.is_file()and not x.is_symlink())>512*1024**2:raise RuntimeError('runtime512MiB guard')
node=Path(shutil.which('node')).resolve();python=Path(sys.executable).resolve();shutil.copy2(node,B/'bin/node');shutil.copy2(python,B/'bin/python3.12');stdlib=Path(sysconfig.get_path('stdlib'));assert str(stdlib)=='/usr/lib/python3.12';shutil.copytree(stdlib,B/'lib/python3.12',symlinks=True,ignore=shutil.ignore_patterns('__pycache__','site-packages','dist-packages'))
initial=[node,python,Path('/workspace/gl3/durable/bin/nitro')]+[Path('/workspace/gl3/same-day-mainnet/node/bin')/n for n in['nitro-val','jit','prover']];queue=initial+list(stdlib.rglob('*.so'));seen=set();deps={}
while queue:
 guard();p=queue.pop()
 if str(p)in seen:continue
 seen.add(str(p));x=subprocess.run(['ldd',str(p)],capture_output=True,text=True);assert 'not found'not in x.stdout
 for line in x.stdout.splitlines():
  m=re.search(r'=> (/\S+)|^\s*(/\S+)',line)
  if not m:continue
  src=Path(m.group(1)or m.group(2));assert str(src).startswith(('/lib/','/lib64/','/usr/lib/'));dst=B/'lib'/src.name
  if dst.exists():assert sha(dst)==sha(src)
  else:shutil.copy2(src.resolve(),dst);deps[str(src)]={'target':str(dst),'SHA256':sha(dst)};queue.append(src)
cert=Path('/etc/ssl/certs/ca-certificates.crt');(B/'certs').mkdir();shutil.copy2(cert,B/'certs/ca-certificates.crt');loader=B/'lib/ld-linux-x86-64.so.2';assert loader.exists();env={'PATH':'/usr/bin:/bin','HOME':str(B),'PYTHONHOME':str(B),'PYTHONNOUSERSITE':'1','LD_LIBRARY_PATH':str(B/'lib')}
checks=[]
for name,args in[('node',[str(B/'bin/node'),'--version']),('python',[str(B/'bin/python3.12'),'-I','-S','-B','-c','import json,socket,ssl,hashlib,tarfile,zlib;print("bundled-python-stdlib-ok")']),('nitro',['/workspace/gl3/durable/bin/nitro','--version'])]:
 x=subprocess.run([str(loader),'--library-path',str(B/'lib'),*args],env=env,capture_output=True,text=True,timeout=10);assert x.returncode==0,(name,x.returncode);checks.append({'name':name,'exitCode':x.returncode,'output':x.stdout.strip()})
files={str(p.relative_to(B)):{'SHA256':sha(p),'bytes':p.stat().st_size}for p in B.rglob('*')if p.is_file()and not p.is_symlink()};report={'passed':True,'publicRuntimeFilesOnly':True,'walletFilesRead':False,'sourcePaths':{'node':str(node),'python':str(python),'stdlib':str(stdlib)},'officialBinarySHA256':{str(p):sha(p)for p in initial[2:]},'dependencies':deps,'checks':checks,'files':files,'totalBytes':sum(x['bytes']for x in files.values()),'seconds':time.monotonic()-started};(B/'manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k]for k in['passed','totalBytes','seconds','checks']}))
