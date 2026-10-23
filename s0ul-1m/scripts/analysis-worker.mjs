// A transaction submitter only. Features, inference and report decoding stay in the EVM.
import { AbiCoder, Contract, Interface, Transaction, ZeroAddress, getAddress, keccak256 } from 'ethers';

export const ANALYSIS_CHAIN_ID = 4663n;
export const ANALYSIS_RPC_URLS = Object.freeze([
  'https://rpc.mainnet.chain.robinhood.com',
  'https://api.blockvectra.com/v1/robinhood_mainnet/public',
]);
export const ANALYSIS_CHECKPOINT = '0x9cf0b5ce17109bda877f21ac08731cd1897bf6d160b4b690de809c750e960716';
export const ANALYSIS_MANIFEST_HASH = '0xa89f665f053d9ea9172112ec839ce16d399f9687c75f00a18ddf0e0ee128a87f';
export const ANALYSIS_DOMAIN = '0xc0a58f640b73adb0cfd80b9eea45c4a72542becb30edccdfecb01cbbc37d778e';
const CONFIG = '(uint16 vocabSize,uint16 dim,uint16 layers,uint16 heads,uint16 hiddenDim,uint16 maxSeqLen,uint32 epsQ28,uint32 attentionScaleQ14)';
const STATUS = '(address owner,uint8 phase,uint16 position,uint16 layer,uint16 row,uint16 head,uint16 promptLength,uint16 maxNewTokens,uint16 generated,uint256 saturationCount,bool done,bool cancelled,bool logitsReady)';
const JOB = '(address owner,address target,uint256 requestId,uint8 state,uint8 failure,uint16 promptLength,uint16 maxNewTokens,uint64 deadline,uint64 capturedAt,uint64 evmBlockCounter,bytes32 targetCodeHash,bytes32 modelId,bytes32 factsHash,bytes32 promptHash,bytes32 outputHash,uint256 feeCeilingWeiPerGas,uint256 maxRewardPerBatchWei,uint256 totalFunded,uint256 remaining,uint256 totalPaid)';
export const WORKER_ABIS = Object.freeze({
  executor: [
    `function getJob(uint256) view returns(${JOB})`, 'function advance(uint256,uint256,uint256) returns(bool)',
    'function finalize(uint256) returns(bool)', 'function withdraw()', 'function credits(address) view returns(uint256)',
    ...['engine','model','adapter','codec'].map(n => `function ${n}() view returns(address)`),
    ...['engineCodeHash','modelCodeHash','adapterCodeHash','codecCodeHash','modelId','configurationHash','domainSha256','schemaHash'].map(n => `function ${n}() view returns(bytes32)`),
    'function chainId() view returns(uint256)',
    'event RewardCredited(uint256 indexed jobId,address indexed worker,uint256 amountWei,uint256 measuredGas,uint256 remainingWei)',
  ],
  engine: ['function model() view returns(address)', 'function tokenizer() view returns(address)',
    'function modelId() view returns(bytes32)', `function configuration() view returns(${CONFIG})`,
    `function status(uint256) view returns(${STATUS})`],
  model: ['function modelId() view returns(bytes32)', 'function sourceCheckpoint() view returns(bytes32)', 'function manifestHash() view returns(bytes32)'],
  adapter: ['function reader() view returns(address)', 'function readerCodeHash() view returns(bytes32)', 'function schemaHash() view returns(bytes32)'],
  codec: ['function domainSha256() view returns(bytes32)'],
  gas: ['function getMaxTxGasLimit() view returns(uint256)', 'function getMaxBlockGasLimit() view returns(uint256)'],
});
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const exact = (v, name) => {
  if (typeof v === 'number' && !Number.isSafeInteger(v) || !['number','bigint','string'].includes(typeof v)
      || typeof v === 'string' && !/^\d+$/.test(v)) throw Error(`${name} must be an exact nonnegative integer`);
  const n=BigInt(v); if(n<0n) throw Error(`${name} must be nonnegative`); return n;
};
const minimum = (...xs) => xs.reduce((a,b)=>a<b?a:b);
const jsonSafe = v => JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));
const safeError = e => String(e?.shortMessage ?? e?.reason ?? e?.message ?? 'Worker failure')
  .replace(/0x[0-9a-f]{64,}/gi,'[hex redacted]').slice(0,300);
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));

