"""Build a cache-only guest with unchanged companion and proof libraries on Linux."""
from pathlib import Path
import hashlib,json,os,subprocess,time
r=Path('/root/bounded-restore');src=r/'nitro';out=r/'evidence';go=r/'toolchain/go/bin/go'
assert os.uname().sysname=='Linux'
env={**os.environ,'GOTOOLCHAIN':'local','GOMAXPROCS':'12','RAYON_NUM_THREADS':'8','PATH':str(go.parent)+':'+os.environ['PATH']}
base=json.loads((r/'original-build.json').read_text())
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
libs=['forward','soft-float','wasi_stub','host_io','user_host','arbcompress','arbcrypto','program_exec']
for name in libs:assert sha(r/'machine-inputs'/(name+'.wasm'))==base['standardLibraries'][name]['SHA256'],name
assert sha(r/'machine-inputs/gl3aot.wasm')==base['artifacts']['gl3aot.wasm']['SHA256']
assert sha(Path('/root/prover'))=='543915bc395d4c0a1442922b4265bfdfcfdd9205e9cb51fa8e0937eab4ca26c0'
started=time.monotonic()
# Freeze the guest sources separately, so native commands keep their own runtime.
# Hard-linking mutable source is deliberately not used.
guest=r/'nitro-guest'
subprocess.run(['cp','-a','--reflink=auto',src,guest],check=True)
subprocess.run([go,'mod','edit','-replace=github.com/Gh0stllm/GH0ST/gl3/slicedchess='+str(r/'aot-runtime')],cwd=guest,env=env,check=True)
subprocess.run([go,'build','-p','8','-mod=mod','-tags=gl3aotproof','-o',r/'replay.raw.wasm','./cmd/replay'],cwd=guest,env={**env,'GOOS':'wasip1','GOARCH':'wasm','CGO_ENABLED':'0'},check=True)
subprocess.run([r/'gh0st-wasm-canonicalizer',r/'replay.raw.wasm',r/'replay.wasm'],check=True)
# Proof-machine generation is gated on native output and exact header/gas parity.
assert json.loads((out/'native-terminal-result.json').read_text())['passed']
deadline=time.monotonic()+300
while not (out/'native-header-comparison.json').exists():
 assert time.monotonic()<deadline,'native header audit not completed';time.sleep(1)
assert json.loads((out/'native-header-comparison.json').read_text())['passed']
machine=r/'machine';machine.mkdir(exist_ok=True)
args=['/root/prover',str(r/'replay.wasm'),'--generate-binaries',str(machine)]
for name in libs:args+=['-l',str(r/'machine-inputs'/(name+'.wasm'))]
args+=['-l',str(r/'machine-inputs/gl3aot.wasm')]
p=subprocess.run(args,env=env)
(out/'machine-generation-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-started})+'\n');assert p.returncode==0
report={'machineGenerated':True,'moduleRoot':(machine/'module-root.txt').read_text().strip(),'seconds':time.monotonic()-started,'guestSoftMemoryLimitAdded':False,'cacheOnlyChange':True,'enginePolicyChanged':False,'allExecutionOnRunpod':True,'fullBoLDDisputeExecuted':False,'WAVMReplayPassed':False,'unchangedCompanionSHA256':sha(r/'machine-inputs/gl3aot.wasm'),'artifacts':{str(p.relative_to(r)):{'bytes':p.stat().st_size,'SHA256':sha(p)} for p in [r/'replay.raw.wasm',r/'replay.wasm',machine/'machine.v2.wavm.br',machine/'until-host-io-state.bin',r/'gh0st-wasm-canonicalizer']}}
(out/'machine-build-result.json').write_text(json.dumps(report,indent=2)+'\n')
