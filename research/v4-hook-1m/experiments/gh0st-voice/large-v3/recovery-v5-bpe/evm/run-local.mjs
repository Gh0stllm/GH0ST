// Genuine per-pool story state on a fresh local PoolManager. No fork URL or public broadcast path exists.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import * as ethers from 'ethers';
import {loadTokenizer,decodeIds} from './tokenizer.mjs';
import { DIR, BASE, relative, sha, json, compileHook, compileManager, compileModel, HOOK, HARNESS, MANAGER, CORE_HARNESS } from './compile.mjs';

const argv=process.argv.slice(2),opt=(key,otherwise)=>(argv.find(a=>a.startsWith(key+'='))??key+'='+otherwise).slice(key.length+1);
assert(argv.every(a=>/^--(export-dir|turns|port|label|prompt-token|top-k|temperature-milli)=/.test(a)),'Unknown option');
const exportDir=path.resolve(DIR,opt('--export-dir','../export/selected'));
const modelName='GH0STVoiceRelative64Model',turns=Number(opt('--turns',128)),port=Number(opt('--port',18660)),label=opt('--label','gh0st-recovery-v5-bpe');
const promptToken=Number(opt('--prompt-token',3)),K=Number(opt('--top-k',8)),TEMP=Number(opt('--temperature-milli',800));
assert(Number.isInteger(promptToken)&&promptToken>0&&promptToken<4019&&![1,2,15,30].includes(promptToken),'Invalid initial prompt token');
assert(Number.isInteger(K)&&K>=1&&K<=64);assert(Number.isInteger(TEMP)&&TEMP>0);
assert(Number.isInteger(turns)&&turns>=1&&turns<=10000);assert(port>=1024&&port<=65535);assert(/^[a-z0-9-]+$/.test(label));
const modelSource=relative(path.join(exportDir,'evm',modelName+'.sol'));
const referencePath=path.join(exportDir,'q12-continuity-comparison.json');
const referenceBytes=readFileSync(referencePath),reference=JSON.parse(referenceBytes);
const referenceRun=reference.runs.find(r=>r.model==='tuned'&&r.seed===42);
assert(referenceRun,'Missing tuned seed42 independent Q12 reference');
assert.deepEqual(reference.initial_prompt_ids,[promptToken]);
assert.deepEqual(referenceRun.prompt_ids,[promptToken]);
assert.equal(reference.top_k,K);assert.equal(reference.temperature_milli,TEMP);assert.equal(reference.window,64);
let generatedBefore=0;
const expected=referenceRun.turns.map(t=>{const prior=generatedBefore;generatedBefore+=t.tokens.length;return{...t,
  max_new_tokens_requested:t.processed_before<=26?2:1,total_generated_before:prior,
  last_logit_hash:referenceRun.every_step_logit_hash[generatedBefore-1],pending_after:t.tokens.at(-1)};});
