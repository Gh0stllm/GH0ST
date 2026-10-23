import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as Eth from '../website/mint/vendor/ethers.js';
import {
  ANALYSIS_ABIS, ANALYSIS_GAS_CAP, ANALYSIS_CONFIG,
  normalizeAnalysisDeployment, verifyAnalysisDeployment, verifyAnalysisRecovery,
  analysisLogicalSteps, analysisWorkSchedule, computeAnalysisFunding,
  planAnalysisAdvance, createS0ULAnalysisClient,
} from '../website/s0ul-analysis-client.mjs';

// These tests use deterministic RPC/wallet doubles. They prove transaction,
// quote and recovery guards; real transformer execution is tested separately.
const calibration = JSON.parse(await readFile(new URL('../s0ul-1m/reports/analysis-phase-gas-calibration.json', import.meta.url)));
const addr=n=>Eth.getAddress('0x'+BigInt(n).toString(16).padStart(40,'0'));
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const OWNER=addr(101), OTHER=addr(102), TARGET=addr(103), BLOCK=hash(201);
const coder=Eth.AbiCoder.defaultAbiCoder();
const iface=new Eth.Interface(ANALYSIS_ABIS.executor);
const cfg=Object.assign([512,128,4,4,640,128,1,4096],{...ANALYSIS_CONFIG,epsQ28:1,attentionScaleQ14:4096});
const configurationHash=Eth.keccak256(coder.encode(['(uint16,uint16,uint16,uint16,uint16,uint16,uint32,uint32)'],[cfg]));
function deployment() {
  return {chainId:4663,publicRpc:'https://rpc.invalid',modelId:calibration.sourceProof.modelId,domainSha256:hash(5),schemaHash:hash(6),configurationHash,
    contracts:Object.fromEntries(['executor','engine','model','adapter','codec','reader'].map((k,i)=>[k,{address:addr(i+1),codeHash:Eth.keccak256('0x6000')}])),
    calibration,worker:{statusUrl:'/api/s0ul/worker',triggerUrl:'/api/s0ul/worker'}};
}
function fixture({fullVerification=false}={}) {
  const d=deployment(), sent=[], triggers=[], store=new Map(), callbacks=new Map();
  const f={now:1_000_000,accounts:[OWNER],chain:'0x1237',price:20_000_000n,balance:10n**20n,estimate:100_000n,cap:31_000_000n,nonce:7,workerReady:true,
    failVerify:false,failRecovery:false,storageFailure:false,storageFailureAfterSend:false,sendError:null,onNonce:null,sent,triggers,store,
    targetCodeHash:Eth.ZeroHash,tokens:[74,95,126,2],report:Eth.hexlify(Eth.toUtf8Bytes('Native balance present.')),receipt:null,transaction:null};
  f.job={owner:OWNER,target:TARGET,requestId:10n,state:1,failure:0,promptLength:16,maxNewTokens:32,deadline:86_500n,capturedAt:100n,evmBlockCounter:99n,targetCodeHash:Eth.ZeroHash,modelId:d.modelId,factsHash:hash(7),promptHash:hash(8),outputHash:Eth.ZeroHash,feeCeilingWeiPerGas:25_000_000n,maxRewardPerBatchWei:ANALYSIS_GAS_CAP*25_000_000n,totalFunded:10n**18n,remaining:10n**18n,totalPaid:0n};
  f.status={owner:d.contracts.executor.address,phase:1,position:0,layer:0,row:0,head:0,promptLength:16,maxNewTokens:32,generated:0,saturationCount:0n,done:false,cancelled:false,logitsReady:false};
  const provider={
    send:async method=>{if(method==='eth_chainId')return f.chain;if(method==='eth_gasPrice')return Eth.toBeHex(f.price);throw Error('Unexpected RPC '+method);},
    getCode:async address=>f.badCode===address?'0x6001':'0x6000',
    getBlock:async()=>({number:99,timestamp:100,gasLimit:32_000_000n,hash:f.canonicalHash??BLOCK}),
    getBalance:async()=>f.balance,
    estimateGas:async request=>{f.lastEstimate=request;return typeof f.estimate==='function'?f.estimate(request):f.estimate;},
    getTransactionCount:async()=>{if(f.onNonce)await f.onNonce();return f.nonce;},
    getTransaction:async()=>f.transaction,
    getTransactionReceipt:async()=>f.receipt,
  };
  const executor={interface:iface,credits:async()=>f.credit??0n,getJob:async()=>({...f.job}),reportOf:async()=>f.report,outputTokensOf:async()=>f.tokens,
    chainId:async()=>4663n,configurationHash:async()=>d.configurationHash,modelId:async()=>d.modelId,domainSha256:async()=>d.domainSha256,schemaHash:async()=>d.schemaHash};
  for(const key of ['engine','model','adapter','codec']){executor[key]=async()=>d.contracts[key].address;executor[key+'CodeHash']=async()=>d.contracts[key].codeHash;}
  const contracts={executor,
    engine:{model:async()=>d.contracts.model.address,tokenizer:async()=>Eth.ZeroAddress,modelId:async()=>d.modelId,configuration:async()=>cfg,status:async()=>({...f.status})},
    model:{modelId:async()=>d.modelId},
    adapter:{chainId:async()=>4663n,reader:async()=>d.contracts.reader.address,readerCodeHash:async()=>d.contracts.reader.codeHash,schemaHash:async()=>d.schemaHash,
      capture:async target=>({facts:coder.encode(['address','uint256','bytes32'],[target,0,f.targetCodeHash]),prompt:[1,...Array(14).fill(5),3]})},
    codec:{domainSha256:async()=>d.domainSha256,decode:async()=>f.decodedReport??f.report},
  };
  const ethereum={
    request:async({method})=>{if(['eth_accounts','eth_requestAccounts'].includes(method))return f.accounts;if(method==='eth_chainId')return f.chain;throw Error('Unexpected wallet method '+method);},
    on:(name,fn)=>callbacks.set(name,fn),removeListener:name=>callbacks.delete(name),
  };
  const storage={getItem:key=>store.get(key)??null,setItem:(key,value)=>{if(f.storageFailure||(f.storageFailureAfterSend&&sent.length))throw Error('storage disabled');store.set(key,value);}};
  class BrowserProvider {async getSigner(){return {sendTransaction:async request=>{
    assert.ok([...store.values()].some(raw=>raw.includes('"pending":{')), 'recovery intent must be durable before wallet send');
    sent.push(request);if(f.sendError)throw f.sendError;
    f.transaction={...request,hash:hash(999),from:OWNER,value:request.value};return {hash:hash(999)};
  }};}destroy(){}}
  const dependencies={contracts,now:()=>f.now,gasLimits:async()=>({maxTxGasLimit:f.cap,maxBlockGasLimit:32_000_000n}),
    worker:{status:async()=>({ready:f.workerReady,status:f.workerReady?'ready':'unavailable'}),trigger:async id=>{triggers.push(id);return {accepted:true};}},
    ...(fullVerification?{}:{verifyDeployment:async()=>{if(f.failVerify)throw Error('model runtime changed');}}),
    verifyRecovery:async()=>{if(f.failRecovery)throw Error('executor runtime changed');},
  };
  const client=createS0ULAnalysisClient({deployment:d,provider,ethereum,storage,eth:{...Eth,BrowserProvider},dependencies});
  Object.assign(f,{d,provider,contracts,ethereum,storage,client,dependencies,callbacks});
  f.connected=async()=>{await client.ready;await client.connect();return f;};
  f.quote=async()=>client.quote({target:TARGET});
  f.confirm=({logAddress=d.contracts.executor.address}={})=>{
    const q=client.state.pending,args=[1n,OWNER,TARGET,10n,d.modelId,Eth.ZeroHash,f.job.factsHash,f.job.promptHash,16,32,f.job.deadline,q.valueWei,25_000_000n,f.job.maxRewardPerBatchWei];
    const event=iface.encodeEventLog(iface.getEvent('JobOpened'),args);
    f.receipt={status:1,blockNumber:99,blockHash:BLOCK,gasUsed:90_000n,gasPrice:f.price,logs:[{address:logAddress,...event}]};
  };
  return f;
}

