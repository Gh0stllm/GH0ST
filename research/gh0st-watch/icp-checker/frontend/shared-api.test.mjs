import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from './shared-api.mjs';

const addr=n=>'0x'+n.toString(16).padStart(40,'0');
const GH0ST='0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559';
const params=(n,refresh=false)=>({network:'mainnet',address:addr(n),...(refresh?{refresh:'1'}:{})});
const parse=r=>JSON.parse(r.body);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};

class Memory {
  rows=new Map();n=0;fault=null;
  async getWithMetadata(k){return this.rows.has(k)?structuredClone(this.rows.get(k)):null}
  async setJSON(k,v,condition){
    if(this.fault?.(k,v)) throw new Error('Simulated storage interruption');
    const cur=this.rows.get(k);
    if(condition.onlyIfNew?!!cur:cur?.etag!==condition.onlyIfMatch)return {modified:false};
    const etag=String(++this.n);this.rows.set(k,{data:structuredClone(v),etag});return {modified:true,etag};
  }
}
function fixture(){
  const s=new Memory();let time=1_800_000_000_000;
  const state={s,advance:n=>time+=n,runs:0};
  state.entry=(network,address)=>({network,address,name:'Test',scannedAt:time,openedAt:time,report:address===GH0ST?null:{block:Math.floor(time/1000)},trace:[],details:{}});
  state.generate=async(n,a)=>state.entry(n,a);
  state.handler=createHandler({storeFor:()=>s,clock:()=>time,generate:(n,a)=>{state.runs++;return state.generate(n,a)}});
  state.req=(method,query,other={})=>state.handler({httpMethod:method,queryStringParameters:query,headers:{},...other});
  return state;
}
test('site-wide immutable reads, explicit refresh cooldown and recents across handlers',async()=>{
  const f=fixture();assert.equal((await f.req('GET',params(1))).statusCode,404);
  const first=await f.req('POST',params(1));assert.equal(first.statusCode,200);assert.equal(parse(first).reused,false);
  assert.equal(parse(await f.req('POST',params(1,true))).reused,true);
  const secondHandler=createHandler({storeFor:()=>f.s,generate:()=>assert.fail('GET cannot run scanner')});
  const read=await secondHandler({httpMethod:'GET',queryStringParameters:params(1)});assert.deepEqual(parse(read).entry,parse(first).entry);
  assert.equal(parse(await f.req('GET',{})).entries.length,1);
  f.advance(600001);assert.equal(parse(await f.req('POST',params(1))).reused,true);
  const next=parse(await f.req('POST',params(1,true)));assert.equal(next.reused,false);assert.equal(f.runs,2);
  assert.equal(parse(await f.req('GET',{})).entries[0].scannedAt,next.entry.scannedAt);
});
test('identical concurrent misses run once; globally bounded expensive work excludes GH0ST',async()=>{
  const f=fixture();const gate=deferred(),start=deferred();
  f.generate=async(n,a)=>{if(a!==GH0ST){start.resolve();await gate.promise;}return f.entry(n,a)};
  const a=f.req('POST',params(1));await start.promise;
  assert.equal((await f.req('POST',params(1))).statusCode,202);
  const b=f.req('POST',params(2));await new Promise(r=>setImmediate(r));
  assert.equal((await f.req('POST',params(3))).statusCode,429);
  assert.equal((await f.req('POST',{network:'mainnet',address:GH0ST})).statusCode,200);
  gate.resolve();await Promise.all([a,b]);assert.equal(f.runs,3);assert.equal(parse(await f.req('GET',{})).entries.length,3);
});
test('timed out workers cannot overwrite replacement or affect recents',async()=>{
  const f=fixture(),started=deferred(),gate=deferred();
  f.generate=async(n,a)=>{const result=f.entry(n,a);started.resolve();await gate.promise;return result;};
  const stale=f.req('POST',params(3));await started.promise;f.advance(120001);
  f.generate=async(n,a)=>f.entry(n,a);const fresh=parse(await f.req('POST',params(3)));gate.resolve();
  assert.equal((await stale).statusCode,202);
  assert.equal(parse(await f.req('GET',params(3))).entry.scannedAt,fresh.entry.scannedAt);
  assert.equal(parse(await f.req('GET',{})).entries[0].scannedAt,fresh.entry.scannedAt);
});
test('a crash after committing the report is repaired on the next expired-lease read',async()=>{
  const f=fixture();f.s.fault=(k,v)=>k==='recent-v1'&&v.recent.length>0;
  assert.equal((await f.req('POST',params(4))).statusCode,503);
  assert.equal((await f.req('GET',params(4))).statusCode,200);
  f.s.fault=null;f.advance(120001);
  assert.equal(parse(await f.req('GET',{})).entries.length,1);assert.equal(f.runs,1);
});
test('bounded failure and burst policies never replace existing evidence',async()=>{
  const f=fixture();const first=parse(await f.req('POST',params(1)));
  f.advance(600001);f.generate=async()=>{throw Error('RPC')};
  assert.equal((await f.req('POST',params(1,true))).statusCode,503);
  assert.deepEqual(parse(await f.req('GET',params(1))).entry,first.entry);
  f.generate=async(n,a)=>f.entry(n,a);
  for(let n=2;n<=10;n++)assert.equal((await f.req('POST',params(n))).statusCode,200);
  const busy=await f.req('POST',params(11));assert.equal(busy.statusCode,429);assert.equal(busy.headers['Retry-After'],'600');
  assert.equal((await f.req('POST',params(1))).statusCode,200);
  f.advance(600001);assert.equal((await f.req('POST',params(11))).statusCode,200);
});
test('API accepts only trusted identifiers, disallows pushed reports, supports anonymous ICP CORS',async()=>{
  const f=fixture();
  assert.equal((await f.req('POST',params(1),{body:'{"report":{}}'})).statusCode,400);
  assert.equal((await f.req('GET',{...params(1),scope:'production'})).statusCode,400);
  assert.equal((await f.req('GET',{...params(1),network:'__proto__'})).statusCode,400);
  const allowed='https://ggcey-baaaa-aaaao-bbsgq-cai.icp0.io';
  const options=await f.req('OPTIONS',{}, {headers:{origin:allowed}});
  assert.equal(options.statusCode,204);assert.equal(options.headers['Access-Control-Allow-Origin'],allowed);
  assert.equal((await f.req('POST',params(1),{headers:{origin:'https://evil.test'}})).statusCode,403);
  assert.equal(f.runs,0);
});
