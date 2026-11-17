from pathlib import Path
import os,subprocess,json,time,urllib.request,hashlib,tarfile
b=Path('/workspace/gl3/zk-tests/evm-proof');start=time.time();p=b/'downloads/cargo-prove-5.0.8.tar.gz';h=hashlib.sha256()
with urllib.request.urlopen('https://github.com/succinctlabs/sp1/releases/download/v5.0.8/cargo_prove_v5.0.8_linux_amd64.tar.gz',timeout=60)as r,p.open('wb')as f:
 for z in iter(lambda:r.read(8*1024*1024),b''):f.write(z);h.update(z)
assert h.hexdigest()=='940a6eb4b008007d99b7177b464e95f1e4b55d85a026c9fd6942c4e4549395aa'
d=b/'toolchains/sp1/bin';d.mkdir(parents=True,exist_ok=True)
with tarfile.open(p,'r:gz')as t:
 members=t.getmembers()
 for m in members:
  if m.isfile()and Path(m.name).name=='cargo-prove':
   q=d/'cargo-prove';q.write_bytes(t.extractfile(m).read());q.chmod(0o755)
assert (d/'cargo-prove').exists()
env=dict(os.environ,RUSTUP_HOME=str(b/'toolchains/rustup'),CARGO_HOME=str(b/'toolchains/cargo'));env['PATH']=str(d)+':'+str(b/'toolchains/cargo/bin')+':'+env['PATH']
with(b/'sp1-toolchain-install.log').open('w')as log:r=subprocess.run([str(d/'cargo-prove'),'prove','install-toolchain'],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=900)
(b/'sp1-toolchain-install-result.json').write_text(json.dumps({'actualExitCode':r.returncode,'seconds':time.time()-start,'cargoProveArchiveSHA256':h.hexdigest(),'noDocker':True,'realProofStarted':False},indent=2)+'\n');print('SP1_TOOLCHAIN_EXIT',r.returncode,flush=True)