export function analysisStepBound(promptLength, maxNewTokens) {
  const p=exact(promptLength,'promptLength'), n=exact(maxNewTokens,'maxNewTokens');
  if(p<3n||p>96n||n<2n||n>32n||p+n>128n) throw Error('Unsupported fixed model dimensions');
  return 77n*(p+n-1n)+6n*n;
}

// This is an explicitly bounded operator subsidy, not a profit assertion.
// A fixed gasleft reimbursement can differ slightly from a Nitro receipt fee.
export function assessWorkerReimbursement({feeWei,creditedWei,maxReimbursementShortfallBps=0,reverted=false}) {
  const fee=exact(feeWei,'feeWei'),credit=exact(creditedWei,'creditedWei');
  const bps=exact(maxReimbursementShortfallBps,'maxReimbursementShortfallBps');
  if(bps>5n)throw Error('Reimbursement shortfall policy must be between 0 and 5 basis points');
  const shortfall=fee>credit?fee-credit:0n,maximum=fee*bps/10_000n;
  const allowed=reverted===false&&credit>0n&&shortfall<=maximum;
  return {allowed,shortfallWei:shortfall,maximumShortfallWei:maximum,
    toleratedShortfallWei:allowed?shortfall:0n,maxReimbursementShortfallBps:Number(bps)};
}

export function normalizeWorkerDeployment(input) {
  if(!input || exact(input.chainId,'chainId')!==ANALYSIS_CHAIN_ID) throw Error('Worker requires chain4663');
  const contracts={};
  for(const role of ['executor','engine','model','adapter','codec','reader']) {
    const c=input.contracts?.[role] ?? {address:input[role],codeHash:input[role+'CodeHash']};
    if(!c || !/^0x[0-9a-fA-F]{64}$/.test(c.codeHash??'')) throw Error('Missing fixed '+role+' code hash');
    contracts[role]={address:getAddress(c.address),codeHash:c.codeHash.toLowerCase()};
    if(contracts[role].address===ZeroAddress) throw Error('Zero dependency');
  }
  for(const key of ['modelId','schemaHash','configurationHash'])
    if(!/^0x[0-9a-fA-F]{64}$/.test(input[key]??'')) throw Error('Missing '+key);
  const localOnly=input.localOnly===true;
  const publicRpc=(input.publicRpc??input.readRpcUrl??input.readOnlyPublicRpc??'').replace(/\/$/,'');
  if(!localOnly && (!input.confirmedComplete || !ANALYSIS_RPC_URLS.includes(publicRpc))) throw Error('Unconfirmed deployment or unapproved RPC');
  if(input.domainSha256 && !same(input.domainSha256,ANALYSIS_DOMAIN)) throw Error('Wrong analysis word domain');
  const workerAddress=getAddress(input.workerAddress??input.worker?.address);
  if(workerAddress===ZeroAddress) throw Error('Worker address must be pinned');
  return {...input,contracts,publicRpc,workerAddress,localOnly};
}

