"""Read-only postbuild identities and combined lock on Runpod; no activation."""
from pathlib import Path
import hashlib,json,os,datetime,shutil
os.sched_setaffinity(0,sorted(os.sched_getaffinity(0))[-2:])
b=Path('/root/gl3-final-pairing');out=b/'ordinary06';profile=b/'source06'
def sha(q):
 h=hashlib.sha256()
 with q.open('rb') as f:
  for x in iter(lambda:f.read(1048576),b''):h.update(x)
 return h.hexdigest()
old=json.loads((b/'ordinary05/artifact-lock.json').read_text());native=json.loads((b/'ordinary05/native-inputs.json').read_text());bindings={}
for label,row in old['modelAndMachine'].items():
 q=Path(row['path']);actual={'path':str(q),'bytes':q.stat().st_size,'SHA256':sha(q)}
 assert actual['bytes']==row['bytes'] and actual['SHA256']==row['SHA256'],label
 bindings[label]=actual
for name,row in native['files'].items():
 q=Path(name);assert q.stat().st_size==row['bytes'] and sha(q)==row['SHA256'],name
native['scope']='Fresh post-source06-build native link/header/tool identities verified against accepted source05; no rebuild/activation'
(out/'native-inputs.json').write_text(json.dumps(native,indent=2)+'\n')
artifacts={};single={}
for name in ['nitro','nitro-val']:
 d=json.loads((out/'evidence'/(name+'-artifact-lock.json')).read_text());q=Path(d['artifact']['path']);assert q.stat().st_size==d['artifact']['bytes'] and sha(q)==d['artifact']['SHA256']
 assert all(x['actualExitCode']==0 and x['stoppedReason'] is None for x in d['results'])
 artifacts[name]=d['artifact'];single[name]={'lockPath':str(out/'evidence'/(name+'-artifact-lock.json')),'lockSHA256':sha(out/'evidence'/(name+'-artifact-lock.json')),'build':d['results'][0]}
frozen=json.loads((profile/'manifest.json').read_text())
lock={'status':'ORDINARY_SOURCE06_NODE_AND_VALIDATOR_BUILDS_AND_SMOKES_PASSED_NO_ACTIVATION','UTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'artifacts':artifacts,'individualBuildLocks':single,'source06ManifestSHA256':sha(profile/'manifest.json'),'ordinaryCompiledSourceRecords':6204,'ordinarySourceClosureSHA256':sha(profile/'evidence/ordinary06-source-files.json'),'sourcePairingSHA256':sha(profile/'evidence/ordinary06-source-pairing.json'),'approvedSourceDeltaFrom05':'exactly7hostfiles;5changed+2new','moduleRoot':old['moduleRoot'],'modelAndMachineRehashedAfterBuild':bindings,'nativeInputsSHA256':sha(out/'native-inputs.json'),'testedFocus':{'normal':{'topLevelPasses':23,'subtestPasses':50},'race':{'topLevelPasses':23,'subtestPasses':50},'initialCombinedMainRaceActualExit':-15,'sequentialRaceRetryPassed':True},'ordinaryDefaultOffActualDumps':True,'ordinaryDefaultRequestCapBytes':3221225472,'explicitRootWARNInterpreterProfileTypedDumpPassed':True,'parserDumpIsNotValidationOrStartup':True,'ordinaryVersionStampProductionAccepted':False,'ordinaryFullSizeTransportOrPairedStartupAccepted':False,'productionGenesisAccepted':False,'operatorCustodyPricerStakeLicenseSelected':False,'twentyGameStorageAccepted':False,'enginePolicyChanged':False,'engineOrProverOrChainStarted':False,'financialOrWalletOrMainnetOperation':False,'allExecutionOnRunpod':True,'source05RawPhysicalRelocationReceiptSHA256':sha(profile/'evidence/source05-raw-relocation-cleanup.json'),'selectedImmutableMachineBackupAlreadyVerified':{'archiveSHA256':'67916f26c6e9e0fb9bef689c750d1ca6d25d9c93a9c733e9cf3d6aebf0dc363c','bytes':713234002,'cloudAndOwnerOffPodCopyRetained':True},'source06ArtifactBackupState':'PROPOSED_NOT_YET_CREATED','diskFreeBytesAtLock':shutil.disk_usage(out).free}
(out/'artifact-lock.json').write_text(json.dumps(lock,indent=2)+'\n');print('COMBINED_LOCK_SHA256',sha(out/'artifact-lock.json'));print('ARTIFACTS',artifacts)
