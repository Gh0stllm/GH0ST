#!/usr/bin/env node
// Independent release integration: the production browser client and worker, one real local model job.
// The only signer is an unlocked, locally spawned Anvil account. No external RPC or private key is accepted.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import * as eth from 'ethers';
import {createS0ULAnalysisClient,verifyAnalysisDeployment,analysisLogicalSteps,computeAnalysisFunding} from '../../website/s0ul-analysis-client.mjs';
import {runAnalysisWorker,createMemoryWorkerStore,analysisStepBound,WORKER_ABIS} from '../scripts/analysis-worker.mjs';
const base=fileURLToPath(new URL('../',import.meta.url));
const binary=process.argv[2];assert.ok(binary&&process.argv.length===3,'Supply only the absolute local Anvil binary path');
const proofPath=resolve(base,'reports/analysis-real-model-validation.json'),proofRaw=readFileSync(proofPath),proof=JSON.parse(proofRaw);
assert.equal(proof.result,'PASS');assert.equal(proof.completed,true);assert.equal(proof.backend,'anvil');
const calibrationPath=resolve(base,'reports/analysis-phase-gas-calibration.json'),calibrationRaw=readFileSync(calibrationPath),calibration=JSON.parse(calibrationRaw);
assert.equal(calibration.result,'PASS');
const goldenPath=resolve(base,'analysis-model/evaluation-v2/canonical-integer-golden.json'),golden=JSON.parse(readFileSync(goldenPath));
const statePath='/tmp/s0ul-analysis-release-'+Date.now()+'.json';copyFileSync(proof.localDatabasePath,statePath);
const output=resolve(base,'reports/analysis-release-real-model-validation.json');
const sha=v=>createHash('sha256').update(v).digest('hex');
const stringify=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
const loadedSourceHashes=Object.fromEntries(['website/s0ul-analysis-client.mjs','s0ul-1m/scripts/analysis-worker.mjs','s0ul-1m/test/analysis-release-real-model-test.mjs'].map(p=>[p,sha(readFileSync(resolve(base,'..',p)))]));
const report={format:'s0ul-analysis-release-real-model-integration-v1',result:'RUNNING',complete:false,localOnly:true,publicRpcCalls:0,publicTransactions:0,realFundsSpent:'0',startedUtc:new Date().toISOString(),
 model:{checkpoint:proof.model.sourceCheckpoint,payloadSha256:proof.model.payloadSha256,modelId:proof.deployment.modelId,shards:48,sourceProofSha256:sha(proofRaw)},
 calibration:{path:calibrationPath,sha256:sha(calibrationRaw)},localStatePath:statePath,guards:[],ownerReceipts:[],workerReceipts:[],decisions:[],
 limits:['One known no-code regression input with the frozen v2 checkpoint; no arbitrary real-address analyst accuracy or AIXBT parity is established.',
 'The complete integration uses the production browser client and worker core against local EVM contracts and real weights. HTTP service availability is a local test adapter.',
 'The32-token quote is an operational estimate with margin and pause/top-up; the actual model stops at17 tokens including EOS. The mathematical3811-step cap is checked independently.',
 'Local EVM fees do not measure Nitro posting fees or public-chain latency. All accounts and funds are simulated.']};
