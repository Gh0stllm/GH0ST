"""Read-only post-run audit and key-excluding public capsule, on Runpod only."""
from pathlib import Path
import csv,hashlib,json,os,platform,shutil,statistics,tarfile
assert platform.system()=='Linux'
R=Path('/workspace/gl3/testnet/withdrawal-recovery');E=R/'evidence';O=R/'public-export';O.mkdir(exist_ok=True)
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
v=read(E/'base-withdrawal-report.json');actual=read(E/'actual-exit.json');controller=read(E/'controller-result.json')
assert v['passed'] is True and actual['exitCode']==0 and actual['terminationReason'] is None and controller['passed'] is True
assert actual['seconds']<=1200
recovery=v['recovery'];b=recovery['before'];a=recovery['after']
assert recovery['passed'] is True
for key in ['binarySHA256','args','configSHA256','headHash','stateRoot','number','headMessageIndex','nonce','playerBalance','peerBalance','db']:assert b[key]==a[key],key
assert b['pid']!=a['pid'] and b['startTicks']!=a['startTicks']
assert b['binarySHA256']=='d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed'
assert b['args']==['/root/gl3-base-launch/bin/nitro','--conf.file',str(E/'child.private.json')]
kill=read(E/'cli-primary-actual-exit.json');assert kill['pid']==b['pid'] and kill['signal']=='SIGKILL' and kill['code'] is None and kill['noPreKillPauseCopyFlush'] is True
assert set(b['db'])=={'l2chaindata','arbitrumdata','wasm'}
currentDB={}
for name,x in b['db'].items():
 p=Path(x['path']);s=p.stat();assert p.is_relative_to(R) and s.st_dev==Path('/workspace').stat().st_dev
 assert x['ino']<2**53 and x['ino']==s.st_ino and x['dev']==s.st_dev
 currentDB[name]={'path':str(p),'dev':s.st_dev,'ino':s.st_ino,'stillMatchesBothCapturedSnapshots':True}
private=read(E/'child.private.json');assert private['node']['batch-poster']['enable'] is True
assert sha(E/'child.private.json')==v['postRecoveryBatchPosterConfiguration']['newConfigSHA256']
private['node']['batch-poster']['enable']=False
reconstructed=(json.dumps(private,indent=2)+'\n').encode();assert hashlib.sha256(reconstructed).hexdigest()==b['configSHA256']
assert private['persistent']['pebble']['sync-mode'] is True
cache=private['execution']['caching'];assert cache['archive'] is True and cache['state-scheme']=='hash'
assert cache['max-number-of-blocks-to-skip-state-saving']==0 and cache['max-amount-of-gas-to-skip-state-saving']==0
expected={'Unconfirmed root rejects':'UnknownRoot(bytes32)','Non-rollup root registration rejects':'NotRollup(address,address)','Altered withdrawal amount rejects':'UnknownRoot(bytes32)','Repeated withdrawal rejects':'AlreadySpent(uint256)'}
negatives={x['label']:x['reason'] for x in v['steps'] if x.get('passed') is True};assert negatives==expected
for label,h in v['genesisSetup']['exactGenesisInputSHA256'].items():
 assert sha(E/(label+'-genesis.json'))==h
 assert sha(R/'attempts/01-ethers-ipc-close/evidence'/(label+'-genesis.json'))==h
for name,h in read(E/'source-manifest.json').items():assert sha(R/name)==h,name
assert v['ownedProcessesRemaining']==0
pids=[x['pid'] for x in v['ownedProcessExits']]+[read(E/'process.json')['pid']]
cleanup=[]
for pid in pids:
 p=Path('/proc')/str(pid);assert not p.exists(),f'Owned PID still exists: {pid}';cleanup.append({'pid':pid,'exists':False})
