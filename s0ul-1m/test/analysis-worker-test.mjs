// Infrastructure recovery tests. Real model parity is a separate release integration test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Wallet, Transaction, keccak256 } from 'ethers';
import { createMemoryWorkerStore, recoverAnalysisWorkerPending, analysisStepBound, assessWorkerReimbursement } from '../scripts/analysis-worker.mjs';

const executor='0x0000000000000000000000000000000000001234';
const blockHash='0x'+'ab'.repeat(32);

async function fixture({mode='mine',state='prepared',attempts=0}={}) {
  const wallet=Wallet.createRandom();
  const raw=await wallet.signTransaction({chainId:4663,nonce:0,to:executor,value:0,data:'0x1234',gasLimit:100_000,gasPrice:2_000_000_000n,type:0});
  const hash=keccak256(raw),signed=Transaction.from(raw),store=createMemoryWorkerStore();
  await store.acquire();
  const record={hash,nonce:0,to:executor,calldataHash:keccak256('0x1234'),gasLimit:'100000',gasPrice:'2000000000',
    reserveWei:'200000000000000',jobId:'1',method:'advance',steps:1,state,broadcastAttempts:attempts,rawTransaction:raw};
  await store.savePending(record);
  let receipt=null,known=null,broadcasts=0,latestNonce=0,pendingNonce=0;
  const transaction=()=>({hash,from:wallet.address,to:executor,chainId:4663n,nonce:0,value:0n,data:signed.data,
    gasLimit:signed.gasLimit,gasPrice:signed.gasPrice});
  const provider={
    async getTransactionReceipt(h){assert.equal(h,hash);return receipt;},
    async getTransaction(h){assert.equal(h,hash);return known;},
    async getTransactionCount(_address,kind){return kind==='pending'?pendingNonce:latestNonce;},
    async getBlock(){return {hash:blockHash};},
    async send(method,args){
      assert.equal(method,'eth_sendRawTransaction');assert.deepEqual(args,[raw]);broadcasts++;
      if(mode==='drop')throw Error('Connection lost after send');
      known=transaction();latestNonce=1;pendingNonce=1;
      receipt={hash,blockNumber:1,blockHash,status:mode==='revert'?0:1,gasPrice:signed.gasPrice,gasUsed:21_000n,logs:[]};
      return hash;
    },
  };
  const recover=()=>recoverAnalysisWorkerPending({provider,store,workerAddress:wallet.address,executorAddress:executor,receiptWaitMilliseconds:0});
  return {wallet,raw,hash,store,provider,recover,broadcasts:()=>broadcasts,
    setKnown(){known=transaction();pendingNonce=1;},
    setNonceUsed(){latestNonce=1;pendingNonce=1;},
    setReceipt(overrides={}){known=transaction();receipt={hash,blockNumber:1,blockHash,status:1,gasPrice:signed.gasPrice,gasUsed:21_000n,logs:[],...overrides};},
  };
}

test('crash after durable prepare recovers exactly the original signed bytes and hash',async()=>{
  const f=await fixture(),out=await f.recover();
  assert.equal(f.broadcasts(),1);assert.equal(out.record.hash,f.hash);assert.equal(out.failed,false);
  assert.equal(await f.store.getPending(),null);assert.equal(await f.store.spentWei(),42_000_000_000_000n);
  assert.equal(out.record.rawTransaction,undefined);
});

test('known pending transaction is never re-signed or redundantly broadcast',async()=>{
  const f=await fixture({state:'ambiguous',attempts:1});f.setKnown();
  const out=await f.recover();assert.equal(out.blocked,true);assert.equal(f.broadcasts(),0);
  assert.equal((await f.store.getPending()).hash,f.hash);
});

test('nonce consumed by another missing hash blocks all replacement transactions',async()=>{
  const f=await fixture({state:'ambiguous',attempts:1});f.setNonceUsed();
  const out=await f.recover();assert.equal(out.blocked,true);assert.match(out.reason,/nonce/);assert.equal(f.broadcasts(),0);
});

test('ambiguous recovery has a persisted two-broadcast total bound',async()=>{
  const f=await fixture({mode:'drop',state:'ambiguous',attempts:1});
  assert.equal((await f.recover()).blocked,true);assert.equal(f.broadcasts(),1);
  assert.equal((await f.recover()).blocked,true);assert.equal(f.broadcasts(),1);
  assert.equal((await f.store.getPending()).broadcastAttempts,2);
});

test('tampered raw journal is rejected before broadcast',async()=>{
  const f=await fixture();f.store.loadPendingRaw=async()=>{
    return f.wallet.signTransaction({chainId:4663,nonce:0,to:executor,value:1,data:'0x1234',gasLimit:100_000,gasPrice:2_000_000_000n,type:0});
  };
  await assert.rejects(f.recover,/saved signed recovery/i);assert.equal(f.broadcasts(),0);
});

