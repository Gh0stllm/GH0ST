"""Build pinned native dependencies and run local Nitro tests, never start a chain.

Requires a real Rust1.93.0 toolchain (RUST_TOOLCHAIN_BIN or rustup's installed
1.93.0). Every install and artifact goes under ignored .cache. --full-model also
requires the separate llm build fixtures and the bridge source in this checkout.
"""
import argparse,hashlib,json,os,platform,shutil,signal,subprocess,tarfile,time,urllib.request
from pathlib import Path
r=Path(__file__).resolve().parent;b=r/'.cache';src=b/'nitro-build'
args=argparse.ArgumentParser();args.add_argument('--full-model',action='store_true');args.add_argument('--llm-abi',action='store_true');args.add_argument('--reuse-build',action='store_true',help='Use an already prepared cache instead of replacing its source/dependencies');opt=args.parse_args()
def run(command,cwd=src,env=None,timeout=900):
 p=subprocess.Popen(command,cwd=cwd,env=env,start_new_session=True)
 try:code=p.wait(timeout=timeout)
 except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGTERM);p.wait();raise
 if code:raise subprocess.CalledProcessError(code,command)
# The package-level integration check creates a fresh ignored source tree.
if not opt.reuse_build:run(['python3',str(r/'integration-build.py')],r,timeout=600)
if not src.is_dir():raise RuntimeError('Run integration-build.py before --reuse-build')
if not opt.reuse_build:
 if os.environ.get('RUST_TOOLCHAIN_BIN'):tb=Path(os.environ['RUST_TOOLCHAIN_BIN'])
 else:
  cached=r.parents[1]/'engine/.cache/toolchain/rust/1.93.0-c0f5063e-b788d8d6/toolchains/1.93.0-aarch64-apple-darwin/bin'
  if cached.exists():tb=cached
  else:tb=Path(subprocess.check_output(['rustup','which','--toolchain','1.93.0','rustc'],text=True).strip()).parent
 version=subprocess.check_output([str(tb/'rustc'),'--version'],text=True).strip()
 if not version.startswith('rustc 1.93.0 '):raise RuntimeError('Exact Rust1.93.0 required; wrappers must not silently select another toolchain')
 for owner,repo,commit,target,sha in [
  ('OffchainLabs','wasmer','4cd8a4500aaa6edf8d5f080e6aa198bd5d25a1a5','crates/tools/wasmer','62c7491772c091061efd835dc0c1d8835b4b0ec8a22fe95838d702ff25012a16'),
  ('google','brotli','f4153a09f87cbb9c826d8fc12c74642bb2d879ea','brotli','6d6cacce05086b7debe75127415ff9c3661849f564fe2f5f3b0383d48aa4ed77')]:
  archive=b/(repo+'-'+commit+'.tar.gz')
  if not archive.exists():urllib.request.urlretrieve('https://codeload.github.com/'+owner+'/'+repo+'/tar.gz/'+commit,archive)
  assert hashlib.sha256(archive.read_bytes()).hexdigest()==sha
  with tarfile.open(archive) as t:
   for m in t.getmembers():assert (b/m.name).resolve().is_relative_to(b.resolve())
   t.extractall(b)
  out=src/target
  if out.exists():shutil.rmtree(out)
  out.parent.mkdir(parents=True,exist_ok=True);shutil.copytree(b/(repo+'-'+commit),out,symlinks=True)
 env={**os.environ,'PATH':str(tb)+':'+os.environ['PATH'],'RUSTC':str(tb/'rustc'),'RUSTDOC':str(tb/'rustdoc'),'CARGO_HOME':str(b/'cargo-home'),'CARGO_TARGET_DIR':str(b/'stylus-target')}
 if not (b/'tools/bin/cbindgen').exists():run([str(tb/'cargo'),'install','cbindgen','--version','0.29.2','--locked','--root',str(b/'tools')],env=env,timeout=600)
 run([str(tb/'cargo'),'build','--locked','--release','-p','stylus','--lib','--features','cc_brotli'],env=env,timeout=1200)
 (src/'target/include').mkdir(parents=True,exist_ok=True);(src/'target/lib').mkdir(parents=True,exist_ok=True)
 run([str(b/'tools/bin/cbindgen'),'--config','cbindgen.toml','--crate','stylus','--output',str(src/'target/include/arbitrator.h')],src/'crates/stylus',env,timeout=180)
 shutil.copy2(b/'stylus-target/release/libstylus.a',src/'target/lib/libstylus.a')
else:
 for name in ['target/include/arbitrator.h','target/lib/libstylus.a']:
  if not (src/name).is_file():raise RuntimeError('Missing native artifact '+name+'; rerun without --reuse-build')
go=str(b/'go/bin/go');goenv={**os.environ,'GOTOOLCHAIN':'local'}
run([go,'test','-mod=mod','./precompiles','-run','^TestGH0STTensor','-count=1','-v'],env=goenv,timeout=180)
if opt.full_model or opt.llm_abi:
 run([go,'mod','edit','-require=github.com/Gh0stllm/GH0ST/l3/bridge@v0.0.0','-replace=github.com/Gh0stllm/GH0ST/l3/bridge='+str((r/'../bridge').resolve())],env=goenv)
 goenv.update({'GH0ST_LLM_FIXTURE_DIR':str((r/'../llm/.cache').resolve()),'GH0ST_LLM_EVIDENCE_PATH':str(b/'fullmodel-arbos-reproduction.json')})
 if opt.full_model:run([go,'test','-mod=mod','-tags=gh0stllmbridge','./precompiles','-run','^TestGH0STFullLLMArbOSWordStore$','-count=1','-v'],env=goenv,timeout=360)
if opt.llm_abi or opt.full_model:
 # Recopy the independently owned wrapper, then verify the real registry rather
 # than accepting a zero-test/zero-patch success.
 llmOverlay=(r/'../bridge/nitro-overlay').resolve()
 for name in ['ArbGhostLLM.go','ArbGhostLLM_test.go']:shutil.copy2(llmOverlay/name,src/'precompiles'/name)
 registry=(src/'precompiles/precompile.go').read_text()
 if 'insert(debugOnly(makeGhostLLMPrecompile()))' not in registry:
  run(['git','apply',str(llmOverlay/'registration.patch')],env={**os.environ,'GIT_CEILING_DIRECTORIES':str(b)})
 assert 'insert(debugOnly(makeGhostLLMPrecompile()))' in (src/'precompiles/precompile.go').read_text()
 for backend in ['interpreter','native-compiler']:
  env={**goenv,'GH0ST_LLM_NATIVE_COMPILER':'1' if backend=='native-compiler' else '0','GH0ST_LLM_ABI_EVIDENCE_PATH':str(b/('llm-abi-dispatch-'+backend+'.json'))}
  result=subprocess.run([go,'test','-mod=mod','./precompiles','-run','^TestGH0STFullLLM(ABIMetadata|NativeABIDispatch)$','-count=1','-json'],cwd=src,env=env,capture_output=True,text=True,timeout=360)
  lines=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
  passed={line.get('Test') for line in lines if line.get('Action')=='pass'}
  assert result.returncode==0 and {'TestGH0STFullLLMABIMetadata','TestGH0STFullLLMNativeABIDispatch'}<=passed,result.stdout+result.stderr
  evidence=json.loads((b/('llm-abi-dispatch-'+backend+'.json')).read_text())
  assert evidence['comparedLogits']==50257 and evidence['actualEVMOutOfGasRollbackVerified']
  print(json.dumps(evidence,indent=2))
print('Native local tests complete. No node, server lease, transaction or fraud-proof challenge was started.')
