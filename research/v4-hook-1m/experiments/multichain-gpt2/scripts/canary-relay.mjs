// One real two-DVN ping/ack round trip. Read-only unless explicitly enabled.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Contract,Interface,JsonRpcProvider,Wallet,NonceManager,ZeroHash,dataSlice,getBytes,getAddress,keccak256} from 'ethers';
import {compile,assertSourcesUnchanged} from './build.mjs';
import {CANARY_CONTRACT,parseCanaryArgs} from './canary-plan.mjs';
import {CANARY_PACKET_TYPE,CANARY_OPTIONS,ENDPOINT_ABI,ULN_ABI,coder,equal,validateCanaryConfig,requestHash,validateUln,checkCanaryTransport,canaryFeeOverrides,reportPath,writeReport} from './canary-runtime.mjs';
import {verifyCanary} from './verify-canary.mjs';
import {gasLimitForEstimate} from './worker.mjs';
import {reserveCanarySpend,markCanaryBroadcast,recordCanaryReceipt,reconcileCanaryBudget,releaseCanaryReservation} from './canary-budget.mjs';
const addressWord=word=>{assert(/^0x0{24}[0-9a-fA-F]{40}$/.test(word),'Noncanonical address');return getAddress('0x'+word.slice(-40));};
export function decodeCanaryPacket(encoded,source,destination,config){
  assert(typeof encoded==='string'&&/^0x[0-9a-fA-F]+$/.test(encoded)&&getBytes(encoded).length===529,'Canary packet must have exact 416-byte payload');
  assert(dataSlice(encoded,0,1)==='0x01','Wrong LayerZero packet version');
  const nonce=BigInt(dataSlice(encoded,1,9)),srcEid=Number(BigInt(dataSlice(encoded,9,13))),sender=dataSlice(encoded,13,45),dstEid=Number(BigInt(dataSlice(encoded,45,49))),receiver=dataSlice(encoded,49,81),guid=dataSlice(encoded,81,113),message=dataSlice(encoded,113);
  assert(nonce>0n&&srcEid===source.eid&&dstEid===destination.eid&&equal(addressWord(sender),source.router)&&equal(addressWord(receiver),destination.router),'Wrong packet route');
  assert(equal(guid,keccak256(dataSlice(encoded,1,81))),'Invalid GUID');const packet=coder.decode([CANARY_PACKET_TYPE],message)[0];assert(equal(coder.encode([CANARY_PACKET_TYPE],[packet]),message),'Noncanonical packet');
  assert(Number(packet.version)===1&&Number(packet.kind)===(source.stage===0?1:2)&&BigInt(packet.nonce)===1n,'Invalid probe kind or nonce');
  assert(equal(packet.sessionId,config.sessionId)&&equal(packet.challenge,config.challenge)&&equal(packet.requestHash,requestHash(config)),'Wrong probe identity');
  assert(Number(packet.homeEid)===config.chains[0].eid&&Number(packet.computeEid)===config.chains[1].eid,'Wrong probe EIDs');
  for(let i=0;i<5;i++)assert(equal(packet['reserved'+i],ZeroHash),'Reserved packet word is nonzero');
  return {encoded,guid,message,header:dataSlice(encoded,0,81),headerHash:keccak256(dataSlice(encoded,0,81)),payloadHash:keccak256(dataSlice(encoded,81)),origin:{srcEid,sender,nonce},packet};
}
export async function chooseCanaryRelayAction(destination,packet){
  const {router,endpoint,receiveLibrary,config}=destination;
  if(await router.acceptedGuid(packet.guid))return {kind:'delivered'};
  const hash=await endpoint.inboundPayloadHash(config.router,packet.origin.srcEid,packet.origin.sender,packet.origin.nonce);
  if(equal(hash,packet.payloadHash))return {kind:'deliver',method:'lzReceive',args:[packet.origin,config.router,packet.guid,packet.message,'0x']};
  assert(equal(hash,ZeroHash),'Different or nil payload already committed');
  assert(BigInt(await endpoint.lazyInboundNonce(config.router,packet.origin.srcEid,packet.origin.sender))<packet.origin.nonce,'Packet nonce was cleared without acceptance');
  const decoded=validateUln(await receiveLibrary.getUlnConfig(config.router,packet.origin.srcEid),config);
  // ethers Result arrays are immutable. Contract argument resolution walks and
  // normalizes nested address arrays, so pass a fresh plain object and arrays.
  const uln={confirmations:decoded.confirmations,requiredDVNCount:decoded.requiredDVNCount,
    optionalDVNCount:decoded.optionalDVNCount,optionalDVNThreshold:decoded.optionalDVNThreshold,
    requiredDVNs:Array.from(decoded.requiredDVNs),optionalDVNs:Array.from(decoded.optionalDVNs)};
  if(!await receiveLibrary.verifiable(uln,packet.headerHash,packet.payloadHash))return {kind:'waiting-dvns'};
  return {kind:'commit',method:'commitVerification',args:[packet.header,packet.payloadHash]};
}
export async function sendCanaryAction(c,action){
  assert(c.execute===true,'Paid canary disabled');
  const allowed={ping:['router','ping','quotePing'],ack:['router','ack','quoteAck'],commit:['receiveLibrary','commitVerification',null],deliver:['endpoint','lzReceive',null]};
  const spec=allowed[action.kind];assert(spec&&action.method===spec[1],'Unsupported canary action');
  const contract=c[spec[0]],method=contract[spec[1]],args=action.args??[];
  const quote=async()=>{if(!spec[2])return 0n;const fee=await contract[spec[2]](...(action.kind==='ping'?args:[]));const uncapped=c.runtimeConfig?.spendingPolicy==='uncapped';assert(fee.lzTokenFee===0n&&fee.nativeFee>=0n&&(uncapped?c.config.maxMessageFeeWei===null:fee.nativeFee<=BigInt(c.config.maxMessageFeeWei)),'Invalid message fee or cap exceeded');return fee.nativeFee;};
  const value=await quote(),ceiling=BigInt(c.config.maxTransactionGas),estimate=await method.estimateGas(...args,{gasLimit:ceiling,value});
  const gasLimit=gasLimitForEstimate(estimate,ceiling);await method.staticCall(...args,{gasLimit,value});
  assert(await quote()===value,'Message fee changed; retry');const fees=await canaryFeeOverrides(c);
  const data=contract.interface.encodeFunctionData(spec[1],args);
  const budget=c.budgetMethods??{reserveCanarySpend,markCanaryBroadcast,recordCanaryReceipt,releaseCanaryReservation};
  const reservation=await budget.reserveCanarySpend({config:c.runtimeConfig,chain:c.config,configFile:c.configFile,provider:c.provider,actionId:action.kind+':'+keccak256(data),gasLimit,feeOverrides:fees,value,data,to:await contract.getAddress()});
  try{
  const submitted=await method(...args,{gasLimit,value,...fees,nonce:reservation.nonce});await budget.markCanaryBroadcast(reservation,submitted.hash);
  let receipt;try{receipt=await submitted.wait(c.config.confirmations);}catch(error){if(error.receipt)await budget.recordCanaryReceipt(reservation,error.receipt,c.provider);throw Error('Canary receipt failed or is uncertain');}
  await budget.recordCanaryReceipt(reservation,receipt,c.provider);
  assert(receipt&&receipt.status===1,'Canary transaction failed');return {hash:receipt.hash,gasUsed:String(receipt.gasUsed)};
  }finally{await budget.releaseCanaryReservation(reservation);}
}
async function packets(source,destination,config,filter){
  const latest=await source.provider.getBlockNumber(),step=2000,iface=new Interface(ENDPOINT_ABI),topic=iface.getEvent('PacketSent').topicHash;
  const process=async logs=>{const out=[];for(const log of logs){if(!equal(log.address,source.config.endpoint)||log.topics[0]!==topic)continue;const e=iface.parseLog(log);if(getBytes(e.args.encodedPayload).length<81||!equal(addressWord(dataSlice(e.args.encodedPayload,13,45)),source.config.router))continue;assert(equal(e.args.sendLibrary,source.config.sendLibrary)&&equal(e.args.options,CANARY_OPTIONS),'Source transport changed');const p=decodeCanaryPacket(e.args.encodedPayload,source.config,destination.config,config);if(filter.guid&&!equal(filter.guid,p.guid))continue;const expectedGuid=await source.router[source.config.stage===0?'pingGuid':'ackGuid']();assert(equal(p.guid,expectedGuid)&&equal(await source.router.requestHash(),p.packet.requestHash),'Source probe state differs');const receipt=await source.provider.getTransactionReceipt(log.transactionHash);assert(receipt?.status===1,'Missing source receipt');if(latest-receipt.blockNumber+1<source.config.dvnConfirmations)continue;const block=await source.provider.getBlock(receipt.blockNumber);assert(block&&equal(block.hash,receipt.blockHash),'Source event reorganized');out.push(p);}return out;};
  if(filter.tx){const receipt=await source.provider.getTransactionReceipt(filter.tx);assert(receipt?.status===1,'Source receipt missing');return process(receipt.logs);}
  for(let to=latest;to>=source.config.deploymentBlock;to-=step){const out=await process(await source.provider.getLogs({address:source.config.endpoint,topics:[topic],fromBlock:Math.max(source.config.deploymentBlock,to-step+1),toBlock:to}));if(out.length)return out;}return [];
}
export function parseRelayArgs(args){if(args.length===1&&args[0]==='--help')return {help:true};const o=parseCanaryArgs(args,['config','source','tx','guid','interval-ms'],['--execute','--once','--watch']);assert(o.config,'config required');assert(!(o.once&&o.watch),'Choose once or watch');assert(!o.source||['robinhood','opbnb'].includes(o.source),'Invalid source');assert(!o.tx||o.source,'tx requires source');for(const k of ['tx','guid'])assert(!o[k]||/^0x[0-9a-fA-F]{64}$/.test(o[k]),'Invalid transaction hash or GUID');const interval=Number(o['interval-ms']??3000);assert(Number.isSafeInteger(interval)&&interval>=1000&&interval<=60000,'Invalid polling interval');return {...o,interval};}
export async function run(args,{signerFactory}={}){const options=parseRelayArgs(args);if(options.help){console.log('canary-relay --config=deployments/canary/manifest.json [--source=robinhood|opbnb --tx=0xHASH] [--guid=0xGUID] [--execute --once|--watch]\nRead-only by default. Paid mode requires explicit enablement, reviewed security, funded key and an approved bounded or uncapped spending policy. Transaction gas ceilings, deadlines and real required-DVN quorum remain mandatory.');return;}
  const config=JSON.parse(fs.readFileSync(options.config));validateCanaryConfig(config,{paid:!!options.execute});const file=reportPath(options.config,config);writeReport(file,{status:'VERIFYING',readOnly:true});const built=compile();let verified;try{verified=await verifyCanary({config,built});writeReport(file,verified);}catch{writeReport(file,{status:'VERIFICATION_FAILED',readOnly:true});throw Error('Canary provenance verification failed');}
  const secret=options.execute&&!signerFactory?process.env[config.keyEnv]:null;if(options.execute&&!signerFactory)assert(typeof secret==='string'&&/^0x[0-9a-fA-F]{64}$/.test(secret),'Signing key unavailable');if(signerFactory)assert(typeof signerFactory==='function','Invalid signer factory');
  const providers=[],connections=[];try{for(const ch of config.chains){const url=process.env[ch.rpcEnv];assert(url,'RPC unavailable');const provider=new JsonRpcProvider(url);providers.push(provider);assert(BigInt(await provider.send('eth_chainId',[]))===BigInt(ch.chainId),'RPC chain changed');if(options.execute)await reconcileCanaryBudget({config,chain:ch,configFile:options.config,provider});const runner=options.execute?(signerFactory?await signerFactory(provider):new Wallet(secret,provider)):provider;if(options.execute)assert(runner&&typeof runner.getAddress==='function'&&equal(await runner.getAddress(),config.admin),'Signer must control the budgeted admin');connections.push({config:ch,runtimeConfig:config,configFile:options.config,provider,execute:!!options.execute,deadline:config.deadline,router:new Contract(ch.router,built.artifacts[CANARY_CONTRACT].abi,runner),endpoint:new Contract(ch.endpoint,ENDPOINT_ABI,runner),sendLibrary:new Contract(ch.sendLibrary,ULN_ABI,provider),receiveLibrary:new Contract(ch.receiveLibrary,ULN_ABI,runner)});}
    do{assertSourcesUnchanged(built);for(const c of connections){const v=verified.chains[c.config.stage];assert(equal(keccak256(await c.provider.getCode(c.config.router)),v.routerCodeHash)&&equal(keccak256(await c.provider.getCode(c.config.selfRelayExecutor)),v.selfRelayExecutorCodeHash),'Verified code changed');await checkCanaryTransport(c,config.chains[1-c.config.stage]);const now=await c.provider.getBlock('latest');assert(now&&now.timestamp<=config.deadline,'Canary expired');}
      const [home,remote]=connections;let action,connection;
      if(await home.router.ackReceived()){console.log(JSON.stringify({status:'CANARY_ROUND_TRIP_COMPLETE'}));break;}
      if(!await home.router.pingSent()&&!options.source){action={kind:'ping',method:'ping',args:[config.challenge]};connection=home;if(options.execute)assert(equal(await home.router.runner.getAddress(),config.requester),'Ping signer is not requester');}
      else if(await remote.router.pingReceived()&&!await remote.router.ackSent()&&!options.source){action={kind:'ack',method:'ack',args:[]};connection=remote;}
      else{for(const source of connections){if(options.source&&source.config.key!==options.source)continue;const dest=connections[1-source.config.stage];for(const p of await packets(source,dest,config,options)){const next=await chooseCanaryRelayAction(dest,p);console.log(JSON.stringify({status:next.kind,source:source.config.key,guid:p.guid}));if(['commit','deliver'].includes(next.kind)){action=next;connection=dest;break;}}if(action)break;}}
      if(action){console.log(JSON.stringify({status:action.kind,chain:connection.config.key,mode:options.execute?'EXECUTE':'READ_ONLY'}));if(options.execute){const receipt=await sendCanaryAction(connection,action);console.log(JSON.stringify({status:'CANARY_ACTION_MINED',action:action.kind,chain:connection.config.key,...receipt}));}}
      else console.log(JSON.stringify({status:'WAITING_FOR_SOURCE_CONFIRMATIONS_OR_REQUIRED_DVNS'}));
      if(!options.execute||!options.watch)break;await new Promise(resolve=>setTimeout(resolve,options.interval));
    }while(true);
  }finally{for(const provider of providers)provider.destroy();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv.slice(2)).catch(()=>{console.error('CANARY_RELAY_STOPPED: check verified code, both transport configurations, actual required-DVN quorum, source events, explicit enablement, fees and deadline.');process.exitCode=1;});
