// Shared model-free configuration, read-only RPC and bounded paid-action guards.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {AbiCoder,ZeroAddress,ZeroHash,getAddress,keccak256,toUtf8Bytes,zeroPadValue} from 'ethers';
import {HERE} from './build.mjs';
import {CANARY_CHAINS,CANARY_KIND,CANARY_CONTRACT,CANARY_ROUTE_ID,CANARY_OPTIONS,CANARY_RAW_OPTIONS,canonical} from './canary-plan.mjs';
export {CANARY_CHAINS,CANARY_OPTIONS,CANARY_RAW_OPTIONS};
export const equal=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
export const coder=AbiCoder.defaultAbiCoder();
export const CANARY_DOMAIN=keccak256(toUtf8Bytes('GH0ST_RH_OPBNB_CANARY_V1'));
export const CANARY_PACKET_TYPE='tuple(uint8 version,uint8 kind,bytes32 sessionId,bytes32 challenge,uint64 nonce,uint32 homeEid,uint32 computeEid,bytes32 requestHash,bytes32 reserved0,bytes32 reserved1,bytes32 reserved2,bytes32 reserved3,bytes32 reserved4)';
export const ULN_TYPE='tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)';
export const ENDPOINT_ABI=['function eid() view returns(uint32)','function delegates(address) view returns(address)','function getSendLibrary(address,uint32) view returns(address)','function getReceiveLibrary(address,uint32) view returns(address,bool)','function receiveLibraryTimeout(address,uint32) view returns(address,uint256)','function setSendLibrary(address,uint32,address)','function setReceiveLibrary(address,uint32,address,uint256)',`function setConfig(address,address,tuple(uint32 eid,uint32 configType,bytes config)[])`,'event PacketSent(bytes encodedPayload,bytes options,address sendLibrary)','function inboundPayloadHash(address,uint32,bytes32,uint64) view returns(bytes32)','function lazyInboundNonce(address,uint32,bytes32) view returns(uint64)','function lzReceive(tuple(uint32 srcEid,bytes32 sender,uint64 nonce),address,bytes32,bytes,bytes) payable'];
export const ULN_ABI=[`function getUlnConfig(address,uint32) view returns(${ULN_TYPE})`,`function getAppUlnConfig(address,uint32) view returns(${ULN_TYPE})`,`function verifiable(${ULN_TYPE},bytes32,bytes32) view returns(bool)`,'function commitVerification(bytes,bytes32)','function getExecutorConfig(address,uint32) view returns(tuple(uint32 maxMessageSize,address executor))','function isSupportedEid(uint32) view returns(bool)'];
export const validAddress=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{40}$/.test(x)&&!equal(x,ZeroAddress);
export const validHash=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{64}$/.test(x)&&!equal(x,ZeroHash);
export const decimal=x=>(typeof x==='string'&&/^(?:0|[1-9][0-9]*)$/.test(x))||(Number.isSafeInteger(x)&&x>=0);
const envName=x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]*$/.test(x);
export function validateCanaryConfig(c,{deployed=true,paid=false}={}){
  assert(c&&c.schemaVersion===1&&c.routeKind===CANARY_KIND&&c.routerContract===CANARY_CONTRACT,'Invalid canary schema');
  assert(c.spendingPolicy===undefined||['bounded','uncapped'].includes(c.spendingPolicy),'Invalid spending policy');
  const uncapped=c.spendingPolicy==='uncapped';
  assert(c.executorMode==='self-relay'&&equal(c.routeId,CANARY_ROUTE_ID),'Canary route is not allowlisted');
  assert(typeof c.enabled==='boolean'&&typeof c.messagingReviewed==='boolean'&&typeof c.budgetApproved==='boolean','Explicit enablement and budget flags required');
  assert(validAddress(c.admin)&&validAddress(c.requester),'Valid public authority addresses required');
  assert(validHash(c.sessionId)&&validHash(c.challenge),'Nonzero canary identity required');
  assert(Number.isSafeInteger(c.deadline)&&c.deadline>0,'Invalid deadline');
  assert(envName(c.keyEnv),'Invalid signing-key environment name');
  assert(c.verificationFile==='verified-canary.json','Unexpected verification filename');
  assert(Array.isArray(c.chains)&&c.chains.length===2,'Canary requires two fixed chains');
  assert(c.engine===undefined&&c.modelId===undefined&&c.routeConfiguration===undefined,'Model or arbitrary route is forbidden');
  for(const field of ['privateKey','key','rpcUrl','mnemonic','secret'])assert(!Object.hasOwn(c,field),'Secrets must remain in environment variables');
  if(c.compilerSourcesHash!==undefined)assert(/^[0-9a-f]{64}$/.test(c.compilerSourcesHash),'Invalid compiler commitment');
  c.chains.forEach((ch,i)=>{
    const e=CANARY_CHAINS[i];for(const key of ['key','stage','role','chainId','eid'])assert(ch[key]===e[key],'Wrong canary chain or role');
    for(const key of ['endpoint','sendLibrary','receiveLibrary'])assert(equal(ch[key],e[key]),'Untrusted transport contract');
    assert(Array.isArray(ch.requiredDVNs)&&canonical(ch.requiredDVNs.map(x=>String(x).toLowerCase()))===canonical(e.requiredDVNs),'Wrong required DVNs');
    assert(envName(ch.rpcEnv),'RPC must be an environment name');
    for(const field of ['privateKey','rpcUrl','url','mnemonic','secret'])assert(!Object.hasOwn(ch,field),'Secrets must remain in environment variables');
    assert(Number.isSafeInteger(ch.dvnConfirmations)&&ch.dvnConfirmations>=1&&ch.dvnConfirmations<=100000,'Invalid DVN confirmation policy');
    assert(Number.isSafeInteger(ch.confirmations)&&ch.confirmations>=1&&ch.confirmations<=100000,'Invalid receipt confirmations');
    assert(Number.isSafeInteger(ch.deploymentBlock)&&ch.deploymentBlock>=0,'Invalid log-start block');
    assert(decimal(ch.maxTransactionGas)&&BigInt(ch.maxTransactionGas)>100000n&&BigInt(ch.maxTransactionGas)<=16777216n,'Invalid transaction gas cap');
    if(uncapped)for(const k of ['maxFeePerGasWei','maxMessageFeeWei','maxTotalSpendWei','maxPostingFeeWei'])assert(ch[k]===null,'Uncapped fee limits must be explicitly null');
    else{for(const k of ['maxFeePerGasWei','maxMessageFeeWei'])assert(decimal(ch[k]),'Invalid native fee cap');
      assert(decimal(ch.maxTotalSpendWei)&&BigInt(ch.maxTotalSpendWei)>0n,'Positive total native budget required');
      assert(decimal(ch.maxPostingFeeWei),'Explicit posting-fee cap required');
      if(i===0)assert(BigInt(ch.maxPostingFeeWei)===0n,'RH posting is included in its gas estimate');}
    if(ch.gasPriceWei!==undefined&&ch.gasPriceWei!==null)assert(i===1&&decimal(ch.gasPriceWei)&&BigInt(ch.gasPriceWei)>0n&&(uncapped||BigInt(ch.gasPriceWei)<=BigInt(ch.maxFeePerGasWei)),'Invalid optional opBNB bid');
    if(deployed){for(const k of ['router','selfRelayExecutor'])assert(validAddress(ch[k]),'Missing deployed address');for(const k of ['routerDeploymentTx','selfRelayExecutorDeploymentTx'])assert(deployed==='prepared'?(ch[k]===null||validHash(ch[k])):validHash(ch[k]),'Missing creation receipt');assert(!equal(ch.router,ch.selfRelayExecutor),'Address collision');}
    else for(const k of ['router','selfRelayExecutor','routerDeploymentTx','selfRelayExecutorDeploymentTx'])assert(ch[k]===null||ch[k]===undefined,'Preparation must start with empty deployment fields');
    assert(ch.engine===undefined&&ch.root===undefined,'Canary cannot contain model contracts');
    if(paid&&!uncapped)assert(BigInt(ch.maxFeePerGasWei)>0n&&BigInt(ch.maxMessageFeeWei)>0n&&(i===0||BigInt(ch.maxPostingFeeWei)>0n),'Paid canary needs positive gas, message and opBNB posting caps');
  });
  assert(c.chains[0].dvnConfirmations===c.chains[1].dvnConfirmations,'Both directions require the same confirmation policy');
  if(paid)assert(c.enabled===true&&c.messagingReviewed===true&&c.budgetApproved===true,'Paid execution is not explicitly reviewed, budgeted and enabled');
  return c;
}
export function requestHash(c){return keccak256(coder.encode(['bytes32','bytes32','bytes32','uint64','uint32','uint32','bytes32','bytes32'],[CANARY_DOMAIN,c.sessionId,c.challenge,1,c.chains[0].eid,c.chains[1].eid,zeroPadValue(c.chains[0].router,32),zeroPadValue(c.chains[1].router,32)]));}
export function checkedOutput(input,{newDirectory=false}={}){
  const target=path.resolve(HERE,input),rel=path.relative(HERE,target),top=rel.split(path.sep)[0];
  assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)&&['reports','deployments'].includes(top),'Output must remain under project reports/ or deployments/');
  assert(fs.readFileSync(path.join(HERE,'.gitignore'),'utf8').split(/\r?\n/).includes(top+'/'),'Output parent must be ignored');
  let parent=path.dirname(target);while(!fs.existsSync(parent))parent=path.dirname(parent);
  assert(fs.realpathSync(parent)===fs.realpathSync(HERE)||fs.realpathSync(parent).startsWith(fs.realpathSync(HERE)+path.sep),'Output symlink escapes project');
  if(newDirectory)assert(!fs.existsSync(target),'Refusing to overwrite output');else if(fs.existsSync(target))assert(!fs.lstatSync(target).isSymbolicLink(),'Output must not be a symlink');
  return target;
}
export function reportPath(configFile,c){return checkedOutput(path.join(path.dirname(path.resolve(configFile)),c.verificationFile));}
export function writeReport(file,data){checkedOutput(file);fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{flag:'wx'});fs.renameSync(tmp,file);}
export function readRpc(url){let parsed;try{parsed=new URL(url);}catch{throw Error('Invalid RPC URL');}assert(['https:','http:'].includes(parsed.protocol),'Invalid RPC protocol');const methods=new Set(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call','eth_getTransactionByHash','eth_getTransactionReceipt']);let id=0;return {request:async(method,params=[])=>{assert(methods.has(method),'Read-only RPC method required');try{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000),redirect:'error'});const body=await response.json();assert(response.ok&&!body.error&&Object.hasOwn(body,'result'));return body.result;}catch{throw Error('Canary RPC read failed: '+method);}}};}
export function validateUln(actual,ch){assert(Number(actual.requiredDVNCount)===2&&Number(actual.optionalDVNCount)===0&&Number(actual.optionalDVNThreshold)===0,'Two required DVNs and zero optional DVNs required');assert(actual.requiredDVNs.length===2&&actual.optionalDVNs.length===0,'Invalid DVN arrays');assert(actual.requiredDVNs.every((x,i)=>equal(x,ch.requiredDVNs[i])),'Wrong DVN addresses');assert(BigInt(actual.confirmations)===BigInt(ch.dvnConfirmations),'Wrong DVN confirmations');return actual;}
export function validateDeclaredUln(actual,ch){assert(Number(actual.optionalDVNCount)===255,'Optional DVNs must be explicitly disabled with NIL_DVN_COUNT');return validateUln({confirmations:actual.confirmations,requiredDVNCount:actual.requiredDVNCount,optionalDVNCount:0,optionalDVNThreshold:actual.optionalDVNThreshold,requiredDVNs:actual.requiredDVNs,optionalDVNs:actual.optionalDVNs},ch);}
export async function checkCanaryTransport(c,remote){const {config:ch,endpoint,sendLibrary,receiveLibrary}=c;assert(equal(await endpoint.getSendLibrary(ch.router,remote.eid),ch.sendLibrary),'Wrong send library');const rx=await endpoint.getReceiveLibrary(ch.router,remote.eid);assert(equal(rx[0],ch.receiveLibrary)&&rx[1]===false,'Explicit receive library required');const old=await endpoint.receiveLibraryTimeout(ch.router,remote.eid);assert(equal(old[0],ZeroAddress)&&BigInt(old[1])===0n,'Receive-library grace override must be cleared');assert(await sendLibrary.isSupportedEid(remote.eid)&&await receiveLibrary.isSupportedEid(remote.eid),'Unsupported ULN pathway');for(const lib of [sendLibrary,receiveLibrary]){validateDeclaredUln(await lib.getAppUlnConfig(ch.router,remote.eid),ch);validateUln(await lib.getUlnConfig(ch.router,remote.eid),ch);}const e=await sendLibrary.getExecutorConfig(ch.router,remote.eid);assert(equal(e.executor,ch.selfRelayExecutor)&&Number(e.maxMessageSize)===4480,'Wrong self-relay executor');}
export async function canaryFeeOverrides(c){const b=await c.provider.getBlock('latest');assert(b&&b.timestamp<=c.deadline,'Canary deadline expired');const uncapped=c.runtimeConfig?.spendingPolicy==='uncapped';const cap=uncapped?null:BigInt(c.config.maxFeePerGasWei);assert(uncapped?c.config.maxFeePerGasWei===null:cap>0n,'Explicit fee policy required');if(c.config.gasPriceWei!==undefined&&c.config.gasPriceWei!==null){const bid=BigInt(c.config.gasPriceWei);assert(c.config.chainId===204&&c.config.key==='opbnb'&&bid>0n&&(uncapped||bid<=cap),'Invalid explicit bid');assert(b.baseFeePerGas!==null&&bid>=BigInt(b.baseFeePerGas)+1001n,'Bid below conservative live floor');return {gasPrice:bid};}const f=await c.provider.getFeeData();if(f.maxFeePerGas!==null){assert(f.maxFeePerGas>0n&&(uncapped||f.maxFeePerGas<=cap)&&(f.maxPriorityFeePerGas??0n)>=0n&&(f.maxPriorityFeePerGas??0n)<=f.maxFeePerGas,'Invalid live fee or cap exceeded');return {maxFeePerGas:f.maxFeePerGas,maxPriorityFeePerGas:f.maxPriorityFeePerGas??0n};}assert(f.gasPrice!==null&&f.gasPrice>0n&&(uncapped||f.gasPrice<=cap),'Invalid live fee or cap exceeded');return {gasPrice:f.gasPrice};}
export const publicAddress=getAddress;
