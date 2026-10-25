// Resumable keeper for an explicitly configured and verified deployment.
// Defaults to read-only. No private key is read without --execute.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, NonceManager, keccak256, AbiCoder } from 'ethers';
import { compile, HERE } from './build.mjs';
import { MODEL_ID } from './plan.mjs';
import { resolveProductionSelection, nativeTransactionGasCeiling } from './verify-deployment.mjs';

const coder = AbiCoder.defaultAbiCoder();
const packetType = 'tuple(uint8 version,bytes32 routeId,bytes32 modelId,bytes32 sessionId,uint32 position,uint32 inputToken,uint8 destinationStage,uint8 kind,uint32 outputToken,bytes32 trace,bytes hidden)';
const option = (args,key,fallback) => args.find(x=>x.startsWith('--'+key+'='))?.slice(key.length+3) ?? fallback;
const equal = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));

export function validateConfig(config) {
  assert.equal(config.schemaVersion,1,'Unsupported worker configuration');
  const selection=resolveProductionSelection(config);
  for(const key of ['modelId','routeId','sessionId']) assert(/^0x[0-9a-fA-F]{64}$/.test(config[key]),'Missing '+key);
  assert(equal(config.modelId,MODEL_ID),'Only the canonical complete GPT-2 model is supported');
  assert(Array.isArray(config.chains) && config.chains.length>=2 && config.chains.length<=8);
  const keys=new Set(),ids=new Set(),eids=new Set();
  config.chains.forEach((chain,index)=>{
    assert.equal(chain.stage,index,'Stages must be contiguous');
    assert(!keys.has(chain.key)&&!ids.has(chain.chainId)&&!eids.has(chain.eid),'Duplicate stage identity');
    keys.add(chain.key);ids.add(chain.chainId);eids.add(chain.eid);
    assert(/^[A-Z][A-Z0-9_]*$/.test(chain.rpcEnv),'RPC must be named by an environment variable');
    for(const field of ['router','engine','root']) assert(/^0x[0-9a-fA-F]{40}$/.test(chain[field])&&!/^0x0{40}$/.test(chain[field]),'Unconfigured '+field);
    assert(Number.isSafeInteger(chain.deploymentBlock)&&chain.deploymentBlock>=0);
    assert(chain.confirmations===undefined||(Number.isSafeInteger(chain.confirmations)&&chain.confirmations>=1));
    const planned=selection.configuration.chains[index];
    assert(planned,'Chain is absent from trusted route configuration');
    assert(chain.key===planned.key&&chain.chainId===planned.chainId&&chain.eid===planned.eid,'Trusted route identity differs');
    assert(chain.engineContract===undefined||chain.engineContract===selection.engineContract,'Chain engine differs from selected engine');
    assert(BigInt(chain.maxTransactionGas)>100000n&&BigInt(chain.maxTransactionGas)<=nativeTransactionGasCeiling(chain,planned),'Invalid gas ceiling');
    assert(BigInt(chain.maxMessageFeeWei)>=0n,'A per-hop fee budget is required');
  });
  assert.equal(config.chains.length,selection.configuration.chains.length,'Trusted route length differs');
  config.chains.forEach((chain,index)=>{
    const expected=selection.configuration.chains[index];
    assert(chain.key===expected.key&&chain.chainId===expected.chainId&&chain.eid===expected.eid,'Trusted route identity differs');
    if(chain.layerRange!==undefined)assert.deepEqual(chain.layerRange,expected.layerRange,'Trusted layer range differs');
  });
  return config;
}

async function pendingActivation(connection) {
  const {router,provider,config}=connection;
  const wanted=await router.inboundHiddenHash();
  const position=await router.nextPosition();
  const latest=await provider.getBlockNumber();
  const window=Number(config.maxLogRange??2000);
  assert(window>=1&&window<=10000);
  for(let to=latest;to>=config.deploymentBlock;to-=window){
    const from=Math.max(config.deploymentBlock,to-window+1);
    const logs=await router.queryFilter(router.filters.PacketReceived(null,position),from,to);
    for(const log of logs.reverse()){
      const packet=coder.decode([packetType],log.args.packet)[0];
      if(equal(keccak256(packet.hidden),wanted)) return packet.hidden;
    }
  }
  throw Error('Authenticated activation event not available; use an archive-capable RPC');
}

