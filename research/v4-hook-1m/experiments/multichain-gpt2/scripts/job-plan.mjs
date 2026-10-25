// Canonical offline two-chain job plan. Complete model arithmetic lives on the selected trusted compute chain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {makePlan, MODEL_ID, canonicalJson, ROOT} from './plan.mjs';
export {MODEL_ID, canonicalJson};
export const JOB_KIND = 'whole-model-job';
export const JOB_ROUTE_ID = '0xf5b94dee310f46242db944e8f0ab81c1b3990a30fef940ffa9f5c9c2d8ffea5c';
export const JOB_ROUTER = 'GPT2JobOApp';
export const JOB_ROUTE_IDS=Object.freeze({monad:JOB_ROUTE_ID,opbnb:'0x453a7f8f39b85f2d93cab49818218515a51803f3016723d96f6ba0ed0a736240'});
export const TRUSTED_COMPUTE_CHAINS=Object.freeze({
  monad:Object.freeze({key:'monad',stage:1,role:'compute',chainId:143,eid:30390,endpointV2:'0x6f475642a6e85809b1c36fa62763669b1b48dd5b',rpcEnv:'MONAD_RPC_URL',profile:'monad',maxTransactionGas:'30000000',layerRange:Object.freeze([0,12]),doesEmbedding:true,doesOutput:true}),
  opbnb:Object.freeze({key:'opbnb',stage:1,role:'compute',chainId:204,eid:30202,endpointV2:'0x1a44076050125825900e736c501f859c50fe728c',rpcEnv:'OPBNB_RPC_URL',profile:'ethereum',maxTransactionGas:'16777216',layerRange:Object.freeze([0,12]),doesEmbedding:true,doesOutput:true}),
});
export const TRUSTED_JOB_TRANSPORT=Object.freeze({
  robinhood:Object.freeze({sendLibrary:'0xc39161c743d0307eb9bcc9fef03eeb9dc4802de7',receiveLibrary:'0xe1844c5d63a9543023008d332bd3d2e6f1fe1043',requiredDVNs:Object.freeze(['0x1258a278519c7f4bd997a9c3bfd4aa802a028d89','0xd01ae6905d48315f7be10c7330aecf8360ef5b12'])}),
  monad:Object.freeze({sendLibrary:'0xc39161c743d0307eb9bcc9fef03eeb9dc4802de7',receiveLibrary:'0xe1844c5d63a9543023008d332bd3d2e6f1fe1043',requiredDVNs:Object.freeze(['0x282b3386571f7f794450d5789911a9804fa346b4','0xdcdd4628f858b45260c31d6ad076bd2c3d3c2f73'])}),
  opbnb:Object.freeze({sendLibrary:'0x44289609cc6781fa2c665796b6c5aabf9ffcedc5',receiveLibrary:'0x9c9e25f9fc4e8134313c2a9f5c719f5c9f4fbd95',requiredDVNs:Object.freeze(['0x3ebb618b5c9d09de770979d552b27d6357aff73b','0xdd7b5e1db4aafd5c8ec3b764efb8ed265aa5445b'])}),
});
const HOME=Object.freeze({key:'robinhood',stage:0,role:'home',chainId:4663,eid:30416,endpointV2:'0x6f475642a6e85809b1c36fa62763669b1b48dd5b',rpcEnv:'RH_RPC_URL',profile:'ethereum',maxTransactionGas:'16777216',layerRange:Object.freeze([0,0]),doesEmbedding:false,doesOutput:false});
export function jobChains(computeChain='monad') {
  assert(Object.hasOwn(TRUSTED_COMPUTE_CHAINS,computeChain),'Compute chain is not allowlisted');
  return [HOME,TRUSTED_COMPUTE_CHAINS[computeChain]].map(chain=>({...chain,...TRUSTED_JOB_TRANSPORT[chain.key],requiredDVNs:[...TRUSTED_JOB_TRANSPORT[chain.key].requiredDVNs],layerRange:[...chain.layerRange]}));
}
export const JOB_CHAINS=Object.freeze(jobChains().map(Object.freeze));
export function makeJobPlan(dataDirectory,{verify=true,computeChain='monad'}={}) {
  // Reuse the fully checked canonical model layout and byte validation; no arbitrary model/config is accepted.
  const checked=makePlan(dataDirectory,{verify,configuration:JSON.parse(fs.readFileSync(path.join(ROOT,'config/chains.json')))});
  const manifest=JSON.parse(fs.readFileSync(path.join(dataDirectory,'manifest.json')));
  const tensors=manifest.tensors.map(t=>({id:t.id,name:t.name,sha256:t.sha256,bytes:t.bytes,shards:t.shards.length}));
  const stages=jobChains(computeChain).map(chain=>({...chain,layerRange:[...chain.layerRange],
    tensorIds:chain.role==='compute'?tensors.map(t=>t.id):[],tensors:chain.role==='compute'?tensors:[],
    payloadBytes:chain.role==='compute'?tensors.reduce((n,t)=>n+t.bytes,0):0,
    weightContracts:chain.role==='compute'?tensors.reduce((n,t)=>n+t.shards,0):0,
    catalogContracts:chain.role==='compute'?1+tensors.reduce((n,t)=>n+1+(t.shards>767?Math.ceil(t.shards/767):0),0):0,
  }));
  const routeIdentity={version:2,kind:JOB_KIND,packetVersion:2,modelId:MODEL_ID,stages:stages.map(s=>({
    chainId:s.chainId,eid:s.eid,role:s.role,layerRange:s.layerRange,doesEmbedding:s.doesEmbedding,doesOutput:s.doesOutput,
    tensors:s.tensors.map(t=>({id:t.id,sha256:t.sha256})),
  }))};
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(stages[1].payloadBytes,checked.totals.uniquePayloadBytes);
  if(JOB_ROUTE_IDS[computeChain])assert.equal('0x'+sha(canonicalJson(routeIdentity)),JOB_ROUTE_IDS[computeChain],'Canonical job route identity changed');
  return {schemaVersion:2,status:'OFFLINE_VALIDATED_JOB_PLAN',routeKind:JOB_KIND,routerContract:JOB_ROUTER,packetVersion:2,
    computeChain,modelId:MODEL_ID,routeId:'0x'+sha(canonicalJson(routeIdentity)),routeIdentity,
    uniqueParameters:checked.uniqueParameters,checkpointSha256:checked.checkpointSha256,manifestSha256:checked.manifestSha256,
    verifiedAllWeights:verify,managedExecutorStatus:computeChain==='opbnb'?'UNSUPPORTED_IN_RESEARCH_SNAPSHOT':'REQUIRES_PATHWAY_REVIEW',stages,totals:{payloadBytes:stages[1].payloadBytes,uniquePayloadBytes:stages[1].payloadBytes,
      duplicatedPayloadBytes:0,weightContracts:stages[1].weightContracts,catalogContracts:stages[1].catalogContracts,
      inferenceContracts:3,routers:2,engines:1,messagesPerJob:2},
    limits:{maxContext:1024,maxTokenIdExclusive:50257,receiveGas:500000,packetBytesForPackedTokenCount:'384 + 32 * ceil(tokenCount / 8)'},
    publicTransactions:0,note:'Offline plan only. Whole-model compute, prefill and decode remain onchain; fees and deployed delivery require separate verification.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);assert(args.every(x=>/^--(?:data|out|compute)=.+/.test(x)),'Unknown job-plan option');
  for(const key of ['data','out','compute'])assert(args.filter(x=>x.startsWith('--'+key+'=')).length<=1,'Duplicate option');
  const data=path.resolve(args.find(x=>x.startsWith('--data='))?.slice(7)??path.join(ROOT,'data'));
  const output=path.resolve(ROOT,args.find(x=>x.startsWith('--out='))?.slice(6)??'reports/job-plan.json');
  assert(output.startsWith(ROOT+path.sep),'Output must stay in this project');
  const computeChain=args.find(x=>x.startsWith('--compute='))?.slice(10)??'monad';
  const plan=makeJobPlan(data,{computeChain});fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(plan,null,2)+'\n');
  console.log(JSON.stringify({status:plan.status,routeId:plan.routeId,totals:plan.totals,output},null,2));
}