test('exact transformer work count and paid Select boundaries match pinned dimensions',()=>{
  assert.equal(analysisLogicalSteps(16,17),2566);assert.equal(analysisLogicalSteps(16,32),3811);
  const schedule=analysisWorkSchedule(16,32);assert.equal(schedule.length,3811);
  assert.equal(schedule.filter(x=>x.phase===16).length,32);
  assert.equal(schedule.filter(x=>x.phase===8).length,47*4*4);
  assert.equal(Math.max(...schedule.map(x=>x.position)),46);
  for(const args of [[2,32],[16,1],[97,32],[16,33],[16,2.5]])assert.throws(()=>analysisLogicalSteps(...args));
});

test('published phase calibration estimates full 32-token context and discloses separate hard ceiling',()=>{
  const q=computeAnalysisFunding({feeCeilingWeiPerGas:25_000_000n,maxRewardPerBatchWei:775_000_000_000_000n,calibration});
  assert.equal(q.measuredGas,11_412_827_766n);assert.equal(q.continuationGasReserve,13_695_393_320n);
  assert.equal(q.logicalCalls,3811);assert.equal(q.hardEscrowCeilingWei,3812n*q.maxRewardPerBatchWei);
  assert.ok(q.escrowWei<q.hardEscrowCeilingWei);assert.equal(q.unmeasuredContext,true);assert.equal(q.completionGuaranteed,false);
  assert.throws(()=>computeAnalysisFunding({feeCeilingWeiPerGas:1n,maxRewardPerBatchWei:1n,calibration:{}}),/calibration/);
  const broken=structuredClone(calibration);broken.attentionOperationalEnvelope.gasPerPosition=0;
  assert.throws(()=>computeAnalysisFunding({feeCeilingWeiPerGas:1n,maxRewardPerBatchWei:1n,calibration:broken}),/Longer attention/);
});

