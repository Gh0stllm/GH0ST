// No RPC, wallet or EVM is used: exercise the keeper's choice of bounded public methods.
import assert from 'node:assert/strict';
import test from 'node:test';
import {selectWork,advance,gasLimitForEstimate} from '../scripts/worker.mjs';

function fixture({phase=11,cursor=0,ceiling=1000000n,cost=({args})=>BigInt(args[1])*10000n,
  rejectStatic=false,monad=true}={}) {
  const calls={estimates:[],preflights:[],sent:[],fees:0};
  const engine={checkpoint:async()=>[BigInt(phase),0n,0n,BigInt(cursor),0n,0n,7n,0n,0n,'0x'+'00'.repeat(32)]};
  for(const method of ['advance','advanceMany']){
    const unpack=values=>({method,args:values.slice(0,-1),overrides:values.at(-1)});
    engine[method]=async(...values)=>{
      const call=unpack(values);calls.sent.push(call);
      return{wait:async()=>({status:1,hash:'0x'+'ab'.repeat(32),gasUsed:cost(call)})};
    };
    engine[method].estimateGas=async(...values)=>{
      const call=unpack(values);calls.estimates.push(call);return cost(call);
    };
    engine[method].staticCall=async(...values)=>{
      const call=unpack(values);calls.preflights.push(call);
      if(rejectStatic||cost(call)>call.overrides.gasLimit)throw Error('deliberate preflight failure');
    };
  }
  const connection={engine,config:{key:monad?'monad':'bsc',chainId:monad?143:56,
    maxTransactionGas:String(ceiling),maxFeePerGasWei:'100',confirmations:1},deadline:10000,
    provider:{getBlock:async()=>({timestamp:100}),getFeeData:async()=>{calls.fees++;return{maxFeePerGas:1n,maxPriorityFeePerGas:0n,gasPrice:1n};}}};
  return{connection,calls};
}

test('heavy phases use direct advance and binary-search the largest row count inside headroom',async()=>{
  for(const phase of [3,6,8,9,11]){
    const {connection,calls}=fixture({phase});
    const work=await selectWork(connection);
    assert.equal(work.method,'advance');
    assert.equal(work.rows,97);
    assert.deepEqual(work.args,[7n,97]);
    assert.equal(work.gasLimit,gasLimitForEstimate(970000n,1000000n,true));
    assert(calls.estimates.every(call=>call.method==='advance'));
    assert(calls.preflights.every(call=>call.method==='advance'&&call.overrides.gasLimit<=1000000n));
    assert.equal(calls.sent.length,0);
  }
});

test('heavy phases never request past remaining rows or above 512',async()=>{
  const end=fixture({phase:11,cursor:50250,cost:()=>10000n});
  assert.equal((await selectWork(end.connection)).rows,7);
  assert(end.calls.estimates.every(call=>call.args[1]<=7));
  const wide=fixture({phase:8,cursor:0,cost:()=>10000n});
  assert.equal((await selectWork(wide.connection)).rows,512);
  assert(wide.calls.estimates.every(call=>call.args[1]<=512));
});

test('only small phases batch at 128 rows and at most 64 steps',async()=>{
  for(const phase of [1,2,4,5,7,10]){
    const {connection,calls}=fixture({phase,cost:({args})=>10000n+BigInt(args[2])*50000n});
    const work=await selectWork(connection);
    assert.equal(work.method,'advanceMany');
    assert.equal(work.rows,128);
    assert.equal(work.steps,19);
    assert.deepEqual(work.args,[7n,128,19]);
    assert(calls.estimates.every(call=>call.method==='advanceMany'&&call.args[2]>=1&&call.args[2]<=64));
    assert.equal(calls.sent.length,0);
  }
});

test('small-phase batches may use all 64 steps when the exact call fits',async()=>{
  const {connection}=fixture({phase:2,cost:()=>10000n});
  assert.equal((await selectWork(connection)).steps,64);
});

test('non-Monad selection retains prior padding and extra headroom',async()=>{
  const {connection}=fixture({phase:3,monad:false});
  const work=await selectWork(connection);
  assert.equal(work.rows,89);
  assert.equal(work.gasLimit,989000n);
  assert.equal(work.targetGas,890000n);
});

test('failed exact-limit preflight never requests fees or sends paid work',async()=>{
  const {connection,calls}=fixture({rejectStatic:true});
  await assert.rejects(advance(connection),/No compute chunk passes/);
  assert(calls.preflights.length>0);
  assert.equal(calls.fees,0);
  assert.equal(calls.sent.length,0);
});

test('executing selected work uses the direct method and the preflighted gas limit',async()=>{
  const {connection,calls}=fixture({phase:9,cursor:760,cost:()=>20000n});
  await advance(connection);
  assert.equal(calls.sent.length,1);
  assert.equal(calls.sent[0].method,'advance');
  assert.deepEqual(calls.sent[0].args,[7n,8]);
  assert.equal(calls.sent[0].overrides.gasLimit,21200n);
  assert.equal(calls.fees,1);
});

test('invalid active phase and exhausted heavy cursor fail without paid work',async()=>{
  for(const config of [{phase:0},{phase:12},{phase:13},{phase:3,cursor:2304}]){
    const {connection,calls}=fixture(config);
    await assert.rejects(advance(connection));
    assert.equal(calls.sent.length,0);
    assert.equal(calls.fees,0);
  }
});