assert(expected.length>=turns,'Independent reference must cover every requested swap');
const quantization=JSON.parse(readFileSync(path.join(exportDir,'quantization-report.json')));
const exportManifestPath=path.join(exportDir,'evm/model-manifest.json'),exportManifestBytes=readFileSync(exportManifestPath),exportManifest=JSON.parse(exportManifestBytes);
assert.equal(exportManifest.allowed_chain_id,31337);assert.equal(exportManifest.contract_name,modelName);
assert.equal(exportManifest.initial_prompt_token,promptToken);assert.deepEqual(quantization.initial_prompt_ids,[promptToken]);
assert.equal(exportManifest.top_k,K);assert.equal(exportManifest.temperature_milli,TEMP);
const tokenizer=loadTokenizer(exportDir,BASE),decode=ids=>decodeIds(ids,tokenizer);
for(const metadata of [reference,quantization,exportManifest])assert.equal(metadata.tokenizer_sha256,tokenizer.sha256);
assert.equal(referenceRun.prompt_text,decode([promptToken]));
assert.equal(exportManifest.source_sha256,sha(readFileSync(path.join(BASE,modelSource))));
assert.equal(exportManifest.checkpoint_sha256,quantization.checkpoint_sha256);
assert.equal(reference.checkpoint_sha256,quantization.checkpoint_sha256);
assert.equal(reference.weights_sha256,quantization.weights_sha256);
assert(quantization.tokenizer_vocab_unchanged&&quantization.swar8_signed12_compatible);
assert.equal(referenceRun.q12_safety.linear_input_signed17_bound_violations,0,'Tuned trajectory violates SWAR activation bound');
const CAP=32_000_000n,BUDGET=29_250_000n,SEED=ethers.zeroPadValue(ethers.toBeHex(42),32);
const url=`http://127.0.0.1:${port}`,output=path.join(DIR,label+'-local.json');
const report={status:'RUNNING',startedAt:new Date().toISOString(),scope:'GH0ST recovery-v5 original WordPiece tokenizer: unforked local PoolManager research only; no public transactions.',
  languageQuality:{status:'NOT_APPROVED',scope:'This is a numerical parity and gas benchmark. Successful swaps do not establish fluent, coherent, or release-ready language.'},
  network:{chainId:31337,forked:false,transactionGasLimit:CAP,feePolicy:'Artificial zero-fee local blocks. Gas figures are execution units, not network fee estimates.'},
  policy:{prompt:[promptToken],promptText:decode([promptToken]),promptCountsAsGenerated:false,seed:SEED,topK:K,temperatureMilli:TEMP,inferenceBudget:BUDGET,maximumNewTokens:2,
    requestedTokens:'Two while the absolute processed position is at most26; one thereafter.',
    termination:'Emits genuine model tokens. A swap may stop mid-sentence; punctuation and EOS do not reset context.',
    overflow:'Attention uses the newest64 numerical KV positions and relative rotary distances. No fixed RoPE table lifetime limit or automatic prompt reset. Monotonic counters are uint64.'},
  configuration:{requestedTurns:turns,exportDir:relative(exportDir),checkpointSha256:quantization.checkpoint_sha256,weightsSha256:quantization.weights_sha256},sources:{model:modelSource,hook:HOOK},sourceSha256:{},reference:{path:relative(referencePath),sha256:sha(referenceBytes),cases:expected.length},
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
  for(const [source,name]of [[modelSource,modelName],[HOOK,'RelativeContinuityHook']]){
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
  async function send(request,using=signer){
    assert(BigInt(request.gasLimit)<=CAP);await mutate('anvil_setNextBlockBaseFeePerGas',['0x0']);await guard();
    const tx=await using.sendTransaction({...request,gasPrice:0n});
    // Poll the actual receipt, not ethers' cached block number: Anvil can mine while wait(1) stalls.
    for(let attempt=0;attempt<6000;attempt++){
      const receipt=await rpc('eth_getTransactionReceipt',[tx.hash]);
      if(receipt)return{...receipt,status:Number(BigInt(receipt.status)),gasUsed:BigInt(receipt.gasUsed)};
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw Error('Local transaction receipt timeout: '+tx.hash);
  }
  async function deploy(source,name,args=[],gasLimit=CAP){const art=artifacts[source][name],factory=new ethers.ContractFactory(art.abi,art.evm.bytecode.object,signer),request=await factory.getDeployTransaction(...args);assert((request.data.length-2)/2<=49152);const receipt=await send({...request,gasLimit});assert.equal(receipt.status,1,'Deployment failed: '+name);report.deployment.push({name,address:receipt.contractAddress,gasUsed:receipt.gasUsed,initCodeBytes:(request.data.length-2)/2,runtimeCodeHash:ethers.keccak256(await provider.getCode(receipt.contractAddress))});save();return new ethers.Contract(receipt.contractAddress,art.abi,signer);}
  const manifestPath=path.join(exportDir,'packed-swar8/manifest.json'),manifest=JSON.parse(readFileSync(manifestPath)),dataDir=path.dirname(manifestPath);
  const tileManifestPath=path.join(exportDir,'codeweights/tile-manifest.json'),tileManifestBytes=readFileSync(tileManifestPath),tileManifest=JSON.parse(tileManifestBytes);
  const groups={weights:[],tables:[],tiles:[]},runtimes=[];
  const weights=readFileSync(path.join(dataDir,'weights.bin'));assert.equal(sha(weights),manifest.artifacts['weights.bin'].sha256);assert.equal(weights.length,6258016);
  assert.equal(tileManifest.source_weights_sha256,quantization.weights_sha256);assert.equal(tileManifest.source_packed_weights_sha256,sha(weights));
  for(let offset=0;offset<weights.length;offset+=24000){const address=ethers.getAddress(ethers.toBeHex(0x100000n+BigInt(runtimes.length),20)),runtime='0x00'+weights.subarray(offset,offset+24000).toString('hex');groups.weights.push(address);runtimes.push({address,runtime});}
  const table=readFileSync(path.join(exportDir,'model/tables-relative64.bin'));
  const frozenTablePath=path.join(BASE,'experiments/simplestories-v2/optimization/varied-sentence/continuity/model/tables-relative64.bin');
  assert.equal(sha(table),sha(readFileSync(frozenTablePath)),'Relative64 numerical table unexpectedly changed');assert.equal(table.length,6152);
  const tableRuntimeHashes=[];for(let offset=0;offset<table.length;offset+=24000){const address=ethers.getAddress(ethers.toBeHex(0xc2048000n+BigInt(groups.tables.length),20)),runtime='0x00'+table.subarray(offset,offset+24000).toString('hex');groups.tables.push(address);runtimes.push({address,runtime});tableRuntimeHashes.push(ethers.keccak256(runtime));}
  report.tables={sha256:sha(table),bytes:table.length,runtimeCodeHashes:tableRuntimeHashes};
  let tileRoot=ethers.ZeroHash;
  for(const [i,tile]of tileManifest.code_tiles.entries()){const data=readFileSync(path.resolve(exportDir,'codeweights',tile.path)),address=ethers.getAddress(ethers.toBeHex(0x200000n+BigInt(i),20)),runtime='0x'+data.toString('hex');assert.equal(tile.index,i);assert.equal(sha(data),tile.sha256);assert.equal(ethers.keccak256(runtime),tile.keccak256);assert(data.length<=24000);groups.tiles.push(address);runtimes.push({address,runtime});tileRoot=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','bytes32'],[tileRoot,tile.keccak256]));}
  assert.equal(tileRoot,tileManifest.code_commitment);assert.equal(tileRoot,exportManifest.expected_tile_commitment);assert.equal(sha(weights),exportManifest.artifacts['weights.bin'].sha256);assert.equal(sha(table),exportManifest.artifacts['tables.bin'].sha256);
  assert.deepEqual(runtimes.filter(r=>groups.weights.includes(r.address)).map(r=>ethers.keccak256(r.runtime)),exportManifest.weight_runtime_hashes);
  assert.deepEqual(tableRuntimeHashes,exportManifest.table_runtime_hashes);
  report.weightArtifacts={packedSha256:sha(weights),packedBytes:weights.length,tiles:tileManifest.code_tiles.length,tileManifestSha256:sha(tileManifestBytes),tileCommitment:tileRoot,exportManifestSha256:sha(exportManifestBytes)};
  for(let i=0;i<runtimes.length;i+=16)await Promise.all(runtimes.slice(i,i+16).map(async({address,runtime})=>{await mutate('anvil_setCode',[address,runtime]);assert.equal(await provider.getCode(address),runtime);}));
  report.checks.verifiedInjectedRuntimes=runtimes.length;save();
  const model=await deploy(modelSource,modelName,[groups.weights,groups.tables,groups.tiles,promptToken]);
  assert.equal(Number(await model.initialPromptToken()),promptToken);report.modelHash=await model.modelHash();report.policy.positionIndependent=await model.POSITION_INDEPENDENT();report.policy.attentionWindow=Number(await model.ATTENTION_WINDOW());
  const manager=await deploy(MANAGER,'PoolManager',[payer]);const router=await deploy(HARNESS,'ContinuityTestRouter',[manager.target]);const factory=await deploy(CORE_HARNESS,'SentenceV4Create2Factory');
  const tokens=[await deploy(CORE_HARNESS,'SentenceV4TestToken'),await deploy(CORE_HARNESS,'SentenceV4TestToken')].sort((a,b)=>BigInt(a.target)<BigInt(b.target)?-1:1);
  for(const token of tokens){assert.equal((await send({to:token.target,data:token.interface.encodeFunctionData('mint',[payer,10n**27n]),gasLimit:1000000n})).status,1);assert.equal((await send({to:token.target,data:token.interface.encodeFunctionData('approve',[router.target,ethers.MaxUint256]),gasLimit:1000000n})).status,1);}
  const hookArt=artifacts[HOOK].RelativeContinuityHook,init=(await new ethers.ContractFactory(hookArt.abi,hookArt.evm.bytecode.object).getDeployTransaction(manager.target,model.target,BUDGET,K,TEMP)).data,initHash=ethers.keccak256(init);
  let salt,hookAddress;for(let i=0n;;i++){salt=ethers.zeroPadValue(ethers.toBeHex(i),32);hookAddress=ethers.getCreate2Address(factory.target,salt,initHash);if((BigInt(hookAddress)&0x3fffn)===0x1040n)break;}
  const hookReceipt=await send({to:factory.target,data:factory.interface.encodeFunctionData('deploy',[salt,init]),gasLimit:5000000n});assert.equal(hookReceipt.status,1);
  const hook=new ethers.Contract(hookAddress,hookArt.abi,signer);report.deployment.push({name:'RelativeContinuityHook',address:hookAddress,gasUsed:hookReceipt.gasUsed,salt,initCodeHash:initHash,runtimeCodeHash:ethers.keccak256(await provider.getCode(hookAddress))});save();
  const coder=ethers.AbiCoder.defaultAbiCoder(),keyType='tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
  const key={currency0:tokens[0].target,currency1:tokens[1].target,fee:3000,tickSpacing:60,hooks:hookAddress};const id=ethers.keccak256(coder.encode([keyType],[key]));report.pool={key,id};
  async function initialize(poolKey){assert.equal((await send({to:manager.target,data:manager.interface.encodeFunctionData('initialize',[poolKey,2n**96n]),gasLimit:2000000n})).status,1);assert.equal((await send({to:router.target,data:router.interface.encodeFunctionData('modifyLiquidity',[poolKey,{tickLower:-60000,tickUpper:60000,liquidityDelta:10n**20n,salt:ethers.ZeroHash}]),gasLimit:2000000n})).status,1);}
  await initialize(key);
  report.tokenizer={type:'WordPiece',sha256:tokenizer.sha256,originalVocabularyPreserved:true};
  const state=async(poolKey=key,poolId=id)=>{const [h,m,slot0,...balances]=await Promise.all([hook.contexts(poolId),model.storyState(hookAddress,poolId),router.poolState(poolKey),...tokens.map(t=>t.balanceOf(payer))]);return{hook:Array.from(h),model:Array.from(m),slot0:Array.from(slot0),balances};};
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
  let transcript=[];let referenceMatches=0,firstChunk,previousState=firstState;
  for(let turn=1;turn<=turns;turn++){
    const before=previousState,revision=before.hook[0],head=before.hook[2];let quote;
    try{quote=await hook.preview(id,revision,head,SEED,{gasLimit:CAP});}
    catch(error){report.stopped={turn,phase:'preview',before:before.model,error:errorInfo(error)};save();break;}
    const tokensOut=Array.from(quote[0],Number),request=requestFor(hookData(revision,head),turn),receipt=await send(request),after=await state();previousState=after;
    const row={turn,requestedTokens:Number(quote[6]),tokens:tokensOut,text:decode(tokensOut),before:before.model,preview:{tokens:tokensOut,endedEos:quote[1],endedSentence:quote[2],lastLogitHash:quote[3],nextContextHash:quote[4],refreshed:quote[5]},swap:{status:receipt.status,gasUsed:receipt.gasUsed,gasLimit:CAP},after:after.model};report.turns.push(row);
    if(receipt.status===0){assert.equal(json(before),json(after));row.swap.atomicRollbackVerified=true;report.stopped={turn,phase:'swap',before:before.model};save();break;}
    const events=receipt.logs.filter(log=>log.address.toLowerCase()===hookAddress.toLowerCase()).map(log=>hook.interface.parseLog(log)).filter(log=>log?.name==='StoryContinued');assert.equal(events.length,1);const event=events[0].args;
    assert.equal(event.poolId,id);assert.equal(event.revision,revision+1n);assert.equal(event.modelHash,report.modelHash);assert.equal(event.previousContextHash,head);assert.equal(event.contextHash,quote[4]);assert.equal(event.seed,SEED);assert.equal(Number(event.requestedTokens),Number(quote[6]));assert.deepEqual(Array.from(event.tokens,Number),tokensOut);assert.equal(event.endedEos,quote[1]);assert.equal(event.endedSentence,quote[2]);assert.equal(event.lastLogitHash,quote[3]);assert.equal(event.refreshed,quote[5]);
    assert.equal(after.hook[0],revision+1n);assert.equal(after.hook[2],quote[4]);assert.equal(after.model[0],quote[4]);assert.equal(after.model[2],BigInt(tokensOut.at(-1)));assert.equal(after.model[3],before.model[3]+BigInt(tokensOut.length));assert.notEqual(json(before.balances),json(after.balances));
    const [chunkAddress,chunkHash]=await model.storyChunk(hookAddress,id,Number(after.model[6])-1),chunkCode=await provider.getCode(chunkAddress);assert.equal(ethers.keccak256(chunkCode),chunkHash);row.chunk={address:chunkAddress,runtimeCodeHash:chunkHash,runtimeBytes:(chunkCode.length-2)/2};if(!firstChunk)firstChunk={address:chunkAddress,code:chunkCode};
    transcript.push(...tokensOut);if(turn===turns||turn%25===0)row.totalText=decode(transcript);row.swap.previewAndExecutionMatch=true;row.swap.settlementVerified=true;
    if(turn<=expected.length){const e=expected[turn-1];assert.equal(Number(quote[6]),Number(e.max_new_tokens_requested??e.maximum_new_tokens??2));assert.equal(Number(before.model[3]),Number(e.total_generated_before));assert.deepEqual(tokensOut,e.tokens,'Independent tokens at turn '+turn);assert.equal(quote[3],e.last_logit_hash,'Full 4019 logits at turn '+turn);assert.equal(quote[1],e.ended_eos);assert.equal(quote[2],e.ended_sentence);assert.equal(after.model[1],BigInt(e.processed_after??e.processed_kv_after));assert.equal(after.model[2],BigInt(e.pending_after??e.pending_token_after));row.independentReferenceVerified=true;referenceMatches++;}
    if(turn%25===0||turn===140)save();if(turn%10===0||turn===turns||quote[5])console.log(`Turn ${turn}: processed position ${after.model[1]}, epoch ${after.model[4]}, ${receipt.gasUsed} gas${quote[5]?' (unexpected refresh)':''}`);
    assert.equal(quote[5],false,'Relative KV continuity must not reset or refresh its prompt');
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
    minSwapGas:gas.reduce((a,b)=>a<b?a:b),maxSwapGas:gas.reduce((a,b)=>a>b?a:b),maximumProcessedPosition:Math.max(...successful.map(x=>Number(x.after[1]))),attentionWindow:report.policy.attentionWindow,
    refreshes:successful.filter(x=>x.preview.refreshed).length,epochs:Number(current.model[4]),oneTokenTurns:successful.filter(x=>x.tokens.length===1).length,twoTokenTurns:successful.filter(x=>x.tokens.length===2).length,
    reachedContextMilestones:[16,32,64,128,2047,2048,2049,2050].map(size=>{const row=successful.find(x=>Number(x.after[1])>=size);return{size,reached:!!row,turn:row?.turn??null,processedPosition:row?.after[1]??null,gasUsed:row?.swap.gasUsed??null};}),transcript:decode(transcript),promptText:decode([promptToken]),fullText:decode([promptToken,...transcript])};
  const saturated=successful.filter(x=>Number(x.before[1])>=63).map(x=>BigInt(x.swap.gasUsed));
  report.summary.meanSwapGas=gas.reduce((a,b)=>a+b,0n)/BigInt(gas.length);
  report.summary.saturatedWindowSwaps=saturated.length;
  if(turns>=64)assert(saturated.length>0,'Requested benchmark must reach and exercise the full64-position attention window');
  report.summary.saturatedWindowMinGas=saturated.length?saturated.reduce((a,b)=>a<b?a:b):null;
  report.summary.saturatedWindowMaxGas=saturated.length?saturated.reduce((a,b)=>a>b?a:b):null;
  writeFileSync(path.join(DIR,label+'-transcript.txt'),'PROMPT: '+report.summary.promptText+'\nGENERATED: '+report.summary.transcript+'\nCOMBINED: '+report.summary.fullText+'\n');
  assert.equal(sha(readFileSync(referencePath)),sha(referenceBytes),'Reference file changed during the run');
  report.checks.allSuccessfulSwapPreviewsMatchExecution=true;report.checks.modelGeneratedEveryPersistedContext=true;report.checks.globalSamplingStepAndPendingTokenPreserved=true;report.checks.sameCallerSeedContinuesInsteadOfResetting=true;assert.equal(referenceMatches,turns,'Every requested swap must match the independent reference');assert.equal(successful.length,turns);assert(gas.every(g=>g<CAP),'Every swap must remain below 32M gas');report.status=report.stopped?'PARTIAL_WITH_RECORDED_LIMIT':'PASS';report.completedAt=new Date().toISOString();save();console.log(json(report.summary));
}
try{await main();}catch(error){report.status='FAIL';report.error=errorInfo(error);save();console.error(error.shortMessage||error.message);process.exitCode=1;}
finally{await provider?.destroy();if(child){child.kill('SIGTERM');await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,1000);});}if(temp)rmSync(temp,{recursive:true,force:true});}