export async function verifyWorkerDeployment({provider,deployment}) {
  const d=normalizeWorkerDeployment(deployment);
  if(BigInt(await provider.send('eth_chainId',[]))!==ANALYSIS_CHAIN_ID) throw Error('Actual RPC chain changed');
  const contracts={};
  for(const role of Object.keys(d.contracts)) {
    const code=await provider.getCode(d.contracts[role].address);
    if(code==='0x'||!same(keccak256(code),d.contracts[role].codeHash)) throw Error(role+' runtime identity changed');
    if(WORKER_ABIS[role]) contracts[role]=new Contract(d.contracts[role].address,WORKER_ABIS[role],provider);
  }
  const {executor:e,engine,model,adapter,codec}=contracts;
  for(const role of ['engine','model','adapter','codec']) {
    if(!same(await e[role](),d.contracts[role].address)||!same(await e[role+'CodeHash'](),d.contracts[role].codeHash)) throw Error('Executor '+role+' pin mismatch');
  }
  if(BigInt(await e.chainId())!==ANALYSIS_CHAIN_ID || !same(await engine.model(),d.contracts.model.address)
    || !same(await engine.tokenizer(),ZeroAddress)||!same(await adapter.reader(),d.contracts.reader.address)
    || !same(await adapter.readerCodeHash(),d.contracts.reader.codeHash)) throw Error('Dependency binding changed');
  for(const c of [e,engine,model]) if(!same(await c.modelId(),d.modelId)) throw Error('Model ID mismatch');
  if(!same(await model.sourceCheckpoint(),ANALYSIS_CHECKPOINT)||!same(await model.manifestHash(),ANALYSIS_MANIFEST_HASH)
    ||!same(await codec.domainSha256(),ANALYSIS_DOMAIN)||!same(await e.domainSha256(),ANALYSIS_DOMAIN)
    ||!same(await e.schemaHash(),d.schemaHash)||!same(await adapter.schemaHash(),d.schemaHash)) throw Error('Frozen model/schema/codec mismatch');
  const cfg=await engine.configuration();
  if([Number(cfg.vocabSize),Number(cfg.dim),Number(cfg.layers),Number(cfg.heads),Number(cfg.hiddenDim),Number(cfg.maxSeqLen)].join(',')!=='512,128,4,4,640,128') throw Error('Unexpected model dimensions');
  const cfgHash=keccak256(AbiCoder.defaultAbiCoder().encode([CONFIG],[cfg]));
  if(!same(cfgHash,d.configurationHash)||!same(await e.configurationHash(),cfgHash)) throw Error('Configuration hash mismatch');
  return {deployment:d,contracts};
}

export async function workerGasContext(provider,deployment) {
  const chain=BigInt(await provider.send('eth_chainId',[]));
  if(chain!==ANALYSIS_CHAIN_ID) throw Error('Actual RPC chain changed');
  const [block,fee]=await Promise.all([provider.getBlock('latest'),provider.getFeeData()]);
  const price=BigInt(fee.gasPrice??0);
  if(!block||price<=0n) throw Error('Live gas price unavailable');
  let maxTx,maxBlock;
  if(deployment.localOnly) { maxTx=31_000_000n;maxBlock=31_000_000n; }
  else {
    const info=new Contract('0x000000000000000000000000000000000000006C',WORKER_ABIS.gas,provider);
    [maxTx,maxBlock]=await Promise.all([info.getMaxTxGasLimit(),info.getMaxBlockGasLimit()]);
    if(maxTx<=0n||maxBlock<=0n) throw Error('Live Nitro gas limits unavailable');
  }
  return {gasPrice:price,cap:minimum(31_000_000n,BigInt(maxTx),BigInt(maxBlock)),timestamp:BigInt(block.timestamp),blockNumber:block.number};
}

// Explicitly for local integration tests. Production functions use a database-fenced store.
export function createMemoryWorkerStore() {
  let locked=false,held=false,pending=null,totalSpent=0n;
  const records=[];
  return {
    localOnly:true,records,
    async acquire(){if(locked)return false;locked=true;held=true;return true;},
    async assertLease(){if(!held)throw Error('Worker lease lost');},
    async release(){held=false;locked=false;},
    async getPending(){return pending;},
    async savePending(record){if(pending)throw Error('Unresolved pending transaction');pending=jsonSafe(record);records.push({type:'prepared',...pending});},
    async markBroadcasting(hash){if(!same(pending?.hash,hash))throw Error('Pending identity mismatch');pending.state='broadcasting';pending.broadcastAttempts=1;},
    async loadPendingRaw(hash){if(!same(pending?.hash,hash))throw Error('Pending identity mismatch');return pending.rawTransaction;},
    async claimRebroadcast(hash){if(!same(pending?.hash,hash))throw Error('Pending identity mismatch');if(Number(pending.broadcastAttempts??0)>=2)return false;pending.broadcastAttempts=Number(pending.broadcastAttempts??0)+1;pending.state='broadcasting';return true;},
    async markAmbiguous(hash,error){if(!same(pending?.hash,hash))throw Error('Pending identity mismatch');pending.state='ambiguous';pending.error=error;},
    async settle(record){if(!same(pending?.hash,record.hash))throw Error('Pending identity mismatch');records.push({type:'settled',...jsonSafe(record)});totalSpent+=BigInt(record.feeWei);pending=null;},
    async spentWei(){return totalSpent;},
  };
}

