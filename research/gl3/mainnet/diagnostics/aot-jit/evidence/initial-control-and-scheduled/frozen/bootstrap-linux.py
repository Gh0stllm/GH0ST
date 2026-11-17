from pathlib import Path
import os,subprocess,urllib.request,hashlib,tarfile,json,time
r=Path('/root/gl3-aot-jit');d=r/'downloads';d.mkdir(exist_ok=True)
def fetch(url,path,expected=None):
 if not path.exists():urllib.request.urlretrieve(url,path)
 digest=hashlib.file_digest(path.open('rb'),'sha256').hexdigest()
 if expected:assert digest==expected,(str(path),digest)
 return digest
brotli=d/'brotli-f4153.tar.gz';sha=fetch('https://codeload.github.com/google/brotli/tar.gz/f4153a09f87cbb9c826d8fc12c74642bb2d879ea',brotli,'6d6cacce05086b7debe75127415ff9c3661849f564fe2f5f3b0383d48aa4ed77')
if not (r/'source/brotli/c/include').exists():
 with tarfile.open(brotli) as t:t.extractall(d,filter='data')
 (d/'brotli-f4153a09f87cbb9c826d8fc12c74642bb2d879ea').rename(r/'source/brotli')
init=d/'rustup-init';url='https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init';expected=urllib.request.urlopen(url+'.sha256').read().decode().split()[0];initsha=fetch(url,init,expected);init.chmod(0o755)
env={**os.environ,'CARGO_HOME':str(r/'cargo'),'RUSTUP_HOME':str(r/'rustup'),'RUSTUP_TOOLCHAIN':'1.93.0','CARGO_BUILD_JOBS':'4','RAYON_NUM_THREADS':'4'}
p=subprocess.run([str(init),'-y','--no-modify-path','--profile','minimal','--default-toolchain','1.93.0'],env=env);assert p.returncode==0
report={'rustupInitSHA256':initsha,'brotliSourceSHA256':sha,'brotliSourceCommit':'f4153a09f87cbb9c826d8fc12c74642bb2d879ea','CargoLockSHA256':hashlib.file_digest((r/'source/Cargo.lock').open('rb'),'sha256').hexdigest(),'toolchain':subprocess.check_output([str(r/'cargo/bin/rustc'),'--version'],env=env,text=True).strip(),'sourceBundle':'/root/gl3-test-bundle.tar.gz','sourceBundleSHA256':hashlib.file_digest(Path('/root/gl3-test-bundle.tar.gz').open('rb'),'sha256').hexdigest(),'allExecutionOnRunpod':True};(r/'bootstrap-result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
