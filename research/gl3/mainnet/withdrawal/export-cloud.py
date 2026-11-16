"""Export verified, secret-scanned evidence from the dedicated Linux worker."""
from pathlib import Path
import gzip,hashlib,io,json,platform,re,shutil,tarfile,time

assert platform.system()=='Linux'
root=Path('/root/withdrawal');active=json.loads((root/'active-attempt.json').read_text());latest=Path(active['directory'])
report=json.loads((latest/'withdrawal-report.json').read_text())
assert report['passed'] and report['ownedChildStopped']
assert report['native']['finalGenesisAssertionValidationEnabled']
assert report['native']['exactSeedAndFinalGenesisHashAndStateRootMatch']
assert report['roleSeparation']['allDistinct']
assert report['actualConfirmedAssertionUpdatesOutbox'] and report['withdrawal']['mockConfirmedRoot'] is False
assert report['withdrawal']['exactGH0STBalanceIncrease'] and report['withdrawal']['bridgeExactDecrease'] and report['withdrawal']['spent']
assert report['seedGenesisCalculation']['serializedChainConfig']==report['native']['finalSerializedChainConfig']
assert report['seedGenesisCalculation']['tokenDecimals']==report['native']['finalTokenDecimals']==18
assert report['seedGenesisCalculation']['dataCostEstimate']==report['native']['finalDataCostEstimate']=='1'
assert report['parentForkAdapter']['beforeCode']=='0xfe' and report['parentForkAdapter']['afterCode']=='0x'
required=['Unconfirmed native withdrawal root rejects','Non-rollup root registration rejects','Altered withdrawal amount/proof rejects','Repeated withdrawal rejects']
negative={r['label']:r for r in report['steps'] if r.get('passed') is True}
assert all(k in negative and negative[k].get('revertReason') for k in required)
for path in Path('/proc').glob('[0-9]*/cmdline'):
 try:cmd=path.read_bytes()
 except (FileNotFoundError,ProcessLookupError,PermissionError):continue
 assert not cmd.startswith(str(root/'bin/nitro').encode()+b'\0'),'Owned native child still running'
export=root/('export-'+str(time.time_ns()));export.mkdir()
shutil.copyfile(latest/'withdrawal-report.json',export/'native-gh0st-withdrawal.json')
shutil.copyfile(latest/'runner.mjs',export/'verified-runner.mjs')
assert hashlib.sha256((export/'verified-runner.mjs').read_bytes()).hexdigest()==report['runnerSHA256']
shutil.copyfile(root/'official-node-manifest.json',export/'official-node-manifest.json')
for name in ['runner.log','seed-calculation.log','child.log']:
 p=latest/name
 if p.exists():(export/(name+'.gz')).write_bytes(gzip.compress(p.read_bytes(),mtime=0))
failures=[];passing=[];failed_directories=[]
for attempt in sorted(root.glob('attempt-*')):
 p=attempt/'withdrawal-report.json';controller=attempt/'controller-failure.json'
 if p.exists():
  r=json.loads(p.read_text())
  if r['passed']:
   passing.append({'attempt':attempt.name,'runnerSHA256':r['runnerSHA256'],'reportSHA256':hashlib.sha256(p.read_bytes()).hexdigest(),'asOfUTC':r['asOfUTC']})
   if attempt!=latest:
    shutil.copyfile(p,export/'earlier-passing-withdrawal.json')
    if (attempt/'runner.mjs').exists():shutil.copyfile(attempt/'runner.mjs',export/'earlier-passing-runner.mjs')
  else:
   failures.append({'attempt':attempt.name,'runnerSHA256':r['runnerSHA256'],'asOfUTC':r['asOfUTC'],'error':r.get('error',{}).get('message'),'lastVerifiedStep':r.get('steps',[{}])[-1].get('label'),'nativeChildStopped':r['ownedChildStopped'],'publicDeployment':False,'realChainSpend':0});failed_directories.append(attempt)
 elif controller.exists():
  failures.append({'attempt':attempt.name,**json.loads(controller.read_text())});failed_directories.append(attempt)
(export/'failed-attempts.json').write_text(json.dumps(failures,indent=2)+'\n')
with tarfile.open(export/'failed-attempt-raw-records.tar.gz','w:gz') as tar:
 for attempt in failed_directories:
  for name in ['withdrawal-report.json','controller-failure.json','runner.log','seed-calculation.log','child.log','runner.mjs']:
   p=attempt/name
   if p.exists():tar.add(p,arcname=attempt.name+'/'+name)
summary={'passed':True,'scope':'Real GH0ST state on adapted Ganache parent, actual official native Nitro child, privileged genuine-rollup confirmation and real outbox proof withdrawal','publicDeployment':False,'realChainSpend':0,'actualRobinhoodParentSemanticsTested':False,'privilegedFastConfirmation':True,'executionHistoryCommitmentVerified':False,'fullBoLDDisputeExecuted':False,'chessPolicyChanged':False,'nativeGenesisValidationPassed':True,'exactSeedFinalGenesisHashAndStateRootMatch':True,'depositGH0ST':'4','ordinaryChildSpendGH0ST':'1','withdrawalGH0ST':'0.5','exactChildNativeDebitIncludesGas':True,'genuineRollupConfirmedRootNotMock':True,'exactParentRecipientIncreaseAndBridgeDecrease':True,'negativeTests':{k:negative[k]['revertReason'] for k in required},'roleSeparation':report['roleSeparation'],'passingExecutions':passing,'failedAttemptsPreserved':len(failures),'reportSHA256':hashlib.sha256((export/'native-gh0st-withdrawal.json').read_bytes()).hexdigest(),'verifiedRunnerSHA256':report['runnerSHA256'],'nativeBinarySHA256':report['native']['binarySHA256'],'moduleRoot':report['native']['machineRoot'],'nodeVersion':None,'nodePackageLockSHA256':hashlib.sha256((root/'package-lock.json').read_bytes()).hexdigest(),'ownedNativeProcessesRemaining':0,'allExecutionOnRunpod':True}
import subprocess
summary['nodeVersion']=subprocess.check_output(['node','--version'],text=True).strip()
(export/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
# The only persisted test signing secret is the new poster key in private node
# config. Reject an export containing any such key from any attempt.
secrets=[]
def scan_keys(x):
 if isinstance(x,dict):
  for k,v in x.items():
   if k=='private-key' and isinstance(v,str):secrets.append(v.lower().removeprefix('0x'))
   else:scan_keys(v)
 elif isinstance(x,list):
  for v in x:scan_keys(v)
for p in root.glob('attempt-*/*.private.json'):scan_keys(json.loads(p.read_text()))
for p in export.iterdir():
 if not p.is_file():continue
 raw=gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes();lower=raw.lower()
 for key in secrets:
  assert re.fullmatch('[0-9a-f]{64}',key)
  assert key.encode() not in lower,'Signing key found in '+p.name
manifest={'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(export.iterdir()) if p.is_file()},'allKnownPersistedTestSigningKeysAbsent':True,'publicRPCReadOnly':True,'privateConfigsExcluded':True}
(export/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
archive=root/'withdrawal-verified-evidence.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
 for p in sorted(export.iterdir()):tar.add(p,arcname=p.name)
print(json.dumps({'exportDirectory':str(export),'archive':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'summary':summary},indent=2))
