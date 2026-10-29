import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {AbiCoder,keccak256,id,getAddress} from 'ethers';
import {buildAnalysisReleaseConfig,createAnalysisReleaseConfig,DEFAULT_ANALYSIS_WORKER} from '../scripts/create-analysis-release-config.mjs';
import {normalizeWorkerDeployment} from '../s0ul-1m/scripts/analysis-worker.mjs';
import {normalizeAnalysisDeployment,computeAnalysisFunding} from '../website/s0ul-analysis-client.mjs';

// Synthetic completed journal only: these tests cannot confirm a deployment.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const addr=n=>getAddress('0x'+BigInt(n).toString(16).padStart(40,'0'));
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const modelPath=new URL('../s0ul-1m/analysis-model/evaluation-v2/solidity/model.json',import.meta.url);
const calibrationPath=new URL('../s0ul-1m/reports/analysis-phase-gas-calibration.json',import.meta.url);
const modelBytes=await readFile(modelPath),calibrationBytes=await readFile(calibrationPath);
const model=JSON.parse(modelBytes),calibration=JSON.parse(calibrationBytes);
const CFG='(uint16 vocabSize,uint16 dim,uint16 layers,uint16 heads,uint16 hiddenDim,uint16 maxSeqLen,uint32 epsQ28,uint32 attentionScaleQ14)';
const SCHEMA=id('S0UL-ANALYSIS-FACTS-v1|code:2|native:2|interfaces:16|owner:3|pause:3|implementation:3|asset:3|supply:3|pool:3|delegate:2|writes:2|origin:2|externalCall:2|scan:2|BOS:1|SEP:3|bases:4,6,8,24,27,30,33,36,39,42,44,46,48,50');
function fixture() {
  const shards=Array.from({length:48},(_,i)=>addr(500+i));
  const coder=AbiCoder.defaultAbiCoder(),modelId=keccak256(coder.encode([CFG,'bytes32','bytes32','address[]','bytes32[]','uint32','uint256'],[model.config,model.sourceCheckpoint,model.manifestHash,shards,model.shards.map(s=>s.runtimeKeccak256),model.shardBytes,model.payload.nbytes]));
  const j={format:'s0ul-analysis-mainnet-deployment-v1',chainId:4663,complete:true,pending:null,completedAt:'2026-10-22T12:00:00.000Z',owner:addr(100),modelManifestSha256:sha(modelBytes),modelManifestHash:model.manifestHash,sourceCheckpoint:model.sourceCheckpoint,
    modelId,expectedModelId:modelId,configurationHash:keccak256(coder.encode([CFG],[model.config])),schemaHash:SCHEMA,domainSha256:model.tokenizerDomainSha256,
    shards,reusedShards:[{index:0,address:shards[0]},{index:1,address:shards[1]}],receipts:[],steps:{},predictions:{},startNonce:20,spentWei:'0',buildFingerprint:'a'.repeat(64),planFingerprint:'b'.repeat(64),contracts:{reader:{address:addr(99),codeHash:hash(999)}}};
  const operations=[...Array.from({length:46},(_,i)=>['shard:'+(i+2),shards[i+2]]),...['model','engine','adapter','codec','executor'].map((r,i)=>['deploy:'+r,addr(2000+i)])];
  for(const [i,[key,address]]of operations.entries()) {
    const r={key,nonce:j.startNonce+i,hash:hash(i+1),predictedAddress:address,receipt:{hash:hash(i+1),blockNumber:100+i,blockHash:hash(100+i),status:1,contractAddress:address,gasUsed:'100000',gasPriceWei:'20000000',feeWei:'2000000000000'}};
    j.predictions[key]=address;j.steps[key]=r;j.receipts.push(r);j.spentWei=(BigInt(j.spentWei)+BigInt(r.receipt.feeWei)).toString();
    if(key.startsWith('deploy:'))j.contracts[key.slice(7)]={address,codeHash:hash(500+i),transactionHash:r.hash,blockNumber:r.receipt.blockNumber};
  }
  return {journal:j,calibration:structuredClone(calibration),modelManifest:structuredClone(model),journalSha256:'c'.repeat(64),calibrationSha256:sha(calibrationBytes),modelManifestSha256:sha(modelBytes)};
}