async function waitReceipt(transaction,chain,action) {
  const receipt=await transaction.wait(chain.confirmations??1);
  assert(receipt&&receipt.status===1,'Transaction failed');
  console.log(JSON.stringify({chain:chain.key,action,hash:receipt.hash,gasUsed:String(receipt.gasUsed)}));
}

async function feeOverrides(connection) {
  const current=await connection.provider.getBlock('latest');
  assert(current&&current.timestamp<=connection.deadline,'Session expired before signed action');
  const cap=BigInt(connection.config.maxFeePerGasWei);
  const fee=await connection.provider.getFeeData();
  if(fee.maxFeePerGas!==null){
    assert(fee.maxFeePerGas<=cap,'Source-chain fee quote exceeds configured per-gas budget');
    return {maxFeePerGas:fee.maxFeePerGas,maxPriorityFeePerGas:fee.maxPriorityFeePerGas??0n};
  }
  assert(fee.gasPrice!==null&&fee.gasPrice<=cap,'Source-chain gas price exceeds configured budget');
  return {gasPrice:fee.gasPrice};
}

// Monad charges the declared limit. Round its 1% margin upward, then apply
// the operator ceiling; a discarded eth_call below verifies that exact limit.
export function gasLimitForEstimate(estimate, ceiling, monad = false) {
  estimate=BigInt(estimate);ceiling=BigInt(ceiling);
  assert(estimate>0n&&ceiling>0n&&estimate<=ceiling,'Gas estimate exceeds configured ceiling or is invalid');
  const padded=monad?(estimate*101n+99n)/100n+1000n:estimate*110n/100n+10000n;
  if(monad)return padded>ceiling?ceiling:padded;
  assert(padded<=ceiling,'Padded gas exceeds configured ceiling');
  return padded;
}

const isMonad = connection => connection.config.chainId===143&&connection.config.key==='monad';

async function sendRouterAction(connection,method,args=[],extra={}) {
  const {router,config}=connection;
  const ceiling=BigInt(config.maxTransactionGas);
  let gasLimit=ceiling;
  if(isMonad(connection)){
    const estimate=await router[method].estimateGas(...args,{...extra,gasLimit:ceiling});
    gasLimit=gasLimitForEstimate(estimate,ceiling,true);
    await router[method].staticCall(...args,{...extra,gasLimit});
  }
  // The fresh fee and expiry checks are the last asynchronous step before signing.
  const fees=await feeOverrides(connection);
  await waitReceipt(await router[method](...args,{...extra,gasLimit,...fees}),config,method);
}

const SMALL_PHASES = new Set([1,2,4,5,7,10]);
const HEAVY_PHASE_ROWS = Object.freeze({3:2304,6:768,8:3072,9:768,11:50257});

/// Select only read-only estimated and simulated work at one immutable expected step.
/// Heavy phases use a direct advance; small phases may batch at most64 bounded steps.
export async function selectWork(connection, checkpoint = null) {
  const {engine,config}=connection;
  const raw=checkpoint??await engine.checkpoint();
  const state=Array.isArray(raw)?{phase:raw[0],cursor:raw[3],stepNumber:raw[6]}:raw;
  const phase=Number(state.phase),cursor=Number(state.cursor),step=BigInt(state.stepNumber);
  assert(Number.isSafeInteger(phase)&&phase>=1&&phase<=11&&step>=0n,'Engine is not in an active compute phase');
  assert(Number.isSafeInteger(cursor)&&cursor>=0,'Invalid compute cursor');
  const ceiling=BigInt(config.maxTransactionGas),monad=isMonad(connection);
  const targetGas=monad?ceiling*97n/100n:ceiling*90n/100n-10000n;
  assert(targetGas>0n,'Configured gas ceiling has no safe compute budget');
  const small=SMALL_PHASES.has(phase);
  const totalRows=HEAVY_PHASE_ROWS[phase];
  if(!small)assert(totalRows!==undefined&&cursor<totalRows,'Heavy-phase cursor is outside its output');
  const method=small?'advanceMany':'advance';
  const maximum=small?64:Math.min(512,totalRows-cursor);
  const argsFor=amount=>small?[step,128,amount]:[step,amount];
  const probe=async amount=>{
    const args=argsFor(amount);
    try {
      const estimate=BigInt(await engine[method].estimateGas(...args,{gasLimit:ceiling}));
      if(estimate>targetGas)return null;
      const gasLimit=gasLimitForEstimate(estimate,ceiling,monad);
      // Every chosen call is simulated at the precise declared limit, including on other chains.
      await engine[method].staticCall(...args,{gasLimit});
      return {method,args,phase,cursor,rows:small?128:amount,steps:small?amount:1,estimate,gasLimit,targetGas};
    } catch {return null;}
  };
  let best=await probe(maximum);
  if(best)return best;
  let low=0,high=maximum-1;
  while(low<high){
    const middle=Math.floor((low+high+1)/2);
    const candidate=await probe(middle);
    if(candidate){low=middle;best=candidate;}else high=middle-1;
  }
  assert(low>0&&best,'No compute chunk passes exact-state gas preflight');
  // Recheck after the search: other permissionless workers may have advanced the checkpoint.
  const fresh=await probe(low);
  assert(fresh,'Selected compute chunk changed or failed final preflight');
  return fresh;
}

