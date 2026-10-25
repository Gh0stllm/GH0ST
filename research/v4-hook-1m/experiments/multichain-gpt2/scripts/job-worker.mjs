// Single-job keeper. Read-only unless --execute plus explicit configuration and a key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AbiCoder,Contract,JsonRpcProvider,Wallet,NonceManager,keccak256} from 'ethers';
import {compile,HERE,assertSourcesUnchanged} from './build.mjs';
import {JOB_ROUTER,JOB_KIND} from './job-plan.mjs';
import {validateJobRuntimeConfig,verifyJobDeployment,jobReportPath,atomicJobReport} from './verify-job-deployment.mjs';
import {selectWork,gasLimitForEstimate} from './worker.mjs';
export {validateJobRuntimeConfig};
const coder=AbiCoder.defaultAbiCoder();
export const JOB_PACKET_TYPE='tuple(uint8 version,uint8 kind,bytes32 routeId,bytes32 modelId,bytes32 sessionId,bytes32 jobId,bytes32 promptHash,uint32 maxNewTokens,bytes32 trace,bytes tokens)';
const equal=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const option=(args,key,fallback)=>args.find(x=>x.startsWith('--'+key+'='))?.slice(key.length+3)??fallback;
export function packJobTokens(tokens) {
  assert(Array.isArray(tokens)&&tokens.length>=1&&tokens.length<=1024,'Invalid prompt length');
  const bytes=Buffer.alloc(tokens.length*4);
  tokens.forEach((token,index)=>{assert(Number.isSafeInteger(token)&&token>=0&&token<50257,'Invalid GPT-2 token ID');bytes.writeUInt32BE(token,index*4);});
  return '0x'+bytes.toString('hex');
}
export function validateJobInput(tokens,newTokens) {
  const packed=packJobTokens(tokens);
  assert(Number.isSafeInteger(newTokens)&&newTokens>=1&&tokens.length+newTokens-1<=1024,'Job exceeds model context');
  return packed;
}
export function parseJobArgs(args) {
  if(args.length===1&&args[0]==='--help')return {help:true};
  const keys=['config','data','prompt-tokens','generate','interval-ms'];
  assert(args.every(x=>['--execute','--once','--watch'].includes(x)||keys.some(k=>x.startsWith('--'+k+'='))),'Unknown job-worker option');
  for(const key of [...keys,'execute','once','watch'])assert(args.filter(x=>x==='--'+key||x.startsWith('--'+key+'=')).length<=1,'Duplicate job-worker option');
  assert(!(args.includes('--once')&&args.includes('--watch')),'Choose once or watch');
  const promptText=option(args,'prompt-tokens',null);
  assert(promptText===null||/^[0-9]+(?:,[0-9]+)*$/.test(promptText),'Prompt must contain decimal token IDs');
  const prompt=promptText===null?null:promptText.split(',').map(Number);
  const generateText=option(args,'generate','1'),intervalText=option(args,'interval-ms','3000');
  assert(/^[1-9][0-9]*$/.test(generateText)&&/^[1-9][0-9]*$/.test(intervalText),'Invalid numeric option');
  const generate=Number(generateText),intervalMs=Number(intervalText);
  assert(Number.isSafeInteger(generate)&&generate<=1024,'Invalid generation length');
  assert(Number.isSafeInteger(intervalMs)&&intervalMs>=1000&&intervalMs<=60000,'Invalid polling interval');
  const packed=prompt===null?null:validateJobInput(prompt,generate);
  return {execute:args.includes('--execute'),watch:args.includes('--watch'),prompt,packed,generate,intervalMs,
    configFile:path.resolve(option(args,'config',path.join(HERE,'deployments/job/runtime.json'))),
    dataDirectory:path.resolve(option(args,'data',fs.existsSync(path.join(HERE,'data/manifest.json'))?path.join(HERE,'data'):path.resolve(HERE,'../gpt2-bsc/data')))};
}
async function pendingPrompt(connection) {
  const {router,provider,config}=connection;
  const jobId=await router.jobId(),promptHash=await router.promptHash();
  const latest=await provider.getBlockNumber(),window=Number(config.maxLogRange??2000);
  assert(Number.isSafeInteger(window)&&window>=1&&window<=10000,'Invalid event window');
  for(let to=latest;to>=config.deploymentBlock;to-=window) {
    const logs=await router.queryFilter(router.filters.JobReceived(null,jobId),Math.max(config.deploymentBlock,to-window+1),to);
    for(const log of logs.reverse()) {
      const packet=coder.decode([JOB_PACKET_TYPE],log.args.packet)[0];
      if(equal(packet.jobId,jobId)&&equal(keccak256(packet.tokens),promptHash)
        &&equal(coder.encode([JOB_PACKET_TYPE],[packet]),log.args.packet))return packet.tokens;
    }
  }
  assert.fail('Authenticated prompt event is unavailable; use an archive-capable RPC');
}
export async function nextJobAction(home,compute,input={packed:null,generate:1}) {
  if(await home.router.resultFinalized())return {kind:'complete'};
  if(!await home.router.requested())return input.packed?{kind:'router',connection:home,method:'requestJob',args:[input.packed,input.generate],quoteMethod:'quoteRequest'}:{kind:'idle'};
  if(input.packed) {
    assert(equal(await home.router.promptHash(),keccak256(input.packed)),'Existing job prompt differs');
    assert(Number(await home.router.maxNewTokens())===input.generate,'Existing job output limit differs');
  }
  if(await compute.router.awaitingActivation())return {kind:'activate',connection:compute};
  if(await compute.router.running()) {
    const phase=Number(await compute.engine.phase());
    if(phase===12)return {kind:'router',connection:compute,method:'continueJob',args:[]};
    assert(phase>=1&&phase<=11,'Running job engine has invalid phase');
    return {kind:'compute',connection:compute};
  }
  if(await compute.router.completed()&&!await compute.router.resultDispatched())return {kind:'router',connection:compute,method:'dispatchResult',args:[],quoteMethod:'quoteResult'};
  return {kind:'idle'};
}
export async function jobFeeOverrides(connection) {
  const block=await connection.provider.getBlock('latest');assert(block&&block.timestamp<=connection.deadline,'Job expired before signed action');
  const cap=BigInt(connection.config.maxFeePerGasWei);assert(cap>0n,'A per-gas budget is required');
  const bid=connection.config.gasPriceWei;
  if(bid!==undefined&&bid!==null) {
    assert(connection.config.key==='opbnb'&&connection.config.chainId===204,'Custom bids are supported only on opBNB');
    const gasPrice=BigInt(bid);assert(gasPrice>=1n&&gasPrice<=cap,'Custom bid exceeds its configured cap');
    assert(block.baseFeePerGas!==null&&block.baseFeePerGas!==undefined,'opBNB base fee is unavailable');
    assert(gasPrice>=BigInt(block.baseFeePerGas)+1001n,'Custom bid is below live base fee plus conservative priority floor');
    // Conservative operator floor, not a claim about the minimum accepted by every sequencer.
    // An explicit policy only. A valid low bid may wait longer for inclusion.
    return {gasPrice};
  }
  const fees=await connection.provider.getFeeData();
  if(fees.maxFeePerGas!==null) {
    assert(fees.maxFeePerGas<=cap,'Source fee quote exceeds configured budget');
    assert((fees.maxPriorityFeePerGas??0n)<=fees.maxFeePerGas,'Priority fee exceeds total fee cap');
    return {maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas??0n};
  }
  assert(fees.gasPrice!==null&&fees.gasPrice<=cap,'Source gas price exceeds configured budget');return {gasPrice:fees.gasPrice};
}
async function mined(transaction,connection,action) {
  const receipt=await transaction.wait(connection.config.confirmations);
  assert(receipt&&receipt.status===1,'Job transaction failed');
  console.log(JSON.stringify({chain:connection.config.key,action,hash:receipt.hash,gasUsed:String(receipt.gasUsed)}));
}
export async function sendJobAction(connection,method,args=[],quoteMethod=null) {
  assert(connection.execute===true,'Paid execution is disabled');
  assert(['requestJob','activateJob','continueJob','dispatchResult'].includes(method),'Unsupported job action');
  assert(quoteMethod===null||quoteMethod===(method==='requestJob'?'quoteRequest':method==='dispatchResult'?'quoteResult':null),'Invalid job quote method');
  assert(!['requestJob','dispatchResult'].includes(method)||quoteMethod!==null,'Message action requires a live fee quote');
  const {router,config}=connection,ceiling=BigInt(config.maxTransactionGas);
  const quote=async()=>{if(!quoteMethod)return 0n;const fee=await router[quoteMethod](...(quoteMethod==='quoteRequest'?args:[]));
    assert(fee.lzTokenFee===0n,'LZ token payment is unsupported');assert(fee.nativeFee<=BigInt(config.maxMessageFeeWei),'Message fee exceeds configured budget');return fee.nativeFee;};
  const value=await quote();
  const estimate=await router[method].estimateGas(...args,{value,gasLimit:ceiling});
  const monad=config.key==='monad'&&config.chainId===143;
  const gasLimit=gasLimitForEstimate(estimate,ceiling,monad);
  await router[method].staticCall(...args,{value,gasLimit});
  assert(await quote()===value,'Message fee changed during preflight; retry with a fresh quote');
  const fees=await jobFeeOverrides(connection);
  await mined(await router[method](...args,{value,gasLimit,...fees}),connection,method);
}
export async function advanceJob(connection) {
  assert(connection.execute===true,'Paid execution is disabled');
  const work=await selectWork(connection);
  const fees=await jobFeeOverrides(connection);
  await mined(await connection.engine[work.method](...work.args,{gasLimit:work.gasLimit,...fees}),connection,'compute');
}
export async function run(args) {
  const options=parseJobArgs(args);
  if(options.help){console.log('job-worker --config=deployments/job/runtime.json [--data=export-dir] [--prompt-tokens=464,3290 --generate=32] [--execute --once|--watch]\nRead-only by default. Paid mode needs enabled:true, messagingReviewed:true, positive fee caps, a prior complete verification and a fresh complete re-verification, plus the named worker key. Optional opBNB-only gasPriceWei is an explicit bid; it must cover live basefee+1001wei and may wait longer for inclusion.');return;}
  const config=validateJobRuntimeConfig(JSON.parse(fs.readFileSync(options.configFile)));
  const reportFile=jobReportPath(options.configFile,config);
  const prior=JSON.parse(fs.readFileSync(reportFile));
  assert(prior.status==='PASS_VERIFIED_JOB_DEPLOYMENT'&&prior.routeKind===JOB_KIND,'Run verify-job-deployment first');
  for(const key of ['modelId','routeId','sessionId','admin','requester'])assert(equal(prior[key],config[key]),'Prior verification identity differs');
  assert(prior.deadline===config.deadline&&prior.engineContract===config.engineContract&&prior.computeChain===(config.computeChain??'monad')&&prior.executorMode===(config.executorMode??'managed'),'Prior verification configuration differs');
  if(options.execute) {
    assert(config.enabled===true,'Paid execution must be explicitly enabled');
    assert(config.messagingReviewed===true,'LayerZero security and pathway review must be explicitly recorded');
    for(const chain of config.chains)assert(BigInt(chain.maxFeePerGasWei)>0n&&BigInt(chain.maxMessageFeeWei)>0n,'Positive transaction and message fee budgets are required');
  }
  // A forged/stale report cannot authorize paid work: re-read every runtime and model byte before loading the key.
  let verified;
  atomicJobReport(reportFile,{schemaVersion:2,status:'VERIFYING',messagingReady:false});
  try {verified=await verifyJobDeployment({config,dataDirectory:options.dataDirectory});atomicJobReport(reportFile,verified);}
  catch {atomicJobReport(reportFile,{schemaVersion:2,status:'VERIFICATION_FAILED',messagingReady:false});throw Error('Fresh full deployment verification failed');}
  const built=compile();assert.equal(built.compiler.sources_commitment_sha256,verified.compilerSourcesHash,'Compiler sources changed after verification');
  const key=options.execute?process.env[config.keyEnv]:null;
  if(options.execute)assert(typeof key==='string'&&/^0x[0-9a-fA-F]{64}$/.test(key),'Worker key is not configured');
  const providers=[],connections=[];
  try {
    for(const chain of config.chains) {
      const url=process.env[chain.rpcEnv];assert(url,'Required RPC environment variable is missing');
      const provider=new JsonRpcProvider(url);providers.push(provider);
      assert(BigInt(await provider.send('eth_chainId',[]))===BigInt(chain.chainId),'RPC identity changed');
      const trusted=verified.chains[chain.stage];
      for(const field of chain.role==='home'?['router']:['router','engine','root']) {
        assert(equal(chain[field],trusted[field]),'Verified address differs');
        assert(equal(keccak256(await provider.getCode(chain[field])),trusted[field+'CodeHash']),'Verified runtime changed');
      }
      const runner=options.execute?new NonceManager(new Wallet(key,provider)):provider;
      const router=new Contract(chain.router,built.artifacts[JOB_ROUTER].abi,runner);
      const engine=chain.role==='compute'?new Contract(chain.engine,built.artifacts[config.engineContract].abi,runner):null;
      if(options.execute&&chain.role==='home'&&options.packed&&!await router.requested())assert(equal(await runner.getAddress(),config.requester),'Initial request requires the configured requester');
      connections.push({provider,router,engine,config:chain,deadline:config.deadline,execute:options.execute});
    }
    do {
      assertSourcesUnchanged(built);
      const [home,compute]=connections;
      for(const connection of connections){const now=await connection.provider.getBlock('latest');assert(now&&now.timestamp<=connection.deadline,'Job deadline elapsed');}
      const action=await nextJobAction(home,compute,options);
      if(!options.execute||action.kind==='complete') {
        console.log(JSON.stringify({status:action.kind==='complete'?'JOB_COMPLETE':'READ_ONLY',nextAction:action.kind==='router'?action.method:action.kind,
          requested:await home.router.requested(),running:await compute.router.running(),completed:await compute.router.completed(),
          resultFinalized:await home.router.resultFinalized(),resultCount:Number(await home.router.resultCount()),outputHash:await home.router.outputHash()}));
        if(!options.execute||action.kind==='complete')break;
      }
      if(action.kind==='activate')await sendJobAction(compute,'activateJob',[await pendingPrompt(compute)]);
      else if(action.kind==='compute')await advanceJob(compute);
      else if(action.kind==='router')await sendJobAction(action.connection,action.method,action.args,action.quoteMethod);
      else console.log(JSON.stringify({status:'WAITING_FOR_AUTHENTICATED_DELIVERY'}));
      if(!options.watch)break;
      await delay(options.intervalMs);
    }while(true);
  }finally{for(const provider of providers)provider.destroy();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv.slice(2)).catch(()=>{
  // Never expose RPC URLs, provider error bodies, arbitrary exceptions or key material.
  console.error(JSON.stringify({status:'STOPPED',reason:'Job worker stopped; check local configuration, full verification, fee caps, deadline and chain state.'}));process.exitCode=1;
});
