import test from 'node:test';
import assert from 'node:assert/strict';
import {openSharedScan} from './shared-client.js';

const coin={network:'mainnet',address:'0x'+'ab'.repeat(20)};
const record={...coin,scannedAt:42};
test('the ICP frontend reads the existing shared entry without asking for a fresh scan',async t=>{
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url.origin,'https://gh0st.fyi');
    assert.equal(options.method,'GET');
    return Response.json({entry:record});
  });
  globalThis.location=new URL('https://ggcey-baaaa-aaaao-bbsgq-cai.icp0.io/');
  t.after(()=>{delete globalThis.location});
  assert.deepEqual(await openSharedScan(coin,false,()=>{}),{entry:record,reused:true});
  assert.equal(fetch.mock.callCount(),1);
});

test('a missing report submits only its identity to the same Netlify deployment',async t=>{
  globalThis.location=new URL('https://example--gh0st-observatory.netlify.app/watcher/');
  t.after(()=>{delete globalThis.location});
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push(options.method);
    assert.equal(url.origin,location.origin);
    assert.deepEqual(Object.fromEntries(url.searchParams),coin);
    assert.equal(options.body,undefined);
    return options.method==='GET'?new Response(null,{status:404}):Response.json({entry:record,reused:false});
  });
  assert.deepEqual(await openSharedScan(coin,false,()=>{}),{entry:record,reused:false});
  assert.deepEqual(calls,['GET','POST']);
});
