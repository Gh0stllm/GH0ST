import test from 'node:test';
import assert from 'node:assert/strict';
import {id} from 'ethers';
import {readLaunchWindow} from './bundles.js';

const addr=n=>'0x'+n.toString(16).padStart(40,'0'),hash=n=>'0x'+n.toString(16).padStart(64,'0');
const token=addr(33),pool=addr(22),sig=id('Swap(address,address,int256,int256,uint160,uint128,int24)');
const creation={transactionHash:hash(93),blockHash:hash(100),transactionIndex:'0x0',blockNumber:'0x64',status:'0x1',from:addr(7),logs:[]};
function transfer(position,from,to,height=100){return {address:token,topics:[id('Transfer(address,address,uint256)'),hash(from),hash(to)],data:hash(7),
  blockHash:hash(height),blockNumber:'0x'+height.toString(16),transactionHash:hash(1000+position),transactionIndex:'0x'+position.toString(16)};}
function receipt(log,emitter=pool){return {...log,status:'0x1',from:addr(Number(log.transactionIndex)+100),logs:[{address:emitter,topics:[sig,hash(0),hash(0)],data:'0x'+'0'.repeat(5*64)}]};}

test('filters unrelated swap emitters, checks same-block senders and validates funding proofs',async t=>{
  const logs=[transfer(0,0,3),transfer(1,22,1),transfer(2,22,2),transfer(3,22,1,101)];
  const donors=new Map([[addr(101).toLowerCase(),hash(6101)],[addr(102).toLowerCase(),hash(6102)]]);
  const funder=addr(8);
  t.mock.method(globalThis,'fetch',async url=>{
    const who=new URL(url).searchParams.get('address').toLowerCase();
    return {ok:true,json:async()=>({result:[{from:funder,to:who,isError:'0',value:'42',hash:donors.get(who),blockNumber:'99'}]})};
  });
  const rpc=async(m,[q])=>{
    if(m==='eth_getLogs')return logs;
    const log=logs.find(l=>l.transactionHash===q);
    if(log)return receipt(log,Number(log.blockNumber)===101?addr(19):pool);
    const [who]=[...donors].find(([,h])=>h===q);
    return {hash:q,transactionHash:q,blockHash:hash(99),blockNumber:'0x63',status:'0x1',from:funder,to:who,value:'0x2a'};
  };
  const b=await readLaunchWindow({explorer:'https://explorer.test'},token,100,creation,rpc,109);
  assert.equal(b.early.blocks.length,10);assert.equal(b.early.matches,2);assert.equal(b.early.wallets,2);
  assert.equal(b.early.blocks[0].transactions,3);assert.equal(b.early.blocks[0].senders,2);
  assert.equal(b.early.blocks[1].rows[0].state,'checked');assert.equal(b.early.blocks[2].transactions,0);
  assert.equal(b.early.funding.match.proofs.length,2);assert.equal(b.early.funding.match.funder,funder);
});
test('unavailable or mismatched receipts stay unknown and reads stay bounded',async()=>{
  const logs=Array.from({length:15},(_,n)=>transfer(n+1,22,1));
  let calls=0;
  const rpc=async(m,[q])=>{
    if(m==='eth_getLogs')return logs;
    calls++;if(calls%2===0)throw Error('offline');
    return {...receipt(logs.find(l=>l.transactionHash===q)),blockHash:hash(999)};
  };
  const b=await readLaunchWindow({},token,100,creation,rpc,101);
  assert.equal(calls,12);assert.equal(b.early.blocks.length,2);assert.equal(b.early.eligible,15);assert.equal(b.early.checked,0);
  assert.equal(b.early.blocks[0].rows[0].state,'unavailable');assert.equal(b.early.funding,null);assert.equal(b.early.blocks[0].repeatRecipients,1);
});
test('empty launch window differs from an unavailable RPC',async()=>{
  const b=await readLaunchWindow({},token,100,creation,async()=>[],100);
  assert.equal(b.transactions,0);assert.equal(b.early.blocks.length,1);assert.equal(b.early.checked,0);
  await assert.rejects(readLaunchWindow({},token,100,creation,async()=>{throw Error('unavailable')},100));
});
