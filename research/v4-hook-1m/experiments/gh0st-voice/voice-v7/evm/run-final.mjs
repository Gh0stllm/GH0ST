// Extended LOCAL-ONLY trained adaptive GRU / real Uniswap v4 benchmark.
// Data runtimes are injected with hardhat_setCode; this is not a deployment-cost benchmark.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import solc from 'solc';
import solcV4 from 'solc-v4';
import hre from 'hardhat';
import * as ethers from 'ethers';
const directory=path.dirname(fileURLToPath(import.meta.url)),base=path.resolve(directory,'../../../..');
const argv=process.argv.slice(2),opt=(key,def)=>(argv.find(x=>x.startsWith(key+'='))??key+'='+def).slice(key.length+1);
assert(argv.every(x=>/^--(model-dir|turns|temperature|label|callers)=/.test(x)),'Unknown option');
const turns=Number(opt('--turns',256)),temperature=Number(opt('--temperature',256)),label=opt('--label','gru2-punct-final'),callers=Number(opt('--callers',2));
assert(Number.isInteger(turns)&&turns>=12&&turns<=10000);assert(Number.isInteger(temperature)&&temperature>=64&&temperature<=4096);assert(/^[a-z0-9-]+$/.test(label));
assert(Number.isInteger(callers)&&callers>=2&&callers<=4);
assert(argv.some(x=>x.startsWith('--model-dir=')),'Specify an explicitly selected trained model export');
const experiment=path.join(base,'experiments/gh0st-voice/recurrent-v1'),modelDir=path.resolve(base,opt('--model-dir',''));
const seed=ethers.zeroPadValue(ethers.toBeHex(42),32);
const MODEL=existsSync(path.join(modelDir,'GRU2WordPunctModel.sol'))?path.relative(base,path.join(modelDir,'GRU2WordPunctModel.sol')).split(path.sep).join('/'):'experiments/gh0st-voice/voice-v7/evm/contracts/GRU2WordPunctModel.sol',HOOK='experiments/gh0st-voice/voice-v7/evm/contracts/GRU2WordPunctHook.sol';
const HARNESS='tests/evm/SentenceV4IntegrationHarness.sol',MANAGER='@uniswap/v4-core/src/PoolManager.sol';
const reportPath=path.join(directory,label+'-local.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,(_,x)=>typeof x==='bigint'?x.toString():x,2);
const TX_CEILING=32000000n,CHUNK=24000;
const result={schemaVersion:2,mode:'LOCAL_ONLY_NO_PUBLIC_RPC_OR_TRANSACTIONS',status:'RUNNING',seed,temperatureQ10:temperature,languageQuality:'NOT_EVALUATED_OR_APPROVED',startedAt:new Date().toISOString(),network:{chainId:31337,hardfork:'cancun',transactionGasCeiling:TX_CEILING.toString(),blockGasLimit:TX_CEILING.toString()},limitations:['All data-shard runtime code is injected with hardhat_setCode, not deployed by transactions.','PoolManager, model, hook, router and test tokens are deployed by actual local transactions.','Neural heads evaluate128group+64word+5punctuation logits per word; all256hidden units across two GRU128 layers and fused input lookup are evaluated.','This benchmark establishes EVM behavior and gas, not language quality or mainnet deployment readiness.'],artifacts:{},dataInjection:{method:'hardhat_setCode',chunkBytes:CHUNK,groups:{}},deployments:[],swaps:[],auxiliarySwaps:[],boundaryProbes:[],checks:{},publicTransactionsSubmitted:0};
const save=()=>writeFileSync(reportPath,json(result)+'\n');
const guard=async()=>assert.equal(await hre.network.provider.request({method:'eth_chainId'}),'0x7a69','Refusing a write outside isolated local chain31337.');
const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
function compile(){
 const imports={import:file=>{for(const p of [path.join(base,file),path.join(base,'node_modules',file),path.join(base,'node_modules/@uniswap/v4-core/lib',file)])if(existsSync(p))return{contents:readFileSync(p,'utf8')};return{error:'Missing import '+file};}};
 const sources=Object.fromEntries([MODEL,HOOK,HARNESS,'experiments/gh0st-voice/recurrent-v1/evm/ContinuityHarness.sol'].map(file=>[file,{content:readFileSync(path.join(base,file),'utf8')}]));
 const c=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings}),imports));
 const errors=(c.errors||[]).filter(x=>x.severity==='error');assert.equal(errors.length,0,errors.map(x=>x.formattedMessage).join('\n'));
 const core=JSON.parse(solcV4.compile(JSON.stringify({language:'Solidity',sources:{[MANAGER]:{content:readFileSync(path.join(base,'node_modules',MANAGER),'utf8')}},settings}),imports));
 const ce=(core.errors||[]).filter(x=>x.severity==='error');assert.equal(ce.length,0,ce.map(x=>x.formattedMessage).join('\n'));
 c.contracts[MANAGER]=core.contracts[MANAGER];return c.contracts;
}

