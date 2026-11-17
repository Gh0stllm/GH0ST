"""Independent post-run raw receipt checks; executed only on the owned Runpod."""
from pathlib import Path
import hashlib,json,time

R=Path('/workspace/gl3/zk-tests/nitro-baseline'); E=R/'evidence'
def load(p):return json.loads(Path(p).read_text())
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
actual=load(E/'actual-exit.json');controller=load(E/'controller-result.json');report=load(E/'result.json')
assert actual['exitCode']==0 and actual['actualWait4'] is True and actual['terminationReason'] is None and actual['seconds']<=300
assert controller['passed'] is True and report['passed'] is True
fixture=load(R/'fixture.normalized.json');binding=load(R/'fixture-binding.json')
assert digest(R/'fixture.normalized.json')==binding['normalizedSHA256']==report['fixtureSHA256']
assert fixture['count']==binding['actualEthrexTransactionHashesMatched']==16
receipts=load(E/'timed-erc20-receipts.json');assert len(receipts)==16
sender=fixture['sender']['address'].lower();contract=fixture['contract']['address'].lower()
gas=fees=0
for transaction,receipt in zip(fixture['transactions'],receipts):
 assert receipt['transactionHash']==transaction['hash'] and int(receipt['status'],16)==1
 saved=load(E/'receipts'/('sequencer-'+transaction['hash']+'.json'))
 replay=load(E/'receipts'/('follower-'+transaction['hash']+'.json'))
 assert saved==receipt
 for key in ['blockHash','status','gasUsed','gasUsedForL1','logs']:
  assert saved[key]==replay[key],(key,transaction['hash'])
 events=[x for x in receipt['logs'] if x['address'].lower()==contract]
 assert len(events)==1
 event=events[0]
 assert event['topics'][0]=='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
 assert event['topics'][1][-40:].lower()==sender[2:]
 assert event['topics'][2][-40:].lower()==transaction['recipient'][2:].lower()
 assert int(event['data'],16)==1
 gas+=int(receipt['gasUsed'],16);fees+=int(receipt['gasUsed'],16)*int(receipt['effectiveGasPrice'],16)
assert str(gas)==report['sequencing']['gasUsed']=='833848'
assert str(fees)==report['sequencing']['actualNativeFeeWei']
parent=load(E/'parent-timed-batch-receipt.json');tx=load(E/'parent-timed-batch-transaction.json')
assert int(parent['status'],16)==1 and parent['transactionHash']==tx['hash']==report['posting']['transactionHash']
data=bytes.fromhex(tx['input'][2:]);assert len(data)==report['posting']['calldataBytes']
assert data.count(0)==report['posting']['calldataZeroBytes']
assert int(parent['gasUsed'],16)==int(report['posting']['parentReceiptGasUsed'])
assert report['posting']['all16InSameBatch'] is True
target=load(E/'target-sequenced-header.json')
follower=load(E/'follower-public-config.json');seq=load(E/'sequencer-public-config.json')
assert follower['execution']['forwarding-target']=='null'
assert follower['node']['sequencer'] is False and follower['execution']['sequencer']['enable'] is False
assert follower['node']['feed']['input']['url']==[] and follower['node']['feed']['output']['enable'] is False
assert follower['node']['batch-poster']['enable'] is False and follower['node']['block-validator']['enable'] is False
assert seq['execution']['rpc']['tx-fee-cap']==5000000
assert report['validation']['headerAndStateAndAll16ReceiptsMatch'] is True
assert report['semanticMatch']['rawSignedTransactionsMatched']==16
assert report['realGH0STGasCompatibilityClaimed'] is False and report['publicWrites']==0 and report['realFundsMoved'] is False
owned=load(E/'owned-exits.json')
assert all(x['exitCode']==0 and x['signal'] is None and not Path('/proc/'+str(x['pid'])).exists() for x in owned)
source=load(E/'source-manifest.json')
assert all(digest(R/p)==h for p,h in source.items())
audit={'passed':True,'asOfUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'scope':'Post-run independent raw receipt/event/fixture/source/config/cleanup audit; header/state replay equality was performed live by the frozen runner, not independently reconstructed here','actualExit':actual,'fixtureSHA256':digest(R/'fixture.normalized.json'),'rawERC20ReceiptAndReplayPairs':16,'ERC20TransferEventChecks':16,'exactGasUsed':str(gas),'parentReceiptAndCalldataVerified':True,'targetHeaderHash':target['hash'],'targetStateRoot':target['stateRoot'],'allOwnedPIDsGone':True,'ownedProcessCount':len(owned),'sourceFilesRehashed':len(source),'ZKProofOrFraudProofClaimed':False,'productionAccepted':False,'RPCFeeCapOverrideScope':'Loopback admission only, 5million synthetic neutral fixture units','rootAndFeeSemanticsDifference':'Whole Ethereum and ArbOS state roots/fees are not equivalent; exact signed calls, contract prestate and token outputs are matched.'}
(E/'independent-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
print(json.dumps(audit,indent=2))
