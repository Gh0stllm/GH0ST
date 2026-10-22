import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {AbiCoder,ZeroAddress,getAddress,id,keccak256} from 'ethers';
import {ANALYSIS_CHECKPOINT,ANALYSIS_MANIFEST_HASH,ANALYSIS_DOMAIN,ANALYSIS_RPC_URLS,normalizeWorkerDeployment} from '../s0ul-1m/scripts/analysis-worker.mjs';
import {computeAnalysisFunding,normalizeAnalysisDeployment} from '../website/s0ul-analysis-client.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MODEL_SHA='9b6090a7639245180a6dbcc1ae69f379d3b9c5bd4c1c5981c78aa7035b50b97d';
const CALIBRATION_SHA='e00dea7507fe4d30d683f241603a0dee5607c210b231858ad86b8a0cb014d7aa';
const PAYLOAD_SHA='b83416a49a7600136a9eb26c8d13b260ed4d4933ec0b1bff7fb5b6419579d901';
const CONFIG='(uint16 vocabSize,uint16 dim,uint16 layers,uint16 heads,uint16 hiddenDim,uint16 maxSeqLen,uint32 epsQ28,uint32 attentionScaleQ14)';
const SCHEMA=id('S0UL-ANALYSIS-FACTS-v1|code:2|native:2|interfaces:16|owner:3|pause:3|implementation:3|asset:3|supply:3|pool:3|delegate:2|writes:2|origin:2|externalCall:2|scan:2|BOS:1|SEP:3|bases:4,6,8,24,27,30,33,36,39,42,44,46,48,50');
const ROLES=['model','engine','adapter','codec','executor'];
const HASH=/^0x[0-9a-fA-F]{64}$/;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clean=value=>JSON.parse(JSON.stringify(value));
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const hash=value=>{requireThat(HASH.test(value??'')&&!/^0x0{64}$/i.test(value),'Missing nonzero bytes32 identity');return value;};
const address=value=>{const a=getAddress(value);requireThat(a!==ZeroAddress,'Zero deployment address');return a;};
export const DEFAULT_ANALYSIS_WORKER='0xA5c5882973c671306E7C1eA2093904470C29d857';

/** Offline normalization only. The deployment tool must already have verified
 * every live receipt, shard and immutable before setting journal.complete. */
