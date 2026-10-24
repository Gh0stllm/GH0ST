// Genuine per-pool story state on a fresh local PoolManager. No fork URL or public broadcast path exists.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import * as ethers from 'ethers';
import { DIR, BASE, relative, sha, json, compileHook, compileManager, compileModel, HOOK, HARNESS, MANAGER, CORE_HARNESS } from './compile.mjs';

const argv=process.argv.slice(2),opt=(key,otherwise)=>(argv.find(a=>a.startsWith(key+'='))??key+'='+otherwise).slice(key.length+1);
assert(argv.every(a=>/^--(model-name|turns|port|label|reference)=/.test(a)),'Unknown option');
const modelName=opt('--model-name','SimpleStoriesV2Rolling64Model'),turns=Number(opt('--turns',140)),port=Number(opt('--port',18587)),label=opt('--label','rolling64-continuity');
assert(/^SimpleStoriesV2[A-Za-z0-9]+$/.test(modelName));assert(Number.isInteger(turns)&&turns>=1&&turns<=200);assert(port>=1024&&port<=65535);assert(/^[a-z0-9-]+$/.test(label));
const modelSource=relative(path.resolve(DIR,'../kernel',modelName+'.sol'));
const referencePath=path.resolve(DIR,opt('--reference','../quality/rolling64/rolling64-140turn-reference.json'));
const referenceBytes=readFileSync(referencePath),reference=JSON.parse(referenceBytes),expected=reference.turns??reference.run?.turns;
assert(Array.isArray(expected));
const CAP=32_000_000n,BUDGET=29_250_000n,SEED=ethers.zeroPadValue(ethers.toBeHex(42),32),K=8,TEMP=800;
const url=`http://127.0.0.1:${port}`,output=path.join(DIR,label+'-local.json');
const report={status:'RUNNING',startedAt:new Date().toISOString(),scope:'Unforked local PoolManager research only; no public transactions.',
  network:{chainId:31337,forked:false,transactionGasLimit:CAP,feePolicy:'Artificial zero-fee local blocks. Gas figures are execution units, not network fee estimates.'},
  policy:{prompt:[3],seed:SEED,topK:K,temperatureMilli:TEMP,inferenceBudget:BUDGET,maximumNewTokens:2,
    requestedTokens:'Two while the absolute processed position is at most30; one thereafter.',
    termination:'Emits genuine model tokens. A swap may stop mid-sentence; punctuation and EOS do not reset context.',
    overflow:'Attention uses the newest64 numerical KV positions. Absolute positions continue up to2048; no prompt reset or position rebase.'},
  configuration:{requestedTurns:turns},sources:{model:modelSource,hook:HOOK},sourceSha256:{},reference:{path:relative(referencePath),sha256:sha(referenceBytes),cases:expected.length},
  compilation:{},deployment:[],turns:[],checks:{},publicTransactionsSubmitted:0,
  limitations:['Execution uses actual local Uniswap v4 PoolManager and settlement, not the live Robinhood contracts.',
    'Weight/tile/table runtimes are injected after hash validation to save setup time. Their deployment cost is excluded.',
    'Stored context comes only from the model after successful local swaps; no story KV state is injected.',
    'A fixed repeatable seed tests continuity. It does not prove a minimum number of unique stories or good prose.',
    'Concurrent swaps can make a quote stale; clients must re-read the revision and context hash then preview again.']};
const save=()=>writeFileSync(output,json(report));
const errorInfo=e=>({message:String(e.shortMessage||e.message).slice(0,350),data:e.data??e.info?.error?.data??null});
async function rpc(method,params=[],timeout=180000){const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(timeout)});const result=await response.json();if(result.error)throw Object.assign(Error(result.error.message),{data:result.error.data});return result.result;}
async function guard(){assert.equal(await rpc('eth_chainId'),'0x7a69','Mutation is restricted to isolated chain31337');assert((await rpc('web3_clientVersion')).toLowerCase().includes('anvil'));}
async function mutate(method,params){await guard();return rpc(method,params);}
let child,temp,provider,stderr='';

