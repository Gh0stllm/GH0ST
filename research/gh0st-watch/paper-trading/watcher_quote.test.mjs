import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRoute} from './watcher_quote.mjs';
const tip={number:106,hash:'0x'+'11'.repeat(32)};
const origo='0xf722b7b078b4b69430586b907ce82122d603c3ba';
const ponsHook='0xe5e702641ea86f4ae6cc3cdaed2b886f976be044';
const eth='0x'+'00'.repeat(20);
const pool='0xbb84f6544a65d52bd2c410be6229a72bc298d81be912bbc752cadb3e782743ff';
function withMapping(key){return {tip,call:async(_url,_block,_contract,fn,args)=>{assert.equal(fn,'poolKeys');assert.match(args[0],/^0x[\da-f]{50}$/);return key;}};}
test('the hashed on-chain pool key must contain the watched address',async()=>{
  const market=withMapping([eth,origo,0,200,ponsHook]);
  const result=await resolveRoute(market,{pool,address:origo},true);
  assert.equal(result.status,'verified');assert.equal(result.poolId,pool);assert.equal(result.evidence.blockHash,tip.hash);
  const mismatch=await resolveRoute(market,{pool,address:'0x'+'ff'.repeat(20)},true);
  assert.equal(mismatch.status,'unsupported');
});
test('a known non-native v4 pool is explicitly unsupported',async()=>{
  const priors='0xedbf91223639800bcd5756815caf908df3b890be',usdg='0x5fc5360d0400a0fd4f2af552add042d716f1d168';
  const market=withMapping([usdg,priors,0,200,ponsHook]);
  const result=await resolveRoute(market,{pool:'0xff7b3bd2db34d9ed8160e6dedf1d448777abaa1fa6fc8a31144930a1a656fd92',address:priors},true);
  assert.equal(result.status,'unsupported');assert.deepEqual(result.key.slice(0,2),[usdg,priors]);assert.equal(result.evidence.source,'PositionManager.poolKeys(bytes25)');
});
