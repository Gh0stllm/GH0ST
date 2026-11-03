import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceSnapshot,saveObservation,compareEvidence} from './time-machine.js';

const addr=n=>'0x'+n.toString(16).padStart(40,'0'), hash=n=>'0x'+n.toString(16).padStart(64,'0');
function sample(block,extra={},intel=null){
  return evidenceSnapshot({network:'mainnet',address:addr(2),block,hash:hash(100),blockHash:hash(block),
    proxyError:'',proxy:null,logicHash:hash(100),verified:true,overview:{fields:[['Owner getter',addr(1)],['Paused getter','False']],controls:['pause()']},
    rules:[{key:'mint',status:'Untested'},{key:'withdraw',status:'Not reproduced'}],...extra},intel,block*1000);
}
test('order, forks, and cross-chain isolation',()=>{
  const a=sample(5), b=sample(6), c=sample(7),fork={...b,blockHash:hash(60)};
  const other={...b,network:'testnet'};
  const hist=[c,a,b,other].reduce(saveObservation,[]);assert.deepEqual(hist.filter(x=>x.network==='mainnet').map(x=>x.block),[7,6,5]);
  assert.throws(()=>compareEvidence(c,b));assert.throws(()=>compareEvidence(a,other));
  const next=saveObservation(hist,fork);assert.deepEqual(next.filter(x=>x.network==='mainnet').map(x=>x.blockHash),[hash(60),hash(5)]);
  assert.equal(next.filter(x=>x.network==='testnet').length,1);
  assert.deepEqual(saveObservation(next,{...b,observed:b.observed-1}),next);
});
test('difference distinguishes changes, gaps and coverage and preserves zero',()=>{
  const a=sample(5,{}, {token:{top:'0.00%',count:10}});
  const b=sample(6,{rules:[{key:'mint',status:'Reproduced'},{key:'withdraw',status:'Untested'}],overview:{fields:[['Owner getter',addr(2)]],controls:['pause()','setFee(uint256)']}}, {token:{top:'8.54%',count:10}});
  const rows=Object.fromEntries(compareEvidence(a,b).map(x=>[x.label,x]));
  assert.equal(rows['Listed holder share'].delta,'8.54 percentage points');assert.equal(rows['Mint'].coverage,true);
  assert.equal(rows['Owner getter'].status,'changed');assert.equal(rows['Paused getter'].status,'gap');
  assert.equal(rows['Verified control methods'].status,'changed');
  assert.equal(compareEvidence(a,{...b,topCount:8}).find(x=>x.label==='Listed holder share').status,'gap');
});
test('same canonical block deduplicates and late failed enrichment retains observations',()=>{
  const initial=sample(3);const enriched={...initial,top:2.55,topCount:10};
  const all=[initial,enriched,{...initial,observed:initial.observed+1}].reduce(saveObservation,[]);
  assert.equal(all.length,1);assert.equal(all[0].top,2.55);
  assert.equal(saveObservation(all,sample(4))[0].top,null);
});
test('bounded local archive and malformed records',()=>{
  let h=Array.from({length:15},(_,i)=>sample(i+1)).reduce(saveObservation,[]);
  assert.equal(h.length,12);assert.equal(h.at(-1).block,4);
  for(let i=0;i<30;i++) h=saveObservation(h,{...sample(20+i),address:addr(100+i)});
  assert.equal(new Set(h.map(x=>x.address)).size,24);
  assert.equal(evidenceSnapshot({block:-1},null),null);
  assert.deepEqual(saveObservation([null,'invalid',{}],sample(2)),[sample(2)]);
});