export function buildAnalysisReleaseConfig({journal:j,calibration:c,modelManifest:m,
  journalSha256,calibrationSha256,modelManifestSha256,workerAddress=DEFAULT_ANALYSIS_WORKER}) {
  requireThat(j?.format==='s0ul-analysis-mainnet-deployment-v1'&&j.chainId===4663&&j.complete===true&&j.pending===null,'A complete confirmed chain4663 deployment journal with no pending transaction is required');
  requireThat(Number.isFinite(Date.parse(j.completedAt)),'Missing journal completion time');
  requireThat(/^[0-9a-f]{64}$/.test(journalSha256??'')&&calibrationSha256===CALIBRATION_SHA&&modelManifestSha256===MODEL_SHA,'Release evidence file hashes differ from the reviewed inputs');
  requireThat(j.modelManifestSha256===MODEL_SHA&&same(j.modelManifestHash,ANALYSIS_MANIFEST_HASH)&&same(j.sourceCheckpoint,ANALYSIS_CHECKPOINT),'Journal model source identity differs');
  requireThat(same(m?.manifestHash,ANALYSIS_MANIFEST_HASH)&&same(m.sourceCheckpoint,ANALYSIS_CHECKPOINT)&&same(m.tokenizerDomainSha256,ANALYSIS_DOMAIN)&&m.payload?.sha256===PAYLOAD_SHA,'Model payload/manifest/checkpoint/domain differs');
  requireThat(m.shards?.length===48&&j.shards?.length===48,'The complete 48-shard model is required');
  const deployer=address(j.owner),worker=address(workerAddress);
  requireThat(!same(deployer,worker),'The dedicated worker must differ from the deployer');
  const shards=j.shards.map(address),cfgHash=keccak256(AbiCoder.defaultAbiCoder().encode([CONFIG],[m.config]));
  const derivedModelId=keccak256(AbiCoder.defaultAbiCoder().encode([CONFIG,'bytes32','bytes32','address[]','bytes32[]','uint32','uint256'],[m.config,m.sourceCheckpoint,m.manifestHash,shards,m.shards.map(s=>hash(s.runtimeKeccak256)),m.shardBytes,m.payload.nbytes]));
  requireThat(same(j.modelId,derivedModelId)&&same(j.expectedModelId,derivedModelId)&&same(j.configurationHash,cfgHash)&&same(j.domainSha256,ANALYSIS_DOMAIN)&&same(j.schemaHash,SCHEMA),'Deployed model/config/domain/schema identity differs');
  requireThat(Array.isArray(j.receipts)&&j.receipts.length===51&&Object.keys(j.steps??{}).length===51&&Number.isSafeInteger(j.startNonce),'All 51 confirmed deployment operations are required');
  const seen=new Set();let spent=0n;
  for(const [index,r]of j.receipts.entries()) {
    requireThat(typeof r.key==='string'&&!seen.has(r.key)&&r.nonce===j.startNonce+index&&same(r.predictedAddress,j.predictions?.[r.key]),'Deployment operation identity/order differs');
    requireThat(HASH.test(r.hash??'')&&same(r.receipt?.hash,r.hash)&&r.receipt.status===1&&HASH.test(r.receipt.blockHash??'')&&Number.isSafeInteger(r.receipt.blockNumber)&&same(r.receipt.contractAddress,r.predictedAddress),'Deployment operation lacks a successful confirmed receipt');
    requireThat(JSON.stringify(j.steps[r.key])===JSON.stringify(r),'Journal step/receipt differs');
    const fee=BigInt(r.receipt.gasUsed)*BigInt(r.receipt.gasPriceWei);
    requireThat(fee===BigInt(r.receipt.feeWei),'Deployment receipt fee accounting differs');spent+=fee;seen.add(r.key);
  }
  requireThat(spent===BigInt(j.spentWei),'Journal total deployment fee differs');
  const contracts={};
  for(const role of [...ROLES,'reader']) {
    const item=j.contracts?.[role];contracts[role]={address:address(item?.address),codeHash:hash(item?.codeHash)};
    if(role!=='reader') {
      const r=j.steps['deploy:'+role];
      requireThat(r&&same(r.hash,item.transactionHash)&&same(r.predictedAddress,item.address)&&r.receipt.blockNumber===item.blockNumber,'Contract does not match confirmed deployment operation: '+role);
    }
  }
  requireThat(c?.result==='PASS'&&c.complete===true&&c.localOnly===true&&c.sourceProof?.payloadSha256===PAYLOAD_SHA&&same(c.sourceProof.checkpointSha256,ANALYSIS_CHECKPOINT)&&c.rewardPolicy?.includesRewardOverhead===true,'Calibration does not prove the reviewed payload/checkpoint and reimbursement policy');
  const calibrated={format:'s0ul-analysis-release-gas-calibration-v1',modelId:derivedModelId,
    source:'s0ul-1m/reports/analysis-phase-gas-calibration.json',sourceSha256:calibrationSha256,
    sourceProof:clean(c.sourceProof),observed:clean(c.observed),rewardPolicy:clean(c.rewardPolicy),
    includesRewardOverhead:true,maxPosition:c.observed.maxProcessedPosition,
    maxMeasuredGasByPhase:clean(c.rawMaxMeasuredGasByPhase),
    attentionGasPerExtraPosition:c.attentionOperationalEnvelope.gasPerPosition,
    attentionBaseMeasuredGas:c.attentionOperationalEnvelope.interceptIncludingRewardOverhead,
    attentionOperationalEnvelope:clean(c.attentionOperationalEnvelope),
    limits:clean(c.limits),modelBinding:{deployedModelId:derivedModelId,sourceModelId:c.sourceProof.modelId,
      modelManifestHash:ANALYSIS_MANIFEST_HASH,modelManifestSha256:MODEL_SHA,sourceCheckpoint:ANALYSIS_CHECKPOINT,payloadSha256:PAYLOAD_SHA,
      note:'Address-bound deployed modelId differs from local sourceProof.modelId; verified payload, model manifest and configuration are identical.'}};
  // Validate every phase, extrapolation policy and exact dimensions before any
  // config file is written. This is an estimated budget, never a gas guarantee.
  computeAnalysisFunding({promptTokens:16,maxNewTokens:32,feeCeilingWeiPerGas:1n,maxRewardPerBatchWei:31_000_000n,calibration:calibrated});
  const config={format:'s0ul-analysis-release-deployment-v1',chainId:4663,confirmedComplete:true,
    completedAt:j.completedAt,publicRpc:ANALYSIS_RPC_URLS[0],deployer,workerAddress:worker,
    modelId:derivedModelId,domainSha256:ANALYSIS_DOMAIN,schemaHash:SCHEMA,configurationHash:cfgHash,
    sourceCheckpoint:ANALYSIS_CHECKPOINT,modelManifestHash:ANALYSIS_MANIFEST_HASH,modelManifestSha256:MODEL_SHA,
    payloadSha256:PAYLOAD_SHA,configuration:clean(m.config),contracts,shards:m.shards.map((s,i)=>({index:i,address:shards[i],codeHash:s.runtimeKeccak256})),
    calibration:calibrated,quotePolicy:{feeCeilingBps:12500,gasReserveBps:12000},
    worker:{address:worker,serviceVerified:false,statusUrl:'/api/s0ul/worker',triggerUrl:'/api/s0ul/worker',
      maxTotalFeeWei:'500000000000000000',maxTransactionFeeWei:'2500000000000000',maxReimbursementShortfallBps:5},
    deploymentEvidence:{journalPath:'s0ul-1m/deployments/robinhood-mainnet-analysis.json',journalSha256,
      buildFingerprint:j.buildFingerprint,planFingerprint:j.planFingerprint,confirmedOperations:51,
      offlineGenerator:true,liveReverificationPerformedByGenerator:false},
    limits:['Finite synthetic-policy model; not validated general contract intelligence or a security audit.',
      'A confirmed infrastructure deployment does not establish a funded, verified continuation service.',
      'The worker remains disabled until separate signer provisioning and production platform checks are complete.',
      'Calibrated funding is an operational estimate; pauses, reviewed top-ups and owner refunds remain possible.']};
  normalizeAnalysisDeployment(config);normalizeWorkerDeployment(config);
  return config;
}

