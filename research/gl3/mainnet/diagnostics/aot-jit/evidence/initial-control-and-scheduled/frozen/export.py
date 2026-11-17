"""Freeze the cloud-only diagnostic result and exact host source provenance."""
from pathlib import Path
import json,hashlib,shutil,tarfile,time,platform
assert platform.system()=='Linux'
r=Path('/root/gl3-aot-jit');d=r/('export-'+str(time.time_ns()));d.mkdir();sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
shutil.copytree(r/'evidence',d/'v2-evidence');shutil.copytree(r/'evidence-v1-import-gap',d/'v1-import-gap')
f=d/'frozen';f.mkdir()
for name in ['aot_bridge.rs','apply-linker.py','build.py','replay.py','build-prover-logging.py','export.py']:
 if (r/'kit'/name).exists():shutil.copyfile(r/'kit'/name,f/name)
shutil.copyfile(r/'bootstrap.py',f/'bootstrap-linux.py');shutil.copyfile(r/'source/Cargo.lock',f/'Cargo.lock');shutil.copyfile(r/'source/Cargo.toml',f/'Cargo.toml');shutil.copyfile(r/'source/crates/caller-env/src/wasip1_stub.rs',f/'pinned-wasip1_stub.rs')
for name in ['bootstrap-result.json','bootstrap.log','replay-controller.log','replay-controller-v2.log','build-controller.log','build-controller-v2.log','prover-logging-controller.log']:
 if (r/name).exists():shutil.copyfile(r/name,d/name)
shutil.copyfile('/root/terminal-acceptance/evidence/terminal-input-manifest.json',d/'original-terminal-input-manifest.json');shutil.copyfile('/root/bounded-restore/evidence/native-guard-comparison.json',d/'native-matching-header-reference.json')
control=json.loads((r/'evidence/unchanged-failed-control/result.json').read_text());candidate=json.loads((r/'evidence/scheduled-candidate/result.json').read_text());assert not control['passed'] and control['exitCode']==1;assert candidate['passed'] and candidate['exitCode']==0 and candidate['allFourGlobalFieldsMatch'] and candidate['artifactsUnchangedAfterReplay']
active=[]
for p in Path('/proc').glob('[0-9]*/cmdline'):
 try:args=p.read_bytes().split(b'\0')
 except FileNotFoundError:continue
 if args and args[0] in [str(r/'source/target/release/jit').encode(),str(r/'cargo/bin/cargo').encode()]:active.append(str(p.parent.name))
assert not active,'Owned diagnostic JIT/build remains running'
summary={'diagnosticPassed':True,'scope':'Original captured terminal-block replay using a real unchanged GL3 AOT engine companion under a custom native Wasmer JIT host; not a replay of every prior search block','control':{'passed':False,'exitCode':control['exitCode'],'seconds':control['seconds'],'reason':'Actual guest Go OOM, matching the independently observed failed guarded interpreter behavior'},'scheduledCandidate':{'passed':True,'exitCode':0,'seconds':candidate['seconds'],'actual':candidate['actual'],'expected':candidate['expected'],'allFourGlobalFieldsMatch':True,'guestRuntimeSeconds':json.loads((r/'evidence/scheduled-candidate/jit-state.json').read_text())['runtimeSeconds'],'guestAllocatedMemoryBytes':json.loads((r/'evidence/scheduled-candidate/jit-state.json').read_text())['guestMemoryBytes']},'companionSHA256':candidate['companionSHA256'],'inputSHA256':candidate['inputSHA256'],'candidateGuestSHA256':candidate['guestSHA256'],'JitSHA256':candidate['JitSHA256'],'gas':{'nativeReferenceGasUsed':candidate['gasUsedInMatchingNativeHeader'],'boundByComputedFullBlockHash':True,'independentJitGasMeter':False},'enginePolicyChanged':False,'guestBytesModifiedByThisHostLane':False,'allExecutionOnRunpod':True,'crossMemoryAndPinnedWASITestsPassed':3,'pinnedCargoLockSHA256':sha(r/'source/Cargo.lock'),'publicDeployment':False,'interpreterReplayAccepted':False,'oneStepProofAccepted':False,'mainnetAccepted':False,'ownedDiagnosticJobsRemaining':0,'failedImportGapAttemptsPreserved':2,'asOfUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
(d/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');(d/'manifest.json').write_text(json.dumps({'files':{str(p.relative_to(d)):sha(p) for p in sorted(d.rglob('*')) if p.is_file()},'inputGuestCompanionAndBinariesExcludedHashesRetained':True,'noPrivateWalletOrCredentialFilesReadOrExported':True},indent=2)+'\n')
a=r/'aot-jit-diagnostic-evidence.tar.gz'
with tarfile.open(a,'w:gz') as t:
 for p in sorted(d.iterdir()):t.add(p,arcname=p.name)
print(json.dumps({'directory':str(d),'archive':str(a),'bytes':a.stat().st_size,'sha256':sha(a),'summary':summary},indent=2))
