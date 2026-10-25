// Produces unsigned transactions only. It has no RPC, signing or broadcast path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ContractFactory,Interface,getCreateAddress,keccak256,zeroPadValue} from 'ethers';
import {compile,assertSourcesUnchanged} from './build.mjs';
import {CANARY_CONTRACT,parseCanaryArgs} from './canary-plan.mjs';
import {validateCanaryConfig,checkedOutput,coder,ULN_TYPE,ENDPOINT_ABI,decimal} from './canary-runtime.mjs';
const STATUS='UNSIGNED_CANARY_NEEDS_SECURITY_GAS_AND_OPERATOR_REVIEW';
export async function createCanarySequence({config,nonces,built=compile()}){
  validateCanaryConfig(config,{deployed:false});assert(config.deadline>Math.floor(Date.now()/1000),'Deadline expired');
  assert(nonces&&typeof nonces==='object'&&!Array.isArray(nonces),'Nonce object required');
  assert.deepEqual(Object.keys(nonces).sort(),['opbnb','robinhood'],'Nonce keys must match both chains');
  const manifest=structuredClone(config);
  Object.assign(manifest,{status:STATUS,enabled:false,messagingReviewed:false,budgetApproved:false,compilerSourcesHash:built.compiler.sources_commitment_sha256,compilerVersion:built.compiler.version,publicTransactions:0});
  const ep=new Interface(ENDPOINT_ABI),routerArtifact=built.artifacts[CANARY_CONTRACT],execArtifact=built.artifacts.GH0STSelfRelayExecutor;
  assert(routerArtifact&&execArtifact,'Canary artifacts missing');
  const routerInterface=new Interface(routerArtifact.abi),records=[];
  for(const ch of manifest.chains){assert(decimal(nonces[ch.key]),'Invalid starting nonce');const n=BigInt(nonces[ch.key]);assert(n+8n<(1n<<64n),'Nonce exhausted');ch.startNonce=String(n);ch.router=getCreateAddress({from:manifest.admin,nonce:n});ch.selfRelayExecutor=getCreateAddress({from:manifest.admin,nonce:n+1n});}
  for(const ch of manifest.chains){let nonce=BigInt(ch.startNonce);const txs=[];const append=(kind,to,data,args=null)=>{const record={schemaVersion:1,status:STATUS,chainId:ch.chainId,index:txs.length,from:manifest.admin,nonce:String(nonce++),to,value:'0',data,gas:null,gasPrice:null,maxFeePerGas:null,maxPriorityFeePerGas:null,kind,inputHash:keccak256(data),constructorArgs:args};txs.push(record);return record;};
    const args=[ch.endpoint,manifest.admin,manifest.requester,ch.stage===0,manifest.chains[0].eid,manifest.chains[1].eid,manifest.sessionId,manifest.deadline];
    const create=await new ContractFactory(routerArtifact.abi,routerArtifact.evm.bytecode.object).getDeployTransaction(...args);append('CREATE '+CANARY_CONTRACT,null,create.data,args);
    const remote=manifest.chains[1-ch.stage];const execArgs=[ch.sendLibrary,ch.router,remote.eid,ch.chainId];const createExec=await new ContractFactory(execArtifact.abi,execArtifact.evm.bytecode.object).getDeployTransaction(...execArgs);append('CREATE GH0STSelfRelayExecutor',null,createExec.data,execArgs);
    append('SET_SEND_LIBRARY',ch.endpoint,ep.encodeFunctionData('setSendLibrary',[ch.router,remote.eid,ch.sendLibrary]));
    append('SET_RECEIVE_LIBRARY',ch.endpoint,ep.encodeFunctionData('setReceiveLibrary',[ch.router,remote.eid,ch.receiveLibrary,0]));
    // NIL_DVN_COUNT=255 explicitly disables optional DVNs; zero inherits defaults.
    const uln=coder.encode([ULN_TYPE],[[ch.dvnConfirmations,2,255,0,ch.requiredDVNs,[]]]);
    const exec=coder.encode(['tuple(uint32 maxMessageSize,address executor)'],[[4480,ch.selfRelayExecutor]]);
    append('SET_SEND_ULN_AND_EXECUTOR',ch.endpoint,ep.encodeFunctionData('setConfig',[ch.router,ch.sendLibrary,[{eid:remote.eid,configType:2,config:uln},{eid:remote.eid,configType:1,config:exec}]]));
    append('SET_RECEIVE_ULN',ch.endpoint,ep.encodeFunctionData('setConfig',[ch.router,ch.receiveLibrary,[{eid:remote.eid,configType:2,config:uln}]]));
    append('SET_PEER',ch.router,routerInterface.encodeFunctionData('setPeer',[remote.eid,zeroPadValue(remote.router,32)]));
    append('SEAL_ROUTE_REVIEW_LAST',ch.router,routerInterface.encodeFunctionData('sealRoute'));
    ch.preparedTransactions=txs.map(({data,...r})=>r);ch.endNonceExclusive=String(nonce);records.push({key:ch.key,txs});
  }
  assertSourcesUnchanged(built);return {status:STATUS,transactions:records.reduce((n,x)=>n+x.txs.length,0),manifest,records};
}
export async function prepareCanary({config,nonces,out,built=compile()}){
  const destination=checkedOutput(out,{newDirectory:true});
  const {manifest,records,transactions}=await createCanarySequence({config,nonces,built});
  fs.mkdirSync(destination,{recursive:true});
  fs.writeFileSync(path.join(destination,'INCOMPLETE'),'Preparation in progress\n',{flag:'wx'});
  for(const {key,txs} of records)fs.writeFileSync(path.join(destination,key+'.unsigned.jsonl'),txs.map(x=>JSON.stringify(x)).join('\n')+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(destination,'REVIEW.txt'),'UNSIGNED ONLY. Review all endpoint libraries, both required DVNs, their confirmation/availability policy, fee budgets, EOA nonces and current chain state. The final seal transaction is included but must be submitted only after security configuration has been verified. No model weights or inference engine are deployed. A separately reviewed broadcaster is required. Fill both creation transaction hashes and deploymentBlock before verification. The 20-confirmation template is illustrative, not provider readiness evidence.\n',{flag:'wx'});
  fs.unlinkSync(path.join(destination,'INCOMPLETE'));return {status:STATUS,directory:destination,transactions,manifest};
}
export async function run(args){if(args.length===1&&args[0]==='--help'){console.log('prepare-canary --config=config.json --nonces=nonces.json --out=deployments/new-canary\nOffline unsigned output only. Public addresses, session, challenge, deadline and budgets belong in config; RPC/signing key values stay in environment variables.');return;}const o=parseCanaryArgs(args,['config','nonces','out']);assert(o.config&&o.nonces&&o.out,'config, nonces and out are required');const r=await prepareCanary({config:JSON.parse(fs.readFileSync(o.config)),nonces:JSON.parse(fs.readFileSync(o.nonces)),out:o.out});console.log(JSON.stringify({status:r.status,directory:r.directory,transactions:r.transactions}));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv.slice(2)).catch(()=>{console.error('CANARY_PREPARATION_FAILED: check local config, nonces, output location and source build. No transaction was submitted.');process.exitCode=1;});
