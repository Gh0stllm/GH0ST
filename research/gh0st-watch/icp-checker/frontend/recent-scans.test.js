import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecentScans,RECENTS_KEY} from './recent-scans.js';

const gh0st='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const addr=n=>'0x'+n.toString(16).padStart(40,'0'), hash=n=>'0x'+n.toString(16).padStart(64,'0');
const mint=addr(10);
function scan(address=mint,network='mainnet',block=7,scannedAt=123) {
  const report={network,address,block,blockHash:hash(block),hash:hash(9),logicHash:hash(9),size:112,
    explorer:network==='mainnet'?'https://robinhoodchain.blockscout.com':'https://explorer.testnet.chain.robinhood.com',
    overview:{fields:[['Symbol','COIN']],controls:[]},verified:false,erc20:false,indicators:[],
    rules:['mint','underflow','withdraw','authorization','replay','token'].map(key=>({key,title:key,status:'Untested',detail:'Unavailable',scope:'Coverage',evidence:[]}))};
  return {network,address,name:'COIN',report,trace:['Confirmed'],scannedAt,openedAt:scannedAt,details:{
    note:{text:'Saved findings',source:'ICP'},intel:{origin:null,token:null},market:{available:false,reason:'No pool'},
  }};
}
function storage() {
  const map=new Map();
  return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
}

test('imports complete snapshots and deduplicates by case-insensitive address and network across tabs',()=>{
  const db=storage(), store=createRecentScans(db), report=scan();
  const first=store.remember(report);
  assert.deepEqual(first.details,report.details);
  assert.equal(first.scannedAt,report.scannedAt);
  assert.ok(first.openedAt>first.scannedAt);
  store.remember(scan(mint,'testnet'));
  const other=createRecentScans(db);
  other.remember(scan(mint.toUpperCase(),'mainnet'));
  const opened=store.get('mainnet',mint);
  assert.deepEqual(store.list().map(x=>x.network),['mainnet','testnet']);
  assert.deepEqual(opened.details,report.details);
  assert.deepEqual(opened.trace,report.trace);
});

test('a late HTTP response cannot replace a newer local result or its enrichment',()=>{
  const db=storage(), oldTab=createRecentScans(db), newTab=createRecentScans(db);
  const stale=scan(mint,'mainnet',7,100);
  oldTab.remember(stale);
  const fresh=scan(mint,'mainnet',8,200);
  fresh.details.note.text='Updated findings';
  newTab.remember(fresh);
  oldTab.remember(scan(addr(11)));
  const reopened=oldTab.remember(stale);
  assert.deepEqual(reopened.report,stale.report);
  assert.deepEqual(newTab.get('mainnet',mint).details,fresh.details);
  assert.equal(newTab.get('mainnet',mint).scannedAt,200);
  assert.equal(newTab.list()[0].address,mint);
  assert.equal(newTab.list().length,2);
});

test('previous v1 device snapshots stay readable including entries without enrichment',()=>{
  const db=storage(), legacy=scan();delete legacy.details;
  db.setItem(RECENTS_KEY,JSON.stringify([legacy]));
  const store=createRecentScans(db);
  assert.deepEqual(store.get('mainnet',mint),{...legacy,details:{}});
  const refreshed=store.remember(scan(mint,'mainnet',11,300));
  assert.ok(refreshed.details.note);
  assert.equal(store.list().length,1);
  assert.equal(createRecentScans(db).get('mainnet',mint).scannedAt,300);
});

test('only exact official address can omit checks; malformed stored records and unsafe links are excluded',()=>{
  const db=storage(), store=createRecentScans(db), sample=scan();
  const official={...scan(gh0st),report:null,name:'GH0ST',trace:[],details:{}};
  assert.ok(store.remember(official));
  assert.equal(store.remember({...official,network:'testnet'}),null);
  assert.equal(store.remember({...sample,report:null}),null);
  assert.equal(store.remember({...sample,report:{...sample.report,address:addr(11)}}),null);
  assert.equal(store.remember({...sample,report:{...sample.report,explorer:'javascript:alert(1)'}}),null);
  db.setItem(RECENTS_KEY,JSON.stringify([{}, {...sample,details:{market:{available:true,url:'javascript:alert(1)',links:[]}}},sample]));
  assert.equal(store.list().length,1);
  assert.deepEqual(store.list()[0].details,{});
  db.setItem(RECENTS_KEY,'{broken');
  assert.deepEqual(store.list(),[]);
});

test('bounds saved history even when browser storage rejects writes',()=>{
  const store=createRecentScans({getItem:()=>null,setItem:()=>{throw Error('Storage disabled');}});
  for(let n=1;n<=14;n++)store.remember(scan(addr(n)));
  assert.equal(store.list().length,12);
  assert.equal(store.list()[0].address,addr(14));
  assert.equal(store.get('mainnet',addr(2)),null);
  store.remember(scan(addr(3)));
  assert.equal(store.list()[0].address,addr(3));
  assert.equal(store.list().length,12);
});

test('oversized snapshots can be displayed without dropping other saved reports',()=>{
  const store=createRecentScans(storage());
  store.remember(scan());
  const huge=scan(addr(11));huge.trace=['x'.repeat(450000)];
  assert.equal(store.remember(huge).address,addr(11));
  assert.deepEqual(store.list().map(e=>e.address),[mint]);
});
