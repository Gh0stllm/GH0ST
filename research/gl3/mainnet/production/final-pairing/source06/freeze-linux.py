from pathlib import Path
import hashlib,json,datetime,difflib,shutil,os,tarfile,re
base=Path('/root/gl3-final-pairing/source05');out=base.parent/'source06';frozen=out/'frozen';frozen.mkdir(exist_ok=True)
os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[-2:])
def sha(q):
 h=hashlib.sha256()
 with q.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
overlay=json.loads((out/'overlay.json').read_text())['Replace'];files={};parents={};diff=[]
for virtual,physical in sorted(overlay.items()):
 rel=str(Path(virtual).relative_to(base));src=Path(physical);dest=frozen/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dest)
 files[rel]={'SHA256':sha(dest),'bytes':dest.stat().st_size}
 orig=Path(virtual);parents[rel]={'SHA256':sha(orig),'bytes':orig.stat().st_size} if orig.exists() else None
 diff.extend(difflib.unified_diff(orig.read_text().splitlines(True) if orig.exists() else [],src.read_text().splitlines(True),fromfile='a/'+rel,tofile='b/'+rel))
assert len(files)==7
(out/'source06.patch').write_text(''.join(diff))
tests={}
for q in sorted((out/'tests').glob('*.go')):
 dest=frozen/'tests'/q.name;dest.parent.mkdir(exist_ok=True);shutil.copyfile(q,dest);tests[q.name]={'SHA256':sha(dest),'bytes':dest.stat().st_size}
baseRecords=json.loads((out/'source05-compiled-go-source-files.json').read_text());bad=[]
for key,row in baseRecords.items():
 p=Path(row['path'])
 if not p.is_file() or p.stat().st_size!=row['bytes'] or sha(p)!=row['SHA256']:bad.append(key)
if bad:raise RuntimeError('base source changed: '+str(bad[:8]))
lock=json.loads((base.parent/'ordinary05/artifact-lock.json').read_text());modelChecks={}
for label,row in lock['modelAndMachine'].items():
 q=Path(row['path']);actual={'path':str(q),'bytes':q.stat().st_size,'SHA256':sha(q)}
 if actual['SHA256']!=row['SHA256'] or actual['bytes']!=row['bytes']:raise RuntimeError('model input changed: '+label)
 modelChecks[label]=actual
results={}
for name in ['normal','race','main-normal','main-race','retry-nitro','retry-nitro-val']:
 row=json.loads((out/'evidence'/(name+'-exit.json')).read_text());log=(out/'evidence'/(name+'.stdout')).read_text()
 row['topLevelPasses']=len(re.findall(r'^--- PASS:',log,re.M));row['subtestPasses']=len(re.findall(r'^\s+--- PASS:',log,re.M));row['stdoutSHA256']=sha(out/'evidence'/(name+'.stdout'));row['stderrSHA256']=sha(out/'evidence'/(name+'.stderr'));results[name]=row
assert all(results[x]['actualExitCode']==0 for x in ['normal','race','main-normal','retry-nitro','retry-nitro-val'])
manifest={'status':'FOCUSED_NORMAL_AND_RACE_PASSED_NO_ORDINARY06_BINARY_OR_ACTIVATION','UTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceBase':str(base),'hostSourceFiles':files,'baseSourceFiles':parents,'testSourceFiles':tests,'source05All6202CompiledRecordsUnchanged':not bad,'source05CompiledRecords':len(baseRecords),'source05CompiledManifestSHA256':sha(out/'source05-compiled-go-source-files.json'),'patchSHA256':sha(out/'source06.patch'),'modelAndMachineRehashedUnchanged':modelChecks,'moduleRoot':lock['moduleRoot'],'results':results,'initialMainRaceResourceStopPreserved':True,'ordinary06BinaryBuilt':False,'mainnetWrites':False,'financialOrWalletOperations':False,'engineOrProverExecuted':False,'actualSmallLoopbackNodesWithoutBlockchain':True,'allBuildsAndTestsOnRunpod':True,'releaseImpact':{'standaloneUnlimitedToFinite3GiBEvenCacheDisabled':True,'embeddedSharedStackAffectsCohostedHTTPAndWS':True,'nonValidationOrdinaryNodeUnchanged':True,'uploadGateDefaultOff':True,'knownLazyClientLoggingSkippedOnlyAtStableWARN':True,'globalErrorDataFormattingBound':False}}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
archive=base.parent/'source06-public-evidence.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
 for name in ['frozen','evidence','manifest.json','source06.patch','overlay.json','test-overlay.json','test-overlay-main.json','test-linux.py','test-main-linux.py','test-main-race-retry-linux.py']:
  tar.add(out/name,arcname=name)
receipt={'path':str(archive),'bytes':archive.stat().st_size,'SHA256':sha(archive),'manifestSHA256':sha(out/'manifest.json')};(out/'archive-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt));print('counts',{k:(v['topLevelPasses'],v['subtestPasses'],v['actualExitCode']) for k,v in results.items()})
