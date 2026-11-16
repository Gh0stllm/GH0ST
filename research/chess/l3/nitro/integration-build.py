"""Bounded real Nitro overlay package build. No server/node/chain starts."""
import hashlib,json,os,shutil,subprocess,tarfile,urllib.request
from pathlib import Path
r=Path(__file__).resolve().parent;b=r/'.cache';dst=b/'nitro-build'
subprocess.run(['python3',str(r/'bootstrap.py')],check=True)
subprocess.run(['python3',str(r/'check-source.py')],check=True)
if dst.exists():shutil.rmtree(dst)
shutil.copytree(b/'nitro-3.12.2',dst,symlinks=True)
for p in (r/'overlay').rglob('*'):
 if p.is_file():
  q=dst/p.relative_to(r/'overlay');q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q)
p=dst/'arbos/gh0stllm';p.mkdir(parents=True,exist_ok=True)
for f in ['runtime.go','runtime_test.go']:shutil.copy2(r/'portable'/f,p/f)
# Prevent git from treating this ignored extracted tree as a subdirectory of the
# enclosing GH0ST checkout and silently skipping all patch paths.
patchEnv={**os.environ,'GIT_CEILING_DIRECTORIES':str(b)}
subprocess.run(['git','apply',str(r/'register-debug-only.patch')],cwd=dst,env=patchEnv,check=True)
llmOverlay=(r/'../bridge/nitro-overlay').resolve()
for name in ['ArbGhostLLM.go','ArbGhostLLM_test.go']:
 shutil.copy2(llmOverlay/name,dst/'precompiles'/name)
subprocess.run(['git','apply',str(llmOverlay/'registration.patch')],cwd=dst,env=patchEnv,check=True)
registry=(dst/'precompiles/precompile.go').read_text()
for name in ['makeGhostTensorPrecompile','makeGhostLLMPrecompile']:
 assert 'insert(debugOnly('+name+'()))' in registry,'Registration patch was not applied: '+name

for repo,commit,name,sha in [
 ('go-ethereum','30456d24d3cff444d3b0f246e9c7609477c7d4a1','geth','264b7c342e58910564f7f70d2975ff455a8293219f1886a32cfd7f4a6799c726'),
 ('nitro-precompile-interfaces','7e88c8cc53c2e96201a23c638f1536557b9cb68b','precompile-interfaces','ada4f0770a5d9aeacfa7ba785d4e55453c1a40c15f0a7782be1ce569e5226912')]:
 archive=b/(name+'-'+commit+'.tar.gz')
 if not archive.exists():urllib.request.urlretrieve('https://codeload.github.com/OffchainLabs/'+repo+'/tar.gz/'+commit,archive)
 assert hashlib.sha256(archive.read_bytes()).hexdigest()==sha
 with tarfile.open(archive) as t:
  for m in t.getmembers():assert (b/m.name).resolve().is_relative_to(b.resolve())
  t.extractall(b)
 if name=='geth':
  if (dst/'go-ethereum').exists():shutil.rmtree(dst/'go-ethereum')
  shutil.copytree(b/(repo+'-'+commit),dst/'go-ethereum',symlinks=True)
subprocess.run(['node',str(r/'generate-precompile-abis.mjs')],cwd=r,check=True)
baseEnv={**os.environ,'GOTOOLCHAIN':'local'}
subprocess.run([str(b/'go/bin/go'),'mod','edit','-require=github.com/Gh0stllm/GH0ST/l3/bridge@v0.0.0','-replace=github.com/Gh0stllm/GH0ST/l3/bridge='+str((r/'../bridge').resolve())],cwd=dst,check=True,env=baseEnv)
subprocess.run([str(b/'go/bin/go'),'run','-mod=mod','solgen/gen.go'],cwd=dst,check=True,env=baseEnv,timeout=150)
p=subprocess.run([str(b/'go/bin/go'),'build','-mod=mod','./precompiles'],cwd=dst,capture_output=True,text=True,env={**baseEnv,'GOOS':'wasip1','GOARCH':'wasm','CGO_ENABLED':'0'},timeout=150)
report={'scope':'Complete pinned Nitro precompiles overlay package on upstream Wasm replay compilation target','target':'wasip1/wasm','exitCode':p.returncode,'output':(p.stdout+p.stderr).replace(str(r),'$NITRO_EXPERIMENT')[-7000:],'overlayTypecheckedAgainstCompleteNitroWasmPackage':p.returncode==0,'nativeNodeBuilt':False,'proverBuilt':False,'fullLLMPrecompileSourceIncluded':True,'debugA12RegisteredInSource':True,'precompileExecutedByThisBuild':False,'financialActions':False}
(r/'evidence/nitro-wasm-package-build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
raise SystemExit(p.returncode)
