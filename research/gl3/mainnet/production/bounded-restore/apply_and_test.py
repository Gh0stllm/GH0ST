"""Run on the owned Linux Runpod worker; no baseline source is modified."""
from pathlib import Path
import hashlib,json,os,subprocess,time
r=Path('/root/bounded-restore');src=r/'nitro';kit=r/'kit';out=r/'evidence';out.mkdir(exist_ok=True)
for f,expected in json.loads((kit/'source-before.json').read_text()).items():
 assert hashlib.sha256((src/f).read_bytes()).hexdigest()==expected, f
subprocess.run(['patch','-p1','--batch','-i',kit/'bounded-code-cache.patch'],cwd=src,check=True)
(src/'go-ethereum/core/state/gl3_uncached_code_test.go').write_bytes((kit/'uncached_code_test.go').read_bytes())
go=r/'toolchain/go/bin/go';env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'16','MALLOC_ARENA_MAX':'2'}
for name,target in [('chessruntime','chess/runtime'),('slicedchess','chess/sliced/runtime')]:subprocess.run([go,'mod','edit','-replace=github.com/Gh0stllm/GH0ST/gl3/'+name+'='+str(r/target)],cwd=src,env=env,check=True)
subprocess.run([go.parent/'gofmt','-w',*[str(src/f) for f in json.loads((kit/'source-before.json').read_text())],src/'go-ethereum/core/state/gl3_uncached_code_test.go'],check=True)
t=time.monotonic()
with (out/'state-tests.log').open('w') as log:
 p=subprocess.run([go,'test','-p','12','-mod=mod','-count=1','-run','^TestGL3Uncached','-v','./core/state'],cwd=src/'go-ethereum',env=env,stdout=log,stderr=subprocess.STDOUT)
(out/'state-tests-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t,'allTestsOnRunpod':True})+'\n')
assert p.returncode==0
