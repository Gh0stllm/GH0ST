import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecentScans,RECENTS_KEY} from './recent-scans.js';

const gh0st='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const addr=n=>'0x'+n.toString(16).padStart(40,'0'), hash=n=>'0x'+n.toString(16).padStart(64,'0');
const mint=addr(10);
function scan(address=mint,network='mainnet',block=7) {
  const report={network,address,block,blockHash:hash(block),hash:hash(9),logicHash:hash(9),size:112,
    explorer:network==='mainnet'?'https://robinhoodchain.blockscout.com':'https://explorer.testnet.chain.robinhood.com',
    overview:{fields:[['Symbol','COIN']],controls:[]},verified:false,erc20:false,indicators:[],
    rules:['mint','underflow','withdraw','authorization','replay','token'].map(key=>({key,title:key,status:'Untested',detail:'Unavailable',scope:'Coverage',evidence:[]}))};
  return {network,address,name:'COIN',report,trace:['Confirmed']};
}
function storage() {
  const map=new Map();
  return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
}

test('one entry per network and address across reloads; reopening retains the original snapshot and scan time',()=>{
  const db=storage(), recents=createRecentScans(db), first=recents.save(scan());
  recents.save(scan(mint,'testnet'));
  const otherTab=createRecentScans(db);
  const entry=otherTab.touch('mainnet',mint.toUpperCase());
  assert.equal(entry.scannedAt,first.scannedAt);
  assert.equal(entry.report.block,7);
  assert.deepEqual(entry.trace,['Confirmed']);
  assert.deepEqual(recents.list().map(x=>x.network),['mainnet','testnet']);
  const next=recents.save(scan(mint,'mainnet',8));
  assert.ok(next.scannedAt>first.scannedAt);
  assert.equal(otherTab.get('mainnet',mint).report.block,8);
  assert.equal(recents.list().length,2);
});

test('late enrichment keeps recency and cannot replace data for a newer scan at the same block',()=>{
  const store=createRecentScans(storage()), first=store.save(scan());
  store.save(scan(addr(4)));
  const note={text:'Saved findings',source:'ICP'};
  store.attach('mainnet',mint,hash(7),{note},first.scannedAt);
  store.attach('mainnet',mint,hash(7),{intel:{origin:null,token:null}},first.scannedAt);
  assert.deepEqual(store.get('mainnet',mint).details,{note,intel:{origin:null,token:null}});
  assert.equal(store.list()[0].address,addr(4));
  const next=store.save(scan());
  assert.equal(store.attach('mainnet',mint,hash(7),{note},first.scannedAt),null);
  assert.equal(store.attach('mainnet',mint,hash(8),{note},next.scannedAt),null);
  assert.deepEqual(store.get('mainnet',mint).details,{});
});

test('successful scan required except for exact platform address on mainnet; malformed records skipped',()=>{
  const db=storage(), store=createRecentScans(db);
  assert.ok(store.save({network:'mainnet',address:gh0st,name:'GH0ST'}));
  assert.equal(store.save({network:'testnet',address:gh0st,name:'GH0ST'}),null);
  assert.equal(store.save({...scan(),report:null}),null);
  const valid=store.save(scan());
  db.setItem(RECENTS_KEY,JSON.stringify([{}, {...valid,report:{...valid.report,explorer:'javascript:alert(1)'}}, {...valid,details:{market:{available:true,url:'javascript:alert(1)',links:[]}}},valid]));
  assert.equal(store.list().length,1);
  assert.deepEqual(store.list()[0].details,{});
  db.setItem(RECENTS_KEY,'{broken');
  assert.deepEqual(store.list(),[]);
});

test('newest twelve retained with bounded in-memory fallback when browser storage is unavailable',()=>{
  const store=createRecentScans({getItem:()=>null,setItem:()=>{throw Error('Storage disabled');}});
  for(let n=1;n<=14;n++)store.save(scan(addr(n)));
  assert.equal(store.list().length,12);
  assert.equal(store.list()[0].address,addr(14));
  assert.equal(store.get('mainnet',addr(2)),null);
  assert.equal(store.touch('mainnet',addr(3)).address,addr(3));
  assert.equal(store.list().length,12);
});
