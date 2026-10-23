#!/usr/bin/env node
// Local single-step gas calibration of the exact frozen trained model, never a public RPC.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {JsonRpcProvider,Contract,keccak256,parseEther,toUtf8String} from 'ethers';
const base=fileURLToPath(new URL('../',import.meta.url));
const binary=process.argv[2];
assert.ok(binary && process.argv.length===3,'Provide only the absolute local Anvil binary path');
const proofPath=resolve(base,'reports/analysis-real-model-validation.json');
const proof=JSON.parse(readFileSync(proofPath,'utf8'));
assert.equal(proof.result,'PASS'); assert.equal(proof.backend,'anvil');
const golden=JSON.parse(readFileSync(resolve(base,'analysis-model/evaluation-v2/canonical-integer-golden.json'),'utf8'));
const output=resolve(base,'reports/analysis-phase-gas-calibration.json');
const statePath='/tmp/s0ul-analysis-phase-calibration-'+Date.now()+'.json';
copyFileSync(proof.localDatabasePath,statePath);
const sha=v=>createHash('sha256').update(v).digest('hex');
const stringify=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
const report={format:'s0ul-analysis-phase-gas-calibration-v1',result:'RUNNING',complete:false,localOnly:true,publicRpcCalls:0,publicTransactions:0,realFundsSpent:'0',
 sourceProofSha256:sha(readFileSync(proofPath)),sourceCheckpoint:proof.model.sourceCheckpoint,modelId:proof.deployment.modelId,
 payloadSha256:proof.model.payloadSha256,localStatePath:statePath,startedUtc:new Date().toISOString(),
 phaseStats:{},attentionByPosition:{},measurements:[],decisions:[],transactions:[],
 limits:['One known no-code profile using the frozen v2 checkpoint; no arbitrary-address or analyst accuracy established.',
 'Single-step local EVM gas includes cold transaction overhead but does not emulate Nitro parent-chain posting fees.',
 'Observed positions 0..31 only; positions 32..46 require an explicitly identified operational extrapolation.',
 'Measurements support an operational estimate and pause/top-up policy, not a formal bound for all targets.']};
