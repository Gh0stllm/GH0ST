from pathlib import Path
import hashlib,json,os,subprocess,time
b=Path('/root/gl3-selected865-boundary');src=b/'native';out=b/'evidence';out.mkdir(exist_ok=False);go=Path('/root/bounded-restore/toolchain/go/bin/go')
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
root='0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086';machine=b/'machines'/root
assert 'pub const MAX_STEPS: u64 = 1 << 43;' in Path('/root/gl3-aot-jit/source/crates/prover/src/machine.rs').read_text()
ids={'machineSHA256':sha(machine/'machine.v2.wavm.br'),'untilHostIOSHA256':sha(machine/'until-host-io-state.bin'),'rootTextSHA256':sha(machine/'module-root.txt'),'libstylusSHA256':sha(src/'target/lib/libstylus.a'),'probeSourceSHA256':sha(src/'cmd/gl3boundary/main.go'),'boldWrapperSourceSHA256':sha(src/'validator/server_arb/bold_machine.go'),'rawMachineLimitSourceSHA256':sha(Path('/root/gl3-aot-jit/source/crates/prover/src/machine.rs')),'selectedGuestSHA256':sha(Path('/root/bounded-restore/fast-comparison/C-combined/replay.wasm')),'companionSHA256':sha(Path('/root/bounded-restore/machine-inputs/gl3aot.wasm'))}
(out/'artifact-identities-before.json').write_text(json.dumps(ids,indent=2)+'\n')
env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'2','RAYON_NUM_THREADS':'2'}
t=time.monotonic()
with (out/'build.log').open('w') as log:p=subprocess.run([go,'build','-p','2','-mod=readonly','-ldflags=-extldflags=-Wl,-z,noexecstack','-o',b/'probe','./cmd/gl3boundary'],cwd=src,env=env,stdout=log,stderr=subprocess.STDOUT)
(out/'build-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t})+'\n')
if p.returncode:raise SystemExit(p.returncode)
ids['probeBinarySHA256']=sha(b/'probe');t=time.monotonic()
with (out/'backend.log').open('w') as log:p=subprocess.run([b/'probe','--manifest','/root/terminal-acceptance/evidence/terminal-input-manifest.json','--input','/root/terminal-acceptance/evidence/terminal-input.json','--machines',b/'machines','--out',out],cwd=src,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=300)
(out/'backend-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t})+'\n')
if p.returncode:raise SystemExit(p.returncode)
env={**env,'GL3_DISPUTE_PACKAGE':'/root/dispute','GL3_CONTRACT_SOURCE':'/root/dispute/repo/research/chess/l3/nitro/.cache/contracts-provenance/git/nitro-contracts-4341b132cfbdcc980ead03765ca5224ff6cb5d97','GL3_CONTRACT_ARTIFACTS':'/root/dispute/repo/research/chess/l3/nitro/.cache/contracts-provenance/compiled-main/build/contracts','GL3_CONTRACT_DEPS':'/root/dispute/deps','GL3_CONTRACT_MANIFEST':'/root/dispute/repo/research/chess/l3/nitro/evidence/contract-source-compilation.json','GL3_SELECTED_PROOFS':str(out/'boundary-selected-proofs.json'),'GL3_TERMINAL_REPORT':str(out/'boundary-solidity-report.json'),'GL3_BACKEND_REPORT':str(out/'boundary-backend.json')}
t=time.monotonic()
with (out/'solidity.log').open('w') as log:p=subprocess.run(['node',b/'run-boundary.mjs'],cwd=b,env=env,stdout=log,stderr=subprocess.STDOUT)
(out/'solidity-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t})+'\n')
ids['machineSHA256After']=sha(machine/'machine.v2.wavm.br');ids['untilHostIOSHA256After']=sha(machine/'until-host-io-state.bin');ids['libstylusSHA256After']=sha(src/'target/lib/libstylus.a');ids['originalInputSHA256After']=sha(Path('/root/terminal-acceptance/evidence/terminal-input.json'));ids['allExecutionOnRunpod']=True
(out/'artifact-identities-after.json').write_text(json.dumps(ids,indent=2)+'\n')
raise SystemExit(p.returncode)