test('manifest and all runtime, dependency, config and chain pins fail closed',async()=>{
  const f=fixture();assert.throws(()=>normalizeAnalysisDeployment({...f.d,chainId:1}),/4663/);
  await verifyAnalysisDeployment({provider:f.provider,deployment:f.d,contracts:f.contracts});
  f.badCode=f.d.contracts.codec.address;await assert.rejects(verifyAnalysisDeployment({provider:f.provider,deployment:f.d,contracts:f.contracts}),/codec runtime/);
  await verifyAnalysisRecovery({provider:f.provider,deployment:f.d,contracts:f.contracts});
  f.badCode=f.d.contracts.executor.address;await assert.rejects(verifyAnalysisRecovery({provider:f.provider,deployment:f.d,contracts:f.contracts}),/executor/);
  f.badCode=null;f.contracts.engine.tokenizer=async()=>OTHER;await assert.rejects(verifyAnalysisDeployment({provider:f.provider,deployment:f.d,contracts:f.contracts}),/model mismatch/);
  f.client.destroy();
});

test('each dependency runtime and immutable metadata pin is checked independently',async()=>{
  for(const name of ['executor','engine','model','adapter','codec','reader']){
    const f=fixture();f.badCode=f.d.contracts[name].address;
    await assert.rejects(verifyAnalysisDeployment({provider:f.provider,deployment:f.d,contracts:f.contracts}),/runtime/);f.client.destroy();
  }
  for(const [group,key,value]of [['executor','engine',OTHER],['executor','modelCodeHash',hash(90)],['executor','modelId',hash(91)],['executor','domainSha256',hash(91)],['executor','schemaHash',hash(91)],['executor','configurationHash',hash(91)],['executor','chainId',1n],['adapter','chainId',1n],['adapter','reader',OTHER],['adapter','readerCodeHash',hash(91)],['adapter','schemaHash',hash(91)],['codec','domainSha256',hash(91)],['engine','modelId',hash(91)],['model','modelId',hash(91)]]){
    const f=fixture();f.contracts[group][key]=async()=>value;
    await assert.rejects(verifyAnalysisDeployment({provider:f.provider,deployment:f.d,contracts:f.contracts}),/mismatch/);f.client.destroy();
  }
});

