from pathlib import Path
import subprocess,os,shutil,json,time,hashlib
r=Path('/root/bounded-restore');d=r/'fast-guest-diagnostic';src=d/'nitro';runtime=d/'runtime'
shutil.copytree(r/'nitro-guest-guard',src,ignore=shutil.ignore_patterns('target'))
shutil.copytree(r/'aot-runtime',runtime)
p=runtime/'proof_runtime.go';s=p.read_text();old='//go:wasmimport gl3aot execute\nfunc execute(op,handle,a,b,c uint32,ptr unsafe.Pointer,n uint32) uint64'
new='func execute(op,handle,a,b,c uint32,ptr unsafe.Pointer,n uint32) uint64 {println("GL3_DIAG_ENGINE_ENTRY",op);panic("DIAGNOSTIC_STOP_BEFORE_COMPANION")} '
assert old in s;p.write_text(s.replace(old,new))
p=src/'precompiles/ArbGhostChessSliceDelta.go';s=p.read_text();needle='\t\thead = prior\n';assert s.count(needle)==1;p.write_text(s.replace(needle,'\t\tgl3DiagnosticMemory(left)\n'+needle))
(src/'precompiles/gl3_diagnostic_memory.go').write_text("""package precompiles
import("runtime";"runtime/debug")
var gl3DiagnosticForceGC="0"
func gl3DiagnosticMemory(left uint32){
 if left%64!=0 && left!=1{return}
 if gl3DiagnosticForceGC=="1"{runtime.GC()}
 var m runtime.MemStats;runtime.ReadMemStats(&m)
 println("GL3_DIAG_MEM left",left,"limit",debug.SetMemoryLimit(-1),"heapAlloc",m.HeapAlloc,"heapInuse",m.HeapInuse,"heapSys",m.HeapSys,"heapIdle",m.HeapIdle,"heapReleased",m.HeapReleased,"sys",m.Sys,"nextGC",m.NextGC,"numGC",m.NumGC,"totalAlloc",m.TotalAlloc,"heapObjects",m.HeapObjects)
}
""")
go=r/'toolchain/go/bin/go';env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'8','GOOS':'wasip1','GOARCH':'wasm','CGO_ENABLED':'0'}
subprocess.run([go,'mod','edit','-replace=github.com/Gh0stllm/GH0ST/gl3/slicedchess='+str(runtime)],cwd=src,env=env,check=True)
for mode in ['0','1']:
 out=d/('restore-force-'+mode+'.wasm');cmd=[go,'build','-p','6','-mod=mod','-tags=gl3aotproof','-ldflags=-X github.com/offchainlabs/nitro/precompiles.gl3DiagnosticForceGC='+mode,'-o',out,'./cmd/replay']
 subprocess.run(cmd,cwd=src,env=env,check=True)
 args=['/root/terminal-acceptance/bin/jit','--binary',str(out),'--debug','--require-success','json','--inputs','/root/terminal-acceptance/evidence/terminal-input.json']
 started=time.monotonic()
 with (d/('mode-'+mode+'.log')).open('w') as log:p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'RAYON_NUM_THREADS':'8','MALLOC_ARENA_MAX':'2'})
 (d/('mode-'+mode+'-exit.json')).write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-started,'guestWasmSHA256':hashlib.file_digest(out.open('rb'),'sha256').hexdigest(),'companionReplacedByExplicitStop':True,'completeEngineReplay':False,'fullWAVMProof':False})+'\n')
