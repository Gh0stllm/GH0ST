// Optional self-operated LayerZero delivery. Never fabricates DVN attestations.
// Default: read-only. Paid mode still requires the real configured two-DVN quorum.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AbiCoder,Contract,Interface,JsonRpcProvider,Wallet,NonceManager,ZeroHash,dataSlice,getAddress,getBytes,keccak256,zeroPadValue} from 'ethers';
import {compile,HERE,assertSourcesUnchanged} from './build.mjs';
import {MODEL_ID,TRUSTED_JOB_TRANSPORT} from './job-plan.mjs';
import {validateJobRuntimeConfig,verifyJobDeployment,jobReportPath,atomicJobReport} from './verify-job-deployment.mjs';
import {JOB_PACKET_TYPE,jobFeeOverrides} from './job-worker.mjs';
import {gasLimitForEstimate} from './worker.mjs';
const coder=AbiCoder.defaultAbiCoder();
const equal=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const ULN_CONFIG_TYPE='tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)';
export const ENDPOINT_RELAY_ABI=[
  'event PacketSent(bytes encodedPayload,bytes options,address sendLibrary)',
  'function getSendLibrary(address,uint32) view returns(address)',
  'function getReceiveLibrary(address,uint32) view returns(address,bool)',
  'function inboundPayloadHash(address,uint32,bytes32,uint64) view returns(bytes32)',
  'function lazyInboundNonce(address,uint32,bytes32) view returns(uint64)',
  'function lzReceive(tuple(uint32 srcEid,bytes32 sender,uint64 nonce),address,bytes32,bytes,bytes) payable',
];
export const ULN_RELAY_ABI=[
  `function getUlnConfig(address,uint32) view returns(${ULN_CONFIG_TYPE})`,
  `function verifiable(${ULN_CONFIG_TYPE},bytes32,bytes32) view returns(bool)`,
  'function commitVerification(bytes,bytes32)',
  'function getExecutorConfig(address,uint32) view returns(tuple(uint32 maxMessageSize,address executor))',
  'function isSupportedEid(uint32) view returns(bool)',
];
export const FIXED_OPTIONS='0x0003010011010000000000000000000000000007a120';
function addr(word) {assert(/^0x0{24}[0-9a-fA-F]{40}$/.test(word),'Noncanonical address word');return getAddress('0x'+word.slice(-40));}
export function decodeRelayPacket(encoded,source,destination,config) {
  assert(typeof encoded==='string'&&/^0x(?:[0-9a-fA-F]{2})+$/.test(encoded),'Malformed packet bytes');
  const bytes=getBytes(encoded);assert(bytes.length>=113+416&&bytes.length<=113+4480,'Packet size outside job bounds');
  assert(bytes[0]===1,'Wrong LayerZero packet version');
  const nonce=BigInt(dataSlice(encoded,1,9)),srcEid=Number(BigInt(dataSlice(encoded,9,13))),sender=dataSlice(encoded,13,45);
  const dstEid=Number(BigInt(dataSlice(encoded,45,49))),receiver=dataSlice(encoded,49,81),guid=dataSlice(encoded,81,113);
  assert(nonce>0n&&srcEid===source.eid&&dstEid===destination.eid,'Packet route mismatch');
  assert(equal(addr(sender),source.router)&&equal(addr(receiver),destination.router),'Packet OApp mismatch');
  assert(equal(guid,keccak256(dataSlice(encoded,1,81))),'Packet GUID mismatch');
  const header=dataSlice(encoded,0,81),message=dataSlice(encoded,113),packet=coder.decode([JOB_PACKET_TYPE],message)[0];
  assert(equal(coder.encode([JOB_PACKET_TYPE],[packet]),message),'Noncanonical job packet');
  assert(Number(packet.version)===2&&Number(packet.kind)===(source.role==='home'?1:2),'Job packet kind mismatch');
  for(const field of ['modelId','routeId','sessionId'])assert(equal(packet[field],config[field]),'Job packet identity mismatch');
  const tokens=getBytes(packet.tokens);assert(tokens.length>=4&&tokens.length<=4096&&tokens.length%4===0,'Invalid packed token length');
  for(let i=0;i<tokens.length;i+=4)assert(new DataView(tokens.buffer,tokens.byteOffset+i,4).getUint32(0)<50257,'Invalid packed token ID');
  const count=tokens.length/4,maxNewTokens=Number(packet.maxNewTokens);
  assert(maxNewTokens>=1&&maxNewTokens<=1024&&packet.trace!==ZeroHash,'Invalid job bounds');
  const expectedJobId=keccak256(coder.encode(['bytes32','bytes32','bytes32','bytes32','uint32'],[config.routeId,MODEL_ID,config.sessionId,packet.promptHash,maxNewTokens]));
  assert(equal(packet.jobId,expectedJobId),'Job hash mismatch');
  if(source.role==='home') {
    assert(equal(keccak256(packet.tokens),packet.promptHash)&&count+maxNewTokens-1<=1024,'Request prompt mismatch');
    assert(equal(packet.trace,keccak256(coder.encode(['string','bytes32'],['GH0ST_JOB_V2',expectedJobId]))),'Request trace mismatch');
  } else assert(count===maxNewTokens,'Result output count mismatch');
  return {encoded,header,headerHash:keccak256(header),guid,message,payloadHash:keccak256(dataSlice(encoded,81)),
    origin:{srcEid,sender,nonce},receiver:addr(receiver),packet};
}
export function validateTwoDvnConfig(actual,chain) {
  const expected=TRUSTED_JOB_TRANSPORT[chain.key];assert(expected,'Untrusted transport chain');
  assert(Number(actual.requiredDVNCount)===2&&Number(actual.optionalDVNCount)===0&&Number(actual.optionalDVNThreshold)===0,'Exactly two required DVNs are mandatory');
  assert(actual.requiredDVNs.length===2&&actual.optionalDVNs.length===0,'Unexpected DVN array length');
  assert(equal(actual.requiredDVNs[0],expected.requiredDVNs[0])&&equal(actual.requiredDVNs[1],expected.requiredDVNs[1]),'Required official DVNs differ');
  assert(BigInt(actual.confirmations)===BigInt(chain.dvnConfirmations)&&BigInt(actual.confirmations)>0n,'DVN confirmation policy differs');
  return actual;
}
export async function chooseRelayAction(destination,packet) {
  const {router,endpoint,receiveLibrary,config}=destination;
  if(await router.acceptedGuid(packet.guid))return {kind:'delivered'};
  const hash=await endpoint.inboundPayloadHash(config.router,packet.origin.srcEid,packet.origin.sender,packet.origin.nonce);
  if(equal(hash,packet.payloadHash))return {kind:'deliver',target:endpoint,method:'lzReceive',args:[packet.origin,config.router,packet.guid,packet.message,'0x']};
  assert(equal(hash,ZeroHash),'Endpoint holds a different or nil payload');
  assert(BigInt(await endpoint.lazyInboundNonce(config.router,packet.origin.srcEid,packet.origin.sender))<packet.origin.nonce,'Nonce already cleared without this job acceptance');
  const decoded=validateTwoDvnConfig(await receiveLibrary.getUlnConfig(config.router,packet.origin.srcEid),config);
  // Copy immutable ethers Results before its argument resolver normalizes
  // nested address arrays for the next contract call.
  const uln={confirmations:decoded.confirmations,requiredDVNCount:decoded.requiredDVNCount,
    optionalDVNCount:decoded.optionalDVNCount,optionalDVNThreshold:decoded.optionalDVNThreshold,
    requiredDVNs:Array.from(decoded.requiredDVNs),optionalDVNs:Array.from(decoded.optionalDVNs)};
  if(!await receiveLibrary.verifiable(uln,packet.headerHash,packet.payloadHash))return {kind:'waiting-dvns'};
  return {kind:'commit',target:receiveLibrary,method:'commitVerification',args:[packet.header,packet.payloadHash]};
}
export async function sendRelayAction(connection,action) {
  assert(connection.execute===true,'Paid relay is disabled');
  assert((action.kind==='commit'&&action.method==='commitVerification')||(action.kind==='deliver'&&action.method==='lzReceive'),'Unsupported relay action');
  const ceiling=BigInt(connection.config.maxTransactionGas),method=action.target[action.method];
  const estimate=await method.estimateGas(...action.args,{gasLimit:ceiling,value:0n});
  const gasLimit=gasLimitForEstimate(estimate,ceiling,connection.config.key==='monad'&&connection.config.chainId===143);
  await method.staticCall(...action.args,{gasLimit,value:0n});
  const fees=await jobFeeOverrides(connection);
  const receipt=await (await method(...action.args,{gasLimit,value:0n,...fees})).wait(connection.config.confirmations);
  assert(receipt&&receipt.status===1,'Relay transaction failed');
  console.log(JSON.stringify({status:'RELAY_MINED',chain:connection.config.key,action:action.kind,hash:receipt.hash,gasUsed:String(receipt.gasUsed)}));
}
async function checkTransport(connection,remote) {
  const {config,endpoint,sendLibrary,receiveLibrary}=connection;
  assert(equal(await endpoint.getSendLibrary(config.router,remote.config.eid),config.sendLibrary),'Source message library changed');
  assert(equal((await endpoint.getReceiveLibrary(config.router,remote.config.eid))[0],config.receiveLibrary),'Receive message library changed');
  assert(await sendLibrary.isSupportedEid(remote.config.eid)&&await receiveLibrary.isSupportedEid(remote.config.eid),'ULN pathway is unsupported');
  validateTwoDvnConfig(await sendLibrary.getUlnConfig(config.router,remote.config.eid),config);
  validateTwoDvnConfig(await receiveLibrary.getUlnConfig(config.router,remote.config.eid),config);
  const executor=await sendLibrary.getExecutorConfig(config.router,remote.config.eid);
  assert(equal(executor.executor,config.selfRelayExecutor)&&Number(executor.maxMessageSize)>=4480,'Self-relay executor configuration differs');
}
async function bindToCurrentJob(source,destination,decoded) {
  const p=decoded.packet;
  assert(equal(await source.router.jobId(),p.jobId)&&equal(await source.router.promptHash(),p.promptHash)
    &&Number(await source.router.maxNewTokens())===Number(p.maxNewTokens),'Source job state differs');
  if(await destination.router.requested())assert(equal(await destination.router.jobId(),p.jobId),'Destination job state differs');
  if(source.config.role==='compute')assert(await source.router.completed()&&await source.router.resultDispatched(),'Result was not dispatched');
}
async function sourcePackets(source,destination,config,{txHash,guid}) {
  const iface=source.endpoint.interface,latest=await source.provider.getBlockNumber(),window=Number(source.config.maxLogRange??2000);
  assert(Number.isSafeInteger(window)&&window>=1&&window<=10000,'Invalid log window');
  const topic=iface.getEvent('PacketSent').topicHash;
  const parse=async(log)=>{
    if(!equal(log.address,source.config.endpoint)||log.topics[0]!==topic)return null;
    const args=iface.parseLog(log).args,raw=args.encodedPayload;
    if(getBytes(raw).length<113||!equal(dataSlice(raw,13,45),zeroPadValue(source.config.router,32)))return null;
    const packet=decodeRelayPacket(raw,source.config,destination.config,config);
    if(guid&&!equal(guid,packet.guid))return null;
    assert(equal(args.sendLibrary,source.config.sendLibrary)&&equal(args.options,FIXED_OPTIONS),'Source event transport differs');
    const receipt=await source.provider.getTransactionReceipt(log.transactionHash);
    assert(receipt&&receipt.status===1,'Source transaction failed');
    const block=await source.provider.getBlock(receipt.blockNumber);
    assert(block&&equal(block.hash,receipt.blockHash),'Source event was reorganized');
    if(latest-receipt.blockNumber+1<source.config.dvnConfirmations)return null;
    await bindToCurrentJob(source,destination,packet);return packet;
  };
  if(txHash) {
    const receipt=await source.provider.getTransactionReceipt(txHash);assert(receipt&&receipt.status===1,'Source receipt unavailable');
    const packets=[];for(const log of receipt.logs){const p=await parse(log);if(p)packets.push(p);}return packets;
  }
  for(let to=latest;to>=source.config.deploymentBlock;to-=window) {
    const from=Math.max(source.config.deploymentBlock,to-window+1);
    const logs=await source.provider.getLogs({address:source.config.endpoint,topics:[topic],fromBlock:from,toBlock:to});
    const packets=[];for(const log of logs){const p=await parse(log);if(p)packets.push(p);}if(packets.length)return packets;
  }
  return [];
}
function parseArgs(args) {
  if(args.length===1&&args[0]==='--help')return {help:true};
  const keys=['config','data','source','tx','guid','interval-ms'];
  assert(args.every(x=>['--execute','--once','--watch'].includes(x)||keys.some(k=>x.startsWith('--'+k+'='))),'Unknown relay option');
  for(const key of [...keys,'execute','once','watch'])assert(args.filter(x=>x==='--'+key||x.startsWith('--'+key+'=')).length<=1,'Duplicate relay option');
  assert(!(args.includes('--once')&&args.includes('--watch')),'Choose once or watch');
  const opt=(key,fallback)=>args.find(x=>x.startsWith('--'+key+'='))?.slice(key.length+3)??fallback;
  const txHash=opt('tx',null),guid=opt('guid',null),source=opt('source',null);
  for(const value of [txHash,guid])assert(value===null||/^0x[0-9a-fA-F]{64}$/.test(value),'Invalid transaction hash or GUID');
  assert(!txHash||source,'--tx requires an explicit --source');
  const interval=opt('interval-ms','3000');assert(/^[1-9][0-9]*$/.test(interval),'Invalid interval');
  const intervalMs=Number(interval);assert(intervalMs>=1000&&intervalMs<=60000,'Invalid interval');
  return {execute:args.includes('--execute'),watch:args.includes('--watch'),source,txHash,guid,intervalMs,
    configFile:path.resolve(opt('config',path.join(HERE,'deployments/job/runtime.json'))),
    dataDirectory:path.resolve(opt('data',fs.existsSync(path.join(HERE,'data/manifest.json'))?path.join(HERE,'data'):path.resolve(HERE,'../gpt2-bsc/data')))};
}
export async function run(args) {
  const options=parseArgs(args);
  if(options.help){console.log('job-relay --config=deployments/job/runtime.json [--data=export-dir] [--source=robinhood|opbnb|monad --tx=0xHASH] [--guid=0xGUID] [--execute --once|--watch]\nRead-only default. Self-relay mode requires exact deployment verification, two official required DVNs, actual quorum, reviewed messaging, explicit paid enablement/key and fee/deadline caps.');return;}
  const config=validateJobRuntimeConfig(JSON.parse(fs.readFileSync(options.configFile)));
  assert(config.executorMode==='self-relay','Runtime must explicitly select self-relay');
  assert(config.chains[0].dvnConfirmations===config.chains[1].dvnConfirmations,'Both directions must use the same reviewed confirmation policy');
  assert(!options.source||config.chains.some(c=>c.key===options.source),'Unknown source chain');
  if(options.execute)assert(config.enabled===true&&config.messagingReviewed===true&&config.chains.every(c=>BigInt(c.maxFeePerGasWei)>0n),'Paid relay requires explicit reviewed enablement and fee caps');
  const reportFile=jobReportPath(options.configFile,config);let verified;
  atomicJobReport(reportFile,{schemaVersion:2,status:'VERIFYING',messagingReady:false});
  try{verified=await verifyJobDeployment({config,dataDirectory:options.dataDirectory});atomicJobReport(reportFile,verified);}
  catch{atomicJobReport(reportFile,{schemaVersion:2,status:'VERIFICATION_FAILED',messagingReady:false});throw Error('Full relay provenance verification failed');}
  const built=compile();assert(built.compiler.sources_commitment_sha256===verified.compilerSourcesHash,'Compiler inputs changed');
  const key=options.execute?process.env[config.relayKeyEnv??config.keyEnv]:null;
  if(options.execute)assert(typeof key==='string'&&/^0x[0-9a-fA-F]{64}$/.test(key),'Relay key is unavailable');
  const providers=[],connections=[];
  try {
    for(const chain of config.chains) {
      const url=process.env[chain.rpcEnv];assert(url,'Required RPC is unavailable');const provider=new JsonRpcProvider(url);providers.push(provider);
      assert(BigInt(await provider.send('eth_chainId',[]))===BigInt(chain.chainId),'Relay RPC chain mismatch');
      const v=verified.chains[chain.stage];
      for(const field of chain.role==='home'?['router','selfRelayExecutor']:['router','engine','root','selfRelayExecutor'])assert(equal(keccak256(await provider.getCode(chain[field])),v[field+'CodeHash']),'Verified relay code changed');
      const runner=options.execute?new NonceManager(new Wallet(key,provider)):provider;
      const normalized={...chain,endpoint:v.endpoint};
      connections.push({config:normalized,provider,deadline:config.deadline,execute:options.execute,
        router:new Contract(chain.router,built.artifacts.GPT2JobOApp.abi,provider),
        endpoint:new Contract(v.endpoint,ENDPOINT_RELAY_ABI,runner),sendLibrary:new Contract(chain.sendLibrary,ULN_RELAY_ABI,provider),
        receiveLibrary:new Contract(chain.receiveLibrary,ULN_RELAY_ABI,runner)});
    }
    do {
      assertSourcesUnchanged(built);let acted=false;
      for(let i=0;i<connections.length;i++) {
        const source=connections[i],destination=connections[1-i];
        const now=await destination.provider.getBlock('latest');assert(now&&now.timestamp<=config.deadline,'Job relay deadline expired');
        await checkTransport(source,destination);await checkTransport(destination,source);
        if(options.source&&source.config.key!==options.source)continue;
        const packets=await sourcePackets(source,destination,config,options);
        for(const packet of packets) {
          const action=await chooseRelayAction(destination,packet);
          console.log(JSON.stringify({status:action.kind,source:source.config.key,destination:destination.config.key,guid:packet.guid,mode:options.execute?'EXECUTE':'READ_ONLY'}));
          if(options.execute&&['commit','deliver'].includes(action.kind)){await sendRelayAction(destination,action);acted=true;break;}
        }
        if(acted)break;
      }
      if(await connections[0].router.resultFinalized()){console.log(JSON.stringify({status:'JOB_RELAY_COMPLETE'}));break;}
      if(!options.execute||!options.watch)break;
      await delay(options.intervalMs);
    }while(true);
  }finally{for(const provider of providers)provider.destroy();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv.slice(2)).catch(()=>{
  console.error(JSON.stringify({status:'RELAY_STOPPED',reason:'Check verified provenance, actual DVN quorum, reviewed pathway configuration, fees, deadline and source events.'}));process.exitCode=1;
});
