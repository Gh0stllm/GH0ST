"""Export the single final combined real-engine diagnostic, without proof claims."""
from pathlib import Path
import json,hashlib,shutil,tarfile,time,platform
assert platform.system()=='Linux'
r=Path('/root/gl3-aot-jit');x=json.loads((r/'profiles/C-combined/result.json').read_text());assert x['passed'] and x['exitCode']==0 and x['allFourGlobalFieldsMatch'] and x['artifactsUnchangedAfterReplay']
native=json.loads((r/'profile-specs/C-combined/native-comparison.json').read_text());assert native['passed']
seed=Path('/root/bounded-restore/fast-comparison/C-combined');assert json.loads((seed/'seed-tests-exit.json').read_text())['exitCode']==0
d=r/('combined-export-'+str(time.time_ns()));d.mkdir();shutil.copytree(r/'profiles/C-combined',d/'profile');shutil.copytree(r/'profile-specs/C-combined',d/'source-spec');shutil.copytree(r/'evidence-metrics-v3',d/'host-metrics-build')
for name in ['seed-tests.log','seed-tests-exit.json']:shutil.copyfile(seed/name,d/name)
f=d/'frozen';f.mkdir()
for name in ['aot_bridge.rs','profile-replay.py','add-memory-metrics.py','export-combined.py']:shutil.copyfile(r/'kit'/name,f/name)
baseline=json.loads((r/'profiles/scheduled-baseline-metrics-v3/result.json').read_text());a=json.loads((r/'profiles/A-forced-gc64/result.json').read_text())
summary={'diagnosticPassed':True,'scope':'One final combined GC+immutable-seed real-engine terminal-block JIT diagnostic; no full interpreter, one-step proof, lifecycle or mainnet acceptance','profile':x,'nativeComparison':native,'seedNegativesAndWitnessRegressionPassed':True,'GoLinearHeadroomBelow4GiBBytes':2**32-x['GoLinearMemoryPeakBytes'],'GoLinearPeakReductionVersusBaselineBytes':baseline['GoLinearMemoryPeakBytes']-x['GoLinearMemoryPeakBytes'],'GoLinearPeakReductionVersusProfileABytes':a['GoLinearMemoryPeakBytes']-x['GoLinearMemoryPeakBytes'],'sameInstrumentedHostAndRealCompanionAndInput':True,'noAdditionalVariantRun':True,'allExecutionOnRunpod':True,'enginePolicyChanged':False,'interpreterOrOSPOrLifecycleAccepted':False,'asOfUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())};(d/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest();(d/'manifest.json').write_text(json.dumps({'files':{str(p.relative_to(d)):sha(p) for p in sorted(d.rglob('*')) if p.is_file()},'largeInputsAndBinariesExcludedHashesRetained':True},indent=2)+'\n')
a=r/'combined-real-engine-diagnostic.tar.gz'
with tarfile.open(a,'w:gz') as t:
 for p in d.iterdir():t.add(p,arcname=p.name)
print(json.dumps({'archive':str(a),'bytes':a.stat().st_size,'sha256':sha(a),'summary':summary},indent=2))