const save=()=>{mkdirSync(dirname(output),{recursive:true});writeFileSync(output,stringify(report));};
let provider,child,client;
const began=Date.now();
async function guard(name,fn){await fn();report.guards.push({name,result:'PASS'});save();}
try{
 for(const[n,h]of Object.entries(proof.build.sourceSha256))assert.equal(sha(readFileSync(resolve(base,'contracts',n))),h,'unchanged real-model contract '+n);
 const server=createServer();await new Promise(a=>server.listen(0,'127.0.0.1',a));const port=server.address().port;await new Promise(a=>server.close(a));
 child=spawn(resolve(binary),['--host','127.0.0.1','--port',String(port),'--chain-id','4663','--hardfork','shanghai','--gas-limit','31000000','--gas-price','20000000','--accounts','3','--balance','1000000','--state',statePath,'--quiet','--threads','2'],{stdio:'ignore'});
 provider=new eth.JsonRpcProvider('http://127.0.0.1:'+port,undefined,{cacheTimeout:-1,batchMaxCount:1});provider.pollingInterval=10;
 let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Owned local Anvil exited');try{ready=BigInt(await provider.send('eth_chainId',[]))===4663n;}catch{}if(ready)break;await new Promise(a=>setTimeout(a,50));}assert.ok(ready);
 report.nativeBackend={binarySha256:sha(readFileSync(binary)),host:'127.0.0.1',port,noPublicFork:true};
 const accounts=await provider.send('eth_accounts',[]),owner=eth.getAddress(accounts[0]),worker=eth.getAddress(accounts[1]);
 const contracts=Object.fromEntries(Object.entries(proof.deployment.codeHashes).map(([role,codeHash])=>[role,{address:proof.deployment[role],codeHash}]));
 const executor=new eth.Contract(contracts.executor.address,[...WORKER_ABIS.executor,'function outputTokensOf(uint256) view returns(uint16[])','function reportOf(uint256) view returns(bytes)','function factsOf(uint256) view returns(bytes)'],provider);
 const engine=new eth.Contract(contracts.engine.address,[...WORKER_ABIS.engine,'function logits(uint256) view returns(int32[])','function outputTokens(uint256) view returns(uint16[])'],provider);
 const deployment={format:'s0ul-analysis-local-release-test',chainId:4663,confirmedComplete:true,localOnly:true,publicRpc:'http://127.0.0.1:'+port,contracts,modelId:proof.deployment.modelId,
  schemaHash:await executor.schemaHash(),configurationHash:await executor.configurationHash(),domainSha256:await executor.domainSha256(),workerAddress:worker,
  calibration:{source:'s0ul-1m/reports/analysis-phase-gas-calibration.json',modelId:proof.deployment.modelId,includesRewardOverhead:true,maxPosition:31,maxMeasuredGasByPhase:calibration.rawMaxMeasuredGasByPhase,
   attentionBaseMeasuredGas:calibration.attentionOperationalEnvelope.interceptIncludingRewardOverhead,attentionGasPerExtraPosition:calibration.attentionOperationalEnvelope.gasPerPosition},
  quotePolicy:{gasReserveBps:12000,feeCeilingBps:12500},worker:{}};
 report.deployment=deployment;
 await verifyAnalysisDeployment({provider,deployment,eth});
 await guard('Exact logical-step bound and operational quote are distinct',async()=>{
  for(let n=2;n<=32;n++)assert.equal(analysisLogicalSteps(16,n),Number(analysisStepBound(16,n)));
  assert.equal(analysisLogicalSteps(16,32),3811);
  const funding=computeAnalysisFunding({promptTokens:16,maxNewTokens:32,feeCeilingWeiPerGas:25_000_000n,maxRewardPerBatchWei:31_000_000n*25_000_000n,calibration:deployment.calibration});
  assert.equal(funding.continuationGasReserve,BigInt(calibration.projectedOperationalGas.prompt16Output32With20PercentMargin));
  assert.equal(funding.hardEscrowCeilingWei,3812n*31_000_000n*25_000_000n);assert.equal(funding.completionGuaranteed,false);assert.ok(funding.escrowWei<funding.hardEscrowCeilingWei);
 });
 await guard('Wrong runtime pin rejects before any wallet transaction',async()=>{
  const wrong={...deployment,contracts:{...contracts,engine:{...contracts.engine,codeHash:'0x'+'11'.repeat(32)}}};
  await assert.rejects(verifyAnalysisDeployment({provider,deployment:wrong,eth}),/runtime/);
 });
 let walletSends=0,workerAvailable=true,timeOffset=0;const triggered=[];
 const ethereum={async request({method,params=[]}){
  if(method==='eth_requestAccounts'||method==='eth_accounts')return[owner];
  if(method==='wallet_switchEthereumChain'){assert.equal(BigInt(params[0].chainId),4663n);return null;}
  if(method==='eth_sendTransaction')walletSends++;
  return provider.send(method,params);
 },on(){},removeListener(){}};
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 client=createS0ULAnalysisClient({deployment,ethereum,storage,eth,provider,dependencies:{now:()=>Date.now()+timeOffset,worker:{status:async()=>({available:workerAvailable,ready:workerAvailable,chainId:4663,executor:contracts.executor.address}),trigger:async id=>{triggered.push(String(id));return{accepted:true};}}}});
 await client.ready;await client.connect();assert.equal(client.state.connected,true);assert.equal(client.state.verified,true);
 let quote=await client.quote({target:proof.target,maxNewTokens:32});
 assert.equal(quote.targetCodeHash,eth.ZeroHash,'nonexistent target uses EXTCODEHASH zero, not keccak(empty code)');
 assert.equal(quote.totalRequiredWei,quote.valueWei+quote.openFeeReserveWei+quote.recoveryFeeReserveWei);assert.equal(quote.completionGuaranteed,false);
 report.quote=quote;
 await guard('Tampered quote and changed funding budget reject without wallet send',async()=>{
  await assert.rejects(client.start({...quote,valueWei:quote.valueWei+1n}),/quote.*changed|stale/i);
  await assert.rejects(client.start(quote,{budgetWei:quote.escrowWei+1n}),/budget changed/);assert.equal(walletSends,0);
 });
 await guard('Unavailable continuation service blocks escrow opening',async()=>{
  workerAvailable=false;await assert.rejects(client.start(quote),/service is unavailable/);assert.equal(walletSends,0);workerAvailable=true;
 });
 await guard('Expired quote rejects before wallet send',async()=>{
  timeOffset=46000;await assert.rejects(client.start(quote),/stale|expired/i);assert.equal(walletSends,0);timeOffset=0;
 });
 quote=await client.quote({target:proof.target,maxNewTokens:32});report.quote=quote;
 const started=await client.start(quote,{budgetWei:quote.escrowWei});if(started.pending)await client.reconcile(started.hash);
 const jobId=BigInt(client.state.jobId),job=await executor.getJob(jobId);assert.equal(walletSends,1);assert.equal(triggered.at(-1),jobId.toString());
 assert.equal(job.totalFunded,quote.escrowWei);assert.equal(job.promptLength,16n);assert.equal(job.maxNewTokens,32n);assert.equal(job.owner.toLowerCase(),owner.toLowerCase());assert.equal(job.target.toLowerCase(),proof.target.toLowerCase());
 report.jobId=jobId;report.requestId=job.requestId;report.factsHash=job.factsHash;report.promptHash=job.promptHash;report.ownerReceipts=client.state.receipts;save();
 const localSigner={async getAddress(){return worker;},async signTransaction(tx){const request={from:worker,to:tx.to,data:tx.data,value:eth.toQuantity(tx.value),gas:eth.toQuantity(tx.gasLimit),gasPrice:eth.toQuantity(tx.gasPrice),nonce:eth.toQuantity(tx.nonce),chainId:eth.toQuantity(tx.chainId),type:'0x0'};const signed=await provider.send('eth_signTransaction',[request]);return typeof signed==='string'?signed:signed.raw;}};
 const store=createMemoryWorkerStore();
 const onReceipt=async record=>{
  assert.equal(record.rawTransaction,undefined,'No raw signed transaction leaks through callback');report.workerReceipts.push(record);
  const s=await engine.status(job.requestId);
  if(Number(s.phase)===16&&!report.decisions.some(x=>x.index===Number(s.generated))){const index=Number(s.generated),logits=(await engine.logits(job.requestId)).map(Number);assert.deepEqual(logits,golden.decisions[index].logits);report.decisions.push({index,tokenId:golden.decisions[index].token_id,actualLogits:logits,all512Exact:true});}
  if(report.workerReceipts.length%50===0)process.stdout.write(stringify({event:'production_worker_local_progress',receipts:report.workerReceipts.length,phase:Number(s.phase),position:Number(s.position),generated:Number(s.generated)}));
  save();
 };
 const runOptions={provider,signer:localSigner,deployment,jobId,store,maxSpendWei:eth.parseEther('100'),maxTransactionFeeWei:eth.parseEther('1'),onReceipt,receiptWaitMilliseconds:5000,maxTransactions:1000,withdrawEvery:8};
 await guard('Worker spend policy pauses before submitting an unfunded external fee reserve',async()=>{
  const result=await runAnalysisWorker({...runOptions,maxSpendWei:1n,maxTransactions:1});assert.equal(result.status,'worker_spend_cap');assert.equal((await engine.status(job.requestId)).phase,1n);assert.equal(await store.getPending(),null);
 });
 let ambiguousOnce=true,actualBroadcastHash=null;
 const ambiguousProvider=new Proxy(provider,{get(target,key){if(key==='send')return async(method,args)=>{if(method==='eth_sendRawTransaction'&&ambiguousOnce){ambiguousOnce=false;actualBroadcastHash=await target.send(method,args);throw Error('Local test: response lost after actual broadcast');}return target.send(method,args);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 await guard('Ambiguous broadcast retains exact hash and blocks resend until receipt recovery',async()=>{
  const result=await runAnalysisWorker({...runOptions,provider:ambiguousProvider,maxTransactions:1});assert.equal(result.status,'pending');const pending=await store.getPending();assert.equal(pending.hash,actualBroadcastHash);assert.equal(pending.state,'ambiguous');report.ambiguousBroadcastHash=actualBroadcastHash;
 });
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),600000);
 let workerResult;try{workerResult=await runAnalysisWorker({...runOptions,signal:controller.signal});}finally{clearTimeout(timer);}
 report.workerResult=workerResult;assert.equal(workerResult.status,'completed');assert.equal(await store.getPending(),null);assert.equal(report.decisions.length,17);
 await client.refresh();const completed=client.state;assert.equal(completed.job.state,2);assert.equal(completed.report,golden.response);assert.deepEqual(completed.outputTokens,golden.generated_token_ids);
 const finalJob=await executor.getJob(jobId);assert.equal(finalJob.totalPaid+finalJob.remaining,quote.escrowWei);assert.ok(finalJob.remaining>=0n);assert.ok(finalJob.totalPaid<quote.escrowWei);
 report.refundBeforeActionWei=finalJob.remaining;
 const refund=await client.quoteAction({action:'refundCompleted'});const refundResult=await client.execute(refund);if(refundResult.pending)await client.reconcile(refundResult.hash);
 assert.equal(await executor.credits(owner),finalJob.remaining);const withdrawal=await client.quoteAction({action:'withdraw'});const withdrawalResult=await client.execute(withdrawal);if(withdrawalResult.pending)await client.reconcile(withdrawalResult.hash);
 assert.equal(await executor.credits(owner),0n);assert.equal(await executor.credits(worker),0n);assert.equal(await provider.getBalance(contracts.executor.address),0n);
 report.ownerReceipts=client.state.receipts;report.generatedTokenIds=completed.outputTokens;report.response=completed.report;report.comparison={decisions:17,logitsPerDecision:512,totalLogitsExact:8704,tokensExact:true,strictStoredReportExact:true};
 const workerFees=report.workerReceipts.reduce((n,x)=>n+BigInt(x.feeWei),0n),workerRewards=report.workerReceipts.reduce((n,x)=>n+BigInt(x.creditedWei),0n);
 assert.equal(workerFees,await store.spentWei());assert.equal(workerRewards,finalJob.totalPaid);
 report.accounting={escrowFundedWei:quote.escrowWei,workerRewardsWei:workerRewards,ownerRefundWei:finalJob.remaining,workerActualReceiptFeesWei:workerFees,allCreditsWithdrawn:true,finalExecutorBalanceWei:0n,quoteCoversObservedJob:true,thirtyTwoTokenCompletionGuaranteed:false};
 report.localGas={worker:report.workerReceipts.reduce((n,x)=>n+BigInt(x.gasUsed),0n),owner:report.ownerReceipts.reduce((n,x)=>n+BigInt(x.gasUsed),0n),operationalCap:31000000,maximumTransaction:report.workerReceipts.reduce((n,x)=>BigInt(x.gasUsed)>n?BigInt(x.gasUsed):n,0n)};
 report.sourceHashes=loadedSourceHashes;for(const[p,h]of Object.entries(loadedSourceHashes))assert.equal(sha(readFileSync(resolve(base,'..',p))),h,'Executed source remained frozen: '+p);
 report.result='PASS';report.complete=true;report.completedUtc=new Date().toISOString();report.elapsedSeconds=(Date.now()-began)/1000;save();process.stdout.write(stringify({event:'release_real_model_integration_pass',comparison:report.comparison,accounting:report.accounting,localGas:report.localGas,seconds:report.elapsedSeconds}));
}catch(error){report.result='FAIL';report.complete=false;report.error=error.stack??error.message;save();process.stderr.write((error.stack??error.message)+'\n');process.exitCode=1;}
finally{client?.destroy();if(provider)await provider.destroy();if(child&&child.exitCode===null){const closed=new Promise(a=>child.once('exit',a));child.kill('SIGINT');await Promise.race([closed,new Promise(a=>setTimeout(a,5000))]);if(child.exitCode===null)child.kill('SIGKILL');}}