test('read-only quote uses captured EXTCODEHASH for nonexistent target and accounts for wallet reserves',async()=>{
  const f=await fixture().connected();const q=await f.quote();
  assert.equal(q.targetCodeHash,Eth.ZeroHash);assert.notEqual(q.targetCodeHash,Eth.keccak256('0x'));
  assert.equal(q.valueWei,q.escrowWei);assert.equal(q.totalRequiredWei,q.escrowWei+q.openFeeReserveWei+q.recoveryFeeReserveWei);
  assert.equal(q.workerAvailable,true);assert.equal(q.affordable,true);assert.equal(f.sent.length,0);assert.equal(f.store.size,0);
  const decoded=iface.decodeFunctionData('open',q.data);assert.equal(decoded[5],Eth.ZeroHash);f.client.destroy();
});

test('funding budget/quote tampering and expired quotes never request a transaction',async()=>{
  const f=await fixture().connected();const q=await f.quote();
  await assert.rejects(f.client.start({...q,valueWei:q.valueWei+1n}),/stale or changed/);
  await assert.rejects(f.client.start(q,{budgetWei:q.escrowWei+1n}),/budget changed/);
  f.now=q.expiresAt;await assert.rejects(f.client.start(q),/stale or changed/);assert.equal(f.sent.length,0);f.client.destroy();
});

test('active caller serialization cannot replace canonical retained calldata, destination or value',async()=>{
  const f=await fixture().connected(),q=await f.quote(),retained=structuredClone(q);let calls=0;
  Object.defineProperty(q,'toJSON',{value:()=>++calls===1?retained:{...retained,to:OTHER,data:'0x1234',valueWei:0n,action:'withdraw'}});
  await f.client.start(q);assert.equal(calls,1);assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].to,retained.to);assert.equal(f.sent[0].data,retained.data);assert.equal(f.sent[0].value,retained.valueWei);f.client.destroy();
});

test('wallet account or chain change invalidates accepted funding quote',async()=>{
  for(const kind of ['account','chain']){
    const f=await fixture().connected(),q=await f.quote();if(kind==='account')f.accounts=[OTHER];else f.chain='0x1';
    await assert.rejects(f.client.start(q),/account or chain changed/);assert.equal(f.sent.length,0);f.client.destroy();
  }
});

test('unavailable continuation service blocks funding before wallet request',async()=>{
  const f=await fixture().connected(),q=await f.quote();f.workerReady=false;
  await assert.rejects(f.client.start(q),/continuation service is unavailable/);assert.equal(f.sent.length,0);assert.equal(f.client.state.pending,null);f.client.destroy();
});

test('service health is accepted only for configured same-origin endpoint, chain and executor',async()=>{
  const f=await fixture().connected();f.dependencies.worker=undefined;let calls=0;
  f.dependencies.fetch=async()=>{calls++;return {ok:true,json:async()=>({ready:true,chainId:4663,executor:f.d.contracts.executor.address,modelId:f.d.modelId})};};
  assert.equal((await f.client.checkWorker()).available,true);
  f.dependencies.fetch=async()=>({ok:true,json:async()=>({ready:true,chainId:1,executor:f.d.contracts.executor.address,modelId:f.d.modelId})});
  assert.equal((await f.client.checkWorker()).available,false);
  f.dependencies.fetch=async()=>({ok:true,json:async()=>({ready:true,chainId:4663,executor:OTHER,modelId:f.d.modelId})});
  assert.equal((await f.client.checkWorker()).available,false);
  f.dependencies.fetch=async()=>({ok:true,json:async()=>({ready:true,chainId:4663,executor:f.d.contracts.executor.address,modelId:hash(92)})});
  assert.equal((await f.client.checkWorker()).available,false);
  f.d.worker.statusUrl='//external.invalid/worker';const before=calls;
  assert.equal((await f.client.checkWorker()).available,false);assert.equal(calls,before);f.client.destroy();
});

