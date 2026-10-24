// Local-only full-model measurement. No external RPC, wallet key, fork or EDR path.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';
import solcV4 from 'solc-v4';
import * as ethers from 'ethers';

const DIR=path.dirname(fileURLToPath(import.meta.url)),BASE=path.resolve(DIR,'../../../..'),MODEL_DIR=path.resolve(DIR,'../..');
const PREFIX=path.relative(BASE,DIR).split(path.sep).join('/');
let CONFIG={modelSource:path.relative(BASE,path.join(MODEL_DIR,'optimization/kernel/SimpleStoriesV2ModelOptimized.sol')),hookSource:PREFIX+'/SimpleStoriesV2StreamingHook.sol',modelName:'SimpleStoriesV2Model',hookName:'SimpleStoriesV2StreamingHook',probeName:'LocalForwardProbe',port:18556};
const HARNESS='tests/evm/SentenceV4IntegrationHarness.sol',MANAGER='@uniswap/v4-core/src/PoolManager.sol',HELPER='LocalGenerationProbe.sol';
const ARGS=process.argv.slice(2),SMOKE=ARGS.includes('--smoke'),LABEL=(ARGS.find(x=>x.startsWith('--label='))??'--label=latest').slice(8);
assert(ARGS.includes('--anvil') && ARGS.every(x=>x==='--anvil'||x==='--smoke'||x==='--profile'||/^--label=[a-z0-9-]+$/.test(x)||/^--variant=swar(5|8|8tile|8unrolled|8pruned)$/.test(x)),'Only --anvil [--smoke] [--label=slug] [--variant=swar5|swar8|swar8tile] [--profile] are supported');
const PROFILE=ARGS.includes('--profile'),PROFILE_SOURCE='LocalStageProfile.sol';
const VARIANT='swar8streaming';
const KERNEL_DIR=path.join(MODEL_DIR,'optimization/kernel8streaming');
CONFIG={...CONFIG,modelSource:path.relative(BASE,path.join(KERNEL_DIR,'SimpleStoriesV2ModelOptimized.sol'))};
const OUTPUT='streaming-benchmark.json';
const CAP=32_000_000n,HIGH=16_000_000_000n,HIGH_MODEL=14_000_000_000n,SPK1='0x53504b31',CHUNK=24_000;
const URL=`http://127.0.0.1:${CONFIG.port}`,TIMEOUT=180_000;
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2),sha=b=>createHash('sha256').update(b).digest('hex');
const read=name=>JSON.parse(readFileSync(path.join(MODEL_DIR,name)));
const readRun=name=>JSON.parse(readFileSync(path.join(DIR,name)));
const manifest=read('model/manifest.json'),protocol=read('contracts/protocol.json'),reference=readRun('reference.json'),streamReference=readRun('streaming-reference.json');
const DATA_DIR=path.join(KERNEL_DIR,'model'),runtimeManifest=JSON.parse(readFileSync(path.join(DATA_DIR,'manifest.json')));
assert.equal(runtimeManifest.parameters,manifest.parameters,'Packed export must preserve total model parameters');
assert.equal(runtimeManifest.source_weights_sha256,manifest.artifacts['weights.bin'].sha256);
assert.equal(runtimeManifest.checkpoint_sha256,manifest.checkpoint_sha256);
const runtimeDomain=runtimeManifest.model_hash_domain;
assert.equal(typeof runtimeDomain,'string');
const architecture={hidden_size:128,layers:4,intermediate_size:341,attention_heads:4,key_value_heads:2,vocabulary:4019},bounds=protocol.bounds;
const result={schemaVersion:3,status:'RUNNING',testLabel:LABEL,variant:VARIANT,smoke:SMOKE,runnerArgs:ARGS,compilers:{model:solc.version(),poolManager:solcV4.version()},startedAt:new Date().toISOString(),repository:manifest.repository,revision:manifest.revision,architecture:{...architecture,parameters:manifest.parameters,quantization:manifest.quantization},network:{backend:'Anvil',chainId:31337,hardfork:'cancun',loopback:`127.0.0.1:${CONFIG.port}`,forking:false,stepsTracing:false,normalTransactionGasCeiling:CAP,elevatedGasUsed:false},originalModelManifest:manifest,modelManifest:runtimeManifest,artifacts:{},deployments:[],dataInjection:{method:'anvil_setCode',chunkBytes:CHUNK,groups:{}},probes:[],checks:{},limitations:['All measurements are on an isolated local chain, never mainnet.','Weights are injected as verified runtime data shards; their deployment costs are not measured.','All weights, transformer layers, and full output vocabulary are evaluated; no row proxy or distilled replacement is used.','INT16 fixed-point arithmetic approximates the original FP32 checkpoint. Exact agreement here is with the independent integer reference.','A token-limited continuation is not described as a complete answer. EOS and actual generated token count are reported separately.','Elevated local gas controls do not demonstrate usability under the normal 32M ceiling.']};
const save=()=>writeFileSync(path.join(DIR,OUTPUT),json(result)+'\n');
let child,tempDir,provider,stderr='',elevated=false;
async function rpc(method,params=[],timeout=TIMEOUT){
 const res=await fetch(URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(timeout)});const body=await res.json();
 if(body.error){const error=new Error(body.error.message);error.data=body.error.data;throw error;}return body.result;
}
const guard=async()=>assert.equal(await rpc('eth_chainId'), '0x7a69','Only isolated local chain31337 is permitted');
function decodeFailure(error){let data=error.data??error.error?.data??error.info?.error?.data??null;if(data&&typeof data==='object')data=data.data??data.result??null;const needle=ethers.id('SpeechRequired(uint8)').slice(2,10),at=typeof data==='string'?data.indexOf(needle):-1;const reason=at<0?null:Number(BigInt('0x'+data.slice(at+8,at+72)));return{data,speechRequiredReason:reason,message:String(error.shortMessage??error.message??'').slice(0,200)};}
function stageProfileSource(original){
 let source=original.slice(0,original.indexOf('    function forward('));
 source=source.replace('contract SimpleStoriesV2Model {','contract SimpleStoriesV2ModelProfile {');
 source=source.replace('function _forward(uint16[] memory prompt) private view returns (uint16 nextToken, int32[128] memory lastHidden, bytes32 logitHash) {','function profile(uint16[] memory prompt) public view returns (uint16 nextToken, int32[128] memory lastHidden, bytes32 logitHash, uint256[7] memory stageGas) {\n        uint256 stageStart = gasleft();');
 const at=source.indexOf('    function profile('),headAt=source.indexOf('    function _head(');let body=source.slice(at,headAt<0?undefined:headAt);const tail=headAt<0?'':source.slice(headAt);
 body=body.replace('        for (uint256 layer; layer < LAYERS; ++layer) {','        stageGas[0] = stageStart - gasleft();\n        for (uint256 layer; layer < LAYERS; ++layer) {\n            stageStart = gasleft();');
 body=body.replace('        }\n        _fill(_weights, FINAL_NORM_OFFSET','            stageGas[layer + 1] = stageStart - gasleft();\n        }\n        stageStart = gasleft();\n        _fill(_weights, FINAL_NORM_OFFSET');
 body=body.replace('        int256[] memory logits =','        stageGas[5] = stageStart - gasleft();\n        stageStart = gasleft();\n        int256[] memory logits =');
 body=body.replace('        logitHash = keccak256(abi.encode(logits));','        logitHash = keccak256(abi.encode(logits));\n        stageGas[6] = stageStart - gasleft();');
 if(headAt>=0)body=body.replace('(nextToken, logitHash) = _head(w.norm, matrixWeights);','stageGas[5] = stageStart - gasleft();\n        stageStart = gasleft();\n        (nextToken, logitHash) = _head(w.norm, matrixWeights);\n        stageGas[6] = stageStart - gasleft();');
 source=source.slice(0,at)+body+tail+'}\n';return source;
}
function compile(){
 const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','storageLayout']}}};
 const imports={import:f=>{for(const p of [path.join(BASE,f),path.join(BASE,'node_modules',f),path.join(BASE,'node_modules/@uniswap/v4-core/lib',f)])if(existsSync(p))return{contents:readFileSync(p,'utf8')};return{error:'Missing '+f};}};
 const sources=Object.fromEntries([CONFIG.modelSource,CONFIG.hookSource,HARNESS].map(f=>[f,{content:readFileSync(path.join(BASE,f),'utf8')}]));
 if(PROFILE){const content=stageProfileSource(sources[CONFIG.modelSource].content);sources[PROFILE_SOURCE]={content};writeFileSync(path.join(DIR,'profile-'+VARIANT+'.sol'),content);result.profileSourceSha256=sha(content);}
 sources[HELPER]={content:'// SPDX-License-Identifier: MIT\npragma solidity 0.8.30; interface IForwardModel {function forward(uint16[] calldata) external view returns(uint16,int32[128] memory,bytes32);} contract LocalForwardProbe {event Forward(uint16 nextToken,int32[128] lastHidden,bytes32 logitHash);function measure(address model,uint16[] calldata prompt) external {(uint16 token,int32[128] memory hidden,bytes32 hash)=IForwardModel(model).forward(prompt);emit Forward(token,hidden,hash);}} interface IGenerationModel {function generate(uint16[] calldata,uint8) external view returns(uint16[] memory,bool,bytes32);} contract LocalGenerationProbe {event Generated(uint16[] tokens,bool ended,bytes32 lastLogitHash); function measure(address model,uint16[] calldata prompt,uint8 cap) external {(uint16[] memory tokens,bool ended,bytes32 hash)=IGenerationModel(model).generate(prompt,cap);emit Generated(tokens,ended,hash);}}'};
 function run(compiler,s){const out=JSON.parse(compiler.compile(json({language:'Solidity',sources:s,settings}),imports));const errors=(out.errors??[]).filter(e=>e.severity==='error');assert.equal(errors.length,0,errors.map(e=>e.formattedMessage).join('\n'));return out.contracts;}
 const artifacts=run(solc,sources);artifacts[MANAGER]=run(solcV4,{[MANAGER]:{content:readFileSync(path.join(BASE,'node_modules',MANAGER),'utf8')}})[MANAGER];return artifacts;
}
function makeDecoder(){
 const tok=read('model-cache/tokenizer.json');assert.equal(tok.decoder.type,'WordPiece');const vocabulary=[];for(const[token,id]of Object.entries(tok.model.vocab))vocabulary[id]=token;
 const special=new Set((tok.added_tokens||[]).filter(t=>t.special).map(t=>t.id));
 return ids=>{let text=ids.filter(x=>!special.has(Number(x))).map(x=>vocabulary[Number(x)]).join(' ').replace(/ ##/g,'');if(tok.decoder.cleanup)text=text.replace(/ \./g,'.').replace(/ \?/g,'?').replace(/ !/g,'!').replace(/ ,/g,',').replace(/ ' /g,"'").replace(/ n't/g,"n't").replace(/ 'm/g,"'m").replace(/ 's/g,"'s").replace(/ 've/g,"'ve").replace(/ 're/g,"'re");return text;};
}
function verifyOriginals(){let count=0;for(const[file,metadata]of Object.entries(readRun('original-artifacts.json'))){const data=readFileSync(path.join(MODEL_DIR,file));assert.equal(data.length,metadata.bytes);assert.equal(sha(data),metadata.sha256,'Original changed: '+file);count++;}return count;}
async function main(){
 assert(ARGS.includes('--anvil'),'Use --anvil for an isolated local-only benchmark');
 result.checks.originalArtifactsVerifiedBefore=verifyOriginals();
 // Count every unique trained value from the complete exported tensor layout.
 let count=0;for(const tensor of protocol.weights.tensor_layout){assert.equal(tensor.byte_offset,count*2);count+=tensor.elements;}
 assert.equal(count,manifest.parameters);assert.equal(count,1_235_968,'Unexpected complete model parameter count');assert.equal(manifest.clipped_weights,0);
 assert.equal(manifest.artifacts['weights.bin'].bytes,count*2);result.checks.totalUniqueParameterCountVerified=true;
 for(const[file,metadata]of Object.entries(manifest.artifacts)){const data=readFileSync(path.join(MODEL_DIR,'model',file));assert.equal(data.length,metadata.bytes);assert.equal(sha(data),metadata.sha256);result.artifacts['original/'+file]={...metadata};}
 for(const[file,metadata]of Object.entries(runtimeManifest.artifacts)){const data=readFileSync(path.join(DATA_DIR,file));assert.equal(data.length,metadata.bytes);assert.equal(sha(data),metadata.sha256);result.artifacts['runtime/'+file]={...metadata};}
 result.artifacts['runtime/manifest.json']={sha256:sha(readFileSync(path.join(DATA_DIR,'manifest.json')))};
 for(const file of [CONFIG.modelSource,CONFIG.hookSource])result.artifacts[file]={sha256:sha(readFileSync(path.join(BASE,file)))};
 for(const file of ['contracts/protocol.json'])result.artifacts[file]={sha256:sha(readFileSync(path.join(MODEL_DIR,file)))};
 for(const file of ['reference.json','streaming-reference.json','run-streaming-benchmark.mjs'])result.artifacts[file]={sha256:sha(readFileSync(path.join(DIR,file)))};
 result.streamingDesign={requiredInference:true,promptPrefill:'One input token per swap; N tokens require N swaps before the first completion.',cacheScope:'Model namespace bound to hook address and pool id',resetPolicy:'Restart fixed configured prompt after EOS, context16, or configured output cap',fullHiddenInEvents:'Included for validation and in measured gas'};
 const decode=makeDecoder(),fixtures=reference.fixtures,one=fixtures.find(f=>f.name==='single-token'),two=fixtures.find(f=>f.name==='two-token-attention'),qa=fixtures.find(f=>f.name==='qa-short');assert(one&&two&&qa);
 const generation=reference.generation_fixtures??[];assert.equal(generation.length,4);assert.equal(qa.prompt_ids.length,10);for(const f of fixtures)assert.equal(decode([f.next_token]),f.next_token_text);
 for(const f of generation){assert.equal(decode(f.tokens),f.text);assert.equal(f.ended,f.tokens.at(-1)===bounds.eos_token_id);assert(f.maximum_new_tokens<=bounds.maximum_new_tokens);}
 result.referenceSummary={fixtures:fixtures.map(f=>({name:f.name,prompt:f.prompt,prompt_ids:f.prompt_ids,next_token:f.next_token,next_token_text:f.next_token_text,logit_hash:f.logit_hash})),generationFixtures:generation};
 result.stage='COMPILE';save();const artifacts=compile();
 for(const[f,name]of [[CONFIG.modelSource,CONFIG.modelName],[CONFIG.hookSource,CONFIG.hookName]]){const bytes=artifacts[f][name].evm.deployedBytecode.object.length/2;assert(bytes<=24576);result.artifacts[f].runtimeBytes=bytes;}result.checks.eip170EnabledAndSatisfied=true;
 // Refuse to reset a pre-existing service accidentally.
 try{await rpc('web3_clientVersion',[],300);throw new Error('Reserved loopback port is already occupied');}catch(e){if(e.message==='Reserved loopback port is already occupied')throw e;}
 tempDir=mkdtempSync(path.join(os.tmpdir(),'simplestories-v2-optimization-anvil-'));
 child=spawn('/Users/abhijith/.foundry/bin/anvil',['--host','127.0.0.1','--port',String(CONFIG.port),'--chain-id','31337','--hardfork','cancun','--gas-limit',CAP.toString(),'--code-size-limit','24576','--memory-limit','104857600','--quiet','--no-cors','--disable-console-log'],{cwd:tempDir,stdio:['ignore','ignore','pipe'],env:{PATH:process.env.PATH}});
 child.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-4096);});child.on('error',e=>{stderr=String(e.message).slice(-4096);});
 let ready=false;for(let i=0;i<100;i++){try{await guard();ready=true;break;}catch{}await new Promise(r=>setTimeout(r,50));}assert(ready,'Anvil startup failed: '+stderr);
 result.network.client=await rpc('web3_clientVersion');assert(result.network.client.toLowerCase().includes('anvil'));provider=new ethers.JsonRpcProvider(URL,undefined,{cacheTimeout:-1});provider.pollingInterval=10;assert.equal((await provider.getBlock('latest')).gasLimit,CAP);
 const signer=await provider.getSigner(0),payer=await signer.getAddress();
 async function send(request,label,high=false){await guard();assert(BigInt(request.gasLimit)<=(high?HIGH:CAP));const start=Date.now(),tx=await signer.sendTransaction(request);let receipt;try{receipt=await tx.wait();}catch(e){receipt=e.receipt;if(!receipt)throw e;}return{receipt,elapsedMs:Date.now()-start,label};}
 async function deploy(source,name,args=[],gasLimit=8_000_000n){const artifact=artifacts[source][name],request=await new ethers.ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer).getDeployTransaction(...args),run=await send({...request,gasLimit},name);assert.equal(run.receipt.status,1);const c=new ethers.Contract(run.receipt.contractAddress,artifact.abi,signer);result.deployments.push({name,address:c.target,gasUsed:run.receipt.gasUsed,runtimeHash:ethers.keccak256(await provider.getCode(c.target))});save();return c;}
 result.stage='DATA';save();const groups={};let shardIndex=0;
 for(const group of ['weights','tables']){const data=readFileSync(path.join(DATA_DIR,group+'.bin'));let commitment=ethers.ZeroHash;groups[group]=[];
  for(let offset=0;offset<data.length;offset+=CHUNK){const address=ethers.getAddress(ethers.toBeHex(0x100000n+BigInt(shardIndex++),20)),runtime='0x00'+data.subarray(offset,offset+CHUNK).toString('hex');assert((runtime.length-2)/2<=24576);await guard();await rpc('anvil_setCode',[address,runtime]);assert.equal(await provider.getCode(address),runtime);commitment=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','bytes32'],[commitment,ethers.keccak256(runtime)]));groups[group].push(address);}
  result.dataInjection.groups[group]={shards:groups[group].length,payloadBytes:data.length,commitment};}
 result.dataInjection.totalShards=shardIndex;result.checks.allRuntimeDataVerified=true;save();
 const model=await deploy(CONFIG.modelSource,CONFIG.modelName,[groups.weights,groups.tables],CAP),forwardProbe=await deploy(HELPER,CONFIG.probeName),generationProbe=await deploy(HELPER,'LocalGenerationProbe');
 for(const[name,value]of Object.entries({PARAMETERS:count,HIDDEN:architecture.hidden_size,LAYERS:architecture.layers,VOCABULARY:bounds.vocabulary,EOS_TOKEN:bounds.eos_token_id}))assert.equal(await model[name](),BigInt(value));
 result.modelHash=await model.modelHash();assert.equal(result.modelHash,ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string','bytes32','bytes32'],[runtimeDomain,result.dataInjection.groups.weights.commitment,result.dataInjection.groups.tables.commitment])));result.checks.fullModelIdentityVerified=true;assert.equal(await model.WEIGHT_BYTES(),BigInt(runtimeManifest.artifacts['weights.bin'].bytes));assert.equal(await model.TABLE_BYTES(),BigInt(runtimeManifest.artifacts['tables.bin'].bytes));
 const invalidInputSelector=ethers.id('InvalidInput()').slice(0,10);let invalidCases=0;
 for(const[name,args]of [['forward',[[]]],['forward',[[4019]]],['generate',[[],1]],['generate',[[85],0]],['generate',[[85],5]],['generate',[Array(16).fill(85),2]]]){
  let reverted=false;try{await provider.call({to:model.target,data:model.interface.encodeFunctionData(name,args),gasLimit:1_000_000n});}catch(error){const failure=decodeFailure(error);assert.equal(failure.data?.slice(0,10),invalidInputSelector);reverted=true;}assert(reverted,'Invalid model input unexpectedly accepted');invalidCases++;
 }result.checks.invalidModelInputsRejected=invalidCases;save();
 const manager=await deploy(MANAGER,'PoolManager',[payer]),router=await deploy(HARNESS,'SentenceV4SettlementRouter',[manager.target]),factory=await deploy(HARNESS,'SentenceV4Create2Factory');
 const a=await deploy(HARNESS,'SentenceV4TestToken'),b=await deploy(HARNESS,'SentenceV4TestToken'),tokens=[a,b].sort((a,b)=>BigInt(a.target)<BigInt(b.target)?-1:1);
 for(const t of tokens){assert.equal((await send({to:t.target,data:t.interface.encodeFunctionData('mint',[payer,10n**25n]),gasLimit:150000n},'mint')).receipt.status,1);assert.equal((await send({to:t.target,data:t.interface.encodeFunctionData('approve',[router.target,ethers.MaxUint256]),gasLimit:150000n},'approve')).receipt.status,1);}
 async function pool(budget,maximumNewTokens=1,prompt=one.prompt_ids){const art=artifacts[CONFIG.hookSource][CONFIG.hookName],req=await new ethers.ContractFactory(art.abi,art.evm.bytecode.object,signer).getDeployTransaction(manager.target,model.target,prompt,maximumNewTokens,budget);let salt,address;
  for(let n=0;n<2_000_000;n++){salt=ethers.zeroPadValue(ethers.toBeHex(n),32);address=ethers.getCreate2Address(factory.target,salt,ethers.keccak256(req.data));if((BigInt(address)&0x3fffn)===0x1040n)break;}assert.equal(BigInt(address)&0x3fffn,0x1040n);
  assert.equal((await send({to:factory.target,data:factory.interface.encodeFunctionData('deploy',[salt,req.data]),gasLimit:8_000_000n},'hook')).receipt.status,1);
  const hook=new ethers.Contract(address,art.abi,signer),key={currency0:tokens[0].target,currency1:tokens[1].target,fee:3000,tickSpacing:60,hooks:address},id=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address','address','uint24','int24','address'],Object.values(key)));
  assert.equal((await send({to:manager.target,data:manager.interface.encodeFunctionData('initialize',[key,2n**96n]),gasLimit:2_000_000n},'initialize')).receipt.status,1);
  assert.equal((await send({to:router.target,data:router.interface.encodeFunctionData('modifyLiquidity',[key,{tickLower:-60000,tickUpper:60000,liquidityDelta:10n**20n,salt:ethers.ZeroHash}]),gasLimit:2_000_000n},'liquidity')).receipt.status,1);assert.deepEqual(Array.from(await hook.prompt(),Number),prompt);assert.equal(await hook.maximumNewTokens(),BigInt(maximumNewTokens));assert.equal(await hook.inferenceGasLimit(),budget);return{hook,key,id,budget,maximumNewTokens,prompt};}
 const layout=artifacts[CONFIG.modelSource][CONFIG.modelName].storageLayout;
 const sessionsMeta=layout.storage.find(x=>x.label==='_sessions');assert(sessionsMeta);
 const sessionType=layout.types[layout.types[sessionsMeta.type].value];
 const kvMeta=sessionType.members.find(x=>x.label==='kv');assert(kvMeta);
 const coder=ethers.AbiCoder.defaultAbiCoder(),MASK=(1n<<256n)-1n;
 async function cacheDigest(p,owner=p.hook.target){
  await guard();const scoped=ethers.keccak256(coder.encode(['address','bytes32'],[owner,p.id]));
  const base=BigInt(ethers.keccak256(coder.encode(['bytes32','uint256'],[scoped,BigInt(sessionsMeta.slot)])));
  const kvRoot=(base+BigInt(kvMeta.slot))&MASK;
  const slots=[ethers.toBeHex(base,32),ethers.toBeHex((base+1n)&MASK,32)];
  for(let i=0;i<1024;i++)slots.push(ethers.keccak256(coder.encode(['uint256','uint256'],[i,kvRoot])));
  const values=[];
  for(let begin=0;begin<slots.length;begin+=256){
   const batch=slots.slice(begin,begin+256).map((slot,i)=>({jsonrpc:'2.0',id:i,method:'eth_getStorageAt',params:[model.target,slot,'latest']}));
   const reply=await fetch(URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(batch),signal:AbortSignal.timeout(TIMEOUT)}).then(x=>x.json());
   assert(Array.isArray(reply));reply.sort((a,b)=>a.id-b.id);for(const item of reply){assert(!item.error);values.push(item.result);}
  }
  return ethers.keccak256(ethers.concat(values));
 }
 const state=async(p,withCache=false)=>({context:Array.from(await p.hook.contexts(p.id)),modelSession:Array.from(await model.sessionState(p.hook.target,p.id)),slot0:Array.from(await router.poolState(p.key)),balances:await Promise.all(tokens.map(t=>t.balanceOf(payer))),...(withCache?{cacheDigest:await cacheDigest(p)}:{})});
 result.streams=[];result.probes=[];result.stage='STREAMING_32M';save();
 async function stepSwap(p,expected,{label,reset=false,fail=false,gasLimit=CAP,checkCache=false}={}){
  const before=await state(p,checkCache),run=await send({to:router.target,data:router.interface.encodeFunctionData('swapWithHookData',[p.key,{zeroForOne:true,amountSpecified:-100000000000000n,sqrtPriceLimitX96:4295128740n},'0x']),gasLimit},label),after=await state(p,checkCache);
  const entry={kind:label,mode:'NORMAL_32M',status:run.receipt.status,gasUsed:run.receipt.gasUsed,elapsedMs:run.elapsedMs,transactionGasLimit:gasLimit,inferenceBudget:p.budget,transactionHash:run.receipt.hash,poolId:p.id};
  if(fail){
   assert.equal(run.receipt.status,0,'Expected required inference to fail');assert.equal(json(before),json(after),'Failed inference must roll back pool, token balances, hook, model metadata and every KV word');
   entry.rollbackVerified=true;entry.fullCacheWordsChecked=checkCache?1024:0;
  }else{
   assert.equal(run.receipt.status,1,'Streaming transaction exceeded32M or reverted');
   assert(before.balances[0]>after.balances[0]&&before.balances[1]<after.balances[1]);
   assert.equal(after.context[0],before.context[0]+1n);
   const logs=run.receipt.logs.filter(x=>x.address.toLowerCase()===p.hook.target.toLowerCase()).map(x=>p.hook.interface.parseLog(x)).filter(x=>x.name==='StreamToken');assert.equal(logs.length,1);
   const e=logs[0].args;
   assert.equal(Number(e.inputToken),expected.input_token);assert.equal(Number(e.nextToken),expected.next_token);
   assert.deepEqual(Array.from(e.lastHidden,Number),expected.last_hidden);assert.equal(e.logitHash,expected.logit_hash);
   assert.equal(e.completion,expected.completion);assert.equal(e.reset,reset);
   assert.equal(Number(after.modelSession[0]),expected.prefix_ids.length);
   assert.equal(after.modelSession[1],expected.prefix_ids.length===16||(!expected.prefill&&expected.next_token===bounds.eos_token_id));
   assert.equal(after.modelSession[2],before.modelSession[2]+(reset?1n:0n));
   const expectedPrefix=ethers.keccak256(coder.encode(['bytes32','uint16'],[reset?ethers.ZeroHash:before.modelSession[3],expected.input_token]));
   assert.equal(after.modelSession[3],expectedPrefix);assert.equal(e.prefixHash,expectedPrefix);
   Object.assign(entry,{inputToken:expected.input_token,nextToken:expected.next_token,text:decode([expected.next_token]),completion:e.completion,reset:e.reset,ended:e.ended,epoch:e.epoch,activeContextTokens:expected.prefix_ids.length,lastHidden:Array.from(e.lastHidden,Number),logitHash:e.logitHash,prefixHash:e.prefixHash,settlementVerified:true,sequenceVerified:true,hiddenValuesMatched:128,logitsHashMatched:4019,allOutputsMatchReference:true});
  }
  result.probes.push(entry);save();console.log(label+': '+entry.status+', gas '+entry.gasUsed);return entry;
 }
 const pools={};
 for(const fixture of streamReference.cases){
  const p=await pool(29_000_000n,fixture.maximum_new_tokens,fixture.prompt_ids);pools[fixture.name]=p;
  const rows=[];for(let i=0;i<fixture.steps.length;i++)rows.push(await stepSwap(p,fixture.steps[i],{label:fixture.name+'_step_'+(i+1),reset:i===0}));
  const completion=rows.filter(x=>x.completion),promptCount=fixture.prompt_ids.length;
  result.streams.push({name:fixture.name,poolId:p.id,promptTokenCount:promptCount,swapsToFirstCompletion:promptCount,totalSwaps:rows.length,totalGas:rows.reduce((a,x)=>a+BigInt(x.gasUsed),0n),maximumGas:rows.reduce((a,x)=>BigInt(x.gasUsed)>a?BigInt(x.gasUsed):a,0n),allSwapsBelow32M:rows.every(x=>BigInt(x.gasUsed)<CAP),completionTokens:completion.map(x=>x.nextToken),completionText:decode(completion.map(x=>x.nextToken)),ended:completion.at(-1).ended,stopReason:completion.at(-1).ended?'model_or_context_end':'configured_output_cap'});
  // A finished cycle must recover automatically instead of permanently preventing swaps.
  await stepSwap(p,fixture.steps[0],{label:fixture.name+'_automatic_reset',reset:true});
  result.checks[fixture.name+'_automaticResetVerified']=true;save();
 }
 const minimal=pools.minimal,qaPool=pools['qa-short'],boundary=pools['context-16'];
 const closedBefore=await state(boundary,true);
 await stepSwap(boundary,null,{label:'required_low_transaction_gas_rollback',fail:true,gasLimit:1_000_000n,checkCache:true});
 assert.equal(json(closedBefore),json(await state(boundary,true)));
 const low=await pool(8_000_000n,4,[85]);
 await stepSwap(low,null,{label:'required_partial_inference_rollback',fail:true,checkCache:true});
 result.checks.requiredPartialModelWritesFullyRolledBack=true;
 // Exactly the same session id under another direct caller must not touch the hook-owned stream.
 const hookBefore=await state(minimal,true),foreignBefore=Array.from(await model.sessionState(payer,minimal.id));
 assert.equal(Number(foreignBefore[0]),0);
 const direct=await send({to:model.target,data:model.interface.encodeFunctionData('step',[minimal.id,85,true]),gasLimit:CAP},'foreign_owner_namespace');
 assert.equal(direct.receipt.status,1);
 assert.equal(Number((await model.sessionState(payer,minimal.id))[0]),1);
 assert.equal(json(hookBefore),json(await state(minimal,true)));
 result.probes.push({kind:'foreign_owner_namespace',status:1,gasUsed:direct.receipt.gasUsed,transactionHash:direct.receipt.hash,hookCacheUnchanged:true,fullCacheWordsChecked:1024});
 result.checks.callerNamespacesIsolated=true;
 // Advancing a second pool must leave the first pool's hook state and full cache unchanged.
 const untouched=await state(minimal,true),qaFirst=streamReference.cases.find(x=>x.name==='qa-short').steps[1];
 await stepSwap(qaPool,qaFirst,{label:'second_pool_isolation_step',reset:false});
 const afterOtherPool=await state(minimal,true);delete untouched.balances;delete afterOtherPool.balances;assert.equal(json(untouched),json(afterOtherPool));
 result.checks.poolSessionsIsolated=true;
 let unauthorized=false;
 try{await provider.call({to:minimal.hook.target,data:minimal.hook.interface.encodeFunctionData('afterSwap',[payer,minimal.key,{zeroForOne:true,amountSpecified:-1n,sqrtPriceLimitX96:4295128740n},0,'0x']),gasLimit:1_000_000n});}catch(error){assert.equal(decodeFailure(error).data?.slice(0,10),ethers.id('UnauthorizedCallback()').slice(0,10));unauthorized=true;}
 assert(unauthorized);result.checks.directHookCallsRejected=true;
 result.checks.allStreamingOutputsMatchIndependentReference=result.probes.filter(p=>p.allOutputsMatchReference!==undefined).every(p=>p.allOutputsMatchReference);
 result.checks.realV4SettlementAndModelInferenceRequired=true;
 result.checks.originalArtifactsVerifiedAfter=verifyOriginals();
 assert.equal(sha(readFileSync(path.join(BASE,CONFIG.modelSource))),result.artifacts[CONFIG.modelSource].sha256,'Streaming source changed during execution');
 result.checks.optimizedSourceUnchangedDuringRun=true;
 result.status='COMPLETE';result.stage='COMPLETE';result.completedAt=new Date().toISOString();save();


}
try{await main();}catch(error){result.status='FAILED';result.error={message:String(error.shortMessage??error.message),stack:String(error.stack??'').slice(0,3000)};save();console.error(result.error.message);process.exitCode=1;}finally{
 if(child&&child.exitCode===null){try{if(elevated){await rpc('evm_setBlockGasLimit',[ethers.toBeHex(CAP)],2000);await rpc('evm_mine',[],2000);}result.network.finalBlockGasLimit=BigInt((await rpc('eth_getBlockByNumber',['latest',false],2000)).gasLimit).toString();result.checks.localNormalGasLimitRestored=result.network.finalBlockGasLimit===CAP.toString();}catch(error){result.cleanupError=String(error.message);}child.kill('SIGTERM');result.network.anvilStopped=true;}
 if(provider)await provider.destroy();if(tempDir)rmSync(tempDir,{recursive:true,force:true});save();console.log('Saved '+path.join(DIR,OUTPUT));
}
