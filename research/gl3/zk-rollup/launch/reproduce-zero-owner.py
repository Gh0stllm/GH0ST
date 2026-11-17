"""Runpod-only unsigned genesis reproducibility experiment; no node or transactions."""
from pathlib import Path
import hashlib, json, os, platform, re, subprocess, time
assert platform.system() == 'Linux'
R = Path(os.environ.get('GL3_ZERO_OWNER_OUTPUT','/workspace/gl3/zk-rollup/zero-owner-genesis'))
assert not R.exists(), 'Preserve existing evidence; use a separately reviewed new attempt'
R.mkdir()
os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[-2:])
os.nice(10)
helper = Path('/workspace/gl3/testnet/withdrawal-recovery/bin/genesis-diagnostics')
helper_hash = hashlib.sha256(helper.read_bytes()).hexdigest()
assert helper_hash == '0c797bd8ecf079669ade4ddcd34d2000ec263c51e21831cea3fec71f0618e678'
gen = json.loads((R.parent/'zero-owner-input.json').read_text())
cfg = json.loads(gen['serializedChainConfig'])
assert cfg['chainId'] == 4663001
assert cfg['arbitrum']['InitialChainOwner'] == '0x'+'00'*20
assert cfg['arbitrum']['InitialArbOSVersion'] == 61
assert cfg['arbitrum']['AllowDebugPrecompiles'] is False
assert gen['alloc'] == {}
assert gen['arbOSInit']['nativeTokenSupplyManagementEnabled'] is False
assert gen['arbOSInit']['initialL1BaseFee'] > 0
source = (json.dumps(gen, indent=2)+'\n').encode()
(R/'genesis.proposed.json').write_bytes(source)
results=[]
for number in [1,2]:
    began=time.monotonic()
    done=subprocess.run([str(helper),'--genesis-json-file',str(R/'genesis.proposed.json')],
        cwd='/workspace/gl3/durable/nitro-clean',capture_output=True,text=True,timeout=30)
    (R/('run'+str(number)+'.log')).write_text(done.stdout+done.stderr)
    assert done.returncode == 0
    match=re.search(r'BlockHash: (0x[0-9a-f]{64}), SendRoot: (0x[0-9a-f]{64}), Batch: (\d+), PosInBatch: (\d+)',done.stdout)
    root=re.search(r'GenesisStateRoot: (0x[0-9a-f]{64})',done.stdout)
    assert match and root
    assert match[2] == '0x'+'00'*32 and (match[3],match[4]) == ('1','0')
    results.append({'actualExitCode':done.returncode,'seconds':time.monotonic()-began,
        'blockHash':match[1],'sendRoot':match[2],'batch':1,'position':0,'stateRoot':root[1]})
assert results[0]['blockHash'] == results[1]['blockHash']
assert results[0]['stateRoot'] == results[1]['stateRoot']
report={'status':'UNSIGNED_ZERO_OWNER_GENESIS_REPRODUCED_NOT_SELECTED_OR_DEPLOYED',
    'helperSHA256':helper_hash,'genesisJSONSHA256':hashlib.sha256(source).hexdigest(),
    'serializedConfigSHA256':hashlib.sha256(gen['serializedChainConfig'].encode()).hexdigest(),
    'chainId':4663001,'initialOwner':'0x'+'00'*20,'allocCount':0,'unbackedNativeAllocation':'0',
    'initialDataCostEstimate':str(gen['arbOSInit']['initialL1BaseFee']),
    'feeRateIsAnEarlierUnselectedReference':True,'sameHeaderAndRootBothRuns':True,'runs':results,
    'actualOwnerSetReadFromDatabase':False,'liveOrFinalizedOwnerPolicyVerified':False,
    'publicWrites':0,'nodeLaunched':False,'allExecutionOnRunpod':True}
(R/'result.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
