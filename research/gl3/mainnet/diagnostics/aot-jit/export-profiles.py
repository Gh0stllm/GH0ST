"""Freeze the independently executed parallel real-engine diagnostic profiles."""
from pathlib import Path
import hashlib,json,shutil,tarfile,time,platform
assert platform.system()=='Linux'
r=Path('/root/gl3-aot-jit');d=r/('profile-export-'+str(time.time_ns()));d.mkdir();sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
shutil.copytree(r/'profiles',d/'profiles');shutil.copytree(r/'profile-specs',d/'profile-specs');shutil.copytree(r/'evidence-metrics-v3',d/'host-metrics-build')
seed=Path('/root/bounded-restore/fast-comparison/B-uncached-seed');q=d/'seed-regression';q.mkdir()
for name in ['seed-tests.log','seed-tests-exit.json']:shutil.copyfile(seed/name,q/name)
shutil.copyfile(seed/'native/precompiles/gl3_seed_access_test.go',q/'gl3_seed_access_test.go')
f=d/'frozen';f.mkdir()
for name in ['aot_bridge.rs','add-memory-metrics.py','profile-replay.py','export-profiles.py']:shutil.copyfile(r/'kit'/name,f/name)
results={}
for name in ['scheduled-baseline-metrics-v3','A-forced-gc64','B-uncached-seed']:
 x=json.loads((r/'profiles'/name/'result.json').read_text());assert x['passed'] and x['exitCode']==0 and x['allFourGlobalFieldsMatch'] and x['artifactsUnchangedAfterReplay'];results[name]=x
assert json.loads((seed/'seed-tests-exit.json').read_text())['exitCode']==0
summary={'diagnosticProfilesPassed':3,'profiles':{n:{k:x[k] for k in ['exitCode','totalSeconds','guestSeconds','GoLinearMemoryPeakBytes','CLinearMemoryPeakBytes','sampledHostRssPeakKiB','guestSHA256','JitSHA256','allFourGlobalFieldsMatch']} for n,x in results.items()},'seedMalformedMissingWitnessRegressionPassed':True,'sameRealCompanionSHA256':results['A-forced-gc64']['companionSHA256'],'sameOriginalInputSHA256':results['A-forced-gc64']['inputSHA256'],'nativeGasUsedBoundByMatchingBlockHash':12306935,'independentJitGasMeter':False,'profilesAandBExecutedInParallel':True,'timingsAreNotProductionLatency':True,'enginePolicyChanged':False,'allExecutionOnRunpod':True,'interpreterOrOSPOrMainnetAcceptance':False,'scope':'Three separately sealed real-engine terminal JIT diagnostics; root chooses any subsequent proof candidate','asOfUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())};(d/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');(d/'manifest.json').write_text(json.dumps({'files':{str(p.relative_to(d)):sha(p) for p in sorted(d.rglob('*')) if p.is_file()},'binariesGuestInputCompanionExcludedHashesRetained':True},indent=2)+'\n')
a=r/'real-engine-profile-comparison.tar.gz'
with tarfile.open(a,'w:gz') as t:
 for p in sorted(d.iterdir()):t.add(p,arcname=p.name)
print(json.dumps({'archive':str(a),'bytes':a.stat().st_size,'sha256':sha(a),'summary':summary},indent=2))
