#!/usr/bin/env node
// Robinhood 4663 only. compile/plan/verify never read a signing credential.
// Deployment requires a frozen plan/build and either explicit capped or market fees.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),solc=require('solc'),ethers=require('ethers');
const {Contract,ContractFactory,JsonRpcProvider,FetchRequest,Wallet,AbiCoder,ZeroAddress,keccak256,getCreateAddress,getBytes}=ethers;
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BUILD=path.join(ROOT,'reports/analysis-build'),PLAN=path.join(ROOT,'reports/analysis-deploy-plan.json');
const JOURNAL=path.join(ROOT,'deployments/robinhood-mainnet-analysis.json');
const MODEL_FILE=path.join(ROOT,'analysis-model/evaluation-v2/solidity/model.json');
const NATIVE_FILE=path.join(ROOT,'reports/analysis-real-model-validation.json');
const CHAIN=4663n,OP_CAP=31_000_000n,HARD_CAP=50_000_000_000_000_000n;
const OWNER='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
const READER='0x5BE840518fb1Be0851f06d68ac0724fdC4e97768';
const READER_HASH='0xba82f9bdc1f259eec2310d536ebbfbf37a6e0a4ccfc9a782c7d7782b1b0adf81';
const MANIFEST_SHA='9b6090a7639245180a6dbcc1ae69f379d3b9c5bd4c1c5981c78aa7035b50b97d';
const NATIVE_SHA='deabce334ae2051e40c9c410b38082e4844fc1c7b0b7ad9368a43f7ca581db72';
const MANIFEST_ID='0xa89f665f053d9ea9172112ec839ce16d399f9687c75f00a18ddf0e0ee128a87f';
const CHECKPOINT='0x9cf0b5ce17109bda877f21ac08731cd1897bf6d160b4b690de809c750e960716';
const DOMAIN='0xc0a58f640b73adb0cfd80b9eea45c4a72542becb30edccdfecb01cbbc37d778e';
const RPCS=['https://rpc.mainnet.chain.robinhood.com','https://api.blockvectra.com/v1/robinhood_mainnet/public'];
const ROLES={model:'S0ULModel',engine:'S0ULInference',adapter:'S0ULAnalysisFacts',codec:'S0ULAnalysisCodec',executor:'S0ULAnalysisExecutor'};
const CFG='tuple(uint16 vocabSize,uint16 dim,uint16 layers,uint16 heads,uint16 hiddenDim,uint16 maxSeqLen,uint32 epsQ28,uint32 attentionScaleQ14)';
const SCHEMA=ethers.id('S0UL-ANALYSIS-FACTS-v1|code:2|native:2|interfaces:16|owner:3|pause:3|implementation:3|asset:3|supply:3|pool:3|delegate:2|writes:2|origin:2|externalCall:2|scan:2|BOS:1|SEP:3|bases:4,6,8,24,27,30,33,36,39,42,44,46,48,50');
const READS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_getBalance','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_call','eth_estimateGas','eth_gasPrice','eth_feeHistory','eth_maxPriorityFeePerGas']);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,json(value),{mode:0o600});fs.renameSync(temp,file);}
function fail(message){throw Error(message);}
function exact(s,name){if(typeof s!=='string'||!/^\d+$/.test(s))fail(name+' requires an exact decimal integer');return BigInt(s);}
function errorData(e){return{code:e?.code??null,rpcMethod:e?.rpcMethod??null,readTag:e?.readTag??null,message:String(e?.shortMessage??e?.message??'RPC error').replace(/https:\/\/robinhood-mainnet\.g\.alchemy\.com\/v2\/[^\s\"'<>]+/gi,'[private RPC]').replace(/alch_[A-Za-z0-9_-]+/g,'[RPC token]').replace(/0x[0-9a-fA-F]{64,}/g,'[hex]').slice(0,300)};}
class Provider extends JsonRpcProvider{async send(method,args){try{return await super.send(method,args);}catch(e){if(READS.has(method)&&e.code==='TIMEOUT'){try{return await super.send(method,args);}catch(retryError){try{retryError.rpcMethod=method;}catch{}throw retryError;}}try{e.rpcMethod=method;}catch{}throw e;}}}
function tagged(promise,readTag){return promise.catch(e=>{try{e.readTag=readTag;}catch{}throw e;});}
function privateUrl(rpc){let u;try{u=new URL(rpc);}catch{fail('Invalid private RPC input');}if(u.origin!=='https://robinhood-mainnet.g.alchemy.com'||u.username||u.password||u.search||u.hash||!/^\/v2\/[A-Za-z0-9_-]+$/.test(u.pathname))fail('Private RPC must use the authorized Robinhood Alchemy origin and token path');return u.href;}
function providerFor(rpc,isPrivate=false){if(isPrivate)privateUrl(rpc);else if(!RPCS.includes(rpc))fail('Only the two reviewed public RPC URLs are supported');const req=new FetchRequest(rpc);req.timeout=15000;req.retryFunc=()=>false;req.setThrottleParams({maxAttempts:1});return new Provider(req,Number(CHAIN),{staticNetwork:true,batchMaxCount:isPrivate?10:1,batchStallTime:isPrivate?10:0,cacheTimeout:-1});}
function normalize(code,refs){let h=code.slice(2).toLowerCase();for(const a of Object.values(refs??{}))for(const r of a)h=h.slice(0,r.start*2)+'0'.repeat(r.length*2)+h.slice((r.start+r.length)*2);return'0x'+h;}
function modelBundle(){
 const raw=fs.readFileSync(MODEL_FILE);if(hash(raw)!==MANIFEST_SHA)fail('Frozen model manifest SHA changed');
 const m=JSON.parse(raw),nraw=fs.readFileSync(NATIVE_FILE);if(hash(nraw)!==NATIVE_SHA)fail('Frozen native evidence changed');const native=JSON.parse(nraw);
 if(!same(m.manifestHash,MANIFEST_ID)||!same(m.sourceCheckpoint,CHECKPOINT)||!same(m.tokenizerDomainSha256,DOMAIN)||native.result!=='PASS'||!native.complete)fail('Selected model/native identity differs');
 const payload=fs.readFileSync(path.resolve(path.dirname(MODEL_FILE),m.payload.path));if(payload.length!==m.payload.nbytes||hash(payload)!==m.payload.sha256)fail('Solidity payload changed');
 if(m.shards.length!==48)fail('Expected complete 48-shard model');
 for(const [i,s]of m.shards.entries()){const init=getBytes(s.initCodeHex),runtime=init.slice(14),bytes=payload.subarray(s.offset,s.offset+s.payloadBytes);if(s.index!==i||runtime[0]!==0||!same(keccak256(init),s.initCodeKeccak256)||!same(keccak256(runtime),s.runtimeKeccak256)||hash(bytes)!==s.payloadSha256||!Buffer.from(runtime.slice(1)).equals(bytes))fail('Shard integrity mismatch '+i);}
 return{model:m,native};
}
function compile(bundle){
 if(!solc.version().startsWith('0.8.30+'))fail('Require Solidity 0.8.30');
 const sources={};function collect(n){if(sources[n])return;const content=fs.readFileSync(path.join(ROOT,'contracts',n),'utf8');if(hash(content)!==bundle.native.build.sourceSha256[n])fail('Source differs from executed native evidence: '+n);sources[n]={content};for(const m of content.matchAll(/(?:from\s+|import\s+)["']([^"']+\.sol)["']/g))collect(path.posix.normalize(path.posix.join(path.posix.dirname(n),m[1])));}
 for(const name of ['S0ULModel.sol','S0ULInference.sol','analysis/S0ULAnalysisFacts.sol','analysis/S0ULAnalysisCodec.sol','analysis/S0ULAnalysisExecutor.sol'])collect(name);
 const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}}};
 const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings})));const errors=(out.errors??[]).filter(e=>e.severity==='error');if(errors.length)fail(errors.map(e=>e.formattedMessage).join('\n'));
 const artifacts={};for(const[role,name]of Object.entries(ROLES)){const matches=Object.values(out.contracts).filter(c=>c[name]);if(matches.length!==1)fail('Artifact missing '+name);const a=matches[0][name],runtime='0x'+a.evm.deployedBytecode.object,refs=a.evm.deployedBytecode.immutableReferences??{};if((runtime.length-2)/2>24576)fail('EIP170 exceeded '+name);artifacts[role]={name,abi:a.abi,bytecode:'0x'+a.evm.bytecode.object,immutableReferences:refs,normalizedRuntimeHash:keccak256(normalize(runtime,refs)),creationCodeHash:keccak256('0x'+a.evm.bytecode.object),runtimeBytes:(runtime.length-2)/2};atomic(path.join(BUILD,name+'.json'),artifacts[role]);}
 const identity={compiler:solc.version(),settings,sourceSha256:Object.fromEntries(Object.entries(sources).map(([n,s])=>[n,hash(s.content)])),modelManifestSha256:MANIFEST_SHA,modelManifestHash:MANIFEST_ID,checkpoint:CHECKPOINT,nativeEvidenceSha256:NATIVE_SHA,existingReader:{address:READER,codeHash:READER_HASH},artifacts:Object.fromEntries(Object.entries(artifacts).map(([r,a])=>[r,{creationCodeHash:a.creationCodeHash,normalizedRuntimeHash:a.normalizedRuntimeHash}]))};const manifest={...identity,buildFingerprint:hash(json(identity))};atomic(path.join(BUILD,'manifest.json'),manifest);return{manifest,artifacts};
}
async function context(p){const chain=BigInt(await tagged(p.send('eth_chainId',[]),'context:chainId'));if(chain!==CHAIN)fail('Wrong RPC chain');const sys=new Contract('0x000000000000000000000000000000000000006c',['function getMaxTxGasLimit()view returns(uint256)','function getMaxBlockGasLimit()view returns(uint256)'],p);const[block,price,balance,nonce,confirmedNonce,maxTx,maxBlock,code]=await Promise.all([tagged(p.getBlock('latest'),'context:latestBlock'),tagged(p.send('eth_gasPrice',[]),'context:gasPrice'),tagged(p.getBalance(OWNER),'context:balance'),tagged(p.getTransactionCount(OWNER,'pending'),'context:pendingNonce'),tagged(p.getTransactionCount(OWNER,'latest'),'context:confirmedNonce'),tagged(sys.getMaxTxGasLimit(),'context:maxTxGas'),tagged(sys.getMaxBlockGasLimit(),'context:maxBlockGas'),tagged(p.getCode(READER),'context:readerCode')]);if(!block||BigInt(price)<=0n||!same(keccak256(code),READER_HASH))fail('Reader/fee/block unavailable or differs');return{chainId:4663,blockNumber:block.number,blockHash:block.hash,gasPriceWei:BigInt(price),balanceWei:balance,pendingNonce:nonce,confirmedNonce,maxTxGas:BigInt(maxTx),maxBlockGas:BigInt(maxBlock),operationalGasCap:[OP_CAP,BigInt(maxTx),BigInt(maxBlock)].reduce((a,b)=>a<b?a:b)};}
async function reusable(p,m){const old=read(path.join(ROOT,'deployments/robinhood-mainnet.json'));const byHash=new Map(old.transactions.filter(t=>t.kind==='shard'&&t.address&&t.runtimeCodeHash).map(t=>[t.runtimeCodeHash.toLowerCase(),t.address]));const result=[];for(const s of m.shards){const a=byHash.get(s.runtimeKeccak256.toLowerCase());if(!a)continue;const code=await p.getCode(a);if((code.length-2)/2!==s.runtimeBytes||!same(keccak256(code),s.runtimeKeccak256))fail('Candidate reused shard differs '+s.index);result.push({index:s.index,address:a,codeHash:s.runtimeKeccak256,runtimeBytes:s.runtimeBytes});}return result;}
function idFor(m,shards){return keccak256(AbiCoder.defaultAbiCoder().encode([CFG,'bytes32','bytes32','address[]','bytes32[]','uint32','uint256'],[m.config,m.sourceCheckpoint,m.manifestHash,shards,m.shards.map(s=>s.runtimeKeccak256),m.shardBytes,m.payload.nbytes]));}
async function plan(p,bundle,build,rpc){
 const live=await context(p);if(live.pendingNonce!==live.confirmedNonce)fail('Signer already has pending transactions');const reused=await reusable(p,bundle.model),reuseMap=new Map(reused.map(x=>[x.index,x])),predictions={},shards=[];let nonce=live.pendingNonce,totalGas=0n;const steps=[];
 for(const s of bundle.model.shards){if(reuseMap.has(s.index)){shards.push(reuseMap.get(s.index).address);continue;}const key='shard:'+s.index,address=getCreateAddress({from:OWNER,nonce:nonce++});predictions[key]=address;shards.push(address);const estimate=BigInt(await p.estimateGas({from:OWNER,data:s.initCodeHex,value:0n})),gasLimit=(estimate*120n+99n)/100n;if(gasLimit>live.operationalGasCap)fail('Shard exceeds transaction cap');steps.push({key,predictedAddress:address,estimateBasis:'live eth_estimateGas; dependencies absent do not affect raw data deployment',gasEstimate:estimate,gasReserve:gasLimit});totalGas+=gasLimit;process.stdout.write(json({planned:key,gasEstimate:estimate}));}
 for(const[role,name]of Object.entries(ROLES)){const key='deploy:'+role,address=getCreateAddress({from:OWNER,nonce:nonce++});predictions[key]=address;const measured=bundle.native.transactions.find(t=>t.kind==='deploy:'+name);if(!measured)fail('Missing measured constructor '+name);const estimate=BigInt(measured.gasUsed),gasReserve=(estimate*135n+99n)/100n+100000n;if(gasReserve>live.operationalGasCap)fail('Constructor forecast exceeds transaction cap');steps.push({key,predictedAddress:address,estimateBasis:'native EVM measured constructor gas +35% +100000; live estimate mandatory after dependencies exist',gasEstimate:estimate,gasReserve});totalGas+=gasReserve;}
 const ceiling=(live.gasPriceWei*150n+99n)/100n;const expectedModelId=idFor(bundle.model,shards);const identity={format:'s0ul-analysis-deploy-plan-v1',chainId:4663,owner:OWNER,publicRpc:rpc,buildFingerprint:build.manifest.buildFingerprint,modelManifestSha256:MANIFEST_SHA,sourceCheckpoint:CHECKPOINT,modelManifestHash:MANIFEST_ID,reader:{address:READER,codeHash:READER_HASH},startNonce:live.pendingNonce,reusedShards:reused,shards,predictions,expectedModelId,steps,totalTransactions:steps.length,totalGasReserve:totalGas,feeCeilingWeiPerGas:ceiling,forecastFeeReserveWei:totalGas*ceiling};const result={...identity,planFingerprint:hash(json(identity)),observed:live,limitations:['Dependent constructor amounts are forecasts, not live estimates. Each actual transaction must pass a fresh live estimate and the explicit cumulative cap.','Gas reserve and current fee forecast do not guarantee future network fees; price/limit changes pause deployment.','This plan deploys infrastructure only; it does not fund or run an inference job.','Current model is a finite synthetic-policy pilot, not validated general address intelligence.']};atomic(PLAN,result);return result;
}
async function codeRecord(p,address,a){const code=await p.getCode(address);if(code==='0x'||!same(keccak256(normalize(code,a.immutableReferences)),a.normalizedRuntimeHash))fail(a.name+' runtime does not match frozen build');return{address,codeHash:keccak256(code),runtimeBytes:(code.length-2)/2};}
async function checkModel(p,j,bundle,build){
 const c=new Contract(j.contracts.model.address,build.artifacts.model.abi,p);
 const a=await Promise.all([c.modelId(),c.manifestHash(),c.sourceCheckpoint(),c.shardCount(),c.payloadLength(),c.shardBytes(),c.configuration()]);
 const expectedConfigHash=keccak256(AbiCoder.defaultAbiCoder().encode([CFG],[bundle.model.config]));
 if(!same(a[0],j.expectedModelId)||!same(a[1],MANIFEST_ID)||!same(a[2],CHECKPOINT)||BigInt(a[3])!==48n||BigInt(a[4])!==BigInt(bundle.model.payload.nbytes)||BigInt(a[5])!==BigInt(bundle.model.shardBytes)||!same(keccak256(AbiCoder.defaultAbiCoder().encode([CFG],[a[6]])),expectedConfigHash))fail('Deployed model identity/configuration differs');
 return c;
}
async function verify(p,j,bundle,build){
 await context(p);
 const model=await checkModel(p,j,bundle,build);
 for(const s of bundle.model.shards){const [code,info]=await Promise.all([p.getCode(j.shards[s.index]),model.shardInfo(s.index)]);if((code.length-2)/2!==s.runtimeBytes||!same(keccak256(code),s.runtimeKeccak256)||!same(info[0],j.shards[s.index])||!same(info[1],s.runtimeKeccak256))fail('Pinned registry shard differs '+s.index);}
 for(const[role,a]of Object.entries(build.artifacts)){const r=await codeRecord(p,j.contracts[role].address,a);if(!same(r.codeHash,j.contracts[role].codeHash))fail('Journal runtime pin differs '+role);}
 const engine=new Contract(j.contracts.engine.address,build.artifacts.engine.abi,p),adapter=new Contract(j.contracts.adapter.address,build.artifacts.adapter.abi,p),codec=new Contract(j.contracts.codec.address,build.artifacts.codec.abi,p),executor=new Contract(j.contracts.executor.address,build.artifacts.executor.abi,p);
 const configurationHash=keccak256(AbiCoder.defaultAbiCoder().encode([CFG],[bundle.model.config]));
 const calls=[engine.model(),engine.tokenizer(),engine.modelId(),engine.configuration(),adapter.reader(),adapter.readerCodeHash(),adapter.schemaHash(),adapter.chainId(),codec.domainSha256(),executor.engine(),executor.adapter(),executor.codec(),executor.model(),executor.modelId(),executor.engineCodeHash(),executor.adapterCodeHash(),executor.codecCodeHash(),executor.modelCodeHash(),executor.domainSha256(),executor.schemaHash(),executor.configurationHash(),executor.chainId()];
 const a=await Promise.all(calls);a[3]=keccak256(AbiCoder.defaultAbiCoder().encode([CFG],[a[3]]));
 const expected=[j.contracts.model.address,ZeroAddress,j.expectedModelId,configurationHash,READER,READER_HASH,SCHEMA,CHAIN,DOMAIN,j.contracts.engine.address,j.contracts.adapter.address,j.contracts.codec.address,j.contracts.model.address,j.expectedModelId,j.contracts.engine.codeHash,j.contracts.adapter.codeHash,j.contracts.codec.codeHash,j.contracts.model.codeHash,DOMAIN,SCHEMA,configurationHash,CHAIN];
 if(a.some((v,i)=>typeof v==='bigint'?v!==expected[i]:!same(v,expected[i])))fail('Immutable dependency/configuration pin differs');
 if(!same(j.schemaHash,SCHEMA)||!same(j.domainSha256,DOMAIN)||!same(j.configurationHash,configurationHash)||!same(j.modelId,j.expectedModelId))fail('Journal configuration identity differs');
 return true;
}
async function credential({needsKey=true,isPrivate=false}={}){
 if(process.stdin.isTTY)fail('Credential must be supplied only as JSON on non-TTY stdin');let input='';for await(const c of process.stdin){input+=c.toString();if(input.length>8192)fail('Signing input too long');}
 let v;try{v=JSON.parse(input);}catch{fail('Expected credential JSON on stdin');}input='';
 if(!v||Object.keys(v).some(k=>!['privateKey','rpcUrl'].includes(k)))fail('Credential fields are limited to privateKey and rpcUrl');
 let rpcUrl;if(isPrivate){if(typeof v.rpcUrl!=='string')fail('Private RPC URL is required on stdin');rpcUrl=privateUrl(v.rpcUrl);}else if(v.rpcUrl!==undefined)fail('RPC input requires --private-rpc true');
 let wallet;if(needsKey){if(typeof v.privateKey!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(v.privateKey))fail('Expected a valid privateKey field');try{wallet=new Wallet(v.privateKey);}catch{fail('Invalid signing credential');}if(!same(wallet.address,OWNER))fail('Credential address differs from reviewed public deployer');}
 v.privateKey='';v.rpcUrl='';v=null;return{wallet,rpcUrl};
}
async function settle(p,j,hashValue){const x=j.pending;if(!x||!same(x.hash,hashValue))fail('Require the exact saved pending hash');let r=await p.getTransactionReceipt(hashValue);if(!r)r=await p.waitForTransaction(hashValue,1,45000);if(!r)fail('Receipt unavailable; reconcile exact saved hash, do not resend');const[tx,block]=await Promise.all([p.getTransaction(hashValue),p.getBlock(r.blockNumber)]);if(!tx||!block||!same(tx.hash,hashValue)||tx.to!==null||!same(tx.from,OWNER)||BigInt(tx.chainId)!==CHAIN||tx.nonce!==x.nonce||tx.value!==0n||!same(keccak256(tx.data),x.calldataHash)||!same(r.hash,hashValue)||!same(block.hash,r.blockHash)||BigInt(tx.gasLimit)!==BigInt(x.gasLimit)||BigInt(tx.gasPrice)!==BigInt(x.gasPriceWei??j.feeCeilingWeiPerGas))fail('Canonical transaction identity differs');const price=BigInt(r.gasPrice??tx.gasPrice),fee=r.gasUsed*price,record={...x,receipt:{hash:r.hash,blockNumber:r.blockNumber,blockHash:r.blockHash,status:Number(r.status),gasUsed:r.gasUsed.toString(),gasPriceWei:price.toString(),feeWei:fee.toString(),contractAddress:r.contractAddress}};if(j.receipts.some(t=>same(t.hash,hashValue)))fail('Receipt already recorded');j.receipts.push(record);j.steps[x.key]=record;j.spentWei=(BigInt(j.spentWei)+fee).toString();j.pending=null;atomic(JOURNAL,j);if(Number(r.status)!==1||!same(r.contractAddress,x.predictedAddress)||(j.feeMode!=='market'&&BigInt(j.spentWei)>BigInt(j.approvedCapWei)))fail('Reverted, mismatched or over-cap transaction; recorded, no retry permitted');return record;}
async function checkPast(p,j){let spent=0n;for(const saved of j.receipts){const[r,tx]=await Promise.all([p.getTransactionReceipt(saved.hash),p.getTransaction(saved.hash)]);if(!r||!tx||!same(r.hash,saved.hash)||!same(tx.hash,saved.hash)||r.blockNumber!==saved.receipt.blockNumber||r.gasUsed!==BigInt(saved.receipt.gasUsed)||BigInt(r.gasPrice??tx.gasPrice)!==BigInt(saved.receipt.gasPriceWei)||Number(r.status)!==1||tx.to!==null||!same(tx.from,OWNER)||tx.nonce!==saved.nonce||BigInt(tx.chainId)!==CHAIN||tx.value!==0n||!same(keccak256(tx.data),saved.calldataHash)||!same(r.blockHash,saved.receipt.blockHash)||!same(r.contractAddress,saved.predictedAddress)||tx.gasLimit!==BigInt(saved.gasLimit)||tx.gasPrice!==BigInt(saved.gasPriceWei??j.feeCeilingWeiPerGas))fail('Prior operation differs');const block=await p.getBlock(r.blockNumber);if(!block||!same(block.hash,r.blockHash))fail('Prior receipt is not canonical');spent+=r.gasUsed*BigInt(r.gasPrice??tx.gasPrice);}if(spent!==BigInt(j.spentWei))fail('Receipt fee sum differs from journal');}
async function deploy(p,j,bundle,build,w){
 for(const s of bundle.model.shards){if(j.reusedShards.some(x=>x.index===s.index))continue;await send('shard:'+s.index,s.initCodeHex);const code=await p.getCode(j.shards[s.index]);if(!same(keccak256(code),s.runtimeKeccak256)||(code.length-2)/2!==s.runtimeBytes)fail('New shard runtime differs');}
 for(const[role,a]of Object.entries(build.artifacts)){let args;if(role==='model')args=[bundle.model.config,CHECKPOINT,MANIFEST_ID,j.shards,bundle.model.shards.map(s=>s.runtimeKeccak256),bundle.model.shardBytes];else if(role==='engine')args=[j.contracts.model.address,ZeroAddress];else if(role==='adapter')args=[READER,READER_HASH];else if(role==='codec')args=[];else args=[j.contracts.engine.address,j.contracts.adapter.address,j.contracts.codec.address,j.contracts.engine.codeHash,j.contracts.adapter.codeHash,j.contracts.codec.codeHash,j.expectedModelId,DOMAIN,j.schemaHash];const tx=await new ContractFactory(a.abi,a.bytecode).getDeployTransaction(...args);const r=await send('deploy:'+role,tx.data);j.contracts[role]={...await codeRecord(p,r.predictedAddress,a),name:a.name,constructorArguments:args,transactionHash:r.hash,blockNumber:r.receipt.blockNumber};if(role==='model')await checkModel(p,j,bundle,build);if(role==='adapter'){const c=new Contract(r.predictedAddress,a.abi,p);if(!same(await c.schemaHash(),j.schemaHash))fail('Schema mismatch');}atomic(JOURNAL,j);}
 await verify(p,j,bundle,build);j.complete=true;j.completedAt=new Date().toISOString();atomic(JOURNAL,j);
 async function send(key,data){
  if(j.steps[key]){const r=j.steps[key];if(r.receipt.status!==1||!same(r.calldataHash,keccak256(data)))fail('Saved operation differs or reverted');return r;}
  if(j.pending)fail('Unresolved signed transaction blocks further sends');
  const live=await context(p),market=j.feeMode==='market';let price=market?live.gasPriceWei:BigInt(j.feeCeilingWeiPerGas);
  if(!market&&live.gasPriceWei>price)fail('Fee ceiling exceeded');
  const expectedNonce=j.startNonce+j.receipts.length;if(live.pendingNonce!==expectedNonce||live.confirmedNonce!==expectedNonce)fail('Signer nonce changed or has pending external activity');
  const estimateRequest={from:OWNER,data,value:0n,gasLimit:live.operationalGasCap};if(!market)estimateRequest.gasPrice=price;
  const estimate=BigInt(await p.estimateGas(estimateRequest)),gasLimit=(estimate*120n+99n)/100n;
  // Market estimates use the RPC's current fee internally. Price is refreshed
  // only after simulation/balance reads, avoiding a stale low supplied fee.
  const balance=await p.getBalance(OWNER);let baseQuotedGasPriceWei=null;if(market){baseQuotedGasPriceWei=BigInt(await p.send('eth_gasPrice',[]));price=(baseQuotedGasPriceWei*105n+99n)/100n;}if(price<=0n)fail('Current market gas price unavailable');
  const reserve=gasLimit*price;if(gasLimit>live.operationalGasCap||(!market&&BigInt(j.spentWei)+reserve>BigInt(j.approvedCapWei))||balance<reserve)fail('Gas, cumulative cap or balance cannot cover next transaction');
  const predictedAddress=getCreateAddress({from:OWNER,nonce:expectedNonce});if(!same(predictedAddress,j.predictions[key]))fail('Frozen address prediction differs');
  let raw=await w.signTransaction({chainId:CHAIN,nonce:expectedNonce,data,value:0n,gasLimit,gasPrice:price,type:0});const txHash=keccak256(raw);
  j.pending={key,hash:txHash,nonce:expectedNonce,predictedAddress,calldataHash:keccak256(data),gasEstimate:estimate.toString(),gasLimit:gasLimit.toString(),gasPriceWei:price.toString(),baseQuotedGasPriceWei:market?baseQuotedGasPriceWei.toString():null,marketPremiumBps:market?500:0,reserveWei:reserve.toString(),preparedAt:new Date().toISOString(),status:'prepared'};atomic(JOURNAL,j);
  try{const got=await p.send('eth_sendRawTransaction',[raw]);if(!same(got,txHash))fail('RPC returned a different hash');raw=undefined;j.pending.status='broadcast';atomic(JOURNAL,j);}catch(e){raw=undefined;j.pending.status='ambiguous';j.pending.error=errorData(e);atomic(JOURNAL,j);fail('Broadcast ambiguous; reconcile saved hash, no retry was sent');}
  const r=await settle(p,j,txHash);process.stdout.write(json({confirmed:key,hash:txHash,spentWei:j.spentWei}));return r;
 }

}
function argsOf(argv){const a={mode:argv[0]??'help'};for(let i=1;i<argv.length;i++){const k=argv[i].replace(/^--/,'');if(!argv[i].startsWith('--')||!['rpc','chain','cap-wei','fee-ceiling-wei','build-hash','plan-hash','hash','market','private-rpc'].includes(k)||k in a)fail('Unsupported/repeated flag');a[k]=argv[++i];if(a[k]===undefined)fail('Missing flag value');}return a;}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
function acceptedPlan(build){const plan=read(PLAN),{planFingerprint,observed,limitations,...identity}=plan;if(hash(json(identity))!==planFingerprint||plan.buildFingerprint!==build.manifest.buildFingerprint||plan.chainId!==4663||!same(plan.owner,OWNER)||plan.modelManifestSha256!==MANIFEST_SHA||!same(plan.modelManifestHash,MANIFEST_ID)||!same(plan.sourceCheckpoint,CHECKPOINT)||plan.totalTransactions!==51)fail('Saved accepted plan identity changed');return plan;}
function journalIdentity(j,plan,bundle,build){
 const expected={chainId:4663,owner:OWNER,buildFingerprint:build.manifest.buildFingerprint,planFingerprint:plan.planFingerprint,modelManifestSha256:MANIFEST_SHA,modelManifestHash:MANIFEST_ID,sourceCheckpoint:CHECKPOINT,startNonce:plan.startNonce,expectedModelId:plan.expectedModelId,modelId:plan.expectedModelId,schemaHash:SCHEMA,domainSha256:DOMAIN,configurationHash:keccak256(AbiCoder.defaultAbiCoder().encode([CFG],[bundle.model.config])),shards:plan.shards,reusedShards:plan.reusedShards,predictions:plan.predictions};
 for(const[k,v]of Object.entries(expected))if(canonical(j[k])!==canonical(v))fail('Journal immutable identity differs: '+k);
 if(!['market','capped'].includes(j.feeMode??'capped'))fail('Unknown saved fee mode');
 if(j.receipts.length>51||Object.keys(j.steps).length!==j.receipts.length)fail('Journal operation count differs');
 const keys=new Set();for(const[rIndex,r]of j.receipts.entries()){if(keys.has(r.key)||r.nonce!==plan.startNonce+rIndex||!same(r.predictedAddress,plan.predictions[r.key])||canonical(j.steps[r.key])!==canonical(r))fail('Journal operation differs from accepted plan');keys.add(r.key);}
 if(j.pending&&(keys.has(j.pending.key)||j.pending.nonce!==plan.startNonce+j.receipts.length||!same(j.pending.predictedAddress,plan.predictions[j.pending.key])))fail('Pending operation differs from accepted plan');
}
async function main(){
 const a=argsOf(process.argv.slice(2));if(a.mode==='help'){console.log('analysis-deploy.mjs compile | plan | verify | deploy | resume | reconcile; deploy/resume require --chain 4663 --build-hash HASH --plan-hash HASH and either --market true OR --cap-wei N --fee-ceiling-wei N; optional --private-rpc true uses stdin {privateKey,rpcUrl}; verify/reconcile need rpcUrl only');return;}
 if(a.market!==undefined&&a.market!=='true')fail('--market accepts only true');if(a['private-rpc']!==undefined&&a['private-rpc']!=='true')fail('--private-rpc accepts only true');
 const market=a.market==='true';if(market&&(a['cap-wei']!==undefined||a['fee-ceiling-wei']!==undefined))fail('Market mode cannot be combined with artificial cap/ceiling flags');
 const bundle=modelBundle(),build=compile(bundle);if(a.mode==='compile'){console.log(json(build.manifest));return;}
 const isPrivate=a['private-rpc']==='true';if(isPrivate&&(!['deploy','resume','verify','reconcile'].includes(a.mode)||a.rpc!==undefined))fail('Private transport is limited to deploy/resume/verify/reconcile and stdin only');const prepared=isPrivate?await credential({needsKey:['deploy','resume'].includes(a.mode),isPrivate:true}):null;const rpc=isPrivate?prepared.rpcUrl:(a.rpc??RPCS[0]),publicRpc=isPrivate?RPCS[0]:rpc,p=providerFor(rpc,isPrivate);
 try{
  if(a.mode==='plan'){if(fs.existsSync(JOURNAL))fail('An existing deployment journal freezes its accepted plan; use resume/verify');const result=await plan(p,bundle,build,rpc);console.log(json(result));return;}
  let j=fs.existsSync(JOURNAL)?read(JOURNAL):null;
  const planRaw=acceptedPlan(build);if(j)journalIdentity(j,planRaw,bundle,build);
  if(a.mode==='verify'){if(!j?.complete)fail('Deployment is not complete');await checkPast(p,j);await verify(p,j,bundle,build);console.log(json({verified:true,modelId:j.expectedModelId,contracts:j.contracts,spentWei:j.spentWei,feeMode:j.feeMode}));return;}
  if(a.mode==='reconcile'){if(!j||!a.hash)fail('Journal and exact pending --hash required');await settle(p,j,a.hash);console.log(json({reconciled:a.hash}));return;}
  if(!['deploy','resume'].includes(a.mode))fail('Unknown mode');
  const cap=market?null:exact(a['cap-wei'],'cap'),ceiling=market?null:exact(a['fee-ceiling-wei'],'fee ceiling');
  if(!market&&(cap<BigInt(planRaw.totalGasReserve)*ceiling||cap<=0n||cap>HARD_CAP||ceiling<=0n||ceiling>1_000_000_000n))fail('Capped mode cannot cover its accepted deployment forecast');
  if(a.chain!=='4663'||a['build-hash']!==build.manifest.buildFingerprint||a['plan-hash']!==planRaw.planFingerprint)fail('Explicit chain/build/plan authorization differs');
  const feeMode=market?'market':'capped';
  if(j){if(a.mode!=='resume'||(j.feeMode??'capped')!==feeMode||j.approvedCapWei!==(market?null:cap.toString())||j.feeCeilingWeiPerGas!==(market?null:ceiling.toString()))fail('Existing journal requires exactly the saved fee mode and parameters');await checkPast(p,j);}
  else{
   if(a.mode!=='deploy')fail('No journal to resume');const live=await context(p);
   if(live.pendingNonce!==planRaw.startNonce||live.confirmedNonce!==planRaw.startNonce||(!market&&(live.gasPriceWei>ceiling||live.balanceWei<cap)))fail('Fresh balance/nonce/price differs from accepted plan');
   j={format:'s0ul-analysis-mainnet-deployment-v1',chainId:4663,owner:OWNER,publicRpc,transportLabel:isPrivate?'alchemy-private':'public',buildFingerprint:a['build-hash'],planFingerprint:a['plan-hash'],modelManifestSha256:MANIFEST_SHA,modelManifestHash:MANIFEST_ID,sourceCheckpoint:CHECKPOINT,expectedModelId:planRaw.expectedModelId,modelId:planRaw.expectedModelId,configurationHash:keccak256(AbiCoder.defaultAbiCoder().encode([CFG],[bundle.model.config])),schemaHash:SCHEMA,domainSha256:DOMAIN,feeMode,approvedCapWei:market?null:cap.toString(),feeCeilingWeiPerGas:market?null:ceiling.toString(),startNonce:planRaw.startNonce,predictions:planRaw.predictions,reusedShards:planRaw.reusedShards,shards:planRaw.shards,contracts:{reader:{address:READER,codeHash:READER_HASH}},steps:{},receipts:[],spentWei:'0',pending:null,complete:false,createdAt:new Date().toISOString()};
   journalIdentity(j,planRaw,bundle,build);atomic(JOURNAL,j);
  }
  if(j.pending)fail('Pending hash requires read-only reconcile before resume');
  j.transportLabel=isPrivate?'alchemy-private':'public';atomic(JOURNAL,j);
  const w=prepared?.wallet??(await credential()).wallet;await deploy(p,j,bundle,build,w);console.log(json({complete:true,contracts:j.contracts,spentWei:j.spentWei,feeMode:j.feeMode}));
 }finally{p.destroy();if(prepared)prepared.rpcUrl='';}
}
main().catch(e=>{console.error(json({error:errorData(e)}));process.exitCode=1;});