export async function createAnalysisReleaseConfig({journalPath=path.join(ROOT,'s0ul-1m/deployments/robinhood-mainnet-analysis.json'),
  calibrationPath=path.join(ROOT,'s0ul-1m/reports/analysis-phase-gas-calibration.json'),
  modelManifestPath=path.join(ROOT,'s0ul-1m/analysis-model/evaluation-v2/solidity/model.json'),
  outputRoot=ROOT,workerAddress=DEFAULT_ANALYSIS_WORKER}={}) {
  const [journalBytes,calibrationBytes,modelBytes]=await Promise.all([readFile(journalPath),readFile(calibrationPath),readFile(modelManifestPath)]);
  const config=buildAnalysisReleaseConfig({journal:JSON.parse(journalBytes),calibration:JSON.parse(calibrationBytes),modelManifest:JSON.parse(modelBytes),journalSha256:sha(journalBytes),calibrationSha256:sha(calibrationBytes),modelManifestSha256:sha(modelBytes),workerAddress});
  const publicFile=path.join(outputRoot,'website/s0ul-analysis-deployment.json'),serverFile=path.join(outputRoot,'netlify/s0ul-analysis-config.mjs');
  const publicText=JSON.stringify(config,null,2)+'\n',serverText='// Generated from a complete verified journal. No signing credential is stored here.\nexport default '+JSON.stringify(config,null,2)+';\n';
  for(const [file,contents]of [[publicFile,publicText],[serverFile,serverText]]){await mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp-'+process.pid;await writeFile(temp,contents,{mode:0o644});await rename(temp,file);}
  return {publicFile,serverFile,modelId:config.modelId,workerAddress:config.workerAddress,serviceVerified:false,publicSha256:sha(publicText),serverSha256:sha(serverText)};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {
    const options={},flags={'journal':'journalPath','calibration':'calibrationPath','model-manifest':'modelManifestPath','worker-address':'workerAddress'};
    for(let i=2;i<process.argv.length;i++){const name=process.argv[i].replace(/^--/,'');if(!process.argv[i].startsWith('--')||!flags[name]||options[flags[name]]!==undefined||!process.argv[i+1])throw Error('Unsupported, repeated or missing flag value');options[flags[name]]=process.argv[++i];}
    console.log(JSON.stringify(await createAnalysisReleaseConfig(options),null,2));
  }catch(error){console.error(String(error.message));process.exitCode=1;}
}