async function reconcile(provider,store,workerAddress,executorAddress,waitMilliseconds=0,signal) {
  const pending=await store.getPending(); if(!pending)return null;
  let receipt=await provider.getTransactionReceipt(pending.hash);
  const until=Date.now()+waitMilliseconds;
  while(!receipt && Date.now()<until && !signal?.aborted) {
    await store.assertLease(); await pause(500); receipt=await provider.getTransactionReceipt(pending.hash);
  }
  if(!receipt) return {blocked:true,hash:pending.hash,reason:'Pending exact hash has no canonical receipt; no transaction was re-signed or resent.'};
  const [tx,block]=await Promise.all([provider.getTransaction(pending.hash),provider.getBlock(receipt.blockNumber)]);
  if(!tx||!block||!same(receipt.hash,pending.hash)||!same(block.hash,receipt.blockHash)||!same(tx.hash,pending.hash)
    ||!same(tx.from,workerAddress)||!same(tx.to,executorAddress)||BigInt(tx.chainId)!==ANALYSIS_CHAIN_ID
    ||Number(tx.nonce)!==pending.nonce||BigInt(tx.value)!==0n||!same(keccak256(tx.data),pending.calldataHash)
    ||BigInt(tx.gasLimit)!==BigInt(pending.gasLimit)||BigInt(tx.gasPrice??0)!==BigInt(pending.gasPrice)) throw Error('Pending canonical receipt identity mismatch');
  const price=BigInt(receipt.gasPrice??0);
  if(price<=0n||price>BigInt(pending.gasPrice)) throw Error('Receipt fee unavailable or outside signed cap');
  const fee=receipt.gasUsed*price;
  if(receipt.gasUsed>BigInt(pending.gasLimit)||fee>BigInt(pending.reserveWei)) throw Error('Actual fee or gas exceeds signed fee reserve');
  const credited=receipt.logs.reduce((sum,log)=>{
    if(!same(log.address,executorAddress))return sum;
    try {const e=new Interface(WORKER_ABIS.executor).parseLog(log);return e?.name==='RewardCredited'&&same(e.args.worker,workerAddress)?sum+e.args.amountWei:sum;}catch{return sum;}
  },0n);
  const record=jsonSafe({...pending,state:Number(receipt.status)===1?'confirmed':'reverted',blockNumber:receipt.blockNumber,
    blockHash:receipt.blockHash,gasUsed:receipt.gasUsed,feeWei:fee,creditedWei:credited,
    // Raw signed bytes are held in a separate private immutable object, not response/log data.
    rawTransaction:undefined});
  await store.assertLease(); await store.settle(record);
  return {record,failed:Number(receipt.status)!==1};
}

