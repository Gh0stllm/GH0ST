from pathlib import Path
import os,subprocess,json,time,hashlib,urllib.request,concurrent.futures
b=Path('/workspace/gl3/zk-tests/evm-proof');os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[:8]);start=time.time()
def fetch(name,url,want):
 p=b/name;p.parent.mkdir(parents=True,exist_ok=True);h=hashlib.sha256()
 with urllib.request.urlopen(url,timeout=60)as r,p.open('wb')as f:
  for z in iter(lambda:r.read(8*1024*1024),b''):f.write(z);h.update(z)
 assert h.hexdigest()==want,(name,h.hexdigest());return {'file':str(p),'SHA256':h.hexdigest(),'bytes':p.stat().st_size}
def source():
 p=b/'source/replay';p.parent.mkdir(exist_ok=True)
 with(b/'source-fetch.log').open('w')as log:
  r=subprocess.run(['git','clone','https://github.com/lambdaclass/ethrex-replay.git',str(p)],stdout=log,stderr=subprocess.STDOUT);assert r.returncode==0
  r=subprocess.run(['git','checkout','--detach','d6687b13f06f39510cf71abafe0e6a5fe2ab3c80'],cwd=p,stdout=log,stderr=subprocess.STDOUT);assert r.returncode==0
  head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=p,text=True).strip();assert head=='d6687b13f06f39510cf71abafe0e6a5fe2ab3c80'
 return {'sourceReady':True,'commit':head,'CargoLockSHA256':hashlib.sha256((p/'Cargo.lock').read_bytes()).hexdigest()}
def rust():
 url='https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init';want=urllib.request.urlopen(url+'.sha256',timeout=30).read().decode().split()[0];r=fetch('downloads/rustup-init',url,want);p=Path(r['file']);p.chmod(0o755);env=dict(os.environ,RUSTUP_HOME=str(b/'toolchains/rustup'),CARGO_HOME=str(b/'toolchains/cargo'))
 with(b/'rust-install.log').open('w')as log:x=subprocess.run([str(p),'-y','--profile','minimal','--default-toolchain','1.90.0','--no-modify-path'],env=env,stdout=log,stderr=subprocess.STDOUT)
 assert x.returncode==0;return {'RustReady':True,'actualExitCode':0,**r}
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:
 jobs=[pool.submit(source),pool.submit(rust),pool.submit(fetch,'guest/ethrex15-sp1.elf','https://github.com/lambdaclass/ethrex/releases/download/v15.0.0/ethrex-riscv32im-sp1-elf-v15.0.0-rc.1','25270f23a49d998e37769c775047a6c9c080cd5d02b9b036ac18facb60c59bbb')]
 rows=[]
 for job in concurrent.futures.as_completed(jobs):
  try:r=job.result();rows.append(r);print(json.dumps(r),flush=True)
  except Exception as e:print('SETUP_FAILED',repr(e),flush=True);rows.append({'failed':repr(e)})
(b/'setup-result.json').write_text(json.dumps({'seconds':time.time()-start,'results':rows,'realProofStarted':False,'allSetupOnRunpod':True},indent=2)+'\n')
