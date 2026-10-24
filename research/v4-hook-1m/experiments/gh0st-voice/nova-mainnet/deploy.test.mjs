import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPackage,verifyNetwork,inspect,main} from './deploy.mjs';
import {CHAIN,read} from './common.mjs';
const pkg=loadPackage();
test('frozen archive validates every unsigned deployment and separates funding',()=>{
 assert.equal(pkg.entries.length,pkg.plan.deployment_count);assert.equal(pkg.entries[0].kind,'vault');
 assert(pkg.entries.every(e=>BigInt(e.transaction.value)===0n));assert.equal(pkg.plan.funding.value,'1000000000000000000');
});
test('wrong chain is rejected before dependency reads',async()=>{
 let read=false;await assert.rejects(()=>verifyNetwork({send:async()=> '0x1',getCode:async()=>{read=true;return'0x';}},pkg.plan),/Wrong chain/);assert.equal(read,false);
});
test('changed dependency code rejects a correctly numbered network',async()=>{
 await assert.rejects(()=>verifyNetwork({send:async()=>CHAIN,getCode:async()=> '0x00'},pkg.plan),/Dependency code changed/);
});
test('pinned dependency runtime accepts the read-only check',async()=>{
 const code=read('build/dependency-runtime.json');await verifyNetwork({send:async()=>CHAIN,getCode:async address=>address===pkg.plan.dependencies.manager.address?code.manager:code.factory},pkg.plan);
});
test('resume distinguishes empty, matching, and conflicting deployed code',async()=>{
 const entry=pkg.entries.find(e=>e.kind==='data');const runtime='0x'+entry.transaction.data.slice(86);
 assert.equal(await inspect({getCode:async()=> '0x'},entry),false);assert.equal(await inspect({getCode:async()=>runtime},entry),true);
 await assert.rejects(()=>inspect({getCode:async()=> '0x00'},entry),/Conflicting runtime/);
});
test('ambiguous deployment plus funding command rejects before connecting',async()=>{
 await assert.rejects(()=>main(['--broadcast','--fund']),/separate explicit stages/);
 await assert.rejects(()=>main(['--unrecognized']),/Unknown option/);
});