const save=()=>{mkdirSync(dirname(output),{recursive:true});writeFileSync(output,stringify(report));};
const STATUS='(address owner,uint8 phase,uint16 position,uint16 layer,uint16 row,uint16 head,uint16 promptLength,uint16 maxNewTokens,uint16 generated,uint256 saturationCount,bool done,bool cancelled,bool logitsReady)';
const JOB='(address owner,address target,uint256 requestId,uint8 state,uint8 failure,uint16 promptLength,uint16 maxNewTokens,uint64 deadline,uint64 capturedAt,uint64 evmBlockCounter,bytes32 targetCodeHash,bytes32 modelId,bytes32 factsHash,bytes32 promptHash,bytes32 outputHash,uint256 feeCeilingWeiPerGas,uint256 maxRewardPerBatchWei,uint256 totalFunded,uint256 remaining,uint256 totalPaid)';
const cap=31_000_000n,price=2_000_000_000n,ceiling=5_000_000_000n,deposit=parseEther('1000');
let provider,child;
async function mined(p,kind){const tx=await p;const r=await provider.getTransactionReceipt(tx.hash)??await tx.wait();report.transactions.push({kind,hash:r.hash,status:Number(r.status),gasUsed:r.gasUsed,blockNumber:r.blockNumber});assert.equal(Number(r.status),1);return r;}
try{
 for(const [name,hash] of Object.entries(proof.build.sourceSha256))assert.equal(sha(readFileSync(resolve(base,'contracts',name))),hash,'unchanged executed source '+name);
 const server=createServer();await new Promise(a=>server.listen(0,'127.0.0.1',a));const port=server.address().port;await new Promise(a=>server.close(a));
 child=spawn(resolve(binary),['--host','127.0.0.1','--port',String(port),'--chain-id','4663','--hardfork','shanghai','--gas-limit',String(cap),'--accounts','3','--balance','1000000','--state',statePath,'--quiet','--threads','2'],{stdio:'ignore'});
 provider=new JsonRpcProvider('http://127.0.0.1:'+port,4663,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});provider.pollingInterval=10;
 let ready=false;for(let i=0;i<80;i++){try{ready=BigInt(await provider.send('eth_chainId',[]))===4663n;}catch{}if(ready)break;await new Promise(a=>setTimeout(a,50));}assert.ok(ready,'owned local Anvil starts');
 report.nativeBinarySha256=sha(readFileSync(binary));report.noPublicFork=true;
 for(const [name,hash]of Object.entries(proof.deployment.codeHashes))assert.equal(keccak256(await provider.getCode(proof.deployment[name])),hash,'actual real deployed '+name);
 const owner=await provider.getSigner(0),worker=await provider.getSigner(1),ownerAddress=await owner.getAddress(),workerAddress=await worker.getAddress();
 const engine=new Contract(proof.deployment.engine,['function status(uint256) view returns('+STATUS+')','function logits(uint256) view returns(int32[])','function outputTokens(uint256) view returns(uint16[])'],provider);
 const ex=new Contract(proof.deployment.executor,['function open(address,uint16,uint256,uint256,uint64,bytes32) payable returns(uint256)','function nextJobId() view returns(uint256)','function getJob(uint256) view returns('+JOB+')','function advance(uint256,uint256,uint256) returns(bool)','function finalize(uint256) returns(bool)','function refundCompleted(uint256)','function withdraw()','function credits(address) view returns(uint256)','function reportOf(uint256) view returns(bytes)',
 'event RewardCredited(uint256 indexed jobId,address indexed worker,uint256 amountWei,uint256 measuredGas,uint256 remainingWei)'],provider);
 const id=await ex.nextJobId(),latest=await provider.getBlock('latest');
 await mined(ex.connect(owner).open(proof.target,32,ceiling,cap*ceiling,latest.timestamp+86400,'0x'+'00'.repeat(32),{value:deposit,gasLimit:cap,gasPrice:price}),'open');
 const job=await ex.getJob(id),request=job.requestId;report.jobId=id;report.requestId=request;save();
 const began=Date.now();
 for(let count=0;count<4000 && Date.now()-began<300000;count++){
  const s=await engine.status(request);if(s.done)break;
  if(Number(s.phase)===16){const index=Number(s.generated),actual=(await engine.logits(request)).map(Number);assert.deepEqual(actual,golden.decisions[index].logits);report.decisions.push({index,tokenId:golden.decisions[index].token_id,actualLogits:actual,all512Exact:true});}
  const receipt=await mined(ex.connect(worker).advance(id,128,1,{gasLimit:cap,gasPrice:price}),'advance');
  const reward=receipt.logs.map(x=>{try{return ex.interface.parseLog(x);}catch{return null;}}).find(x=>x?.name==='RewardCredited');assert.ok(reward);
  const phase=Number(s.phase),position=Number(s.position),gas=receipt.gasUsed,measured=reward.args.measuredGas;
  const m={phase,position,layer:Number(s.layer),row:Number(s.row),head:Number(s.head),generated:Number(s.generated),gasUsed:gas,measuredRewardGas:measured,rewardWei:reward.args.amountWei,hash:receipt.hash};report.measurements.push(m);
  const stat=report.phaseStats[phase]??={samples:0,maxReceiptGas:0n,maxMeasuredRewardGas:0n,maxPhaseGasExcluding75000:0n};stat.samples++;if(gas>stat.maxReceiptGas)stat.maxReceiptGas=gas;if(measured>stat.maxMeasuredRewardGas)stat.maxMeasuredRewardGas=measured;if(measured-75000n>stat.maxPhaseGasExcluding75000)stat.maxPhaseGasExcluding75000=measured-75000n;
  if(phase===8){const stat=report.attentionByPosition[position]??={samples:0,maxReceiptGas:0n,maxMeasuredRewardGas:0n};stat.samples++;if(gas>stat.maxReceiptGas)stat.maxReceiptGas=gas;if(measured>stat.maxMeasuredRewardGas)stat.maxMeasuredRewardGas=measured;}
  if((count+1)%200===0){save();process.stdout.write(stringify({event:'local_phase_calibration',steps:count+1,position,phase}));}
 }
 const terminal=await engine.status(request);assert.ok(terminal.done,'bounded calibration completed actual inference');
 const actualIds=(await engine.outputTokens(request)).map(Number);assert.deepEqual(actualIds,golden.generated_token_ids);assert.equal(report.decisions.length,17);
 await mined(ex.connect(worker).finalize(id,{gasLimit:8_000_000n,gasPrice:price}),'finalize');assert.equal(toUtf8String(await ex.reportOf(id)),golden.response);
 const final=await ex.getJob(id);assert.equal(Number(final.state),2);await mined(ex.connect(owner).refundCompleted(id,{gasLimit:500_000n,gasPrice:price}),'refundCompleted');
 const workerCredit=await ex.credits(workerAddress),ownerCredit=await ex.credits(ownerAddress);assert.equal(workerCredit+ownerCredit,deposit);await mined(ex.connect(worker).withdraw({gasLimit:500_000n,gasPrice:price}),'workerWithdraw');await mined(ex.connect(owner).withdraw({gasLimit:500_000n,gasPrice:price}),'ownerWithdraw');assert.equal(await provider.getBalance(proof.deployment.executor),0n);
 report.result='PASS';report.complete=true;report.generatedTokenIds=actualIds;report.response=golden.response;report.logicalSteps=report.measurements.length;assert.equal(report.logicalSteps,77*(16+17-1)+6*17);
 report.maxObservedPosition=31;report.fullJobGas=report.transactions.reduce((s,x)=>s+x.gasUsed,0n);report.accounting={fundedWei:deposit,workerCreditedWei:workerCredit,ownerRefundWei:ownerCredit,finalExecutorBalanceWei:0n};report.completedUtc=new Date().toISOString();report.elapsedSeconds=(Date.now()-began)/1000;save();process.stdout.write(stringify({event:'calibration_pass',logicalSteps:report.logicalSteps,phaseStats:report.phaseStats,attentionAt0:report.attentionByPosition[0],attentionAt31:report.attentionByPosition[31],seconds:report.elapsedSeconds}));
}catch(e){report.result='FAIL';report.error=e.stack;save();process.stderr.write(e.stack+'\n');process.exitCode=1;}finally{if(provider)await provider.destroy();if(child&&child.exitCode===null){const done=new Promise(a=>child.once('exit',a));child.kill('SIGINT');await Promise.race([done,new Promise(a=>setTimeout(a,5000))]);if(child.exitCode===null)child.kill('SIGKILL');}}