export async function advance(connection) {
  const {engine,config}=connection;
  const work=await selectWork(connection);
  const fees=await feeOverrides(connection);
  await waitReceipt(await engine[work.method](...work.args,{gasLimit:work.gasLimit,...fees}),config,'compute');
  return true;
}

export async function run(args) {
  if(args.includes('--help')){
    console.log('worker --config=deployments/runtime.json [--execute --once | --execute --watch] [--prompt-tokens=464,3290 --generate=2]');
    console.log('Default: inspect verified contracts without signing. --execute additionally requires enabled:true, verificationFile and GH0ST_WORKER_KEY.');
    return;
  }
  assert(args.every(x=>/^--(?:config|prompt-tokens|generate|interval-ms)=/.test(x)||['--execute','--once','--watch'].includes(x)),'Unknown worker option');
  assert(!(args.includes('--once')&&args.includes('--watch')));
  const execute=args.includes('--execute');
  const configFile=path.resolve(option(args,'config',path.join(HERE,'deployments/runtime.json')));
  const config=validateConfig(JSON.parse(fs.readFileSync(configFile)));
  const selection=resolveProductionSelection(config);
  assert(config.verificationFile,'Run verify-deployment first');
  const verification=JSON.parse(fs.readFileSync(path.resolve(path.dirname(configFile),config.verificationFile)));
  assert.equal(verification.status,'PASS_VERIFIED_DEPLOYMENT');
  assert.equal(verification.engineContract,selection.engineContract,'Verified engine differs from configured engine');
  assert.equal(verification.routeConfiguration,selection.routeConfiguration,'Verified route configuration differs');
  assert.equal(verification.routeConfigurationSha256,selection.routeConfigurationSha256,'Trusted route changed since verification');
  for(const field of ['modelId','routeId','sessionId']) assert(equal(config[field],verification[field]),'Verification identity differs');
  const built=compile();
  assert.equal(verification.compilerSourcesHash,built.compiler.sources_commitment_sha256,'Compiler inputs changed since verification');
  if(execute){
    assert(config.enabled===true,'Configuration must explicitly enable paid execution');
    for(const chain of config.chains) assert(BigInt(chain.maxFeePerGasWei??0)>0n,'A per-gas native fee budget is required before paid execution');
  }
  const key=execute?process.env[config.keyEnv??'GH0ST_WORKER_KEY']:null;
  if(execute) assert(key&&/^0x[0-9a-fA-F]{64}$/.test(key),'Worker key not configured');
  const prompt=option(args,'prompt-tokens','').split(',').filter(Boolean).map(Number);
  assert(prompt.every(t=>Number.isSafeInteger(t)&&t>=0&&t<50257),'Invalid GPT-2 token ID');
  const generate=Number(option(args,'generate','1'));
  assert(Number.isSafeInteger(generate)&&generate>=1);
  const positions=prompt.length?prompt.length+generate-1:null;
  assert(positions===null||positions<=1024,'Session exceeds model context');
  const connections=[],providers=[];
  try {
    for(const chain of config.chains){
      const url=process.env[chain.rpcEnv];assert(url,'Missing RPC environment variable: '+chain.rpcEnv);
      const provider=new JsonRpcProvider(url);
      providers.push(provider);
      // Explicit request is required even if a provider caches its network identity.
      assert.equal(BigInt(await provider.send('eth_chainId',[])),BigInt(chain.chainId),'RPC chain ID differs');
      const trusted=verification.chains.find(c=>c.key===chain.key);
      assert(trusted&&trusted.chainId===chain.chainId&&trusted.eid===chain.eid,'Chain absent from verification');
      assert.equal(trusted.engineContract,selection.engineContract,'Verified chain engine differs');
      for(const name of ['router','engine','root']){
        assert(equal(chain[name],trusted[name]),'Address differs from verified deployment');
        assert(equal(keccak256(await provider.getCode(chain[name])),trusted[name+'CodeHash']),'Verified bytecode changed');
      }
      const signer=execute?new NonceManager(new Wallet(key,provider)):provider;
      const router=new Contract(chain.router,built.artifacts.GPT2InferenceOApp.abi,signer);
      assert(built.artifacts[selection.engineContract]?.evm.bytecode.object,'Selected audited engine artifact is missing');
      const engine=new Contract(chain.engine,built.artifacts[selection.engineContract].abi,signer);
      if(execute&&chain.stage===0&&prompt.length) assert(equal(await router.requester(),await signer.getAddress()),'Prompt submission requires the configured requester');
      assert(await router.routeSealed(),'Route is not sealed');
      for(const field of ['modelId','routeId','sessionId']) assert(equal(await router[field](),config[field]),'Onchain identity differs');
      assert(equal(await engine.controller(),chain.router));
      const deadline=Number(await router.deadline());
      const block=await provider.getBlock('latest');assert(block.timestamp<=deadline,'Session expired');
      connections.push({provider,router,engine,config:chain,deadline});
    }
    for(let index=0;index<connections.length;index++){
      const c=connections[index],next=config.chains[(index+1)%connections.length],previous=config.chains[(index+connections.length-1)%connections.length];
      assert.equal(Number(await c.router.stage()),index);
      assert.equal(Number(await c.router.routeLength()),connections.length);
      assert.equal(Number(await c.router.nextEid()),next.eid);
      assert.equal(Number(await c.router.previousEid()),previous.eid);
      for(const peer of [next,previous]) assert(equal((await c.router.peers(peer.eid)).slice(-40),peer.router.slice(2)),'Peer differs from verified route');
    }
    let rounds=0;
    do {
      const home=connections[0];
      if(positions!==null&&Number(await home.router.finalizedCount())>=positions){
        console.log(JSON.stringify({status:'SESSION_COMPLETE',positions,latestToken:Number(await home.router.latestResult())}));break;
      }
      let progressed=false;
      for(const c of connections){
        const awaiting=await c.router.awaitingActivation(),active=await c.router.active(),sent=await c.router.dispatched();
        const position=Number(await c.router.nextPosition());
        const phase=Number(await c.engine.phase());
        if(!execute){
          console.log(JSON.stringify({chain:c.config.key,position,phase,awaitingActivation:awaiting,active,dispatched:sent,mode:'READ_ONLY'}));continue;
        }
        if(awaiting){
          const hidden=await pendingActivation(c);
          await sendRouterAction(c,'activate',[hidden]);progressed=true;
        }else if(active&&!sent){
          if(phase===12||phase===13){
            const quote=await c.router.quoteDispatch();
            assert.equal(quote.lzTokenFee,0n);
            assert(quote.nativeFee<=BigInt(c.config.maxMessageFeeWei),'Messaging quote exceeds per-hop budget');
            await sendRouterAction(c,'dispatch',[],{value:quote.nativeFee});progressed=true;
          }else if(phase>0){await advance(c);progressed=true;}
        }else if(c===home&&!active&&positions!==null&&position<positions){
          const input=position<prompt.length?prompt[position]:Number(await home.router.latestResult());
          await sendRouterAction(c,'beginToken',[input]);progressed=true;
        }
      }
      rounds++;
      if(!execute||!args.includes('--watch')) break;
      if(!progressed) console.log(JSON.stringify({status:'WAITING_FOR_AUTHENTICATED_DELIVERY',round:rounds}));
      await delay(Math.max(1000,Number(option(args,'interval-ms','3000'))));
    } while(true);
  } finally {for(const provider of providers)provider.destroy();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  run(process.argv.slice(2)).catch(error=>{
    // Provider errors may contain credential-bearing URLs. Never echo their full messages.
    const message=error?.code==='ERR_ASSERTION'?error.message:'Worker stopped; inspect configuration, funds, chain state and private local diagnostics.';
    console.error(JSON.stringify({status:'STOPPED',reason:message}));process.exitCode=1;
  });
}
