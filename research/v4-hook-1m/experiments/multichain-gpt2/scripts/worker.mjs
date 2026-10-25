// Resumable keeper for an explicitly configured and verified deployment.
// Defaults to read-only. No private key is read without --execute.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, NonceManager, keccak256, AbiCoder } from 'ethers';
import { compile, HERE } from './build.mjs';

const coder = AbiCoder.defaultAbiCoder();
const packetType = 'tuple(uint8 version,bytes32 routeId,bytes32 modelId,bytes32 sessionId,uint32 position,uint32 inputToken,uint8 destinationStage,uint8 kind,uint32 outputToken,bytes32 trace,bytes hidden)';
const option = (args,key,fallback) => args.find(x=>x.startsWith('--'+key+'='))?.slice(key.length+3) ?? fallback;
const equal = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));

export function validateConfig(config) {
  assert.equal(config.schemaVersion,1,'Unsupported worker configuration');
  for(const key of ['modelId','routeId','sessionId']) assert(/^0x[0-9a-fA-F]{64}$/.test(config[key]),'Missing '+key);
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
    assert(BigInt(chain.maxTransactionGas)>100000n&&BigInt(chain.maxTransactionGas)<=16777216n,'Invalid gas ceiling');
    assert(BigInt(chain.maxMessageFeeWei)>=0n,'A per-hop fee budget is required');
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

async function advance(connection) {
  const {engine,config}=connection;
  const state=await engine.checkpoint();
  const phase=Number(state[0]),step=Number(state[6]);
  const ceiling=BigInt(config.maxTransactionGas);
  const maxRows=phase===4||phase===5?64:512;
  // A reverted estimate changes no state. Every paid chunk is estimated at its current checkpoint.
  for(const steps of [8,2,1]) for(const rows of [maxRows,Math.min(maxRows,128),32,8,1]){
    let gas;
    try {gas=await engine.advanceMany.estimateGas(step,rows,steps,{gasLimit:ceiling});}
    catch {continue;}
    gas=gas*110n/100n+10000n;
    if(gas>ceiling) continue;
    await waitReceipt(await engine.advanceMany(step,rows,steps,{gasLimit:gas,...await feeOverrides(connection)}),config,'compute');
    return true;
  }
  throw Error('No compute chunk fits configured transaction gas limit');
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
  assert(config.verificationFile,'Run verify-deployment first');
  const verification=JSON.parse(fs.readFileSync(path.resolve(path.dirname(configFile),config.verificationFile)));
  assert.equal(verification.status,'PASS_VERIFIED_DEPLOYMENT');
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
      for(const name of ['router','engine','root']){
        assert(equal(chain[name],trusted[name]),'Address differs from verified deployment');
        assert(equal(keccak256(await provider.getCode(chain[name])),trusted[name+'CodeHash']),'Verified bytecode changed');
      }
      const signer=execute?new NonceManager(new Wallet(key,provider)):provider;
      const router=new Contract(chain.router,built.artifacts.GPT2InferenceOApp.abi,signer);
      const engine=new Contract(chain.engine,built.artifacts.GPT2Shard.abi,signer);
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
          await waitReceipt(await c.router.activate(hidden,{gasLimit:BigInt(c.config.maxTransactionGas),...await feeOverrides(c)}),c.config,'activate');progressed=true;
        }else if(active&&!sent){
          if(phase===12||phase===13){
            const quote=await c.router.quoteDispatch();
            assert.equal(quote.lzTokenFee,0n);
            assert(quote.nativeFee<=BigInt(c.config.maxMessageFeeWei),'Messaging quote exceeds per-hop budget');
            await waitReceipt(await c.router.dispatch({value:quote.nativeFee,gasLimit:BigInt(c.config.maxTransactionGas),...await feeOverrides(c)}),c.config,'dispatch');progressed=true;
          }else if(phase>0){await advance(c);progressed=true;}
        }else if(c===home&&!active&&positions!==null&&position<positions){
          const input=position<prompt.length?prompt[position]:Number(await home.router.latestResult());
          await waitReceipt(await c.router.beginToken(input,{gasLimit:BigInt(c.config.maxTransactionGas),...await feeOverrides(c)}),c.config,'begin');progressed=true;
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
