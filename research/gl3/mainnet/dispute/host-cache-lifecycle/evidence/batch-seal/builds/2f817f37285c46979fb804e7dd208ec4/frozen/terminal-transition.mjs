// Pure acceptance boundary. Run its regressions on the assigned Runpod worker.
import assert from 'node:assert/strict';
const ZERO='0x'+'00'.repeat(32),hash=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{64}$/.test(x);
const g=s=>s.globalState||s[0],bytes=s=>g(s).bytes32Vals||g(s)[0],numbers=s=>g(s).u64Vals||g(s)[1];
const status=s=>BigInt(s.machineStatus??s[1]),history=s=>s.endHistoryRoot??s[2];
const canonical=s=>[bytes(s).map(x=>x.toLowerCase()),numbers(s).map(x=>String(x)),String(status(s)),history(s).toLowerCase()];
export function verifyTerminalTransition({manifest,proof,states,claims,honestAssertionHash}){
 assert(manifest.completed===true&&manifest.requested===true,'Completed terminal receipt manifest required');
 const terminal=manifest.blockNumber;
 assert(Number.isSafeInteger(terminal)&&terminal>0,'Invalid terminal receipt block number');
 assert(hash(manifest.blockHash)&&manifest.blockHash.toLowerCase()===manifest.expectedEndState.BlockHash.toLowerCase(),'Terminal receipt/expected-state block hash mismatch');
 assert(hash(manifest.terminalComputeTx),'Terminal receipt transaction identity missing');
 assert(Number.isSafeInteger(manifest.parentBatchMetadata.MessageCount)&&manifest.parentBatchMetadata.MessageCount===terminal+1,'Private genesis-zero block/message count mismatch');
 assert(BigInt(manifest.expectedEndState.Batch)===BigInt(manifest.parentBatch)+1n&&BigInt(manifest.expectedEndState.PosInBatch)===0n,'Terminal receipt is not the recorded batch end');
 const target=claims.find(c=>c.hash===honestAssertionHash);assert(target,'Exact honest target claim missing');
 const predecessor=claims.find(c=>c.hash===target.parent);assert(predecessor,'Assertion-start predecessor missing');
 assert.deepEqual(canonical(target.before),canonical(predecessor.after),'Target start differs from predecessor after-state');
 assert.equal(status(predecessor.after),1n);assert.deepEqual(numbers(predecessor.after).map(String),['1','0'],'Target start is not the private genesis-finished state');
 assert.deepEqual(numbers(predecessor.before).map(String),['0','0']);assert.deepEqual(bytes(predecessor.before).map(x=>x.toLowerCase()),[ZERO,ZERO],'Bootstrap does not start from the recorded zero initial state');
 const genesis=claims.find(c=>c.hash===predecessor.parent);assert(genesis&&genesis.parent===ZERO,'Bootstrap does not descend from the actual initial assertion');
 assert.deepEqual(canonical(predecessor.before),canonical(genesis.after),'Bootstrap start does not match initial assertion');
 const first=(proof.path||[]).find(x=>x.kind==='subchallenge-claim');assert(first,'No block-to-machine subchallenge claim');
 const edge=states[first.from],child=states[first.to];assert(edge&&child,'Block-to-machine link state missing');
 assert.equal(BigInt(edge.level),0n);assert.equal(BigInt(child.level),1n);assert.equal(child.claimId,first.from,'Machine subchallenge claims a different block edge');
 const start=Number(edge.startHeight),end=Number(edge.endHeight);
 assert(Number.isSafeInteger(start)&&Number.isSafeInteger(end),'Unsafe block history height');
 assert.equal(start,terminal-1,'Proof starts at a different terminal transition');
 assert.equal(end,terminal,'Proof ends at a different terminal transition');
 return {verified:true,terminalBlockNumber:terminal,startHeight:start,endHeight:end,terminalBlockHash:manifest.blockHash,terminalTransactionHash:manifest.terminalComputeTx,blockClaimEdge:first.from,machineSubchallengeRoot:first.to,assertionStartBlockNumber:0,assertionStartBatch:1,assertionStartPosInBatch:0,genesisBlockNumber:0,scope:'Exact terminal receipt-manifest transition in the private genesis-block-zero fixture'};
}
