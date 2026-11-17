from pathlib import Path
import shutil,subprocess,os,json,time,hashlib
r=Path('/root/bounded-restore');p=r/'phase-profile';src=p/'nitro';shutil.copytree(r/'scheduled-candidate/nitro',src)
go=r/'toolchain/go/bin/go';env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'8','GOOS':'wasip1','GOARCH':'wasm','CGO_ENABLED':'0'}
subprocess.run([go,'mod','edit','-replace=github.com/Gh0stllm/GH0ST/gl3/slicedchess='+str(r/'fast-guest-diagnostic/runtime')],cwd=src,env=env,check=True)
f=src/'precompiles/ArbGhostChessSlices.go';s=f.read_text();start=s.index('func sliceRestoreSeed(');end=s.index('\nfunc sliceCommit(',start);q=s[start:end]
q=q.replace('\tim := sliced.Image{Memory: make([]byte, m.MemoryBytes), Globals: m.Globals}','\tgl3HeapPhase("before-image",evm.StateDB)\n\tim := sliced.Image{Memory: make([]byte, m.MemoryBytes), Globals: m.Globals}\n\tgl3HeapPhase("after-image",evm.StateDB)',1)
q=q.replace('\tif e := sliceApplyDeltas(','\tgl3HeapPhase("after-seed",evm.StateDB)\n\tif e := sliceApplyDeltas(',1)
q=q.replace('\ttree := sliced.NewTree(im.Memory)','\tgl3HeapPhase("after-deltas",evm.StateDB)\n\ttree := sliced.NewTree(im.Memory)\n\tgl3HeapPhase("after-tree",evm.StateDB)',1)
q=q.replace('\tsliceRestoreBeforeCompanion()','\tgl3HeapPhase("authenticated-before-GC",evm.StateDB)\n\tsliceRestoreBeforeCompanion()\n\tgl3HeapPhase("authenticated-after-GC",evm.StateDB)',1);f.write_text(s[:start]+q+s[end:])
(src/'precompiles/gl3_heap_phase.go').write_text("""package precompiles
import("runtime";"runtime/debug";"reflect";"fmt";"github.com/ethereum/go-ethereum/core/vm")
func gl3Unwrap(v reflect.Value)reflect.Value{for v.IsValid()&&(v.Kind()==reflect.Pointer||v.Kind()==reflect.Interface){if v.IsNil(){return reflect.Value{}};v=v.Elem()};return v}
func gl3HeapPhase(name string,db vm.StateDB){
 v:=gl3Unwrap(reflect.ValueOf(db));objects:=v.FieldByName("stateObjects");count,accountLen,accountCap:=0,0,0
 if objects.IsValid(){count=objects.Len();it:=objects.MapRange();for it.Next(){code:=gl3Unwrap(it.Value()).FieldByName("code");accountLen+=code.Len();accountCap+=code.Cap()}}
 cacheBytes,cacheCap,cacheLimit:=uint64(0),0,uint64(0)
 reader:=gl3Unwrap(v.FieldByName("reader"));if reader.IsValid(){codeReader:=gl3Unwrap(reader.FieldByName("ContractCodeReader"));if codeReader.IsValid(){cache:=gl3Unwrap(codeReader.FieldByName("cache"));if cache.IsValid(){blobs:=gl3Unwrap(cache.FieldByName("codeCache"));if blobs.IsValid(){cacheBytes=blobs.FieldByName("size").Uint();cacheLimit=blobs.FieldByName("maxSize").Uint();it:=blobs.FieldByName("lru").FieldByName("items").MapRange();for it.Next(){cacheCap+=it.Value().FieldByName("value").Cap()}}}}}
 var m runtime.MemStats;runtime.ReadMemStats(&m)
 fmt.Printf("GL3_HEAP_PHASE %s limit=%d heapAlloc=%d heapInuse=%d heapSys=%d heapReleased=%d nextGC=%d numGC=%d objects=%d accountCodeLen=%d accountCodeCap=%d readerCodeLen=%d readerCodeCap=%d readerCodeLimit=%d\\n",name,debug.SetMemoryLimit(-1),m.HeapAlloc,m.HeapInuse,m.HeapSys,m.HeapReleased,m.NextGC,m.NumGC,count,accountLen,accountCap,cacheBytes,cacheCap,cacheLimit)
}
""")
out=p/'replay.wasm';subprocess.run([go,'build','-p','6','-mod=mod','-tags=gl3aotproof','-o',out,'./cmd/replay'],cwd=src,env=env,check=True)
t=time.monotonic()
with (p/'jit.log').open('w') as log:proc=subprocess.run(['/root/terminal-acceptance/bin/jit','--binary',str(out),'--debug','--require-success','json','--inputs','/root/terminal-acceptance/evidence/terminal-input.json'],stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'RAYON_NUM_THREADS':'8','MALLOC_ARENA_MAX':'2'})
(p/'exit.json').write_text(json.dumps({'exitCode':proc.returncode,'seconds':time.monotonic()-t,'guestWasmSHA256':hashlib.file_digest(out.open('rb'),'sha256').hexdigest(),'diagnosticOnly':True,'engineReplacedWithStop':True})+'\n')
