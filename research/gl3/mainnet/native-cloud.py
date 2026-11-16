"""Linux-only native acceptance build. Run on the disposable Runpod node lane.

Inputs are the copied, already patched source tree and pinned portable module.
This script never reads a wallet or connects to a public chain.
"""
from pathlib import Path
import concurrent.futures,hashlib,json,os,platform,re,shutil,subprocess,tarfile,time,urllib.request

assert platform.system()=='Linux' and platform.machine()=='x86_64'
ROOT=Path('/root/gl3-node');CACHE=ROOT/'downloads';CACHE.mkdir(exist_ok=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(args,**kw):
 print('RUN '+json.dumps([str(a) for a in args]),flush=True)
 subprocess.run([str(a) for a in args],check=True,**kw)
def fetch(url,name,digest):
 p=CACHE/name
 if not p.exists():urllib.request.urlretrieve(url,p)
 assert sha(p)==digest,'archive mismatch '+name
 return p
def unpack(p,dest):
 dest.mkdir(parents=True,exist_ok=True)
 with tarfile.open(p) as t:t.extractall(dest,filter='data')

versions=json.load(urllib.request.urlopen('https://go.dev/dl/?mode=json&include=all'))
release=next(x for x in versions if x['version']=='go1.25.12')
go_file=next(x for x in release['files'] if x['os']=='linux' and x['arch']=='amd64' and x['kind']=='archive')
go_archive=fetch('https://go.dev/dl/'+go_file['filename'],go_file['filename'],go_file['sha256'])
if not (ROOT/'toolchain/go/bin/go').exists():unpack(go_archive,ROOT/'toolchain')
go=ROOT/'toolchain/go/bin/go'
geth_commit='30456d24d3cff444d3b0f246e9c7609477c7d4a1'
geth_archive=fetch('https://codeload.github.com/OffchainLabs/go-ethereum/tar.gz/'+geth_commit,'geth.tar.gz','264b7c342e58910564f7f70d2975ff455a8293219f1886a32cfd7f4a6799c726')
if not (ROOT/'nitro/go-ethereum/go.mod').exists():
 unpack(geth_archive,CACHE/'geth');shutil.move(CACHE/'geth'/('go-ethereum-'+geth_commit),ROOT/'nitro/go-ethereum')
assert sha(ROOT/'chess/sliced/runtime/.cache/sliced.wasm')=='1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc'

lock=json.loads((ROOT/'engine-lock.json').read_text());network=lock['network']
# The pinned portable program already contains the entire original NNUE file.
# Extract those exact bytes; the upstream model CDN can reject datacenter IPs.
model=CACHE/network['name']
if not model.exists():
 embedded=(ROOT/'chess/sliced/runtime/.cache/sliced.wasm').read_bytes()
 header=bytes.fromhex('fa8a446a05225ba8540000004e6574776f726b20747261696e65642077697468')
 at=embedded.find(header);assert at>=0,'embedded original network not found'
 raw=embedded[at:at+network['bytes']]
 assert hashlib.sha256(raw).hexdigest()==network['sha256'],'extracted model differs'
 model.write_bytes(raw)
assert sha(model)==network['sha256']
src=ROOT/'chess/engine/.cache/src';cache=src.parent;out=cache/'linux-native';out.mkdir(exist_ok=True)
compiler=shutil.which('clang++');assert compiler
common=['-std=c++20','-O3','-fno-exceptions','-fno-rtti','-DGH0ST_ICP','-DIS_64BIT','-DUSE_POPCNT','-DNO_TABLEBASES','-DARCH=gl3-scalar','-fconstexpr-steps=500000000','-I'+str(src),'-I'+str(cache),'-fPIC','-DUSE_SSE2','-DUSE_SSSE3','-DUSE_SSE41','-msse4.1','-mssse3','-mpopcnt']
sources=[p for p in src.rglob('*.cpp') if p.name!='main.cpp' and (p.parent==src or p.parent.name in ['nnue','features','syzygy'])]+[cache/'engine.cpp']
def compile_one(p):
 obj=(out/(p.relative_to(src) if p.is_relative_to(src) else Path('gl3.cpp'))).with_suffix('.o');obj.parent.mkdir(parents=True,exist_ok=True)
 run([compiler,*common,'-c',p,'-o',obj]);return obj
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:objects=list(pool.map(compile_one,sources))
asm=out/'weights.s';asm.write_text('.section .rodata.gEmbeddedNNUEData,"a",@progbits\n.globl gEmbeddedNNUEData\n.type gEmbeddedNNUEData,@object\n.p2align 6\ngEmbeddedNNUEData:\n.incbin "'+str(model)+'"\n.size gEmbeddedNNUEData, .-gEmbeddedNNUEData\n')
run([compiler,'-c',asm,'-o',out/'weights.o'])
run(['ar','rcs',cache/'libgl3chess.a',*objects,out/'weights.o'])

env={**os.environ,'GOTOOLCHAIN':'local','PATH':str(go.parent)+':/root/.cargo/bin:'+os.environ['PATH'],'GOMAXPROCS':'12','MALLOC_ARENA_MAX':'2'}
nitro=ROOT/'nitro'
for name,target in [('chessruntime','chess/runtime'),('slicedchess','chess/sliced/runtime')]:
 run([go,'mod','edit','-replace=github.com/Gh0stllm/GH0ST/gl3/'+name+'='+str(ROOT/target)],cwd=nitro,env=env)
deadline=time.monotonic()+1500
while not (nitro/'target/lib/libstylus.a').exists():
 assert time.monotonic()<deadline,'native Rust library was not produced'
 time.sleep(1)
bin_dir=ROOT/'bin';bin_dir.mkdir(exist_ok=True)
run([go,'build','-p','8','-mod=mod','-o',bin_dir/'nitro','./cmd/nitro'],cwd=nitro,env=env)
run([go,'test','-c','-p','8','-mod=mod','-o',bin_dir/'precompiles.test','./precompiles'],cwd=nitro,env=env)
run([go,'test','-c','-p','8','-mod=mod','-o',bin_dir/'system_tests.test','./system_tests'],cwd=nitro,env=env)
report={'platform':platform.platform(),'GoVersion':subprocess.check_output([go,'version'],text=True).strip(),'goArchiveSHA256':go_file['sha256'],'gethCommit':geth_commit,'portableModuleSHA256':sha(ROOT/'chess/sliced/runtime/.cache/sliced.wasm'),'unchangedNNUE_SHA256':network['sha256'],'nativeSSE41':True,'binarySHA256':{p.name:sha(p) for p in bin_dir.iterdir() if p.is_file()},'publicDeployment':False,'realChainSpend':0}
(ROOT/'build-result.json').write_text(json.dumps(report,indent=2)+'\n')
results=ROOT/'results';results.mkdir(exist_ok=True)
env.update({'GL3_SLICES_FULL':'1','GL3_SLICES_EVIDENCE':str(results/'full-evm.json'),'GL3_CACHE_METERING_EVIDENCE':str(results/'cache-metering.json')})
with (results/'full-evm.log').open('w') as log:
 p=subprocess.Popen([str(bin_dir/'precompiles.test'),'-test.run','^TestGL3ChessSlices(ABIMetadata|Dispatch)$','-test.v','-test.timeout','30m'],cwd=nitro,env=env,stdout=log,stderr=subprocess.STDOUT)
(results/'process.json').write_text(json.dumps({'fullEVM_PID':p.pid,'allTestsOnRunpod':True})+'\n')
code=p.wait();(results/'full-evm-exit.json').write_text(json.dumps({'exitCode':code})+'\n');assert code==0,'full EVM test failed'
print('NATIVE_ACCEPTANCE_FINISHED',flush=True)