assert v['lightTransactions']['passed'] is True and v['lightTransactions']['count']==100
assert v['flow']['exactUserNativeDebitWithGas'] is True and v['flow']['exactReceiverAndBridgeDeltas'] is True
assert v['flow']['deposit']=='4000000000000000000' and v['flow']['spend']=='1000000000000000000' and v['flow']['burnAndWithdrawal']=='500000000000000000'
assert v['flow']['mockConfirmedRoot'] is False
assert v['fastConfirmationPrivileged'] is True and v['permissionlessFinalityTested'] is False
assert v['source']['scope'].startswith('Private synthetic balance-owner remap') and v['publicWrites']==0
light=v['lightTransactions'];times=sorted(x['estimateSendReceiptMilliseconds'] for x in light['receipts'])
resource=list(csv.DictReader((E/'resources.csv').open()))
audit={'passed':True,'scope':'Independent post-run checks of captured data and still-closed persistent DB identities; no new chain execution','sameDBInodesAndDevices':currentDB,'sameCLIArgsConfigHashHeadRootMessageNonceBalances':True,'actualSIGKILLBoundToBeforePID':True,'postRecoveryOnlyBatchPosterFlagDiffVerified':True,'syncArchiveEveryBlockVerified':True,'negativeDecodedReasons':negatives,'samePriorGenesisJSONVerified':True,'runtimeSourceHashesUnchanged':True,'processCleanup':cleanup,'fullRPCTransactionReceiptJSONCaptured':False,'capturedReceiptScope':'Actual hash/block/gas rows plus assertion/outbox event and trace fields; not every complete RPC receipt JSON'}
(E/'post-run-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
summary={'passed':True,'scope':'Official private Geth1337 -> Nitro4663 -> Nitro4663007 on persistent Runpod volume; no chess/model','exitCode':actual['exitCode'],'seconds':actual['seconds'],'officialNodeSHA256':b['binarySHA256'],'moduleRoot':v['child']['configuredMachineRoot'],'genesisDiagnosticSHA256':v['genesisSetup']['genesisGeneratorSHA256'],'strictBothGenesisHashAndStateRootValidated':True,'nativeParentArbSysNotOverridden':True,'depositGH0ST':'4','ordinaryNativeSpendGH0ST':'1','withdrawalGH0ST':'0.5','exactGasAndPayoutAssertionsPassed':True,'recoveryMilliseconds':recovery['recoveryMilliseconds'],'sameThreePersistentDBsAndExactCLIStateVerified':True,'lightTransfers':100,'transactionLatencyMilliseconds':{'median':statistics.median(times),'nearestRankP95':times[94],'max':max(times),'scope':'Sequential local estimate/sign/send/receipt, not public throughput or SLA'},'childDBOpenMeasurements':{'before':light['before'],'after':light['after'],'allocatedDeltaBytes':light['physicalDeltaBytes'],'logicalDeltaBytes':light['logicalDeltaBytes'],'scope':'100 fresh-account transfers; no long-run capacity/pruning extrapolation'},'sampledSharedCgroupPeakBytes':max(int(x['cgroupCurrentBytes']) for x in resource),'minimumWorkingDiskFreeBytes':min(int(x['workingFreeBytes']) for x in resource),'fourStrictNegativeReasonsVerified':True,'parentTrace':v['storageCoverage'],'parentPayoutTransaction':v['flow']['parentReleaseTransaction'],'fastConfirmationPrivileged':True,'canonicalTokenLedgerCloned':False,'explicitSyntheticBalanceOwnerRemap':True,'permissionlessFinalityTested':False,'fullRPCTransactionReceiptJSONCaptured':False,'noPublicWrites':True,'ownedProcessesRemaining':0,'productionAccepted':False,'sourceReportSHA256':sha(E/'base-withdrawal-report.json'),'postRunAuditSHA256':sha(E/'post-run-audit.json')}
(E/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
secrets=[]
for x in read(E/'source-wallets.private.json').values():secrets.extend([x['privateKey'].encode(),x['privateKey'][2:].encode()])
manifest=[]
def copy(p,name):
 data=p.read_bytes();assert all(key not in data for key in secrets),'Generated key detected in '+str(p)
 target=O/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 manifest.append({'path':name,'bytes':len(data),'SHA256':hashlib.sha256(data).hexdigest()})
allowed=['summary.json','post-run-audit.json','actual-exit.json','controller-result.json','source-manifest.json','process.json','runtime-context.json','preflight-identities.json','base-withdrawal-report.json','recovery-before.json','cli-primary-actual-exit.json','recovery-and-storage.json','token-storage-witness.json','source-snapshot.json','root-stack.json','child-stack.json','parent-genesis.json','child-genesis.json','parent-genesis-generator.log','child-genesis-generator.log','parent-public-config.json','child-public-config.json','runner.log','parent.log','child.log','geth.log','resources.csv']
for name in allowed:
 p=E/name
 if p.exists():copy(p,name)
for name in ['runtime-launch-authorization.json','runtime-controller.log','ipc-smoke.log','ipc-smoke-exit.json','ipc-smoke-first-launch-missing-test-source.log']:
 p=R/name
 if p.exists():copy(p,'support/'+name)
for p in (R/'source').rglob('*'):
 if p.is_file() and '__pycache__' not in p.parts:copy(p,'frozen-source/'+str(p.relative_to(R/'source')))
for p in (R/'genesis-build').glob('*.json'):copy(p,'genesis-build/'+p.name)
failed=R/'attempts/01-ethers-ipc-close'
for name in ['actual-exit.json','controller-result.json','source-manifest.json','process.json','failure-classification.json','runner.log','recovery-before.json','cli-primary-actual-exit.json','root-stack.json','child-stack.json','parent-public-config.json','child-public-config.json']:
 p=failed/'evidence'/name
 if p.exists():copy(p,'failed-attempts/01/'+name)
for p in (failed/'frozen-source').rglob('*'):
 if p.is_file() and '__pycache__' not in p.parts:copy(p,'failed-attempts/01/frozen-source/'+str(p.relative_to(failed/'frozen-source')))
(O/'manifest.json').write_text(json.dumps({'files':manifest,'privateConfigsKeysAndDBsExcluded':True,'allExportedFilesScannedAgainstGeneratedPrivateKeys':True},indent=2)+'\n')
archive=R/'base-withdrawal-recovery-evidence.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
 for p in sorted(O.rglob('*')):
  if p.is_file():tar.add(p,arcname=str(p.relative_to(O)))
receipt={'path':str(archive),'bytes':archive.stat().st_size,'SHA256':sha(archive),'files':len(manifest)+1,'allExecutionOnRunpod':True,'keyScanPassed':True}
(R/'export-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'summary':summary,'archive':receipt},indent=2))
