// Executes the exact Node prototype host functions extracted from benchmark-wasm.mjs.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';import{keccak256,getBytes}from'ethers';
const dir=path.dirname(fileURLToPath(import.meta.url)),stylus=path.join(dir,'../stylus'),source=fs.readFileSync(path.join(stylus,'benchmark-wasm.mjs'),'utf8');
const sha=x=>createHash('sha256').update(x).digest('hex');
function body(name){const start=source.indexOf(name+'(');assert(start>=0);let pos=source.indexOf('{',start),depth=1,end=pos+1;while(depth){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}return source.slice(pos+1,end-1);}
const instance={exports:{memory:{buffer:new ArrayBuffer(6_000_000)}}};
const files=[null,'core.bin','groups.bin','words.bin','punct.bin','fused.bin','punct-fold.bin','sigmoid-delta.bin','exp-q32.bin','word-punct.bin'];
const blobs=files.map(f=>f?fs.readFileSync(path.join(stylus,'raw-model',f)):null);
const f=new Function('assert','instance','blobs','keccak256','getBytes',`let readCalls=0,readBytes=0;return {account_code:function(address,offset,size,dest){${body('account_code')}},native_keccak256:function(input,length,output){${body('native_keccak256')}},counts:()=>({readCalls,readBytes})};`)(assert,instance,blobs,keccak256,getBytes);
const memory=Buffer.from(instance.exports.memory.buffer),addr=128,dest=4096;const results=[];
function address(kind,index=0){memory.fill(0,addr,addr+20);memory[addr]=kind;memory.writeUInt32BE(index,addr+16);}
function good(name,fn){fn();results.push({name,accepted:true});}
function bad(name,fn){assert.throws(fn,assert.AssertionError,name);results.push({name,rejected:true});}
for(let kind=1;kind<blobs.length;kind++){address(kind);good('valid kind '+kind,()=>{assert.equal(f.account_code(addr,1,Math.min(10,blobs[kind].length),dest),Math.min(10,blobs[kind].length));assert.equal(memory[dest],blobs[kind][0]);});}
address(1);good('valid shard end',()=>f.account_code(addr,23999,2,dest));
for(const [name,a,o,n,d] of [['negative address',-1,1,1,dest],['address outside memory',memory.length-19,1,1,dest],['offset zero',addr,0,1,dest],['negative offset',addr,-1,1,dest],['offset beyond shard',addr,24002,1,dest],['negative length',addr,1,-1,dest],['copy crossing shard boundary',addr,24000,2,dest],['negative destination',addr,1,1,-1],['destination outside memory',addr,1,10,memory.length-9]]){address(1);bad(name,()=>f.account_code(a,o,n,d));}
for(const kind of [0,10,255]){address(kind);bad('invalid kind '+kind,()=>f.account_code(addr,1,1,dest));}
address(1);memory[addr+7]=1;bad('noncanonical virtual address',()=>f.account_code(addr,1,1,dest));
address(1,0xffffffff);bad('shard outside blob',()=>f.account_code(addr,1,1,dest));
address(7);bad('read beyond short final shard',()=>f.account_code(addr,514,2,dest));
memory.fill(7,512,608);good('keccak96 exact',()=>{f.native_keccak256(512,96,1024);assert.equal(memory.subarray(1024,1056).toString('hex'),keccak256(memory.subarray(512,608)).slice(2));});
for(const [name,a,n,d]of[['bad keccak length',512,95,1024],['negative keccak input',-1,96,1024],['keccak input outside memory',memory.length-95,96,1024],['negative keccak output',512,96,-1],['keccak output outside memory',512,96,memory.length-31]])bad(name,()=>f.native_keccak256(a,n,d));
const report={status:'PASS',scope:'EXACT_NODE_HOST_FUNCTION_TESTS_ONLY',publicTransactions:0,benchmarkSourceSha256:sha(source),rustSourceSha256:sha(fs.readFileSync(path.join(stylus,'wasm-kernel/src/lib.rs'))),cases:results.length,results,hostCounts:f.counts(),limitations:['These are local fixture host bounds, not an activated Stylus host contract or model pinning proof','No Stylus gas or network throughput was measured']};fs.writeFileSync(path.join(dir,'wasm-host-review.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases,hash:report.benchmarkSourceSha256}));
