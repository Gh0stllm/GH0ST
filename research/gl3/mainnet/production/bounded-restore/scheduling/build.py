from pathlib import Path
import shutil,subprocess,os,json,hashlib,time,difflib
r=Path('/root/bounded-restore');n=r/'scheduled-candidate';src=n/'nitro'
shutil.copytree(r/'nitro-guest-guard',src,ignore=shutil.ignore_patterns('target'))
p=src/'precompiles/ArbGhostChessSliceDelta.go';s=p.read_text();s=s.replace('\thead := m.Head\n','\thead := m.Head\n\tvar restoreBytes uint64\n',1);needle='\t\thead = prior\n';assert s.count(needle)==1;s=s.replace(needle,'\t\tsliceRestoreSchedule(&restoreBytes, len(body))\n'+needle);p.write_text(s)
p=src/'precompiles/ArbGhostChessSlices.go';s=p.read_text();start=s.index('func sliceRestoreSeed(');end=s.index('\nfunc sliceCommit(',start);part=s[start:end];part=part.replace('\tcodes := map[addr]common.Hash{}','\tcodes := map[addr]common.Hash{}\n\tvar restoreBytes uint64',1);part=part.replace('\t\tcode := evm.StateDB.GetCode(address)','\t\tcode := evm.StateDB.GetCode(address)\n\t\tsliceRestoreSchedule(&restoreBytes, len(code))',1);part=part.replace('\tr, e := sliced.Shared()','\tsliceRestoreBeforeCompanion()\n\tr, e := sliced.Shared()',1);p.write_text(s[:start]+part+s[end:])
(src/'precompiles/gl3_restore_schedule_wasm.go').write_text("""//go:build wasm

package precompiles

import "runtime"

// A byte budget also bounds scheduling gaps when a sealed delta is large.
// These are runtime safe points only; no engine policy, state or gas changes.
func sliceRestoreSchedule(total *uint64, n int) {
 *total += uint64(n)
 if *total >= 64*1024*1024 { *total = 0; runtime.Gosched() }
}

// A cold authenticated image needs headroom for the next Go/C image copies.
func sliceRestoreBeforeCompanion() { runtime.GC() }
""")
(src/'precompiles/gl3_restore_schedule_native.go').write_text("""//go:build !wasm

package precompiles

func sliceRestoreSchedule(_ *uint64, _ int) {}
func sliceRestoreBeforeCompanion() {}
""")
go=r/'toolchain/go/bin/go';subprocess.run([go.parent/'gofmt','-w',src/'precompiles/ArbGhostChessSliceDelta.go',src/'precompiles/ArbGhostChessSlices.go',src/'precompiles/gl3_restore_schedule_wasm.go',src/'precompiles/gl3_restore_schedule_native.go'],check=True)
env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'8'}
# Runtime is the original AOT module, including the REAL companion import.
subprocess.run([go,'mod','edit','-replace=github.com/Gh0stllm/GH0ST/gl3/slicedchess='+str(r/'aot-runtime')],cwd=src,env=env,check=True)
t=time.monotonic();p=subprocess.run([go,'build','-p','6','-mod=mod','-tags=gl3aotproof','-o',n/'replay.raw.wasm','./cmd/replay'],cwd=src,env={**env,'GOOS':'wasip1','GOARCH':'wasm','CGO_ENABLED':'0'})
(n/'build-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t})+'\n');assert p.returncode==0
subprocess.run([r/'gh0st-wasm-canonicalizer',n/'replay.raw.wasm',n/'replay.wasm'],check=True)
manifest={'guestWasmSHA256':hashlib.file_digest((n/'replay.wasm').open('rb'),'sha256').hexdigest(),'rawGuestWasmSHA256':hashlib.file_digest((n/'replay.raw.wasm').open('rb'),'sha256').hexdigest(),'realCompanionImport':True,'companionSHA256':'b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555','byteBudget':64*1024**2,'yieldAfterBudget':True,'forcedGCAtAuthenticatedCompanionBoundary':True,'enginePolicyChanged':False,'fullWAVMProofPassed':False,'fullAOTJITRunPassed':False}
(n/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
patch=''
for f in ['precompiles/ArbGhostChessSliceDelta.go','precompiles/ArbGhostChessSlices.go']:
 old=(r/'nitro-guest-guard'/f).read_text();new=(src/f).read_text();patch+=''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+f,tofile='b/'+f))
(n/'schedule.patch').write_text(patch)
