// Read-only, model-free verification. No signer or key is loaded by this module.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Interface,ZeroHash,keccak256,zeroPadValue} from 'ethers';
import {compile,assertSourcesUnchanged} from './build.mjs';
import {verifyCreation} from './verify-deployment.mjs';
import {CANARY_CONTRACT,parseCanaryArgs} from './canary-plan.mjs';
import {CANARY_DOMAIN,CANARY_RAW_OPTIONS,CANARY_OPTIONS,ENDPOINT_ABI,ULN_ABI,validateCanaryConfig,readRpc,equal,requestHash,checkCanaryTransport,reportPath,writeReport} from './canary-runtime.mjs';
export function rpcContract(rpc,blockTag,address,abi){const iface=new Interface(abi);return new Proxy({}, {get:(_,method)=>async(...args)=>{const raw=await rpc.request('eth_call',[{to:address,data:iface.encodeFunctionData(method,args)},blockTag]);const output=iface.decodeFunctionResult(method,raw);return output.length===1?output[0]:output;}});}
export async function verifyCanary({config,built=compile(),rpcFactory=readRpc}){
  validateCanaryConfig(config);assert(config.deadline>Math.floor(Date.now()/1000),'Canary deadline expired');
  assert(config.compilerSourcesHash===built.compiler.sources_commitment_sha256,'Prepared compiler/source commitment differs');
  const routerArtifact=built.artifacts[CANARY_CONTRACT],execArtifact=built.artifacts.GH0STSelfRelayExecutor;
  assert(routerArtifact&&execArtifact,'Audited canary artifacts missing');
  const expectedHash=requestHash(config),chains=[];
  for(const ch of config.chains){const remote=config.chains[1-ch.stage],url=process.env[ch.rpcEnv];assert(typeof url==='string'&&url,'RPC environment variable unavailable');const rpc=rpcFactory(url);
    assert(BigInt(await rpc.request('eth_chainId'))===BigInt(ch.chainId),'RPC chain identity differs');
    const block=await rpc.request('eth_getBlockByNumber',['latest',false]);assert(block&&block.hash&&BigInt(block.timestamp)<=BigInt(config.deadline),'Invalid or expired snapshot');const tag=block.number;
    const r=rpcContract(rpc,tag,ch.router,routerArtifact.abi),e=rpcContract(rpc,tag,ch.selfRelayExecutor,execArtifact.abi),endpoint=rpcContract(rpc,tag,ch.endpoint,ENDPOINT_ABI),sendLibrary=rpcContract(rpc,tag,ch.sendLibrary,ULN_ABI),receiveLibrary=rpcContract(rpc,tag,ch.receiveLibrary,ULN_ABI);
    const externalCodeHashes={};for(const [name,address] of [['endpoint',ch.endpoint],['sendLibrary',ch.sendLibrary],['receiveLibrary',ch.receiveLibrary],...ch.requiredDVNs.map((x,i)=>['dvn'+i,x])]){const code=await rpc.request('eth_getCode',[address,tag]);assert(code&&code!=='0x','Required transport contract has no code');externalCodeHashes[name]=keccak256(code);}
    assert(Number(await endpoint.eid())===ch.eid&&equal(await endpoint.delegates(ch.router),config.admin),'Endpoint EID or delegate differs');
    assert(equal(await r.endpoint(),ch.endpoint)&&equal(await r.owner(),config.admin)&&equal(await r.requester(),config.requester),'Canary authority differs');
    assert(BigInt(await r.deploymentChainId())===BigInt(ch.chainId)&&equal(await r.pendingOwner(),'0x'+'0'.repeat(40)),'Canary chain binding or pending owner differs');
    assert(await r.isHome()===(ch.stage===0)&&Number(await r.homeEid())===config.chains[0].eid&&Number(await r.computeEid())===config.chains[1].eid&&Number(await r.remoteEid())===remote.eid,'Canary route differs');
    assert(equal(await r.sessionId(),config.sessionId)&&BigInt(await r.deadline())===BigInt(config.deadline)&&await r.routeSealed()===true,'Canary session is not sealed or differs');
    assert(equal(await r.peers(remote.eid),zeroPadValue(remote.router,32))&&equal(await r.fixedOptions(),CANARY_OPTIONS),'Canary peer or options differ');
    assert(Number(await r.VERSION())===1&&equal(await r.CANARY_DOMAIN(),CANARY_DOMAIN),'Canary protocol differs');
    assert(equal(await e.sendLibrary(),ch.sendLibrary)&&equal(await e.authorizedOApp(),ch.router)&&Number(await e.remoteEid())===remote.eid&&BigInt(await e.deploymentChainId())===BigInt(ch.chainId),'Executor bindings differ');
    assert(Number(await e.MAX_MESSAGE_BYTES())===4480&&equal(await e.OPTIONS_HASH(),keccak256(CANARY_RAW_OPTIONS)),'Executor constraints differ');
    await checkCanaryTransport({config:ch,endpoint,sendLibrary,receiveLibrary},remote);
    const routerCreation=await verifyCreation({rpc,chain:ch,address:ch.router,transactionHash:ch.routerDeploymentTx,artifact:routerArtifact,blockTag:tag,expectedArgs:a=>assert(a.length===8&&equal(a[0],ch.endpoint)&&equal(a[1],config.admin)&&equal(a[2],config.requester)&&a[3]===(ch.stage===0)&&Number(a[4])===config.chains[0].eid&&Number(a[5])===config.chains[1].eid&&equal(a[6],config.sessionId)&&BigInt(a[7])===BigInt(config.deadline),'Canary constructor differs')});
    const execCreation=await verifyCreation({rpc,chain:ch,address:ch.selfRelayExecutor,transactionHash:ch.selfRelayExecutorDeploymentTx,artifact:execArtifact,blockTag:tag,expectedArgs:a=>assert(a.length===4&&equal(a[0],ch.sendLibrary)&&equal(a[1],ch.router)&&Number(a[2])===remote.eid&&BigInt(a[3])===BigInt(ch.chainId),'Executor constructor differs')});
    assert(equal(routerCreation.deployer,config.admin)&&equal(execCreation.deployer,config.admin),'Deployer differs');
    for(const authority of [config.admin,config.requester])assert(await rpc.request('eth_getCode',[authority,tag])==='0x','Canary authority must be an EOA');
    const state={};for(const field of ['pingSent','pingReceived','ackSent','ackReceived','challenge','requestHash','pingGuid','ackGuid'])state[field]=await r[field]();
    if(ch.stage===0)assert(!state.pingReceived&&!state.ackSent&&(!state.ackReceived||state.pingSent),'Invalid home sequence');
    else assert(!state.pingSent&&!state.ackReceived&&(!state.ackSent||state.pingReceived),'Invalid remote sequence');
    const active=state.pingSent||state.pingReceived;assert(equal(state.challenge,active?config.challenge:ZeroHash)&&equal(state.requestHash,active?expectedHash:ZeroHash),'Canary request commitment differs');
    assert(active?!equal(state.pingGuid,ZeroHash):equal(state.pingGuid,ZeroHash),'Invalid ping GUID');
    assert(state.ackSent||state.ackReceived?!equal(state.ackGuid,ZeroHash):equal(state.ackGuid,ZeroHash),'Invalid ack GUID');
    const received=ch.stage===0?state.ackReceived:state.pingReceived;if(received)assert(await r.acceptedGuid(ch.stage===0?state.ackGuid:state.pingGuid),'Missing accepted GUID');
    const fresh=await rpc.request('eth_getBlockByNumber',[tag,false]);assert(equal(fresh.hash,block.hash),'Verification snapshot reorganized');
    chains.push({key:ch.key,chainId:ch.chainId,router:ch.router,selfRelayExecutor:ch.selfRelayExecutor,routerCodeHash:routerCreation.codeHash,selfRelayExecutorCodeHash:execCreation.codeHash,routerDeploymentTx:routerCreation.deploymentTx,selfRelayExecutorDeploymentTx:execCreation.deploymentTx,verifiedBlock:Number(BigInt(tag)),verifiedBlockHash:block.hash,externalCodeHashes,state});
  }
  assert(!chains[1].state.pingReceived||chains[0].state.pingSent,'Remote request has no home request');
  assert(!chains[0].state.ackReceived||chains[1].state.ackSent,'Home acknowledgement has no remote send');
  if(chains[1].state.pingReceived)assert(equal(chains[0].state.pingGuid,chains[1].state.pingGuid),'Ping GUID differs across chains');
  if(chains[0].state.ackReceived)assert(equal(chains[0].state.ackGuid,chains[1].state.ackGuid),'Ack GUID differs across chains');
  assertSourcesUnchanged(built);
  return {schemaVersion:1,status:'PASS_VERIFIED_CANARY',checkedAt:new Date().toISOString(),routeId:config.routeId,sessionId:config.sessionId,challenge:config.challenge,requestHash:expectedHash,compilerSourcesHash:built.compiler.sources_commitment_sha256,chains,roundTripComplete:chains[0].state.ackReceived,operatorLivenessProven:chains[0].state.ackReceived,scope:'Exact compiled creation/runtime and current explicit transport configuration. Operator liveness is only demonstrated by the completed real round trip; RPC snapshots are trusted.',publicTransactions:0,readOnly:true};
}
export async function run(args){if(args.length===1&&args[0]==='--help'){console.log('verify-canary --config=deployments/canary/manifest.json\nRead-only exact code, creation, two-DVN and endpoint configuration verification.');return;}const o=parseCanaryArgs(args,['config']);assert(o.config,'config required');const config=JSON.parse(fs.readFileSync(o.config));validateCanaryConfig(config);const file=reportPath(o.config,config);writeReport(file,{status:'VERIFYING',readOnly:true});try{const report=await verifyCanary({config});writeReport(file,report);console.log(JSON.stringify({status:report.status,roundTripComplete:report.roundTripComplete,file}));}catch{writeReport(file,{status:'VERIFICATION_FAILED',readOnly:true});throw Error('Canary verification failed');}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv.slice(2)).catch(()=>{console.error('CANARY_VERIFICATION_FAILED: check exact source, creation receipts, identities, both explicit transport configurations and deadline.');process.exitCode=1;});
