from pathlib import Path
import hashlib,json,os,subprocess,time
r=Path('/root/bounded-restore');d=r/'fast-comparison/C-combined';tool=Path('/root/gl3-aot-jit/bin/prover-exact-final-steps')
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
assert sha(tool)=='cc5c9de07b2a739978e383cd4ac4baee3a1d49761c5c75ad414e12056cd7ab27'
assert sha(d/'replay.wasm')=='8d18145460e5f4c649895728fa089a52a04ead2c3fa5e7d10789d72d7de42fbd'
base=json.loads((r/'original-build.json').read_text());libs=['forward','soft-float','wasi_stub','host_io','user_host','arbcompress','arbcrypto','program_exec']
for name in libs:assert sha(r/'machine-inputs'/(name+'.wasm'))==base['standardLibraries'][name]['SHA256']
assert sha(r/'machine-inputs/gl3aot.wasm')=='b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555'
m=d/'machine';m.mkdir(exist_ok=True);args=[str(tool),str(d/'replay.wasm'),'--generate-binaries',str(m)]
for name in libs+['gl3aot']:args+=['-l',str(r/'machine-inputs'/(name+'.wasm'))]
t=time.monotonic();p=subprocess.run(args,env={**os.environ,'RAYON_NUM_THREADS':'8','MALLOC_ARENA_MAX':'2'});(d/'machine-generation-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t})+'\n');assert p.returncode==0
report={'moduleRoot':(m/'module-root.txt').read_text().strip(),'machineSHA256':sha(m/'machine.v2.wavm.br'),'guestWasmSHA256':sha(d/'replay.wasm'),'proverSHA256':sha(tool),'companionSHA256':sha(r/'machine-inputs/gl3aot.wasm'),'librarySHA256':{name:sha(r/'machine-inputs'/(name+'.wasm')) for name in libs},'enginePolicyChanged':False,'allExecutionOnRunpod':True,'nativeComparisonPassed':json.loads((d/'native-comparison.json').read_text())['passed'],'seedNegativeWitnessTestsExit':json.loads((d/'seed-tests-exit.json').read_text())['exitCode'],'fullWAVMReplayPassed':False};(d/'machine-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