test('opening transaction matches accepted calldata, escrow, bounded fee and durable intent',async()=>{
  const f=await fixture().connected(),q=await f.quote();const result=await f.client.start(q);
  assert.equal(result.hash,hash(999));assert.equal(f.sent.length,1);
  const tx=f.sent[0];assert.equal(tx.value,q.escrowWei);assert.equal(tx.data,q.data);assert.equal(tx.to,q.to);assert.equal(tx.gasLimit,q.gasLimit);
  assert.ok(tx.gasPrice<=q.feeCeilingWeiPerGas);assert.equal(tx.chainId,4663);assert.equal(tx.nonce,7);
  assert.equal(f.client.state.pending.hash,hash(999));await assert.rejects(f.client.start(q),/stale or changed|pending/);assert.equal(f.sent.length,1);f.client.destroy();
});

test('late account switch or quote expiry during nonce lookup cannot reach wallet send',async()=>{
  for(const kind of ['account','expiry']){
    const f=await fixture().connected(),q=await f.quote();f.onNonce=async()=>{if(kind==='account')f.accounts=[OTHER];else f.now=q.expiresAt;};
    await assert.rejects(f.client.start(q),/account or chain changed|stale or changed/);assert.equal(f.sent.length,0);f.client.destroy();
  }
});

test('final opening balance preserves quoted recovery reserve even after nonce lookup',async()=>{
  for(const kind of ['before','duringNonce']){
    const f=await fixture().connected(),q=await f.quote(),short=q.valueWei+q.openFeeReserveWei;
    if(kind==='before')f.balance=short;else f.onNonce=async()=>{f.balance=short;};
    await assert.rejects(f.client.start(q),/approved fee reserves/);assert.equal(f.sent.length,0);assert.equal(f.client.state.pending,null);f.client.destroy();
  }
});

test('fresh gas estimate and Nitro cap cannot silently expand approved reserve',async()=>{
  for(const kind of ['estimate','cap']){
    const f=await fixture().connected(),q=await f.quote();if(kind==='estimate')f.estimate=100_001n;else f.cap=q.gasLimit-1n;
    await assert.rejects(f.client.start(q),/approved reserve/);assert.equal(f.sent.length,0);f.client.destroy();
  }
});

test('fee rise or target runtime change invalidates funding before any wallet request',async()=>{
  for(const kind of ['fee','target']){
    const f=await fixture().connected(),q=await f.quote();if(kind==='fee')f.price=q.feeCeilingWeiPerGas+1n;else f.targetCodeHash=hash(9);
    await assert.rejects(f.client.start(q),/Gas price rose|Target runtime changed/);assert.equal(f.sent.length,0);f.client.destroy();
  }
});

test('pre-send storage failure blocks wallet; post-broadcast failure preserves exact known hash',async()=>{
  const a=await fixture().connected(),qa=await a.quote();a.storageFailure=true;
  await assert.rejects(a.client.start(qa),/recovery data cannot be saved/);assert.equal(a.sent.length,0);assert.equal(a.client.state.pending,null);
  a.storageFailure=false;await a.client.start(qa);assert.equal(a.sent.length,1);a.client.destroy();
  const b=await fixture().connected(),qb=await b.quote();b.storageFailureAfterSend=true;
  await assert.rejects(b.client.start(qb),new RegExp(hash(999)));assert.equal(b.sent.length,1);assert.equal(b.client.state.pending.hash,hash(999));
  b.storageFailureAfterSend=false;b.confirm();await b.client.reconcile(hash(999));assert.equal(b.client.state.pending,null);b.client.destroy();
});

