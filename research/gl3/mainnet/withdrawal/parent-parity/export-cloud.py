"""Export a passed actual-Nitro-parent scenario without generated signing keys."""
from pathlib import Path
import gzip,hashlib,json,platform,re,shutil,subprocess,tarfile,time

assert platform.system()=='Linux'
root=Path('/root/withdrawal-parent')
active=json.loads((root/'active-attempt.json').read_text());latest=Path(active['directory'])
report=json.loads((latest/'parent-parity-report.json').read_text())
assert report['passed'] and report['ownedProcessesRemaining']==0
assert report['publicWrites']==0 and report['realChainSpend']==0
assert report['parentNativeArbSysNotOverridden'] and report['parent']['nativeArbSys']['notOverridden']
assert report['parent']['hashAndStateRootMatchComputed'] and report['child']['hashAndStateRootMatchComputed']
assert report['parent']['genesisValidationLogged'] and report['child']['genesisValidationLogged']
assert report['flow']['exactReceiverAndBridgeDeltas'] and report['flow']['mockConfirmedRoot'] is False
assert report['storageCoverage']['unmatchedKeys']==0 and report['storageCoverage']['allInitialValuesMatchFrozenSource']
assert report['chessPolicyChanged'] is False and report['modelOrEngineExecuted'] is False
required=['Unconfirmed root rejects','Non-rollup root registration rejects','Altered withdrawal amount rejects','Repeated withdrawal rejects']
negative={x['label']:x for x in report['steps'] if x.get('passed') is True}
assert all(x in negative and negative[x].get('reason') for x in required)
for path in Path('/proc').glob('[0-9]*/cmdline'):
 try:cmd=path.read_bytes()
 except (FileNotFoundError,ProcessLookupError,PermissionError):continue
 assert not cmd.startswith(str(root/'bin/nitro').encode()+b'\0'),'Owned native process still running'
export=root/('export-'+str(time.time_ns()));export.mkdir()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for name in ['parent-parity-report.json','source-snapshot.json','token-storage-witness.json','root-stack.json','child-stack.json','parent-genesis.json','child-genesis.json']:
 shutil.copyfile(latest/name,export/name)
shutil.copytree(latest/'src',export/'verified-source')
for name in ['official-node-manifest.json','source-info-manifest.json','genesis-build-manifest.json','genesis-diagnostics-manifest.json']:
 shutil.copyfile(root/name,export/name)
shutil.copyfile(root/'genesis-diagnostics.go',export/'genesis-diagnostics.go')
for name in ['runner.log','geth.log','parent.log','child.log','parent-genesis-generator.log','child-genesis-generator.log']:
 p=latest/name
 if p.exists():(export/(name+'.gz')).write_bytes(gzip.compress(p.read_bytes(),mtime=0))
failures=[]
raw=root/('failures-'+str(time.time_ns()));raw.mkdir()
for attempt in sorted(root.glob('attempt-*')):
 if attempt==latest:continue
 p=attempt/'parent-parity-report.json'
 if p.exists():
  r=json.loads(p.read_text())
  assert not r['passed'],'Earlier passing execution needs a deliberate export'
  failures.append({'attempt':attempt.name,'asOfUTC':r['asOfUTC'],'error':r.get('error',{}).get('message'),'lastVerifiedStep':r.get('steps',[{}])[-1].get('label') if r.get('steps') else None,'ownedProcessesRemaining':r['ownedProcessesRemaining']})
 else:failures.append({'attempt':attempt.name,'reportAbsent':True,'reason':'Pre-controller adapter module resolution failure; raw log preserved'})
 dst=raw/attempt.name;dst.mkdir()
 for name in ['parent-parity-report.json','runner.log','geth.log','parent.log','child.log','source-snapshot.json','parent-genesis-generator.log','child-genesis-generator.log']:
  p=attempt/name
  if p.exists():shutil.copyfile(p,dst/name)
 if (attempt/'src').exists():shutil.copytree(attempt/'src',dst/'src')
(export/'failed-attempts.json').write_text(json.dumps(failures,indent=2)+'\n')
with tarfile.open(export/'failed-attempt-raw-records.tar.gz','w:gz') as tar:
 for p in sorted(raw.iterdir()):tar.add(p,arcname=p.name)
keys=[]
def collect(obj):
 if isinstance(obj,dict):
  for k,v in obj.items():
   if k in ['private-key','privateKey'] and isinstance(v,str):keys.append(v.lower().removeprefix('0x'))
   else:collect(v)
 elif isinstance(obj,list):
  for v in obj:collect(v)
for p in root.glob('attempt-*/*.private.json'):collect(json.loads(p.read_text()))
assert keys,'No generated signing keys found to validate the exclusion scan'
def check(data,name):
 for k in keys:
  assert re.fullmatch('[0-9a-f]{64}',k)
  assert k.encode() not in data.lower(),'Generated test signing key leaked into '+name
for p in export.rglob('*'):
 if not p.is_file():continue
 if p.name.endswith('.tar.gz'):
  with tarfile.open(p) as tar:
   for m in tar.getmembers():
    if m.isfile():check(tar.extractfile(m).read(),p.name+'/'+m.name)
 elif p.suffix=='.gz':check(gzip.decompress(p.read_bytes()),str(p))
 else:check(p.read_bytes(),str(p))
summary={'passed':True,'scope':report['scope'],'topology':'Native Geth 1337 -> official native Nitro parent 4663 -> official native Nitro child 4663007','actualNativeParentArbSysSemanticsTested':True,'completeCanonicalTokenStateCloned':False,'canonicalMerkleProofVerificationPerformed':False,'publicDeployment':False,'publicWrites':0,'realChainSpend':0,'fastConfirmationPrivileged':True,'executionHistoryCommitmentVerified':False,'permissionlessFinalityTested':False,'allExecutionOnRunpod':True,'chessPolicyChanged':False,'modelOrEngineExecuted':False,'storageCoverage':report['storageCoverage'],'nativeParentAndChildGenesisHashAndStateRootValidated':True,'exactParentRecipientAndBridgeTokenDeltas':True,'negativeTests':{k:negative[k]['reason'] for k in required},'failedAttemptsPreserved':len(failures),'ownedNativeProcessesRemaining':0,'nativeBinarySHA256':report['genesisSetup']['officialNativeBinarySHA256'],'nodeVersion':subprocess.check_output(['node','--version'],text=True).strip(),'packageLockSHA256':sha(root/'bridge/package-lock.json'),'reportSHA256':sha(latest/'parent-parity-report.json'),'sourceFilesSHA256':{str(p.relative_to(export/'verified-source')):sha(p) for p in sorted((export/'verified-source').rglob('*')) if p.is_file()}}
(export/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
manifest={'files':{str(p.relative_to(export)):sha(p) for p in sorted(export.rglob('*')) if p.is_file()},'allKnownPersistedGeneratedSigningKeysAbsent':True,'privateConfigsExcluded':True,'publicRPCReadOnly':True}
(export/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
archive=root/'parent-parity-verified-evidence.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
 for p in sorted(export.iterdir()):tar.add(p,arcname=p.name)
print(json.dumps({'exportDirectory':str(export),'archive':str(archive),'bytes':archive.stat().st_size,'sha256':sha(archive),'summary':summary},indent=2))
