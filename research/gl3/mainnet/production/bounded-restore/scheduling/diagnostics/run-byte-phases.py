from pathlib import Path
import subprocess,os,json,time,hashlib
r=Path('/root/bounded-restore');d=r/'fast-guest-diagnostic';src=d/'nitro';go=r/'toolchain/go/bin/go';env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'8','GOOS':'wasip1','GOARCH':'wasm','CGO_ENABLED':'0'}
assert hashlib.file_digest(Path('/root/terminal-acceptance/evidence/terminal-input.json').open('rb'),'sha256').hexdigest()=='bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90'
for mode in ['gosched','gc']:
 out=d/('restore-byte-'+mode+'.wasm');subprocess.run([go,'build','-p','6','-mod=mod','-tags=gl3aotproof','-ldflags=-X github.com/offchainlabs/nitro/precompiles.gl3DiagnosticSchedule='+mode,'-o',out,'./cmd/replay'],cwd=src,env=env,check=True)
 started=time.monotonic()
 with (d/('byte-'+mode+'.log')).open('w') as log:p=subprocess.run(['/root/terminal-acceptance/bin/jit','--binary',str(out),'--debug','--require-success','json','--inputs','/root/terminal-acceptance/evidence/terminal-input.json'],stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'RAYON_NUM_THREADS':'8','MALLOC_ARENA_MAX':'2'})
 (d/('byte-'+mode+'-exit.json')).write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-started,'guestWasmSHA256':hashlib.file_digest(out.open('rb'),'sha256').hexdigest(),'bodyAndSeedByteBudget':64*1024**2,'companionReplacedByExplicitStop':True,'completeEngineReplay':False,'fullWAVMProof':False})+'\n')
