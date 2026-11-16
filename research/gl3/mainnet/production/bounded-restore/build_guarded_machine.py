from pathlib import Path
import hashlib,json,os,subprocess,time
r=Path('/root/bounded-restore');go=r/'toolchain/go/bin/go';env={**os.environ,'GOTOOLCHAIN':'local','GOMAXPROCS':'12','RAYON_NUM_THREADS':'8','PATH':str(go.parent)+':'+os.environ['PATH']}
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
assert json.loads((r/'evidence/native-guard-comparison.json').read_text())['passed']
assert json.loads((r/'evidence/machine-build-result.json').read_text())['machineGenerated']
t=time.monotonic();src=r/'nitro-guest-guard'
subprocess.run(['cp','-a','--reflink=auto',r/'nitro-guest',src],check=True)
subprocess.run(['patch','-p1','--batch','-i',r/'kit/guest-memory-guard.patch'],cwd=src,check=True)
subprocess.run([go,'build','-p','8','-mod=mod','-tags=gl3aotproof','-o',r/'replay-guard.raw.wasm','./cmd/replay'],cwd=src,env={**env,'GOOS':'wasip1','GOARCH':'wasm','CGO_ENABLED':'0'},check=True)
subprocess.run([r/'gh0st-wasm-canonicalizer',r/'replay-guard.raw.wasm',r/'replay-guard.wasm'],check=True)
m=r/'machine-guard';m.mkdir(exist_ok=True)
args=['/root/prover',str(r/'replay-guard.wasm'),'--generate-binaries',str(m)]
for name in ['forward','soft-float','wasi_stub','host_io','user_host','arbcompress','arbcrypto','program_exec','gl3aot']:args+=['-l',str(r/'machine-inputs'/(name+'.wasm'))]
p=subprocess.run(args,env=env)
(r/'evidence/guard-machine-generation-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t})+'\n');assert p.returncode==0
report={'machineGenerated':True,'moduleRoot':(m/'module-root.txt').read_text().strip(),'seconds':time.monotonic()-t,'guestSoftMemoryLimitAdded':True,'guestSoftMemoryLimitBytes':3*1024**3,'enginePolicyChanged':False,'allExecutionOnRunpod':True,'fullBoLDDisputeExecuted':False,'WAVMReplayPassed':False,'unchangedCompanionSHA256':sha(r/'machine-inputs/gl3aot.wasm'),'artifacts':{str(p.relative_to(r)):{'bytes':p.stat().st_size,'SHA256':sha(p)} for p in [r/'replay-guard.raw.wasm',r/'replay-guard.wasm',m/'machine.v2.wavm.br',m/'until-host-io-state.bin']}}
(r/'evidence/guard-machine-build-result.json').write_text(json.dumps(report,indent=2)+'\n')