// Recovery broadcasts the exact saved bytes at most twice in total. It cannot
// replace a nonce, increase a fee, or construct a second transaction.
export async function recoverAnalysisWorkerPending({provider,store,workerAddress,executorAddress,signal,receiptWaitMilliseconds=45_000}) {
  let result=await reconcile(provider,store,workerAddress,executorAddress,0,signal);
  if(!result?.blocked||signal?.aborted)return result;
  await store.assertLease();
  const pending=await store.getPending();
  const [known,latestNonce,pendingNonce]=await Promise.all([provider.getTransaction(pending.hash),
    provider.getTransactionCount(workerAddress,'latest'),provider.getTransactionCount(workerAddress,'pending')]);
  if(known) {
    if(!same(known.from,workerAddress)||known.nonce!==pending.nonce||!same(known.hash,pending.hash))throw Error('Known pending transaction identity mismatch');
    return reconcile(provider,store,workerAddress,executorAddress,receiptWaitMilliseconds,signal);
  }
  if(latestNonce>pending.nonce||pendingNonce>pending.nonce) {
    const canonical=await reconcile(provider,store,workerAddress,executorAddress,0,signal);
    return canonical?.blocked?{...canonical,reason:'Saved hash is missing while its signer nonce is already used or pending; no alternative transaction is permitted.'}:canonical;
  }
  const raw=await store.loadPendingRaw(pending.hash),tx=Transaction.from(raw);
  if(!same(keccak256(raw),pending.hash)||!same(tx.from,workerAddress)||!same(tx.to,executorAddress)
    ||tx.chainId!==ANALYSIS_CHAIN_ID||tx.nonce!==pending.nonce||tx.value!==0n
    ||!same(keccak256(tx.data),pending.calldataHash)||tx.gasLimit!==BigInt(pending.gasLimit)
    ||tx.gasPrice!==BigInt(pending.gasPrice))throw Error('Saved signed recovery bytes do not match the pending transaction');
  await store.assertLease();
  if(!await store.claimRebroadcast(pending.hash))return {...result,reason:'Exact signed-byte recovery attempt limit reached; operator reconciliation required.'};
  try {
    const hash=await provider.send('eth_sendRawTransaction',[raw]);
    if(!same(hash,pending.hash))throw Error('RPC returned a different recovery transaction hash');
  } catch(error) {
    // "Already known" and "nonce used" are not permission to construct another
    // transaction. Only a canonical receipt for the original hash can settle it.
    try{await store.markAmbiguous(pending.hash,safeError(error));}catch{}
  }
  return reconcile(provider,store,workerAddress,executorAddress,receiptWaitMilliseconds,signal);
}

/**
 * Continue one already funded, immutable on-chain job. Never opens jobs, provides
 * prompts, or supplies reports. A durable signer-wide lease/store is mandatory.
 */
