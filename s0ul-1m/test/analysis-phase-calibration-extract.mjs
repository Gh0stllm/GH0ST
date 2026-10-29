#!/usr/bin/env node
// Read-only extraction of actual per-phase gas from the completed local real-model proof.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {AbiCoder,id} from 'ethers';
const base=fileURLToPath(new URL('../',import.meta.url));
assert.equal(process.argv.length,2,'This extractor accepts no RPC URL, signer or other arguments');
const proofPath=resolve(base,'reports/analysis-real-model-validation.json'),proofRaw=readFileSync(proofPath),proof=JSON.parse(proofRaw);
assert.equal(proof.result,'PASS');assert.equal(proof.completed,true);assert.equal(proof.backend,'anvil');assert.equal(proof.comparison.totalLogitsMatched,8704);
const stateRaw=readFileSync(proof.localDatabasePath),state=JSON.parse(stateRaw);
const sha=v=>createHash('sha256').update(v).digest('hex');
const coder=AbiCoder.defaultAbiCoder();
const statusType='tuple(address owner,uint8 phase,uint16 position,uint16 layer,uint16 row,uint16 head,uint16 promptLength,uint16 maxNewTokens,uint16 generated,uint256 saturationCount,bool done,bool cancelled,bool logitsReady)';
const statusSelector=id('status(uint256)').slice(0,10),advanceSelector=id('advance(uint256,uint256)').slice(0,10),rewardTopic=id('RewardCredited(uint256,address,uint256,uint256,uint256)');
const schedule=[];
function add(phase,position,layer=0,row=0,head=0){schedule.push({phase,position,layer,row,head,generated:Math.max(0,position-15)});}
for(let p=0;p<32;p++){
 add(1,p);
 for(let l=0;l<4;l++){
  for(const phase of [2,3,4,5,6,7])add(phase,p,l);
  for(let h=0;h<4;h++)add(8,p,l,0,h);
  add(9,p,l);add(10,p,l);
  for(let row=0;row<640;row+=128)add(11,p,l,row);
  add(12,p,l);add(13,p,l);
 }
 if(p>=15){add(14,p,3);for(let row=0;row<512;row+=128)add(15,p,3,row);add(16,p,3);}
}
assert.equal(schedule.length,2566);
const byHash=new Map(state.transactions.map(t=>[t.info.transaction_hash.toLowerCase(),t]));
const engine=proof.deployment.engine.toLowerCase();
const stats={},attention={},batches=[],measurements=[];
let cursor=0,maxWrapper=0;
for(const receipt of proof.transactions.filter(x=>x.kind==='advance')){
 const t=byHash.get(receipt.hash.toLowerCase());assert.ok(t);assert.equal(t.receipt.status,'0x1');assert.equal(BigInt(t.receipt.cumulativeGasUsed),BigInt(receipt.gasUsed));
 const traces=t.info.traces.toSorted((a,b)=>a.idx-b.idx);
 const calls=traces.filter(x=>x.trace.address.toLowerCase()===engine&&x.trace.kind==='CALL'&&x.trace.data.startsWith(advanceSelector));
 assert.ok(calls.length>=1&&calls.length<=4);
 const reward=t.receipt.logs.find(x=>x.topics[0]===rewardTopic);assert.ok(reward);
 const [,measuredGas]=coder.decode(['uint256','uint256','uint256'],reward.data);
 const engineGas=calls.reduce((n,x)=>n+x.trace.gas_used,0),wrapper=Number(measuredGas)-engineGas;
 assert.ok(wrapper>=75000);maxWrapper=Math.max(maxWrapper,wrapper);
 batches.push({hash:receipt.hash,blockNumber:receipt.blockNumber,logicalSteps:calls.length,receiptGas:Number(receipt.gasUsed),measuredRewardGas:Number(measuredGas),engineGas,wrapperIncluding75000:wrapper});
 for(const call of calls){
  const expected=schedule[cursor++];assert.ok(expected);assert.equal(call.trace.success,true);
  const before=traces.filter(x=>x.idx<call.idx&&x.trace.address.toLowerCase()===engine&&x.trace.data.startsWith(statusSelector)).at(-1);assert.ok(before);
  const actual=coder.decode([statusType],before.trace.output)[0];
  for(const field of ['phase','position','layer','row','head','generated'])assert.equal(Number(actual[field]),expected[field],'actual trace pre-state '+field);
  const measurement={...expected,engineCallGas:call.trace.gas_used,transactionHash:receipt.hash,traceIndex:call.idx};measurements.push(measurement);
  const stat=stats[expected.phase]??={samples:0,maxEngineCallGas:0};stat.samples++;stat.maxEngineCallGas=Math.max(stat.maxEngineCallGas,call.trace.gas_used);
  if(expected.phase===8)attention[expected.position]=Math.max(attention[expected.position]??0,call.trace.gas_used);
 }
}
assert.equal(cursor,schedule.length);assert.equal(batches.length,647);
const rawMaxMeasuredGasByPhase={};for(const[phase,stat]of Object.entries(stats))rawMaxMeasuredGasByPhase[phase]=stat.maxEngineCallGas+maxWrapper;
const slope=Math.max(...Object.entries(attention).filter(([p])=>Number(p)>0).map(([p,g])=>g-attention[Number(p)-1]));
const engineIntercept=Math.max(...Object.entries(attention).map(([p,g])=>g-slope*Number(p)));
const attentionIntercept=engineIntercept+maxWrapper;
for(const[p,g]of Object.entries(attention))assert.ok(g+maxWrapper<=attentionIntercept+slope*Number(p));
function projected(P,N){let gas=0;for(let p=0;p<P+N-1;p++){gas+=rawMaxMeasuredGasByPhase[1];for(let l=0;l<4;l++)gas+=[2,3,4,5,6,7,9,10,11,11,11,11,11,12,13].reduce((n,q)=>n+rawMaxMeasuredGasByPhase[q],0)+4*(attentionIntercept+slope*p);if(p>=P-1)gas+=rawMaxMeasuredGasByPhase[14]+4*rawMaxMeasuredGasByPhase[15]+rawMaxMeasuredGasByPhase[16];}return gas;}
const report={format:'s0ul-analysis-phase-gas-calibration-v2',result:'PASS',complete:true,operation:'read-only trace extraction from a previously completed real-model local EVM job',localOnly:true,publicRpcCalls:0,publicTransactions:0,realFundsSpent:'0',
 sourceProof:{path:proofPath,sha256:sha(proofRaw),result:proof.result,completed:proof.completed,modelId:proof.deployment.modelId,checkpointSha256:proof.model.sourceCheckpoint,payloadSha256:proof.model.payloadSha256},
 sourceState:{localPath:proof.localDatabasePath,sha256:sha(stateRaw),historicalExecutionTraces:true},
 sourceExtractorSha256:sha(readFileSync(fileURLToPath(import.meta.url))),
 observed:{promptTokens:16,generatedTokensIncludingEOS:17,maxProcessedPosition:31,logicalAdvances:cursor,continuationTransactions:batches.length,allTracePreStatesMatchIndependentSchedule:true},
 rewardPolicy:{gasOverhead:75000,includesRewardOverhead:true,maxBatchWrapperIncludingRewardOverhead:maxWrapper,
 attribution:'Each logical step receives its own maximum observed batch wrapper plus its phase maximum engine-call gas. This intentionally overcounts multi-step wrapper work and the75k policy overhead to estimate fragmented continuation.'},
 phaseStats:stats,rawMaxMeasuredGasByPhase,attentionMaxEngineGasByPosition:attention,
 attentionOperationalEnvelope:{interceptIncludingRewardOverhead:attentionIntercept,gasPerPosition:slope,observedPositions:[0,31],extrapolatedPositionsFor32OutputCap:[32,46],allObservedPositionsCovered:true,method:'maximum positive adjacent observed context growth; intercept covers every observed head/layer at positions0..31'},
 projectedOperationalGas:{prompt16Output17:projected(16,17),prompt16Output32:projected(16,32),prompt16Output32With20PercentMargin:Math.ceil(projected(16,32)*1.2)},
 formalPaidStepBound:{prompt16Output32:3811,withFinalizationReward:3812,formula:'77*(P+N-1)+6*N; reserve per logical step because workers can choose steps1'},
 batches,measurements,
 limits:['This calibration is an operational estimate from one known no-code regression, not a formal gas or analyst-quality guarantee for arbitrary addresses.',
 'Adding maximum batch wrapper to every logical step is conservative on observed traces; it is not a proof of all future cold-storage costs.',
 'Positions32..46 are extrapolated. The worker must freshly estimate every transaction, reduce grouping when needed, and pause on insufficient budget or fee ceiling.',
 'Local EVM execution does not emulate Nitro parent-chain posting fees. Mainnet quotes must distinguish reimbursement escrow from worker gas spending.',
 'Finalization, cancellation/refund, withdrawals and owner opening fees require separate reserves.',
 'A separate single-step calibration attempt was stopped after two actual steps due slow ethers receipt polling on a reloaded chain; it is not reported as a completed job.']};
writeFileSync(resolve(base,'reports/analysis-phase-gas-calibration.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({result:report.result,rawMaxMeasuredGasByPhase,attentionOperationalEnvelope:report.attentionOperationalEnvelope,projectedOperationalGas:report.projectedOperationalGas,sha256:sha(readFileSync(resolve(base,'reports/analysis-phase-gas-calibration.json')))},null,2)+'\n');
