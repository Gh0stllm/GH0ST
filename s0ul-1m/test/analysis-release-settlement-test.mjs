#!/usr/bin/env node
// Settle only the already completed real-model job, retaining exact prior stage evidence.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import * as eth from 'ethers';
import {createS0ULAnalysisClient,ANALYSIS_ABIS} from '../../website/s0ul-analysis-client.mjs';
const base=fileURLToPath(new URL('../',import.meta.url)),binary=process.argv[2];assert.ok(binary&&process.argv.length===3);
const path=resolve(base,'reports/analysis-release-inference-stage.json'),raw=readFileSync(path),stage=JSON.parse(raw),golden=JSON.parse(readFileSync(resolve(base,'analysis-model/evaluation-v2/canonical-integer-golden.json')));
assert.equal(stage.workerResult.status,'completed');assert.equal(stage.decisions.length,17);
for(const d of stage.decisions)assert.deepEqual(d.actualLogits,golden.decisions[d.index].logits);
const sha=v=>createHash('sha256').update(v).digest('hex'),safe=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
const clientHash=sha(readFileSync(resolve(base,'../website/s0ul-analysis-client.mjs'))),workerHash=sha(readFileSync(resolve(base,'scripts/analysis-worker.mjs')));
assert.equal(clientHash,'1cf42db3c532ac896170186264785668e9d7be26ff865e82f964486bd796708b');assert.equal(workerHash,'1bad1315973fc04b489f4f87cfff484391bb3bebb22491d7e78fe352228a2aab');
const output=resolve(base,'reports/analysis-release-settlement-validation.json'),r={format:'s0ul-analysis-release-settlement-v1',result:'RUNNING',complete:false,localOnly:true,publicTransactions:0,realFundsSpent:'0',inferenceStageSha256:sha(raw),clientSha256:clientHash,workerSha256:workerHash,startedUtc:new Date().toISOString(),walletResponses:[],receipts:[]};
const save=()=>writeFileSync(output,safe(r));let provider,child,client;save();
try{
 const server=createServer();await new Promise(a=>server.listen(0,'127.0.0.1',a));const port=server.address().port;await new Promise(a=>server.close(a));
 child=spawn(resolve(binary),['--host','127.0.0.1','--port',String(port),'--chain-id','4663','--hardfork','shanghai','--gas-limit','31000000','--accounts','3','--balance','1000000','--state',stage.localStatePath,'--quiet','--threads','2'],{stdio:'ignore'});
 provider=new eth.JsonRpcProvider('http://127.0.0.1:'+port,undefined,{batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=10;
 let ready=false;for(let i=0;i<100;i++){try{ready=BigInt(await provider.send('eth_chainId',[]))===4663n;}catch{}if(ready)break;await new Promise(a=>setTimeout(a,50));}assert.ok(ready);
 const owner=eth.getAddress((await provider.send('eth_accounts',[]))[0]),d={...stage.deployment,publicRpc:'http://127.0.0.1:'+port};
 const ex=new eth.Contract(d.contracts.executor.address,ANALYSIS_ABIS.executor,provider),id=BigInt(stage.jobId),before=await ex.getJob(id);assert.equal(Number(before.state),2);assert.equal(eth.toUtf8String(await ex.reportOf(id)),golden.response);assert.deepEqual((await ex.outputTokensOf(id)).map(Number),golden.generated_token_ids);assert.equal(await ex.credits(d.workerAddress),0n);
 const storageData=new Map(),storage={getItem:k=>storageData.get(k)??null,setItem:(k,v)=>storageData.set(k,v)};
 const ethereum={async request({method,params=[]}){if(method==='eth_requestAccounts'||method==='eth_accounts')return[owner];if(method==='wallet_switchEthereumChain')return null;const value=await provider.send(method,params);if(method==='eth_sendTransaction'){r.walletResponses.push({hash:value,request:params[0]});save();}return value;},on(){},removeListener(){}};
 client=createS0ULAnalysisClient({deployment:d,ethereum,provider,eth,storage,dependencies:{worker:{status:async()=>({available:true})}}});await client.ready;await client.connect();await client.loadJob(id);
 async function executeAndSettle(action){const quote=await client.quoteAction({action,jobId:id}),sent=await client.execute(quote);r.lastSubmission=sent;save();const until=Date.now()+20000;while(client.state.pending&&Date.now()<until){const result=await client.reconcile(sent.hash);r.lastReconcile={pending:result.pending,hash:result.hash};save();if(!result.pending)break;await new Promise(a=>setTimeout(a,100));}assert.equal(client.state.pending,null,'canonical wallet settlement completed');r.receipts=client.state.receipts;save();}
 const existingCredit=await ex.credits(owner);r.existingOwnerCreditWei=existingCredit;assert.equal(existingCredit+before.remaining,BigInt(stage.refundBeforeActionWei));if(before.remaining>0n)await executeAndSettle('refundCompleted');else r.refundAlreadyApplied=true;r.refundedCreditWei=await ex.credits(owner);assert.equal(r.refundedCreditWei,BigInt(stage.refundBeforeActionWei));
 await executeAndSettle('withdraw');assert.equal(await ex.credits(owner),0n);assert.equal(await ex.credits(d.workerAddress),0n);assert.equal(await provider.getBalance(d.contracts.executor.address),0n);
 assert.equal(sha(readFileSync(resolve(base,'../website/s0ul-analysis-client.mjs'))),clientHash);assert.equal(sha(readFileSync(resolve(base,'scripts/analysis-worker.mjs'))),workerHash);
 r.result='PASS';r.complete=true;r.finalExecutorBalanceWei='0';r.completedUtc=new Date().toISOString();r.accounting={escrowWei:before.totalFunded,workerRewardsWei:before.totalPaid,ownerRefundWei:BigInt(stage.refundBeforeActionWei),conserved:before.totalPaid+BigInt(stage.refundBeforeActionWei)===before.totalFunded};assert.equal(r.accounting.conserved,true);save();
 const combined={...stage,result:'PASS',complete:true,error:undefined,settlementStage:{path:output,sha256:sha(readFileSync(output)),result:r.result,canonicalReceiptPolling:true},
 executionStages:[{path,sha256:sha(raw),result:'INFERENCE_COMPLETED_SETTLEMENT_ASSERTION_PREMATURE',note:'Production model/worker completed; original harness checked credit before the nonblocking wallet transaction settled.'},{path:output,sha256:sha(readFileSync(output)),result:'PASS',note:'Only owner refund/withdraw tail; no inference rerun.'}],
 ownerReceipts:[...stage.ownerReceipts,...r.receipts],generatedTokenIds:golden.generated_token_ids,response:golden.response,comparison:{decisions:17,logitsPerDecision:512,totalLogitsExact:8704,tokensExact:true,strictStoredReportExact:true},
 accounting:{escrowFundedWei:before.totalFunded,workerRewardsWei:before.totalPaid,ownerRefundWei:BigInt(stage.refundBeforeActionWei),workerActualReceiptFeesWei:stage.workerReceipts.reduce((n,x)=>n+BigInt(x.feeWei),0n),allCreditsWithdrawn:true,finalExecutorBalanceWei:'0',quoteCoversObservedJob:true,thirtyTwoTokenCompletionGuaranteed:false},
 sourceHashes:{'website/s0ul-analysis-client.mjs':clientHash,'s0ul-1m/scripts/analysis-worker.mjs':workerHash,'s0ul-1m/test/analysis-release-real-model-test.mjs':sha(readFileSync(resolve(base,'test/analysis-release-real-model-test.mjs'))),'s0ul-1m/test/analysis-release-settlement-test.mjs':sha(readFileSync(fileURLToPath(import.meta.url)))},completedUtc:new Date().toISOString()};
 combined.receiptCoverage={allWorkerReceiptsCanonical:true,ownerInitialOpeningCanonical:true,ownerFinalWithdrawalCanonical:true,originalRefundReceiptNotRetainedAfterPrematureHarnessStop:true};combined.limits.push('The initial harness stopped before it retained the owner refund receipt. The restored state already held the exact refund credit; the tail verified that credit and canonically withdrew it. Recorded owner gas excludes that unretained original refund receipt.');
 combined.localGas={worker:stage.workerReceipts.reduce((n,x)=>n+BigInt(x.gasUsed),0n),owner:combined.ownerReceipts.reduce((n,x)=>n+BigInt(x.gasUsed),0n),ownerReceiptCoverageComplete:false,operationalCap:31000000,maximumTransaction:stage.workerReceipts.reduce((n,x)=>BigInt(x.gasUsed)>n?BigInt(x.gasUsed):n,0n)};
 writeFileSync(resolve(base,'reports/analysis-release-real-model-validation.json'),safe(combined));process.stdout.write(safe({result:'PASS',accounting:combined.accounting,localGas:combined.localGas,comparison:combined.comparison}));
}catch(e){r.result='FAIL';r.complete=false;r.error=e.stack;r.clientState=client?.state;save();process.stderr.write(e.stack+'\n');process.exitCode=1;}finally{client?.destroy();if(provider)await provider.destroy();if(child&&child.exitCode===null){const closed=new Promise(a=>child.once('exit',a));child.kill('SIGINT');await Promise.race([closed,new Promise(a=>setTimeout(a,5000))]);if(child.exitCode===null)child.kill('SIGKILL');}}