async function main(){
  save();
  const hookCompilation=compileHook(),managerCompilation=compileManager(),modelCompilation=compileModel(modelSource);
  const artifacts={...hookCompilation.artifacts,...modelCompilation.artifacts,...managerCompilation.artifacts};
  for(const [name,c]of Object.entries({hook:hookCompilation,manager:managerCompilation,model:modelCompilation})){
    report.compilation[name]={compiler:c.compiler,settings:c.settings,reusedAfterVerifyingAllSources:c.reused,sourceSha256:c.sourceSha256};
  }
  for(const source of [modelSource,HOOK,HARNESS,relative(path.join(DIR,'run-local.mjs')),relative(path.join(DIR,'compile.mjs'))])report.sourceSha256[source]=sha(readFileSync(path.join(BASE,source)));
  for(const [source,name]of [[modelSource,modelName],[HOOK,'ContinuityHook']]){
    const art=artifacts[source][name];assert(art.evm.deployedBytecode.object.length/2<=24576);report.compilation[name]={creationBytecodeKeccak:ethers.keccak256('0x'+art.evm.bytecode.object),runtimeTemplateKeccak:ethers.keccak256('0x'+art.evm.deployedBytecode.object)};
  }
  const publishedArtifactPath=path.join(BASE,modelSource.replace(/\.sol$/,'.compiled.json'));
  if(existsSync(publishedArtifactPath)){
    const published=JSON.parse(readFileSync(publishedArtifactPath)),fresh=artifacts[modelSource][modelName];
    report.compilation.modelArtifactCrosscheck={path:relative(publishedArtifactPath),sha256:sha(readFileSync(publishedArtifactPath)),creationEqual:published.evm.bytecode.object===fresh.evm.bytecode.object,runtimeTemplateEqual:published.evm.deployedBytecode.object===fresh.evm.deployedBytecode.object};
    assert(report.compilation.modelArtifactCrosscheck.creationEqual&&report.compilation.modelArtifactCrosscheck.runtimeTemplateEqual,'Independently compiled model artifact differs');
  }
  save();
  try{await rpc('eth_chainId',[],300);throw Error('Reserved local port is already busy');}catch(e){if(e.message==='Reserved local port is already busy')throw e;}
  temp=mkdtempSync(path.join(os.tmpdir(),'gh0st-continuity-v4-'));
  child=spawn('/Users/abhijith/.foundry/bin/anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--hardfork','cancun','--gas-limit',CAP.toString(),'--code-size-limit','24576','--block-base-fee-per-gas','0','--gas-price','0','--quiet','--no-cors','--disable-console-log'],{cwd:temp,stdio:['ignore','ignore','pipe'],env:{PATH:process.env.PATH}});
  child.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-1200);});
  let ready=false;for(let i=0;i<100;i++){try{await guard();ready=true;break;}catch{}await new Promise(r=>setTimeout(r,50));}assert(ready,'Local Anvil did not start: '+stderr);
  provider=new ethers.JsonRpcProvider(url,31337,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=10;
  const signer=await provider.getSigner(0),payer=await signer.getAddress();assert.equal((await provider.getBlock('latest')).gasLimit,CAP);
  async function send(request,using=signer){assert(BigInt(request.gasLimit)<=CAP);await mutate('anvil_setNextBlockBaseFeePerGas',['0x0']);await guard();const tx=await using.sendTransaction({...request,gasPrice:0n});try{return await tx.wait();}catch(e){if(e.receipt)return e.receipt;throw e;}}
  async function deploy(source,name,args=[],gasLimit=CAP){const art=artifacts[source][name],factory=new ethers.ContractFactory(art.abi,art.evm.bytecode.object,signer),request=await factory.getDeployTransaction(...args);assert((request.data.length-2)/2<=49152);const receipt=await send({...request,gasLimit});assert.equal(receipt.status,1,'Deployment failed: '+name);report.deployment.push({name,address:receipt.contractAddress,gasUsed:receipt.gasUsed,initCodeBytes:(request.data.length-2)/2,runtimeCodeHash:ethers.keccak256(await provider.getCode(receipt.contractAddress))});save();return new ethers.Contract(receipt.contractAddress,art.abi,signer);}
  const manifestPath=path.join(BASE,'experiments/simplestories-v2/optimization/full-sentence/codeweights/model/manifest.json'),manifest=JSON.parse(readFileSync(manifestPath)),dataDir=path.dirname(manifestPath);
  const groups={weights:[],tables:[],tiles:[]},runtimes=[];
  const weights=readFileSync(path.join(dataDir,'weights.bin'));assert.equal(sha(weights),manifest.artifacts['weights.bin'].sha256);
  for(let offset=0;offset<weights.length;offset+=24000){const address=ethers.getAddress(ethers.toBeHex(0x100000n+BigInt(runtimes.length),20)),runtime='0x00'+weights.subarray(offset,offset+24000).toString('hex');groups.weights.push(address);runtimes.push({address,runtime});}
  const table=readFileSync(path.resolve(DIR,'../model/tables-2048.bin')),tableMetadataBytes=readFileSync(path.resolve(DIR,'../model/tables-2048.json')),tableMetadata=JSON.parse(tableMetadataBytes);
  assert.equal(table.length,133128);assert.equal(sha(table),tableMetadata.sha256);
  const tableRuntimeHashes=[];for(let offset=0;offset<table.length;offset+=24000){const address=ethers.getAddress(ethers.toBeHex(0xc2048000n+BigInt(groups.tables.length),20)),runtime='0x00'+table.subarray(offset,offset+24000).toString('hex');groups.tables.push(address);runtimes.push({address,runtime});tableRuntimeHashes.push(ethers.keccak256(runtime));}
  assert.deepEqual(tableRuntimeHashes,tableMetadata.runtimeHashes);
  report.tables={sha256:sha(table),bytes:table.length,runtimeCodeHashes:tableRuntimeHashes,metadataSha256:sha(tableMetadataBytes)};
  for(const [i,tile]of manifest.executable_tiles.entries()){const data=readFileSync(path.resolve(dataDir,tile.path)),address=ethers.getAddress(ethers.toBeHex(0x200000n+BigInt(i),20)),runtime='0x'+data.toString('hex');assert.equal(sha(data),tile.sha256);assert.equal(ethers.keccak256(runtime),tile.keccak256);groups.tiles.push(address);runtimes.push({address,runtime});}
  for(let i=0;i<runtimes.length;i+=16)await Promise.all(runtimes.slice(i,i+16).map(async({address,runtime})=>{await mutate('anvil_setCode',[address,runtime]);assert.equal(await provider.getCode(address),runtime);}));
  report.checks.verifiedInjectedRuntimes=runtimes.length;save();
  const model=await deploy(modelSource,modelName,[groups.weights,groups.tables,groups.tiles,3]);report.modelHash=await model.modelHash();report.policy.absolutePositionLimit=Number(await model.MAX_CONTEXT());report.policy.attentionWindow=Number(await model.ATTENTION_WINDOW());
  const manager=await deploy(MANAGER,'PoolManager',[payer]);const router=await deploy(HARNESS,'ContinuityTestRouter',[manager.target]);const factory=await deploy(CORE_HARNESS,'SentenceV4Create2Factory');
  const tokens=[await deploy(CORE_HARNESS,'SentenceV4TestToken'),await deploy(CORE_HARNESS,'SentenceV4TestToken')].sort((a,b)=>BigInt(a.target)<BigInt(b.target)?-1:1);
  for(const token of tokens){assert.equal((await send({to:token.target,data:token.interface.encodeFunctionData('mint',[payer,10n**27n]),gasLimit:1000000n})).status,1);assert.equal((await send({to:token.target,data:token.interface.encodeFunctionData('approve',[router.target,ethers.MaxUint256]),gasLimit:1000000n})).status,1);}
  const hookArt=artifacts[HOOK].ContinuityHook,init=(await new ethers.ContractFactory(hookArt.abi,hookArt.evm.bytecode.object).getDeployTransaction(manager.target,model.target,BUDGET,K,TEMP)).data,initHash=ethers.keccak256(init);
  let salt,hookAddress;for(let i=0n;;i++){salt=ethers.zeroPadValue(ethers.toBeHex(i),32);hookAddress=ethers.getCreate2Address(factory.target,salt,initHash);if((BigInt(hookAddress)&0x3fffn)===0x1040n)break;}
  const hookReceipt=await send({to:factory.target,data:factory.interface.encodeFunctionData('deploy',[salt,init]),gasLimit:5000000n});assert.equal(hookReceipt.status,1);
  const hook=new ethers.Contract(hookAddress,hookArt.abi,signer);report.deployment.push({name:'ContinuityHook',address:hookAddress,gasUsed:hookReceipt.gasUsed,salt,initCodeHash:initHash,runtimeCodeHash:ethers.keccak256(await provider.getCode(hookAddress))});save();
  const coder=ethers.AbiCoder.defaultAbiCoder(),keyType='tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
  const key={currency0:tokens[0].target,currency1:tokens[1].target,fee:3000,tickSpacing:60,hooks:hookAddress};const id=ethers.keccak256(coder.encode([keyType],[key]));report.pool={key,id};
  async function initialize(poolKey){assert.equal((await send({to:manager.target,data:manager.interface.encodeFunctionData('initialize',[poolKey,2n**96n]),gasLimit:2000000n})).status,1);assert.equal((await send({to:router.target,data:router.interface.encodeFunctionData('modifyLiquidity',[poolKey,{tickLower:-60000,tickUpper:60000,liquidityDelta:10n**20n,salt:ethers.ZeroHash}]),gasLimit:2000000n})).status,1);}
  await initialize(key);
  const tokenizer=JSON.parse(readFileSync(path.join(BASE,'experiments/simplestories-v2/model-cache/tokenizer.json'))),vocabulary=[],special=new Set(tokenizer.added_tokens.filter(t=>t.special).map(t=>t.id));for(const [text,index]of Object.entries(tokenizer.model.vocab))vocabulary[index]=text;
  const decode=ids=>ids.filter(i=>!special.has(i)).map(i=>vocabulary[i]).join(' ').replace(/ ##/g,'').replace(/ \./g,'.').replace(/ \?/g,'?').replace(/ !/g,'!').replace(/ ,/g,',').replace(/ ' /g,"'").replace(/ n't/g,"n't").replace(/ 'm/g,"'m").replace(/ 's/g,"'s").replace(/ 've/g,"'ve").replace(/ 're/g,"'re");
  const state=async(poolKey=key,poolId=id)=>({hook:Array.from(await hook.contexts(poolId)),model:Array.from(await model.storyState(hookAddress,poolId)),slot0:Array.from(await router.poolState(poolKey)),balances:await Promise.all(tokens.map(t=>t.balanceOf(payer)))});
  const params=turn=>({zeroForOne:turn%2===1,amountSpecified:-100000000000000n,sqrtPriceLimitX96:turn%2===1?4295128740n:1461446703485210103287273052203988822378723970341n});
  const hookData=(revision,head,seed=SEED)=>coder.encode(['uint64','bytes32','bytes32'],[revision,head,seed]);
  const requestFor=(data,turn=1,method='swapWithHookData',poolKey=key,gasLimit=CAP)=>({to:router.target,data:router.interface.encodeFunctionData(method,[poolKey,params(turn),data]),gasLimit});
  async function rejected(request,before,label){const receipt=await send(request);assert.equal(receipt.status,0,label);assert.equal(json(await state()),json(before),label+' must roll back state');return{status:receipt.status,gasUsed:receipt.gasUsed};}
  const firstState=await state();assert.deepEqual(firstState.hook,[0n,true,ethers.ZeroHash]);assert.equal(firstState.model[0],ethers.ZeroHash);report.checks.poolStartsWithEmptyModelContext=true;
  const firstQuote=await hook.preview(id,0,ethers.ZeroHash,SEED,{gasLimit:CAP});assert.deepEqual(Array.from(firstQuote[0],Number),expected[0].tokens);
  for(const [method,args]of[['afterInitialize',[payer,key,2n**96n,0]],['afterSwap',[payer,key,params(1),0,hookData(0,ethers.ZeroHash)]]]){
    await rejected({to:hookAddress,data:hook.interface.encodeFunctionData(method,args),gasLimit:1000000n},firstState,'Unauthorized callback');
  }
  report.checks.unauthorizedCallbacksRejected=true;
  const modelCode=await provider.getCode(model.target);await mutate('anvil_setCode',[model.target,'0x00']);let rejectedChangedModel=false;try{await hook.preview(id,0,ethers.ZeroHash,SEED,{gasLimit:1000000n});}catch{rejectedChangedModel=true;}assert(rejectedChangedModel);await mutate('anvil_setCode',[model.target,modelCode]);report.checks.previewRejectsChangedModelRuntime=true;
  for(const malformed of ['0x','0x'+'00'.repeat(95),'0x'+'00'.repeat(97),'0x'+'ff'.repeat(96)])await rejected(requestFor(malformed,1,'swapWithHookData',key,1000000n),firstState,'Malformed hook data');report.checks.malformedHookDataRejectedAtomically=true;
  await rejected(requestFor(hookData(0,ethers.ZeroHash),1,'swapWithHookData',key,1000000n),firstState,'Low gas');report.checks.lowGasRejectedWithoutStateAdvance=true;
  const forced=await rejected(requestFor(hookData(0,ethers.ZeroHash),1,'swapAndRevert'),firstState,'Forced post-settlement rollback');report.checks.forcedRollbackAfterInference=forced;
  let transcript=[];let referenceMatches=0,firstChunk;
  for(let turn=1;turn<=turns;turn++){
    const before=await state(),revision=before.hook[0],head=before.hook[2];let quote;
    try{quote=await hook.preview(id,revision,head,SEED,{gasLimit:CAP});}
    catch(error){report.stopped={turn,phase:'preview',before:before.model,error:errorInfo(error)};save();break;}
    const tokensOut=Array.from(quote[0],Number),request=requestFor(hookData(revision,head),turn),receipt=await send(request),after=await state();
    const row={turn,requestedTokens:Number(quote[6]),tokens:tokensOut,text:decode(tokensOut),before:before.model,preview:{tokens:tokensOut,endedEos:quote[1],endedSentence:quote[2],lastLogitHash:quote[3],nextContextHash:quote[4],refreshed:quote[5]},swap:{status:receipt.status,gasUsed:receipt.gasUsed,gasLimit:CAP},after:after.model};report.turns.push(row);
    if(receipt.status===0){assert.equal(json(before),json(after));row.swap.atomicRollbackVerified=true;report.stopped={turn,phase:'swap',before:before.model};save();break;}
    const events=receipt.logs.filter(log=>log.address.toLowerCase()===hookAddress.toLowerCase()).map(log=>hook.interface.parseLog(log)).filter(log=>log?.name==='StoryContinued');assert.equal(events.length,1);const event=events[0].args;
    assert.equal(event.poolId,id);assert.equal(event.revision,revision+1n);assert.equal(event.modelHash,report.modelHash);assert.equal(event.previousContextHash,head);assert.equal(event.contextHash,quote[4]);assert.equal(event.seed,SEED);assert.equal(Number(event.requestedTokens),Number(quote[6]));assert.deepEqual(Array.from(event.tokens,Number),tokensOut);assert.equal(event.endedEos,quote[1]);assert.equal(event.endedSentence,quote[2]);assert.equal(event.lastLogitHash,quote[3]);assert.equal(event.refreshed,quote[5]);
    assert.equal(after.hook[0],revision+1n);assert.equal(after.hook[2],quote[4]);assert.equal(after.model[0],quote[4]);assert.equal(after.model[2],BigInt(tokensOut.at(-1)));assert.equal(after.model[3],before.model[3]+BigInt(tokensOut.length));assert.notEqual(json(before.balances),json(after.balances));
    const [chunkAddress,chunkHash]=await model.storyChunk(hookAddress,id,Number(after.model[6])-1),chunkCode=await provider.getCode(chunkAddress);assert.equal(ethers.keccak256(chunkCode),chunkHash);row.chunk={address:chunkAddress,runtimeCodeHash:chunkHash,runtimeBytes:(chunkCode.length-2)/2};if(!firstChunk)firstChunk={address:chunkAddress,code:chunkCode};
    transcript.push(...tokensOut);row.totalText=decode(transcript);row.swap.previewAndExecutionMatch=true;row.swap.settlementVerified=true;
    if(turn<=expected.length){const e=expected[turn-1];assert.equal(Number(quote[6]),Number(e.max_new_tokens_requested??e.maximum_new_tokens??2));assert.equal(Number(before.model[3]),Number(e.total_generated_before));assert.deepEqual(tokensOut,e.tokens,'Independent tokens at turn '+turn);assert.equal(quote[3],e.last_logit_hash,'Full 4019 logits at turn '+turn);assert.equal(quote[1],e.ended_eos);assert.equal(quote[2],e.ended_sentence);assert.equal(after.model[1],BigInt(e.processed_after??e.processed_kv_after));assert.equal(after.model[2],BigInt(e.pending_after??e.pending_token_after));row.independentReferenceVerified=true;referenceMatches++;}
    save();if(turn%5===0||quote[5])console.log(`Turn ${turn}: absolute position ${after.model[1]}, epoch ${after.model[4]}, ${receipt.gasUsed} gas${quote[5]?' (unexpected refresh)':''}`);
    assert.equal(quote[5],false,'Rolling KV continuity must not reset or refresh its prompt');
    if(turn===1){
      await rejected(requestFor(hookData(0,ethers.ZeroHash),2,'swapWithHookData',key,1000000n),after,'Stale quote');report.checks.staleRevisionAndContextRejected=true;
      await rejected(requestFor(hookData(after.hook[0],ethers.ZeroHash),2,'swapWithHookData',key,1000000n),after,'Forged context hash');report.checks.forgedContextHashRejected=true;
      await rejected(requestFor(hookData(0,after.hook[2]),2,'swapWithHookData',key,1000000n),after,'Stale revision');report.checks.staleRevisionRejected=true;
    }
  }
  const current=await state();const n=Number(current.model[6]);assert(n>0);const [activeAddress]=await model.storyChunk(hookAddress,id,n-1),activeCode=await provider.getCode(activeAddress),altered=Buffer.from(activeCode.slice(2),'hex');altered[6]^=1;await mutate('anvil_setCode',[activeAddress,'0x'+altered.toString('hex')]);let rejectedHistory=false;try{await hook.preview(id,current.hook[0],current.hook[2],SEED,{gasLimit:CAP});}catch{rejectedHistory=true;}assert(rejectedHistory);await mutate('anvil_setCode',[activeAddress,activeCode]);report.checks.modifiedActiveHistoryChunkRejected=true;
  const eoaBefore=await model.storyState(payer,id);assert.equal(eoaBefore[0],ethers.ZeroHash);const eoaRequest={to:model.target,data:model.interface.encodeFunctionData('advanceStory',[id,ethers.ZeroHash,2,SEED,K,TEMP]),gasLimit:CAP};const eoaReceipt=await send(eoaRequest);assert.equal(eoaReceipt.status,1);assert.deepEqual(Array.from(await model.storyState(hookAddress,id)),current.model);assert.notEqual((await model.storyState(payer,id))[0],ethers.ZeroHash);report.checks.untrustedCallerCannotAdvanceHookNamespace=true;
  const secondKey={...key,fee:500},secondId=ethers.keccak256(coder.encode([keyType],[secondKey]));await initialize(secondKey);assert.equal((await model.storyState(hookAddress,secondId))[0],ethers.ZeroHash);const secondQuote=await hook.preview(secondId,0,ethers.ZeroHash,SEED,{gasLimit:CAP});assert.deepEqual(Array.from(secondQuote[0],Number),expected[0].tokens);const secondReceipt=await send(requestFor(hookData(0,ethers.ZeroHash),1,'swapWithHookData',secondKey));assert.equal(secondReceipt.status,1);assert.deepEqual(Array.from(await model.storyState(hookAddress,id)),current.model);report.checks.poolStoriesIsolated={secondPoolId:secondId,secondPoolFirstTokens:Array.from(secondQuote[0],Number),gasUsed:secondReceipt.gasUsed};
  const successful=report.turns.filter(x=>x.swap.status===1),gas=successful.map(x=>BigInt(x.swap.gasUsed));report.summary={attemptedSwaps:report.turns.length,successfulSwaps:successful.length,generatedTokens:transcript.length,independentReferenceMatches:referenceMatches,
    minSwapGas:gas.reduce((a,b)=>a<b?a:b),maxSwapGas:gas.reduce((a,b)=>a>b?a:b),maximumAbsolutePosition:Math.max(...successful.map(x=>Number(x.after[1]))),attentionWindow:report.policy.attentionWindow,
    refreshes:successful.filter(x=>x.preview.refreshed).length,epochs:Number(current.model[4]),oneTokenTurns:successful.filter(x=>x.tokens.length===1).length,twoTokenTurns:successful.filter(x=>x.tokens.length===2).length,
    reachedContextMilestones:[16,32,64,128].map(size=>{const row=successful.find(x=>Number(x.after[1])>=size);return{size,reached:!!row,turn:row?.turn??null,absolutePosition:row?.after[1]??null,gasUsed:row?.swap.gasUsed??null};}),transcript:decode(transcript)};
  assert.equal(sha(readFileSync(referencePath)),sha(referenceBytes),'Reference file changed during the run');
  report.checks.allSuccessfulSwapPreviewsMatchExecution=true;report.checks.modelGeneratedEveryPersistedContext=true;report.checks.globalSamplingStepAndPendingTokenPreserved=true;report.checks.sameCallerSeedContinuesInsteadOfResetting=true;report.status=report.stopped?'PARTIAL_WITH_RECORDED_LIMIT':'PASS';report.completedAt=new Date().toISOString();save();console.log(json(report.summary));
}
try{await main();}catch(error){report.status='FAIL';report.error=errorInfo(error);save();console.error(error.shortMessage||error.message);process.exitCode=1;}
finally{await provider?.destroy();if(child){child.kill('SIGTERM');await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,1000);});}if(temp)rmSync(temp,{recursive:true,force:true});}