export async function runAnalysisWorker({provider,signer,deployment,jobId,signal,maxTransactions=1000,
  store,maxSpendWei,maxTransactionFeeWei,maxReimbursementShortfallBps,onReceipt,receiptWaitMilliseconds=45_000,withdrawEvery=8}) {
  const id=exact(jobId,'jobId'); if(id===0n)throw Error('Invalid jobId');
  if(!Number.isSafeInteger(maxTransactions)||maxTransactions<1||maxTransactions>5000)throw Error('Invalid transaction bound');
  const verified=await verifyWorkerDeployment({provider,deployment});
  const d=verified.deployment,e=verified.contracts.executor,engine=verified.contracts.engine;
  const worker=getAddress(await signer.getAddress());
  if(!same(worker,d.workerAddress))throw Error('Signer is not the dedicated pinned worker');
  if(!store || !d.localOnly&&store.localOnly)throw Error('Durable production worker store required');
  for(const name of ['acquire','assertLease','release','getPending','savePending','markBroadcasting','markAmbiguous','loadPendingRaw','claimRebroadcast','settle','spentWei'])
    if(typeof store[name]!=='function')throw Error('Missing worker store operation '+name);
  const spendCap=exact(maxSpendWei??d.worker?.maxTotalFeeWei??'1000000000000000','maxSpendWei');
  const txFeeCap=exact(maxTransactionFeeWei??d.worker?.maxTransactionFeeWei??'100000000000000','maxTransactionFeeWei');
  const reimbursementBps=exact(maxReimbursementShortfallBps??d.worker?.maxReimbursementShortfallBps??0,'maxReimbursementShortfallBps');
  if(reimbursementBps>5n)throw Error('Reimbursement shortfall policy must be between 0 and 5 basis points');
  if(spendCap<=0n||txFeeCap<=0n||!Number.isSafeInteger(withdrawEvery)||withdrawEvery<1||withdrawEvery>32)throw Error('Invalid positive worker policy');
  if(!await store.acquire())return {status:'busy',transactions:0};
  let transactions=0,advancesSinceWithdraw=0,receiptFees=0n,rewards=0n,toleratedShortfall=0n;
  const settled=[];
  const finish=(status,extra={})=>jsonSafe({status,jobId:id,transactions,receiptFeesWei:receiptFees,rewardsWei:rewards,
    maxReimbursementShortfallBps:Number(reimbursementBps),toleratedReimbursementShortfallWei:toleratedShortfall,...extra});
  const assessPaidReceipt=record=>{
    if(!['advance','finalize'].includes(record.method))return {allowed:true};
    const assessment=assessWorkerReimbursement({feeWei:record.feeWei,creditedWei:record.creditedWei,
      maxReimbursementShortfallBps:reimbursementBps,reverted:record.state!=='confirmed'});
    if(assessment.allowed)toleratedShortfall+=assessment.toleratedShortfallWei;
    return assessment;
  };
  try {
    const previous=await recoverAnalysisWorkerPending({provider,store,workerAddress:worker,executorAddress:d.contracts.executor.address,signal,receiptWaitMilliseconds});
    if(previous?.blocked)return finish('pending',previous);
    if(previous?.record) {
      settled.push(previous.record);receiptFees+=BigInt(previous.record.feeWei);rewards+=BigInt(previous.record.creditedWei);
      await onReceipt?.(previous.record);
    }
    if(previous?.failed)return finish('reverted',{hash:previous.record.hash});
    if(previous?.record&&!assessPaidReceipt(previous.record).allowed)return finish('unprofitable',{
      hash:previous.record.hash,reason:'Recovered paid-work receipt exceeds the explicit reimbursement policy; worker paused.'});
    const submit=async(method,args,job,context,steps)=>{
      await store.assertLease();
      if(signal?.aborted)return {stopped:true};
      const data=e.interface.encodeFunctionData(method,args);
      const request={from:worker,to:d.contracts.executor.address,data,value:0n,gasPrice:context.gasPrice};
      let estimate;
      try { estimate=BigInt(await provider.estimateGas(request)); }
      catch(error) { return {estimateFailed:true,error:safeError(error)}; }
      const gasLimit=(estimate*12n+9n)/10n;
      if(gasLimit>context.cap)return {tooLarge:true};
      const reserve=gasLimit*context.gasPrice;
      if(reserve>txFeeCap||BigInt(await store.spentWei())+reserve>spendCap)return {policyStop:'worker_spend_cap'};
      if(BigInt(await provider.getBalance(worker))<reserve)return {policyStop:'worker_needs_gas'};
      if(method!=='withdraw') {
        // Capped reimbursement must have room for the entire estimated fee reserve.
        // Actual receipt net is checked below; Nitro posting costs are not gasleft.
        if(job.maxRewardPerBatchWei<reserve||job.remaining<job.maxRewardPerBatchWei)return {policyStop:'underfunded_or_reward_cap'};
      }
      await store.assertLease();
      const [latestNonce,pendingNonce]=await Promise.all([provider.getTransactionCount(worker,'latest'),provider.getTransactionCount(worker,'pending')]);
      if(latestNonce!==pendingNonce)return {policyStop:'untracked_pending_nonce'};
      if(BigInt(await provider.send('eth_chainId',[]))!==ANALYSIS_CHAIN_ID)throw Error('Chain changed before signing');
      const tx={chainId:ANALYSIS_CHAIN_ID,nonce:pendingNonce,to:request.to,data,value:0n,gasLimit,gasPrice:context.gasPrice,type:0};
      await store.assertLease();
      const raw=await signer.signTransaction(tx),hash=keccak256(raw),decoded=Transaction.from(raw);
      if(!same(decoded.from,worker)||!same(decoded.to,request.to)||decoded.nonce!==pendingNonce||decoded.chainId!==ANALYSIS_CHAIN_ID
        ||decoded.value!==0n||decoded.gasLimit!==gasLimit||decoded.gasPrice!==context.gasPrice
        ||decoded.data!==data||decoded.type!==0)throw Error('Signer returned a different transaction');
      const prepared=jsonSafe({hash,nonce:pendingNonce,to:request.to,calldataHash:keccak256(data),gasLimit,gasPrice:context.gasPrice,
        reserveWei:reserve,jobId:id,method,steps:steps??null,state:'prepared',broadcastAttempts:0,preparedAt:new Date().toISOString(),rawTransaction:raw});
      await store.assertLease();await store.savePending(prepared);
      await store.assertLease();await store.markBroadcasting(hash);
      try {
        // Exactly one broadcast attempt. Even an ambiguous transport error leaves
        // the same pending hash blocking every new nonce across every job.
        const returned=await provider.send('eth_sendRawTransaction',[raw]);
        if(!same(returned,hash))throw Error('RPC returned another transaction hash');
      } catch(error) {
        try{await store.markAmbiguous(hash,safeError(error));}catch{}
        return {blocked:true,hash,reason:'Broadcast outcome ambiguous; exact-hash reconciliation required.'};
      }
      transactions++;
      const outcome=await reconcile(provider,store,worker,d.contracts.executor.address,receiptWaitMilliseconds,signal);
      if(outcome?.record){
        settled.push(outcome.record);receiptFees+=BigInt(outcome.record.feeWei);rewards+=BigInt(outcome.record.creditedWei);
        await onReceipt?.(outcome.record);
      }
      return outcome;
    };
    while(transactions<maxTransactions&&!signal?.aborted) {
      await store.assertLease();
      let job;
      try{job=await e.getJob(id);}catch{return finish('unknown');}
      if(!same(job.modelId,d.modelId))throw Error('Job model mismatch');
      const context=await workerGasContext(provider,d);
      const credit=await e.credits(worker);
      // Refloat gas regularly, including after terminal jobs. A withdrawal only
      // transfers this worker's own earned credit back to itself.
      if(credit>0n&&(advancesSinceWithdraw>=withdrawEvery||Number(job.state)!==1||BigInt(await provider.getBalance(worker))<context.cap*context.gasPrice*2n)) {
        const withdrawalEstimate=await e.withdraw.estimateGas({from:worker,gasPrice:context.gasPrice});
        if(credit>withdrawalEstimate*context.gasPrice*2n) {
          const out=await submit('withdraw',[],job,context);
          if(out?.blocked)return finish('pending',out);
          if(out?.failed)return finish('reverted',{hash:out.record.hash});
          if(out?.policyStop)return finish(out.policyStop);
          if(out?.estimateFailed)return finish('estimate_failed',{reason:out.error});
          if(out?.tooLarge)throw Error('Withdrawal exceeds operational gas cap');
          if(out?.stopped)break;
          advancesSinceWithdraw=0;continue;
        }
      }
      if(Number(job.state)!==1)return finish(Number(job.state)===2?'completed':Number(job.state)===3?'rejected':'terminal');
      if(context.timestamp>job.deadline)return finish('expired');
      if(context.gasPrice>job.feeCeilingWeiPerGas)return finish('fee_ceiling');
      if(job.remaining<job.maxRewardPerBatchWei)return finish('underfunded');
      const state=await engine.status(job.requestId);
      if(!same(state.owner,d.contracts.executor.address)||state.promptLength!==job.promptLength||state.maxNewTokens!==job.maxNewTokens)throw Error('Engine job binding changed');
      const method=state.done||state.cancelled?'finalize':'advance';
      let outcome;
      if(method==='finalize')outcome=await submit('finalize',[id],job,context);
      else {
        for(let steps=4;steps>=1;steps--) {
          outcome=await submit('advance',[id,128,steps],job,context,steps);
          if(outcome?.tooLarge||outcome?.estimateFailed)continue;
          break;
        }
      }
      if(outcome?.blocked)return finish('pending',outcome);
      if(outcome?.failed)return finish('reverted',{hash:outcome.record.hash});
      if(outcome?.policyStop)return finish(outcome.policyStop);
      if(outcome?.estimateFailed)return finish('estimate_failed',{reason:outcome.error});
      if(outcome?.tooLarge)throw Error('No phase batch fits live operational gas cap');
      if(outcome?.stopped)break;
      advancesSinceWithdraw++;
      if(outcome?.record&&!assessPaidReceipt(outcome.record).allowed)
        return finish('unprofitable',{hash:outcome.record.hash,reason:'Paid-work receipt exceeds the explicit reimbursement shortfall policy; worker paused.'});
    }
    return finish(signal?.aborted?'paused':'transaction_limit');
  } finally {await store.release();}
}
