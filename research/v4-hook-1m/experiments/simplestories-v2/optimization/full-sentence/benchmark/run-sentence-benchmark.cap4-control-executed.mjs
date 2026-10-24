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

const DIR=path.dirname(fileURLToPath(import.meta.url)),BASE=path.resolve(DIR,'../../../../..'),MODEL_DIR=path.resolve(DIR,'../../..');
const PREFIX=path.relative(BASE,DIR).split(path.sep).join('/');
let CONFIG={modelSource:path.relative(BASE,path.join(MODEL_DIR,'optimization/kernel/SimpleStoriesV2ModelOptimized.sol')),hookSource:PREFIX+'/SimpleStoriesV2SentenceHook.sol',modelName:'SimpleStoriesV2Model',hookName:'SimpleStoriesV2SentenceHook',probeName:'LocalForwardProbe',port:18562};
const HARNESS='tests/evm/SentenceV4IntegrationHarness.sol',MANAGER='@uniswap/v4-core/src/PoolManager.sol',HELPER='LocalGenerationProbe.sol';
const ARGS=process.argv.slice(2),SMOKE=ARGS.includes('--smoke'),LABEL=(ARGS.find(x=>x.startsWith('--label='))??'--label=latest').slice(8);
assert(ARGS.includes('--anvil') && ARGS.every(x=>x==='--anvil'||x==='--smoke'||x==='--profile'||x==='--normal-only'||/^--max-new=[0-9]+$/.test(x)||/^--budget-scan=[0-9,]+$/.test(x)||/^--normal-budget=[0-9]+$/.test(x)||/^--kernel=[a-z0-9-]+$/.test(x)||/^--cases=[a-z0-9,-]+$/.test(x)||/^--label=[a-z0-9-]+$/.test(x)||/^--variant=swar(5|8|8tile|8unrolled|8pruned|8cached)$/.test(x)),'Only --anvil [--smoke] [--label=slug] [--variant=swar5|swar8|swar8tile] [--profile] are supported');
const PROFILE=ARGS.includes('--profile'),PROFILE_SOURCE='LocalStageProfile.sol';
const VARIANT=(ARGS.find(x=>x.startsWith('--kernel='))??'--kernel=generation-candidate').slice(9);
const NORMAL_ONLY=ARGS.includes('--normal-only'),NORMAL_BUDGET=BigInt((ARGS.find(x=>x.startsWith('--normal-budget='))??'--normal-budget=29000000').slice(16));assert(NORMAL_BUDGET>=100000n&&NORMAL_BUDGET<=32000000n);
const CAP_OVERRIDE=ARGS.find(x=>x.startsWith('--max-new='))?.slice(10);const NORMAL_BUDGETS=ARGS.find(x=>x.startsWith('--budget-scan='))?.slice(14).split(',').map(BigInt)??[NORMAL_BUDGET];for(const b of NORMAL_BUDGETS)assert(b>=100000n&&b<=32000000n);
const SELECTED=(ARGS.find(x=>x.startsWith('--cases='))??'--cases=quote,colon').slice(8).split(',');
const KERNEL_DIR=path.join(MODEL_DIR,'optimization/full-sentence',VARIANT);
CONFIG={...CONFIG,modelSource:path.relative(BASE,path.join(KERNEL_DIR,'SimpleStoriesV2ModelOptimized.sol'))};
const OUTPUT='gas-benchmark-'+LABEL+(SMOKE?'-smoke':'')+'.json';
const CAP=32_000_000n,HIGH=16_000_000_000n,HIGH_MODEL=14_000_000_000n,SPK1='0x53504b31',CHUNK=24_000;
const URL=`http://127.0.0.1:${CONFIG.port}`,TIMEOUT=180_000;
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2),sha=b=>createHash('sha256').update(b).digest('hex');
const read=name=>JSON.parse(readFileSync(path.join(MODEL_DIR,name)));
const readRun=name=>JSON.parse(readFileSync(path.join(DIR,name)));
const manifest=read('model/manifest.json'),protocol=read('contracts/protocol.json'),reference=readRun('reference.json'),sentenceReference=JSON.parse(readFileSync(path.join(DIR,'../quality/reference.json')));
const additionalPath=path.join(DIR,'../quality/additional-reference.json');
if(existsSync(additionalPath))sentenceReference.cases.push(...JSON.parse(readFileSync(additionalPath)).cases);
const DATA_DIR=existsSync(path.join(KERNEL_DIR,'model/manifest.json'))?path.join(KERNEL_DIR,'model'):path.join(MODEL_DIR,'optimization/full-sentence/kernel/model'),runtimeManifest=JSON.parse(readFileSync(path.join(DATA_DIR,'manifest.json')));
assert.equal(runtimeManifest.parameters,manifest.parameters,'Packed export must preserve total model parameters');
assert.equal(runtimeManifest.source_weights_sha256,manifest.artifacts['weights.bin'].sha256);
assert.equal(runtimeManifest.checkpoint_sha256,manifest.checkpoint_sha256);
const runtimeDomain=runtimeManifest.model_hash_domain;
assert.equal(typeof runtimeDomain,'string');
const architecture={hidden_size:128,layers:4,intermediate_size:341,attention_heads:4,key_value_heads:2,vocabulary:4019},bounds=protocol.bounds;
const result={schemaVersion:3,status:'RUNNING',testLabel:LABEL,variant:VARIANT,normalInferenceBudget:NORMAL_BUDGET,normalBudgetScan:NORMAL_BUDGETS,maximumNewTokensOverride:CAP_OVERRIDE??null,normalOnlyBudgetControl:NORMAL_ONLY,smoke:SMOKE,runnerArgs:ARGS,compilers:{model:solc.version(),poolManager:solcV4.version()},startedAt:new Date().toISOString(),repository:manifest.repository,revision:manifest.revision,architecture:{...architecture,parameters:manifest.parameters,quantization:manifest.quantization},network:{backend:'Anvil',chainId:31337,hardfork:'cancun',loopback:`127.0.0.1:${CONFIG.port}`,forking:false,stepsTracing:false,normalTransactionGasCeiling:CAP,elevatedLocalTransactionCeiling:HIGH},originalModelManifest:manifest,modelManifest:runtimeManifest,artifacts:{},deployments:[],dataInjection:{method:'anvil_setCode',chunkBytes:CHUNK,groups:{}},probes:[],checks:{},limitations:['All measurements are on an isolated local chain, never mainnet.','Weights are injected as verified runtime data shards; their deployment costs are not measured.','All trained weights and the full output vocabulary are retained. Memory-cached generation omits final-layer prefix work which cannot affect the output; no distilled model is used.','INT16 fixed-point arithmetic approximates the original FP32 checkpoint. Exact agreement here is with the independent integer reference.','A token-limited continuation is not described as a complete answer. EOS and actual generated token count are reported separately.','Elevated local gas controls do not demonstrate usability under the normal 32M ceiling.']};
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
 const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
 const imports={import:f=>{for(const p of [path.join(BASE,f),path.join(BASE,'node_modules',f),path.join(BASE,'node_modules/@uniswap/v4-core/lib',f)])if(existsSync(p))return{contents:readFileSync(p,'utf8')};return{error:'Missing '+f};}};
 const sources=Object.fromEntries([CONFIG.modelSource,CONFIG.hookSource,HARNESS].map(f=>[f,{content:readFileSync(path.join(BASE,f),'utf8')}]));
 if(PROFILE){const content=stageProfileSource(sources[CONFIG.modelSource].content);sources[PROFILE_SOURCE]={content};writeFileSync(path.join(DIR,'profile-'+VARIANT+'.sol'),content);result.profileSourceSha256=sha(content);}
 sources[HELPER]={content:'// SPDX-License-Identifier: MIT\npragma solidity 0.8.30; interface IForwardModel {function forward(uint16[] calldata) external view returns(uint16,int32[128] memory,bytes32);} contract LocalForwardProbe {event Forward(uint16 nextToken,int32[128] lastHidden,bytes32 logitHash);function measure(address model,uint16[] calldata prompt) external {(uint16 token,int32[128] memory hidden,bytes32 hash)=IForwardModel(model).forward(prompt);emit Forward(token,hidden,hash);}} interface IGenerationModel {function generateSentence(uint16[] calldata,uint8) external view returns(uint16[] memory,bool,bool,bytes32);} contract LocalGenerationProbe {event Generated(uint16[] tokens,bool endedEos,bool endedSentence,bytes32 lastLogitHash); function measure(address model,uint16[] calldata prompt,uint8 cap) external {(uint16[] memory tokens,bool endedEos,bool endedSentence,bytes32 hash)=IGenerationModel(model).generateSentence(prompt,cap);emit Generated(tokens,endedEos,endedSentence,hash);}}'};
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
 for(const tile of runtimeManifest.executable_tiles??[]){const file=tile.path??tile.file;const data=readFileSync(path.join(DATA_DIR,file));assert.equal(data.length,tile.bytes);assert.equal(sha(data),tile.sha256);result.artifacts['runtime/'+file]={bytes:tile.bytes,sha256:tile.sha256};}
 for(const file of [CONFIG.modelSource,CONFIG.hookSource])result.artifacts[file]={sha256:sha(readFileSync(path.join(BASE,file)))};
 for(const file of ['contracts/protocol.json'])result.artifacts[file]={sha256:sha(readFileSync(path.join(MODEL_DIR,file)))};
 for(const file of ['reference.json','run-sentence-benchmark.mjs'])result.artifacts[file]={sha256:sha(readFileSync(path.join(DIR,file)))};
 result.sentenceDesign={allInferenceInOneTransaction:true,persistentAttentionCache:false,precomputedOutputs:false,nativeTerminationOnly:[1,2,15,30],wordpieceTokensNeverAppendedByHook:true};
 const decode=makeDecoder(),fixtures=reference.fixtures,one=fixtures.find(f=>f.name==='single-token'),two=fixtures.find(f=>f.name==='two-token-attention'),qa=fixtures.find(f=>f.name==='qa-short');assert(one&&two&&qa);
 const generation=reference.generation_fixtures??[];assert.equal(generation.length,4);assert.equal(qa.prompt_ids.length,10);for(const f of fixtures)assert.equal(decode([f.next_token]),f.next_token_text);
 for(const f of generation){assert.equal(decode(f.tokens),f.text);assert.equal(f.ended,f.tokens.at(-1)===bounds.eos_token_id);assert(f.maximum_new_tokens<=bounds.maximum_new_tokens);}
 result.selectedSentenceCases=SELECTED;result.sentenceReference=sentenceReference;result.artifacts['quality/reference.json']={sha256:sha(readFileSync(path.join(DIR,'../quality/reference.json')))};
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
 async function injectRuntimes(entries){
  for(let offset=0;offset<entries.length;offset+=32){await guard();const batch=entries.slice(offset,offset+32);await Promise.all(batch.map(e=>rpc('anvil_setCode',[e.address,e.runtime])));const actual=await Promise.all(batch.map(e=>rpc('eth_getCode',[e.address,'latest'])));for(let i=0;i<batch.length;i++)assert.equal(actual[i],batch[i].runtime);}
 }
 result.stage='DATA';save();const groups={};let shardIndex=0;
 for(const group of ['weights','tables']){const data=readFileSync(path.join(DATA_DIR,group+'.bin'));let commitment=ethers.ZeroHash;groups[group]=[];const runtimes=[];
  for(let offset=0;offset<data.length;offset+=CHUNK){const address=ethers.getAddress(ethers.toBeHex(0x100000n+BigInt(shardIndex++),20)),runtime='0x00'+data.subarray(offset,offset+CHUNK).toString('hex');assert((runtime.length-2)/2<=24576);runtimes.push({address,runtime});commitment=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','bytes32'],[commitment,ethers.keccak256(runtime)]));groups[group].push(address);}
  await injectRuntimes(runtimes);result.dataInjection.groups[group]={shards:groups[group].length,payloadBytes:data.length,commitment};}
 if(runtimeManifest.executable_tiles){
  groups.tiles=[];let commitment=ethers.ZeroHash;let bytes=0;const runtimes=[];
  for(const [index,tile]of runtimeManifest.executable_tiles.entries()){const file=tile.path??tile.file,data=readFileSync(path.join(DATA_DIR,file)),runtime='0x'+data.toString('hex'),address=ethers.getAddress(ethers.toBeHex(0x200000n+BigInt(index),20));assert(data.length<=24576&&data.length>0);runtimes.push({address,runtime});const codeHash=ethers.keccak256(runtime);if(tile.keccak256)assert.equal(codeHash,tile.keccak256);commitment=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','bytes32'],[commitment,codeHash]));groups.tiles.push(address);bytes+=data.length;}
  await injectRuntimes(runtimes);result.dataInjection.groups.tiles={count:groups.tiles.length,payloadBytes:bytes,commitment,executable:true,stopPrefixAdded:false};
 }
 result.dataInjection.totalShards=shardIndex;result.checks.allRuntimeDataVerified=true;save();
 const model=await deploy(CONFIG.modelSource,CONFIG.modelName,[groups.weights,groups.tables,...(groups.tiles?[groups.tiles]:[])],CAP),forwardProbe=await deploy(HELPER,CONFIG.probeName),generationProbe=await deploy(HELPER,'LocalGenerationProbe');
 for(const[name,value]of Object.entries({PARAMETERS:count,HIDDEN:architecture.hidden_size,LAYERS:architecture.layers,VOCABULARY:bounds.vocabulary,EOS_TOKEN:bounds.eos_token_id}))assert.equal(await model[name](),BigInt(value));
 result.modelHash=await model.modelHash();assert.equal(result.modelHash,ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['string','bytes32','bytes32',...(groups.tiles?['bytes32']:[])],[runtimeDomain,result.dataInjection.groups.weights.commitment,result.dataInjection.groups.tables.commitment,...(groups.tiles?[result.dataInjection.groups.tiles.commitment]:[])])));result.checks.fullModelIdentityVerified=true;assert.equal(await model.WEIGHT_BYTES(),BigInt(runtimeManifest.artifacts['weights.bin'].bytes));assert.equal(await model.TABLE_BYTES(),BigInt(runtimeManifest.artifacts['tables.bin'].bytes));
 const invalidInputSelector=ethers.id('InvalidInput()').slice(0,10);let invalidCases=0;
 for(const[name,args]of [['forward',[[]]],['forward',[[4019]]],['generateSentence',[[],1]],['generateSentence',[[85],0]],['generateSentence',[[85],17]],['generateSentence',[Array(16).fill(85),2]]]){
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
 const state=async p=>({context:Array.from(await p.hook.contexts(p.id)),slot0:Array.from(await router.poolState(p.key)),balances:await Promise.all(tokens.map(t=>t.balanceOf(payer)))});
 const selected=sentenceReference.cases.filter(c=>SELECTED.includes(c.name));assert.equal(selected.length,SELECTED.length,'Unknown sentence fixture');
 function expected(c){const ids=c.output_ids;return{...c,tokens:ids,endedEos:ids.at(-1)===1,endedSentence:[2,15,30].includes(ids.at(-1)),lastLogitHash:c.steps.at(-1).logit_hash,text:c.output};}
 const cases=selected.map(c=>expected({...c,maximum_new_tokens:CAP_OVERRIDE?Number(CAP_OVERRIDE):c.maximum_new_tokens}));
 for(const c of cases){assert.equal(decode(c.tokens),c.text);assert(c.endedEos||c.endedSentence);assert(c.tokens.length>=2);assert(c.maximum_new_tokens>=c.tokens.length);assert(c.maximum_new_tokens<=16);assert(c.prompt_ids.length+c.maximum_new_tokens-1<=16);}
 function verify(e,c){
  assert.deepEqual(Array.from(e.tokens,Number),c.tokens);assert.equal(e.endedEos,c.endedEos);assert.equal(e.endedSentence,c.endedSentence);assert.equal(e.lastLogitHash,c.lastLogitHash);
  return{tokens:c.tokens,text:decode(c.tokens),endedEos:c.endedEos,endedSentence:c.endedSentence,naturallyTerminated:c.endedEos||c.endedSentence,actualNewTokens:c.tokens.length,maximumNewTokens:c.maximum_new_tokens,lastLogitHash:e.lastLogitHash,exactTokenSequence:true,generatedTextIsStandaloneSentence:c.generated_text_is_standalone_sentence};
 }
 async function standalone(c,high){const run=await send({to:generationProbe.target,data:generationProbe.interface.encodeFunctionData('measure',[model.target,c.prompt_ids,c.maximum_new_tokens]),gasLimit:high?HIGH:CAP},'standalone_'+c.name,high);
  const entry={kind:'standalone_sentence',fixture:c.name,prompt:c.prompt,prompt_ids:c.prompt_ids,mode:high?'LOCAL_ABOVE_CAP':'NORMAL_32M',transactionGasLimit:high?HIGH:CAP,status:run.receipt.status,gasUsed:run.receipt.gasUsed,elapsedMs:run.elapsedMs};
  if(run.receipt.status===1){const log=run.receipt.logs.find(l=>l.address.toLowerCase()===generationProbe.target.toLowerCase());assert(log);Object.assign(entry,verify(generationProbe.interface.parseLog(log).args,c));}
  result.probes.push(entry);save();return entry;
 }
 async function swapSentence(p,c,{high=false,label,requiredStatus=null,gasLimit=high?HIGH:CAP}={}){
  const before=await state(p),request={to:router.target,data:router.interface.encodeFunctionData('swapWithHookData',[p.key,{zeroForOne:true,amountSpecified:-100000000000000n,sqrtPriceLimitX96:4295128740n},'0x']),gasLimit};
  const run=await send(request,label,high),after=await state(p),entry={kind:'v4_sentence',fixture:c.name,label,mode:high?'LOCAL_ABOVE_CAP':'NORMAL_32M',transactionGasLimit:gasLimit,inferenceBudget:p.budget,prompt:c.prompt,prompt_ids:c.prompt_ids,status:run.receipt.status,gasUsed:run.receipt.gasUsed,elapsedMs:run.elapsedMs,transactionHash:run.receipt.hash,poolId:p.id};
  if(requiredStatus!==null)assert.equal(run.receipt.status,requiredStatus);
  if(run.receipt.status===1){assert(before.balances[0]>after.balances[0]&&before.balances[1]<after.balances[1]);assert.equal(after.context[0],before.context[0]+1n);
   const logs=run.receipt.logs.filter(l=>l.address.toLowerCase()===p.hook.target.toLowerCase()).map(l=>p.hook.interface.parseLog(l)).filter(e=>e.name==='SentenceSpoken');assert.equal(logs.length,1);
   Object.assign(entry,verify(logs[0].args,c),{settlementVerified:true,sequenceVerified:true,fullSentenceRequired:true});
  }else{assert.equal(json(before),json(after));entry.rollbackVerified=true;try{await provider.call(request);}catch(error){entry.failure=decodeFailure(error);}}
  result.probes.push(entry);save();console.log(label+': '+entry.status+', gas '+entry.gasUsed+(entry.text?' '+entry.text:''));return entry;
 }
 result.stage='NORMAL_32M_SENTENCES';save();
 for(const c of cases){await standalone(c,false);for(const budget of NORMAL_BUDGETS){const p=await pool(budget,c.maximum_new_tokens,c.prompt_ids);const suffix=NORMAL_BUDGETS.length>1?'_budget_'+budget:'';const first=await swapSentence(p,c,{label:c.name+'_normal'+suffix});
  if(first.status===1)await swapSentence(p,c,{label:c.name+'_normal_repeat'+suffix,requiredStatus:1});
  await swapSentence(p,c,{label:c.name+'_low_transaction_gas'+suffix,gasLimit:1_000_000n,requiredStatus:0});}}
 if(NORMAL_ONLY){result.checks.originalArtifactsVerifiedAfter=verifyOriginals();result.checks.normalOnlyBudgetControl=true;result.status='COMPLETE';result.stage='COMPLETE';result.completedAt=new Date().toISOString();save();return;}
 await guard();await rpc('evm_setBlockGasLimit',[ethers.toBeHex(HIGH)]);await rpc('evm_mine');elevated=true;assert.equal((await provider.getBlock('latest')).gasLimit,HIGH);
 result.stage='DIAGNOSTIC_SENTENCES';save();
 for(const c of cases){const row=await standalone(c,true);assert.equal(row.status,1,'Sentence generation exceeds diagnostic ceiling');const p=await pool(HIGH_MODEL,c.maximum_new_tokens,c.prompt_ids);await swapSentence(p,c,{high:true,label:c.name+'_diagnostic',requiredStatus:1});}
 result.stage='FULL_PREFIX_PARITY';save();const seen=new Set();
 for(const c of cases)for(const [i,f]of c.steps.entries()){const key=f.context_ids.join(',');if(seen.has(key))continue;seen.add(key);
  const run=await send({to:forwardProbe.target,data:forwardProbe.interface.encodeFunctionData('measure',[model.target,f.context_ids]),gasLimit:HIGH},'prefix_'+c.name+'_'+i,true);assert.equal(run.receipt.status,1);
  const log=run.receipt.logs.find(l=>l.address.toLowerCase()===forwardProbe.target.toLowerCase());assert(log);const e=forwardProbe.interface.parseLog(log).args;
  assert.equal(Number(e.nextToken),f.next_token);assert.deepEqual(Array.from(e.lastHidden,Number),f.last_hidden);assert.equal(e.logitHash,f.logit_hash);
  result.probes.push({kind:'prefix_parity',fixture:c.name,step:i,prompt_ids:f.context_ids,status:1,gasUsed:run.receipt.gasUsed,hiddenValuesMatched:128,logitsHashMatched:4019,exact:true,mode:'LOCAL_ABOVE_CAP_DIAGNOSTIC'});save();
 }
 // Ending a computation at an arbitrary cap must never pass the full-sentence hook.
 const source=cases[0],n=Math.min(2,source.tokens.length-1),incomplete={...source,name:'incomplete_cap',maximum_new_tokens:n,tokens:source.tokens.slice(0,n),endedEos:false,endedSentence:false,lastLogitHash:source.steps[n-1].logit_hash,text:decode(source.tokens.slice(0,n)),generated_text_is_standalone_sentence:false};
 await standalone(incomplete,true);const incompletePool=await pool(HIGH_MODEL,n,incomplete.prompt_ids);
 await swapSentence(incompletePool,incomplete,{label:'incomplete_cap_rejected',high:true,requiredStatus:0});
 const low=await pool(1_000_000n,source.maximum_new_tokens,source.prompt_ids);await swapSentence(low,source,{label:'partial_inference_rejected',high:true,requiredStatus:0});
 result.checks.allSuccessfulSwapsRequireNaturalSentence=result.probes.filter(p=>p.kind==='v4_sentence'&&p.status===1).every(p=>p.naturallyTerminated&&p.exactTokenSequence);
 result.checks.fullPrefixParityCases=seen.size;result.checks.allFailedSwapsRollback=result.probes.filter(p=>p.kind==='v4_sentence'&&p.status===0).every(p=>p.rollbackVerified);
 result.normal32MPassingSentences=result.probes.filter(p=>p.kind==='v4_sentence'&&p.mode==='NORMAL_32M'&&p.status===1&&p.generatedTextIsStandaloneSentence).map(p=>({fixture:p.fixture,text:p.text,gasUsed:p.gasUsed,transactionHash:p.transactionHash}));
 result.checks.originalArtifactsVerifiedAfter=verifyOriginals();
 assert.equal(sha(readFileSync(path.join(BASE,CONFIG.modelSource))),result.artifacts[CONFIG.modelSource].sha256,'Model changed during benchmark');
 result.checks.modelSourceUnchanged=true;result.status='COMPLETE';result.stage='COMPLETE';result.completedAt=new Date().toISOString();save();


}
try{await main();}catch(error){result.status='FAILED';result.error={message:String(error.shortMessage??error.message),stack:String(error.stack??'').slice(0,3000)};save();console.error(result.error.message);process.exitCode=1;}finally{
 if(child&&child.exitCode===null){try{if(elevated){await rpc('evm_setBlockGasLimit',[ethers.toBeHex(CAP)],2000);await rpc('evm_mine',[],2000);}result.network.finalBlockGasLimit=BigInt((await rpc('eth_getBlockByNumber',['latest',false],2000)).gasLimit).toString();result.checks.localNormalGasLimitRestored=result.network.finalBlockGasLimit===CAP.toString();}catch(error){result.cleanupError=String(error.message);}child.kill('SIGTERM');result.network.anvilStopped=true;}
 if(provider)await provider.destroy();if(tempDir)rmSync(tempDir,{recursive:true,force:true});save();console.log('Saved '+path.join(DIR,OUTPUT));
}
