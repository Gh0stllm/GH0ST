from pathlib import Path
import subprocess,os,json,shutil,re,time
r=Path('/root/bounded-restore');src=r/'nitro';cmd=src/'cmd/gl3replayguard';shutil.copytree(src/'cmd/gl3replayaudit',cmd)
(cmd/'native.go').write_text('package main\nimport "runtime/debug"\nfunc setupGarbageCollector(){debug.SetGCPercent(1000);debug.SetMemoryLimit(3*1024*1024*1024)}\n')
go=r/'toolchain/go/bin/go';env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'12','MALLOC_ARENA_MAX':'2'}
subprocess.run([go,'build','-p','8','-mod=mod','-o',r/'replay-guard','./cmd/gl3replayguard'],cwd=src,env=env,check=True)
args=json.loads((r/'evidence/native-terminal-process.json').read_text())['args'];args[0]=str(r/'replay-guard')
t=time.monotonic()
with (r/'evidence/native-guard.log').open('w') as log:p=subprocess.run(args,env=env,stdout=log,stderr=subprocess.STDOUT)
(r/'evidence/native-guard-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t})+'\n')
s=(r/'evidence/native-guard.log').read_text();header=re.search(r'GL3_HEADER_AUDIT (0x[0-9a-f]{64}) (\d+) (0x[0-9a-f]{64}) (0x[0-9a-f]{64})',s)
ref=json.loads((r/'evidence/native-header-comparison.json').read_text())['results']['baseline']
actual={'blockHash':header[1],'gasUsed':int(header[2]),'stateRoot':header[3],'receiptHash':header[4]} if header else None
report={'passed':p.returncode==0 and all(actual[k]==ref[k] for k in actual),'exitCode':p.returncode,'actualHeader':actual,'guestEquivalentSoftLimitBytes':3*1024**3,'GOGC':1000,'nativeInputPreimagesStillResident':True,'enginePolicyChanged':False};(r/'evidence/native-guard-comparison.json').write_text(json.dumps(report,indent=2)+'\n');assert report['passed']