test('normalized release preserves native gas proof and independently binds deployed model identity',()=>{
  const f=fixture(),out=buildAnalysisReleaseConfig(f);
  assert.notEqual(out.modelId,calibration.sourceProof.modelId);assert.equal(out.calibration.modelId,out.modelId);
  assert.deepEqual(out.calibration.sourceProof,calibration.sourceProof);assert.equal(out.configurationHash,f.journal.configurationHash);
  assert.equal(out.shards.length,48);assert.equal(out.worker.serviceVerified,false);assert.equal(out.workerAddress,DEFAULT_ANALYSIS_WORKER);
  assert.equal(out.worker.maxTotalFeeWei,'500000000000000000');assert.equal(out.worker.maxTransactionFeeWei,'2500000000000000');
  assert.equal(out.worker.maxReimbursementShortfallBps,5);
  assert.equal(BigInt(out.worker.maxTotalFeeWei)*BigInt(out.worker.maxReimbursementShortfallBps)/10_000n,250_000_000_000_000n);
  assert.equal(out.publicRpc,'https://rpc.mainnet.chain.robinhood.com');assert.equal(out.worker.statusUrl,'/api/s0ul/worker');
  assert.equal(normalizeAnalysisDeployment(out).modelId,out.modelId);assert.equal(normalizeWorkerDeployment(out).modelId,out.modelId);
  assert.equal(computeAnalysisFunding({calibration:out.calibration,feeCeilingWeiPerGas:1n,maxRewardPerBatchWei:31_000_000n}).measuredGas,11_412_827_766n);
  f.journal.privateKey='not copied';assert.equal(JSON.stringify(buildAnalysisReleaseConfig(f)).includes('not copied'),false);
});

test('incomplete or inconsistent journal never becomes a confirmed config',()=>{
  const mutations=[f=>f.journal.complete=false,f=>f.journal.pending={hash:hash(2)},f=>f.journal.chainId=1,
    f=>f.journal.receipts.pop(),f=>f.journal.receipts[0].receipt.status=0,f=>f.journal.receipts[0].nonce++,
    f=>f.journal.receipts[0].receipt.feeWei='1',f=>f.journal.spentWei='1',f=>f.journal.contracts.executor.transactionHash=hash(44),
    f=>f.journal.shards[0]=addr(9999),f=>f.journal.expectedModelId=hash(4),f=>f.journal.configurationHash=hash(5),f=>f.journal.schemaHash=hash(6),
    f=>f.journal.domainSha256=hash(7),f=>f.journal.sourceCheckpoint=hash(8),f=>f.modelManifestSha256='a'.repeat(64),
    f=>f.calibrationSha256='b'.repeat(64),f=>f.calibration.sourceProof.payloadSha256='0'.repeat(64),
    f=>f.calibration.sourceProof.checkpointSha256=hash(9),f=>f.workerAddress=f.journal.owner];
  for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>buildAnalysisReleaseConfig(f));}
});

test('generator writes equal public/default-server config and keeps service disabled; incomplete input writes neither',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'s0ul-release-config-test-'));
  try {
    const f=fixture(),journalPath=path.join(temp,'journal.json'),outRoot=path.join(temp,'out');
    await writeFile(journalPath,JSON.stringify({...f.journal,complete:false}));
    await assert.rejects(createAnalysisReleaseConfig({journalPath,calibrationPath,modelManifestPath:modelPath,outputRoot:outRoot}),/complete confirmed/);
    await assert.rejects(access(path.join(outRoot,'website/s0ul-analysis-deployment.json')));
    await assert.rejects(access(path.join(outRoot,'netlify/s0ul-analysis-config.mjs')));
    await writeFile(journalPath,JSON.stringify(f.journal));
    const result=await createAnalysisReleaseConfig({journalPath,calibrationPath,modelManifestPath:modelPath,outputRoot:outRoot});
    const publicConfig=JSON.parse(await readFile(result.publicFile));const server=(await import(pathToFileURL(result.serverFile))).default;
    assert.deepEqual(server,publicConfig);assert.equal(server.worker.serviceVerified,false);assert.equal(server.confirmedComplete,true);
    assert.equal(server.worker.maxReimbursementShortfallBps,5);
    assert.equal(server.deploymentEvidence.journalSha256,sha(await readFile(journalPath)));
    assert.equal(result.publicSha256,sha(await readFile(result.publicFile)));assert.equal(result.serverSha256,sha(await readFile(result.serverFile)));
  }finally{await rm(temp,{recursive:true,force:true});}
});
