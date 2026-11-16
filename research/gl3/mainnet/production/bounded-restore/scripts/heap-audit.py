from pathlib import Path
import subprocess,os,json,shutil,time,struct
r=Path('/root/bounded-restore');src=r/'nitro';cmd=src/'cmd/gl3replayheap';shutil.copytree(src/'cmd/gl3replayaudit',cmd)
s=(cmd/'main.go').read_text().replace('wavmio.OnFinal()','gl3HeapAudit()\n\twavmio.OnFinal()');(cmd/'main.go').write_text(s)
(cmd/'native.go').write_text('package main\nimport("runtime";"runtime/debug";"fmt")\nfunc setupGarbageCollector(){debug.SetGCPercent(1000)}\nfunc gl3HeapAudit(){var m runtime.MemStats;runtime.ReadMemStats(&m);fmt.Printf("GL3_HEAP_BEFORE %d %d %d %d %d\\n",m.HeapAlloc,m.HeapInuse,m.NextGC,m.Sys,m.NumGC);runtime.GC();runtime.ReadMemStats(&m);fmt.Printf("GL3_HEAP_AFTER %d %d %d %d %d\\n",m.HeapAlloc,m.HeapInuse,m.NextGC,m.Sys,m.NumGC)}\n')
go=r/'toolchain/go/bin/go';env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'12','MALLOC_ARENA_MAX':'2','GODEBUG':'gctrace=1'}
subprocess.run([go,'build','-p','8','-mod=mod','-o',r/'replay-heap','./cmd/gl3replayheap'],cwd=src,env=env,check=True)
args=json.loads((r/'evidence/native-terminal-process.json').read_text())['args'];args[0]=str(r/'replay-heap')
t=time.monotonic()
with (r/'evidence/native-gogc1000.log').open('w') as log:p=subprocess.run(args,env=env,stdout=log,stderr=subprocess.STDOUT)
(r/'evidence/native-gogc1000-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t,'nativeInputPreimagesNotGuestHeap':True})+'\n')
assert p.returncode==0