test('ambiguous wallet response retains intent and exact-hash reconciliation prevents duplicate send',async()=>{
  const f=await fixture().connected(),q=await f.quote();f.sendError=Error('Network response lost');
  await assert.rejects(f.client.start(q),/response lost/);assert.equal(f.client.state.pending.hash,null);assert.equal(f.sent.length,1);
  await assert.rejects(f.client.quote({target:TARGET}),/pending/);
  const request=f.sent[0];f.transaction={...request,from:OWNER,value:request.value};f.confirm();await f.client.reconcile(hash(999));
  assert.equal(f.client.state.jobId,1n);assert.equal(f.triggers.length,1);assert.equal(f.sent.length,1);f.client.destroy();
});

test('reconciliation binds exact transaction fields and canonical receipt',async()=>{
  for(const key of ['from','to','data','value','nonce','chainId','gasLimit','gasPrice','canonical']){
    const f=await fixture().connected(),q=await f.quote();await f.client.start(q);f.confirm();
    const changes={from:OTHER,to:OTHER,data:'0x1234',value:1n,nonce:8,chainId:1,gasLimit:q.gasLimit+1n,gasPrice:q.feeCeilingWeiPerGas+1n};
    if(key==='canonical')f.canonicalHash=hash(202);else f.transaction[key]=changes[key];
    await assert.rejects(f.client.reconcile(hash(999)),/does not match|canonical/);assert.ok(f.client.state.pending);assert.equal(f.triggers.length,0);f.client.destroy();
  }
});

test('funding receipt must contain JobOpened from pinned executor; confirmation triggers job worker only',async()=>{
  const f=await fixture().connected(),q=await f.quote();await f.client.start(q);f.confirm({logAddress:OTHER});
  await assert.rejects(f.client.reconcile(hash(999)),/no matching analysis job/);assert.equal(f.triggers.length,0);
  f.confirm();await f.client.reconcile(hash(999));assert.equal(f.client.state.jobId,1n);assert.deepEqual(f.triggers,[1n]);assert.equal(f.client.state.pending,null);f.client.destroy();
});

test('confirmed receipt storage failure retains same hash and does not duplicate receipts or trigger work',async()=>{
  const f=await fixture().connected(),q=await f.quote();await f.client.start(q);f.confirm();f.storageFailure=true;
  await assert.rejects(f.client.reconcile(hash(999)),/confirmed.*same hash/);assert.equal(f.client.state.pending.hash,hash(999));assert.equal(f.client.state.receipts.length,0);assert.equal(f.triggers.length,0);
  f.storageFailure=false;await f.client.reconcile(hash(999));assert.equal(f.client.state.receipts.length,1);assert.equal(f.triggers.length,1);f.client.destroy();
});

test('browser restart restores unresolved transaction and permits read-only exact-hash recovery',async()=>{
  const f=await fixture().connected(),q=await f.quote();await f.client.start(q);f.client.destroy();
  const restored=createS0ULAnalysisClient({deployment:f.d,provider:f.provider,ethereum:f.ethereum,storage:f.storage,dependencies:f.dependencies,eth:{...Eth,BrowserProvider:class{destroy(){}}}});
  await restored.ready;await restored.connect();assert.equal(restored.state.pending.hash,hash(999));
  await assert.rejects(restored.quote({target:TARGET}),/pending/);f.confirm();await restored.reconcile(hash(999));assert.equal(restored.state.jobId,1n);assert.equal(f.sent.length,1);restored.destroy();
});

test('worker trigger failure preserves the confirmed funded job for explicit recovery',async()=>{
  const f=await fixture().connected(),q=await f.quote();await f.client.start(q);f.confirm();
  f.dependencies.worker.trigger=async()=>{throw Error('service failed');};await f.client.reconcile(hash(999));
  assert.equal(f.client.state.pending,null);assert.equal(f.client.state.jobId,1n);assert.equal(f.client.state.workerStatus.available,false);
  assert.equal(f.client.state.workerStatus.message,'service failed');f.client.destroy();
});