let provider;
async function main(){
 const manifest=JSON.parse(readFileSync(path.join(modelDir,'manifest.json')));result.modelManifest=manifest;
 assert(manifest.checkpoint_sha256,'Extended benchmark requires a checkpoint-bound model export');
 if(manifest.source_sha256)assert.equal(sha(readFileSync(path.join(base,MODEL))),manifest.source_sha256,'Generated model source does not match the export');
 const expected={core:300288,groups:33024,words:2113536,vocabulary:262144,fused:15730560,punctuation:92810};
 for(const [group,bytes]of Object.entries(expected)){
  const file=group+'.bin',payload=readFileSync(path.join(modelDir,file));assert.equal(payload.length,bytes);
  assert.equal(sha(payload),manifest.artifacts[file].sha256);result.artifacts[file]={bytes,sha256:sha(payload)};
 }
 for(const file of [MODEL,HOOK])result.artifacts[file]={sha256:sha(readFileSync(path.join(base,file)))};
 result.stage='COMPILE';save();const artifacts=compile();
 hre.config.networks.hardhat.blockGasLimit=Number(TX_CEILING);hre.config.networks.hardhat.throwOnTransactionFailures=false;hre.config.networks.hardhat.throwOnCallFailures=true;
 await hre.network.provider.request({method:'hardhat_reset',params:[]});await guard();
 provider=new ethers.BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 assert.equal((await provider.getBlock('latest')).gasLimit,TX_CEILING);
 const signer=await provider.getSigner(0),payer=await signer.getAddress();
 const traders=await Promise.all(Array.from({length:callers},(_,i)=>provider.getSigner(i))),traderAddresses=await Promise.all(traders.map(s=>s.getAddress()));
 result.callers=traderAddresses;
 async function send(request,sender=signer){
  await guard();assert(BigInt(request.gasLimit)<=TX_CEILING);const tx=await sender.sendTransaction(request);let receipt;
  try{receipt=await tx.wait();}catch(e){receipt=e.receipt;if(!receipt)throw e;}return receipt;
 }
 async function deploy(file,name,args=[],gasLimit=TX_CEILING){
  const a=artifacts[file][name];assert(a.evm.deployedBytecode.object.length/2<=24576);
  const request=await new ethers.ContractFactory(a.abi,a.evm.bytecode.object,signer).getDeployTransaction(...args);
  const receipt=await send({...request,gasLimit});assert.equal(receipt.status,1,name+' deployment');
  result.deployments.push({name,address:receipt.contractAddress,gasUsed:receipt.gasUsed,runtimeHash:ethers.keccak256(await provider.getCode(receipt.contractAddress)),runtimeBytes:a.evm.deployedBytecode.object.length/2});save();
  return new ethers.Contract(receipt.contractAddress,a.abi,signer);
 }
 result.stage='INJECT_LOCAL_DATA';save();const groups={};let index=0;
 for(const [group,bytes]of Object.entries(expected)){
  const payload=readFileSync(path.join(modelDir,group+'.bin')),addresses=[];let commitment=ethers.ZeroHash;
  for(let start=0;start<bytes;start+=CHUNK){
   const address=ethers.getAddress(ethers.toBeHex(0x100000n+BigInt(index++),20)),code='0x00'+payload.subarray(start,start+CHUNK).toString('hex');
   await guard();await hre.network.provider.request({method:'hardhat_setCode',params:[address,code]});assert.equal(await provider.getCode(address),code);
   commitment=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','bytes32'],[commitment,ethers.keccak256(code)]));addresses.push(address);
  }
  groups[group]=addresses;result.dataInjection.groups[group]={shards:addresses.length,payloadBytes:bytes,runtimeCommitment:commitment};
 }
 result.dataInjection.totalShards=index;result.checks.allDataRuntimesVerified=true;save();
 const catalogs={};let catalogIndex=0;
 for(const [group,addresses]of Object.entries(groups)){const catalog=ethers.getAddress(ethers.toBeHex(0x500000n+BigInt(catalogIndex++),20));const code='0x00'+addresses.map(a=>a.slice(2).toLowerCase()).join('');assert((code.length-2)/2<=24576);await guard();await hre.network.provider.request({method:'hardhat_setCode',params:[catalog,code]});assert.equal(await provider.getCode(catalog),code);catalogs[group]=catalog;}
 result.dataInjection.catalogs=catalogs;
 const model=await deploy(MODEL,'GRU2WordPunctModel',[catalogs.core,catalogs.groups,catalogs.words,catalogs.vocabulary,catalogs.fused,catalogs.punctuation]);
 result.modelHash=await model.modelHash();const coder=ethers.AbiCoder.defaultAbiCoder();
 const directInput=[8192,0,Array(256).fill(0),[0,0,0,0,1024,1024],seed,0,temperature];
 const directRequest={to:model.target,data:model.interface.encodeFunctionData('stepSampled',directInput),gasLimit:TX_CEILING};
 const directReceipt=await send(directRequest);result.directProbe={gasUsed:directReceipt.gasUsed,status:directReceipt.status,input:directInput};save();assert.equal(directReceipt.status,1,'direct two-layer model exceeds32M or reverts');
 const directOutput=model.interface.decodeFunctionResult('stepSampled',await provider.call(directRequest));assert.equal(directOutput[3].length,197);result.directProbe.token=Number(directOutput[0]);result.directProbe.logitCount=197;save();
 const boundaryInputs=[
  [0,4,Array.from({length:256},(_,i)=>i%2?-1024:1024),[4096,4096,4096,4096,-4096,-4096],seed,255,64],
  [8191,3,Array.from({length:256},(_,i)=>i%2?1024:-1024),[-4096,-4096,-4096,-4096,4096,4096],seed,256,4096],
  [8192,0,Array(256).fill(0),[0,0,0,0,0,0],seed,257,temperature]
 ];
 for(const probeInput of boundaryInputs){
  const req={to:model.target,data:model.interface.encodeFunctionData('stepSampled',probeInput),gasLimit:TX_CEILING};
  const receipt=await send(req);assert.equal(receipt.status,1,'Boundary model probe');
  const output=model.interface.decodeFunctionResult('stepSampled',await provider.call(req));
  result.boundaryProbes.push({input:probeInput,token:Number(output[0]),punct:Number(output[1]),hidden:Array.from(output[2]),scores:Array.from(output[3]),text:output[4],terminal:output[5],gasUsed:receipt.gasUsed});save();
 }
 for(const [name,changes]of [['inputOnlyUnk',{0:8193}],['stateOutOfRange',{2:Array(256).fill(1025)}],['featureOutOfRange',{3:[4097,0,0,0,0,0]}],['punctOutOfRange',{1:5}],['temperatureLow',{6:63}],['temperatureHigh',{6:4097}]]){
  const bad=[...directInput];for(const [i,v]of Object.entries(changes))bad[Number(i)]=v;
  const receipt=await send({to:model.target,data:model.interface.encodeFunctionData('stepSampled',bad),gasLimit:1000000n});assert.equal(receipt.status,0,name);result.checks[name]={passed:true,gasUsed:receipt.gasUsed};
 }

 const expectedHash=ethers.keccak256(coder.encode(['string','bytes32','bytes32','bytes32','bytes32','bytes32','bytes32'],['GH0ST_GRU2_H128_WORD_PUNCT_Q10_LOCAL_V1',...Object.keys(expected).map(g=>result.dataInjection.groups[g].runtimeCommitment)]));
 assert.equal(result.modelHash,expectedHash);result.checks.modelHashMatchesIndependentCommitments=true;
 const manager=await deploy(MANAGER,'PoolManager',[payer]);
 const routerFile='experiments/gh0st-voice/recurrent-v1/evm/ContinuityHarness.sol';
 const router=await deploy(routerFile,'ContinuityTestRouter',[manager.target]);const factory=await deploy(HARNESS,'SentenceV4Create2Factory');
 const tokens=[await deploy(HARNESS,'SentenceV4TestToken'),await deploy(HARNESS,'SentenceV4TestToken')].sort((a,b)=>BigInt(a.target)<BigInt(b.target)?-1:1);
 for(const token of tokens)for(let i=0;i<traders.length;i++){assert.equal((await send({to:token.target,data:token.interface.encodeFunctionData('mint',[traderAddresses[i],10n**27n]),gasLimit:200000n})).status,1);assert.equal((await send({to:token.target,data:token.interface.encodeFunctionData('approve',[router.target,ethers.MaxUint256]),gasLimit:200000n},traders[i])).status,1);}
 const hookArtifact=artifacts[HOOK].GRU2WordPunctHook;
 const init=(await new ethers.ContractFactory(hookArtifact.abi,hookArtifact.evm.bytecode.object,signer).getDeployTransaction(manager.target,model.target,28500000,seed,temperature)).data;
 const initHash=ethers.keccak256(init);let salt,address;
 for(let i=0;;i++){salt=ethers.zeroPadValue(ethers.toBeHex(i),32);address=ethers.getCreate2Address(factory.target,salt,initHash);if((BigInt(address)&0x3fffn)===0x1040n)break;}
 assert.equal((await send({to:factory.target,data:factory.interface.encodeFunctionData('deploy',[salt,init]),gasLimit:8000000n})).status,1);
 const hook=new ethers.Contract(address,hookArtifact.abi,signer);result.hookAddress=address;
 const key={currency0:tokens[0].target,currency1:tokens[1].target,fee:3000,tickSpacing:60,hooks:address};
 const idOf=k=>ethers.keccak256(coder.encode(['address','address','uint24','int24','address'],Object.values(k))),id=idOf(key);
 result.pool={key,id};
 async function initialize(k){assert.equal((await send({to:manager.target,data:manager.interface.encodeFunctionData('initialize',[k,2n**96n]),gasLimit:2000000n})).status,1);assert.equal((await send({to:router.target,data:router.interface.encodeFunctionData('modifyLiquidity',[k,{tickLower:-60000,tickUpper:60000,liquidityDelta:10n**20n,salt:ethers.ZeroHash}]),gasLimit:2000000n})).status,1);}
 await initialize(key);
 const snapshot=async(k=key)=>({context:Array.from(await hook.contexts(idOf(k))),hidden:Array.from(await hook.hiddenState(idOf(k))),pool:Array.from(await router.poolState(k)),balances:await Promise.all(traderAddresses.flatMap(owner=>tokens.map(t=>t.balanceOf(owner))))});
 const params=n=>({zeroForOne:n%2===0,amountSpecified:-(n===Math.floor(turns/2)?10n**19n:100000000000000n),sqrtPriceLimitX96:n%2===0?4295128740n:1461446703485210103287273052203988822378723970341n});
 const input=c=>coder.encode(['uint64','bytes32'],[c[4],c[8]]);
 const request=(data,n=0,method='swapWithHookData',k=key,gasLimit=TX_CEILING)=>({to:router.target,data:router.interface.encodeFunctionData(method,[k,params(n),data]),gasLimit});
 async function reject(req,before,label,k=key){const receipt=await send(req);assert.equal(receipt.status,0,label);assert.equal(json(await snapshot(k)),json(before),label+' rollback');result.checks[label]={passed:true,gasUsed:receipt.gasUsed};}
 const initial=await snapshot();assert.equal(initial.context[4],0n);assert.equal(initial.context[5],8192n);assert.equal(initial.context[6],0n);assert(initial.hidden.every(x=>x===0n));result.checks.initialStateVerified=true;
 await reject(request(input(initial.context),0,'swapAndRevert'),initial,'postInferenceRollback');
 await reject(request(input(initial.context),0,'swapWithHookData',key,1000000n),initial,'lowGasRollback');
 for(const data of ['0x','0x'+'00'.repeat(63),'0x'+'00'.repeat(65)])await reject(request(data,0,'swapWithHookData',key,1000000n),initial,'malformedInput'+((data.length-2)/2)+'Rollback');
 const words=JSON.parse(readFileSync(path.join(modelDir,'vocabulary.json')));
 for(let n=0;n<turns;n++){
  if(n===Math.floor(turns/3)){await guard();await hre.network.provider.request({method:'evm_increaseTime',params:[301]});}
  const caller=n%traders.length,before=await snapshot(),receipt=await send(request(input(before.context),n),traders[caller]);assert.equal(receipt.status,1,'swap '+(n+1));
  const after=await snapshot(),events=receipt.logs.filter(l=>l.address.toLowerCase()===address.toLowerCase()).map(l=>hook.interface.parseLog(l));
  assert.equal(events.length,1);assert.equal(events[0].name,'WordSpoken');const event=events[0].args;
  const token=Number(event.token),features=Array.from(event.features,Number),scores=Array.from(event.branchScores,String);
  assert.equal(event.sequence,BigInt(n+1));assert.equal(event.sampleIndex,BigInt(n));assert.equal(event.text,words[token]+['',',','.','!','?'][Number(event.punct)]);assert.equal(after.context[6],event.punct);assert(event.text.length>0);assert.equal(event.terminal,/[.!?]$/.test(event.text));
  assert.equal(after.context[4],BigInt(n+1));assert.equal(after.context[5],BigInt(token));assert.equal(after.context[8],event.stateHash);
  assert.equal(event.previousStateHash,before.context[8]);assert.notEqual(json(before.balances),json(after.balances));
  const stateHash=ethers.keccak256(coder.encode(['bytes32','bytes32','uint64','uint16','uint8','int16[256]'],[result.modelHash,id,n+1,token,Number(event.punct),after.hidden]));assert.equal(stateHash,event.stateHash);
  const block=await provider.getBlock(receipt.blockNumber);const move=Math.min(1024,Math.abs(Number(after.pool[1])-Number(before.context[0])));
  const expectedFeatures=[move*4,Number(before.context[2])*4,Math.abs(move-Number(before.context[1]))*4,Math.floor(Math.min(300,block.timestamp-Number(before.context[3]))*1024/300),n%2===0?1024:-1024,1024];assert.deepEqual(features,expectedFeatures);
  result.swaps.push({swap:n+1,caller:traderAddresses[caller],token,punct:Number(event.punct),text:event.text,terminal:event.terminal,sampleIndex:Number(event.sampleIndex),features,branchScores:scores,before,after,gasUsed:receipt.gasUsed,status:receipt.status,stateHash:event.stateHash});
  if(n===0){
   await reject(request(input(initial.context),1,'swapWithHookData',key,1000000n),after,'staleInputRollback');
   await reject(request(coder.encode(['uint64','bytes32'],[after.context[4],ethers.ZeroHash]),1,'swapWithHookData',key,1000000n),after,'forgedStateHashRollback');
  }
  if(n%5===4){console.log('Swap '+(n+1)+': '+event.text+'; '+receipt.gasUsed+' gas');save();}
 }
 assert(result.swaps.some(s=>s.features[3]===1024),'Elapsed feature never reached clamp');
 assert(result.swaps.some(s=>s.features[0]===4096),'Tick feature never reached clamp');
 result.checks.elapsedFeatureClamp=true;result.checks.tickFeatureClamp=true;result.checks.multipleCallers=true;
 const final=await snapshot(),code=await provider.getCode(model.target);await guard();await hre.network.provider.request({method:'hardhat_setCode',params:[model.target,'0x00']});
 await reject(request(input(final.context)),final,'modifiedModelRollback');await guard();await hre.network.provider.request({method:'hardhat_setCode',params:[model.target,code]});
 const unauthorized=await send({to:hook.target,data:hook.interface.encodeFunctionData('afterSwap',[payer,key,params(0),0,input(final.context)]),gasLimit:1000000n});assert.equal(unauthorized.status,0);assert.equal(json(await snapshot()),json(final));result.checks.unauthorizedCallbackRejected=true;
 const other={...key,fee:500};await initialize(other);const otherBefore=await snapshot(other);assert.equal(otherBefore.context[4],0n);assert(otherBefore.hidden.every(x=>x===0n));
 for(let n=0;n<4;n++){
  const before=await snapshot(other),receipt=await send(request(input(before.context),n,'swapWithHookData',other),traders[(n+1)%traders.length]);assert.equal(receipt.status,1);
  const after=await snapshot(other),event=receipt.logs.filter(l=>l.address.toLowerCase()===address.toLowerCase()).map(l=>hook.interface.parseLog(l))[0].args;
  assert.equal(event.sequence,BigInt(n+1));assert.equal(event.sampleIndex,BigInt(n));assert.equal(after.context[5],event.token);
  assert.equal(event.stateHash,ethers.keccak256(coder.encode(['bytes32','bytes32','uint64','uint16','uint8','int16[256]'],[result.modelHash,idOf(other),n+1,event.token,event.punct,after.hidden])));
  result.auxiliarySwaps.push({swap:n+1,poolId:idOf(other),caller:traderAddresses[(n+1)%traders.length],token:Number(event.token),punct:Number(event.punct),text:event.text,terminal:event.terminal,sampleIndex:Number(event.sampleIndex),features:Array.from(event.features,Number),branchScores:Array.from(event.branchScores,String),before,after,gasUsed:receipt.gasUsed,status:receipt.status,stateHash:event.stateHash});
 }
 const primaryAfterOtherPool=await snapshot();
 for(const field of ['context','hidden','pool'])assert.equal(json(primaryAfterOtherPool[field]),json(final[field]),'Primary pool '+field+' changed after second pool activity');
 assert.equal((await snapshot(other)).context[4],4n);result.checks.poolIsolation=true;
 // Context is the first storage mapping; sequence is the packed uint64 at byte15.
 const otherSlot=ethers.keccak256(coder.encode(['bytes32','uint256'],[idOf(other),0])),originalSlot=await provider.getStorage(hook.target,otherSlot);
 const sequenceMask=((1n<<64n)-1n)<<120n,overflowSlot=(BigInt(originalSlot)&~sequenceMask)|sequenceMask;
 await guard();await hre.network.provider.request({method:'hardhat_setStorageAt',params:[hook.target,otherSlot,ethers.toBeHex(overflowSlot,32)]});
 const overflowBefore=await snapshot(other);assert.equal(overflowBefore.context[4],(1n<<64n)-1n);
 await reject(request(input(overflowBefore.context),0,'swapWithHookData',other),overflowBefore,'sequenceOverflowRollback',other);
 await guard();await hre.network.provider.request({method:'hardhat_setStorageAt',params:[hook.target,otherSlot,originalSlot]});
 const gases=result.swaps.map(r=>BigInt(r.gasUsed));assert(gases.every(g=>g<TX_CEILING));
 result.summary={swaps:turns,words:result.swaps.length,everySuccessfulSwapEmitsOneWord:true,noForcedPunctuation:true,hiddenStateNeverReset:true,naturalTerminalWords:result.swaps.filter(r=>r.terminal).length,minGas:gases.reduce((a,b)=>a<b?a:b),maxGas:gases.reduce((a,b)=>a>b?a:b),meanGas:gases.reduce((a,b)=>a+b,0n)/BigInt(turns),transcript:result.swaps.map(r=>r.text).join(' ')};
 const auxiliaryGases=result.auxiliarySwaps.map(r=>BigInt(r.gasUsed)),boundaryGases=result.boundaryProbes.map(r=>BigInt(r.gasUsed));
 assert([...auxiliaryGases,...boundaryGases].every(g=>g<TX_CEILING));
 Object.assign(result.summary,{callers:traderAddresses.length,auxiliarySwaps:auxiliaryGases.length,auxiliaryMaxGas:auxiliaryGases.reduce((a,b)=>a>b?a:b),boundaryModelProbes:boundaryGases.length,boundaryModelMaxGas:boundaryGases.reduce((a,b)=>a>b?a:b)});
 result.checks.allSwapsSettled=true;result.checks.monotonicSampleIndex=true;result.status='EVM_PASS_AWAITING_INDEPENDENT_REFERENCE';result.completedAt=new Date().toISOString();save();
 console.log(json(result.summary));
}
main().catch(error=>{result.status='FAIL';result.error=String(error.stack||error).slice(0,4000);save();console.error(result.error);process.exitCode=1;}).finally(async()=>{await provider?.destroy();});