test('lease loss prevents recovery broadcast',async()=>{
  const f=await fixture();await f.store.release();
  await assert.rejects(f.recover,/lease/);assert.equal(f.broadcasts(),0);
});

test('reverted canonical receipt accounts the spent fee and clears only its exact pending hash',async()=>{
  const f=await fixture({mode:'revert'}),out=await f.recover();
  assert.equal(out.failed,true);assert.equal(await f.store.getPending(),null);
  assert.equal(await f.store.spentWei(),42_000_000_000_000n);
});

test('noncanonical receipt block cannot settle the pending nonce',async()=>{
  const f=await fixture();f.setReceipt({blockHash:'0x'+'cd'.repeat(32)});
  await assert.rejects(f.recover,/canonical receipt identity/);
  assert.equal((await f.store.getPending()).hash,f.hash);assert.equal(await f.store.spentWei(),0n);
});

test('actual receipt fees cannot exceed the signed reserve',async()=>{
  const f=await fixture();f.setReceipt({gasUsed:100_001n});
  await assert.rejects(f.recover,/signed fee reserve/);assert.equal(await f.store.spentWei(),0n);
});

test('a receipt for another hash cannot settle the signed pending transaction',async()=>{
  const f=await fixture();f.setReceipt({hash:'0x'+'ef'.repeat(32)});
  await assert.rejects(f.recover,/canonical receipt identity/);assert.equal(await f.store.spentWei(),0n);
});

test('worst-case escrow accounts for all 3811 logical steps and finalization',()=>{
  assert.equal(analysisStepBound(16,32),3811n);
  assert.equal(analysisStepBound(16,17),2566n);
  assert.throws(()=>analysisStepBound(97,32));assert.throws(()=>analysisStepBound(16,33));
  const maxReward=31_000_000n*25_000_000n;
  const deposit=(analysisStepBound(16,32)+1n)*maxReward;
  let remaining=deposit;
  for(let i=0;i<3811;i++){assert.ok(remaining>=maxReward);remaining-=maxReward;}
  assert.equal(remaining,maxReward);
});

test('reimbursement policy is strict by default and tolerates only reviewed positive-credit shortfalls',()=>{
  const rows=[
    {name:'equal reimbursement',feeWei:10000n,creditedWei:10000n,allowed:true},
    {name:'over reimbursement',feeWei:10000n,creditedWei:10001n,allowed:true},
    {name:'strict default rejects one wei',feeWei:10000n,creditedWei:9999n,allowed:false},
    {name:'observed Nitro196gas strict',feeWei:147784478736000n,creditedWei:147780517968000n,allowed:false},
    {name:'observed Nitro196gas explicit5bps',feeWei:147784478736000n,creditedWei:147780517968000n,maxReimbursementShortfallBps:5,allowed:true,loss:3960768000n},
    {name:'exact5bps boundary',feeWei:40000n,creditedWei:39980n,maxReimbursementShortfallBps:5,allowed:true,loss:20n},
    {name:'one wei above5bps',feeWei:40000n,creditedWei:39979n,maxReimbursementShortfallBps:5,allowed:false},
    {name:'floor accepts10 not11',feeWei:20001n,creditedWei:19991n,maxReimbursementShortfallBps:5,allowed:true,loss:10n},
    {name:'floor rejects rounding extra',feeWei:20001n,creditedWei:19990n,maxReimbursementShortfallBps:5,allowed:false},
    {name:'zero credit cannot be subsidized',feeWei:1n,creditedWei:0n,maxReimbursementShortfallBps:5,allowed:false},
    {name:'zero credit even zero fee rejected',feeWei:0n,creditedWei:0n,maxReimbursementShortfallBps:5,allowed:false},
    {name:'reverted remains rejected',feeWei:40000n,creditedWei:40000n,maxReimbursementShortfallBps:5,reverted:true,allowed:false},
  ];
  for(const row of rows){const out=assessWorkerReimbursement(row);assert.equal(out.allowed,row.allowed,row.name);
    assert.equal(out.toleratedShortfallWei,row.allowed?(row.loss??0n):0n,row.name);}
});

test('invalid reimbursement basis points cannot widen the hard maximum',()=>{
  for(const bps of [-1,6,10000,0.5,NaN,'5.0','-1',null])assert.throws(()=>assessWorkerReimbursement({feeWei:10000,creditedWei:9999,maxReimbursementShortfallBps:bps}));
  const fees=[40000n,20001n,147784478736000n];
  assert.ok(fees.reduce((n,fee)=>n+fee*5n/10000n,0n)<=fees.reduce((n,fee)=>n+fee,0n)*5n/10000n);
});