test('only strict actual model tokens, hash and codec output can be displayed as completed report',async()=>{
  const f=await fixture().connected();f.job.state=2;f.status.done=true;f.job.outputHash=Eth.keccak256(coder.encode(['uint16[]'],[f.tokens]));
  await f.client.loadJob(1);assert.equal(f.client.state.report,'Native balance present.');
  f.decodedReport=Eth.hexlify(Eth.toUtf8Bytes('invented'));await assert.rejects(f.client.refresh(),/differs from the model output/);
  f.decodedReport=null;f.tokens=[74,95,126];await assert.rejects(f.client.refresh(),/invalid model tokens/);
  f.tokens=[4,2];await assert.rejects(f.client.refresh(),/invalid model tokens/);f.client.destroy();
});

test('owner recovery remains usable after model pins break, but executor mismatch blocks it',async()=>{
  for(const action of ['cancel','refundCompleted','withdraw']){
    const f=await fixture().connected();f.failVerify=true;await f.client.loadJob(1);assert.equal(f.client.state.verified,false);assert.equal(f.client.state.engineStatus,null);
    const q=await f.client.quoteAction({action,jobId:1});await f.client.execute(q);assert.equal(f.sent.length,1);assert.equal(iface.parseTransaction(f.sent[0]).name,action);f.client.destroy();
  }
  const f=await fixture().connected();f.failRecovery=true;await assert.rejects(f.client.quoteAction({action:'withdraw'}),/executor runtime changed/);assert.equal(f.sent.length,0);f.client.destroy();
});

test('cancellation tolerates worker progress; paid work quote does not; expired top-up blocked',async()=>{
  const a=await fixture().connected();let q=await a.client.quoteAction({action:'cancel',jobId:1});a.job.remaining-=1n;a.status.position=1;await a.client.execute(q);assert.equal(a.sent.length,1);a.client.destroy();
  const b=await fixture().connected();q=await b.client.quoteAction({action:'advance',jobId:1});b.status.position=1;await assert.rejects(b.client.execute(q),/advanced or changed/);assert.equal(b.sent.length,0);b.client.destroy();
  const c=await fixture().connected();c.job.deadline=99n;await assert.rejects(c.client.quoteAction({action:'topUp',jobId:1,valueWei:1n}),/expired/);assert.equal(c.sent.length,0);c.client.destroy();
});

test('manual paid work gas price headroom is clamped to job ceiling',async()=>{
  const f=await fixture().connected();f.job.feeCeilingWeiPerGas=f.price+1n;
  const q=await f.client.quoteAction({action:'advance',jobId:1});await f.client.execute(q);
  assert.equal(f.sent[0].gasPrice,f.job.feeCeilingWeiPerGas);assert.equal(iface.parseTransaction(f.sent[0]).args[1],128n);f.client.destroy();
});

test('adaptive batch planner chooses largest estimated bounded group and does not swallow RPC outage',async()=>{
  const chosen=[];const provider={estimateGas:async request=>{const steps=Number(iface.parseTransaction(request).args[2]);chosen.push(steps);return steps>2?30_000_000n:1_000_000n;}};
  const plan=await planAnalysisAdvance({provider,executorAddress:addr(1),executorInterface:iface,from:OWNER,jobId:1n,gasPriceWei:1n});
  assert.deepEqual(chosen,[4,3,2]);assert.equal(plan.steps,2);assert.equal(plan.rows,128);
  await assert.rejects(planAnalysisAdvance({provider:{estimateGas:async()=>{throw Object.assign(Error('network outage'),{code:'TIMEOUT'});}},executorAddress:addr(1),executorInterface:iface,from:OWNER,jobId:1n,gasPriceWei:1n}),/network outage/);
});
