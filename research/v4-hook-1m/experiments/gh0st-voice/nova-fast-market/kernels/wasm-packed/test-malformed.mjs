import fs from 'node:fs';import path from'node:path';import assert from'node:assert/strict';import{fileURLToPath}from'node:url';import{keccak256,getBytes}from'ethers';import{createHash}from'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url)),files=[null,'core.bin','groups.bin','words.bin','punct.bin','fused.bin','punct-fold.bin','sigmoid-delta.bin','exp-q32.bin','word-punct.bin'];
const base=files.map(f=>f?fs.readFileSync(path.join(here,'model',f)):null),wasm=fs.readFileSync(path.join(here,'wasm/target/wasm32-unknown-unknown/release/nova_wasm_delta_packed3.wasm')),module=await WebAssembly.compile(wasm),rows=[];
async function trial(name,mutate,shouldReject=true,shortRead=false){
 const blobs=base.map(b=>b?Buffer.from(b):null);mutate(blobs);let instance;
 const host={vm_hooks:{account_code(address,offset,size,dest){const mem=Buffer.from(instance.exports.memory.buffer);assert(address>=0&&address+20<=mem.length);const a=mem.subarray(address,address+20),kind=a[0],idx=a.readUInt32BE(16);assert(a.subarray(1,16).every(x=>x===0));assert(kind>=1&&kind<blobs.length);assert(offset>=1&&offset<=24001&&size>=0&&offset+size<=24001);const start=idx*24000+offset-1;assert(start+size<=blobs[kind].length&&dest>=0&&dest+size<=mem.length);blobs[kind].copy(mem,dest,start,start+size);return shortRead?Math.max(0,size-1):size;},native_keccak256(input,len,out){const mem=Buffer.from(instance.exports.memory.buffer);assert.equal(len,96);assert(input>=0&&input+len<=mem.length&&out>=0&&out+32<=mem.length);Buffer.from(getBytes(keccak256(mem.subarray(input,input+len)))).copy(mem,out);}}};
 instance=await WebAssembly.instantiate(module,host);instance.exports.reset(42,512,0,0,0,0,1024,1024);
 if(shouldReject)assert.throws(()=>instance.exports.step(),undefined,name);else assert.equal(instance.exports.step(),0);
 rows.push({name,passed:true,rejected:shouldReject});
}
await trial('valid baseline',()=>{},false);
await trial('wrong core magic',b=>b[1][0]=0);
await trial('wrong core row count',b=>b[1].writeUInt32LE(1,4));
await trial('wrong core auxiliary length',b=>b[1].writeUInt32LE(0,8));
await trial('nonzero core reserved flags',b=>b[1].writeUInt32LE(1,12));
await trial('row bitwidth exceeds16',b=>b[1][18]=17);
await trial('decoded value exceedsi16',b=>b[1].writeInt16LE(32767,16));
await trial('decoded triple exceeds proven carry bound',b=>b[1].writeInt16LE(1000,16));
await trial('truncated core',b=>b[1]=b[1].subarray(0,b[1].length-1));
await trial('wrong group header',b=>b[2][0]=0);
await trial('wrong punctuation row count',b=>b[4].writeUInt32LE(6,4));
await trial('wrong word table magic',b=>b[3][0]=0);
await trial('word first offset points inside header',b=>b[3].writeUInt32LE(531,16));
await trial('word offsets nonincreasing',b=>b[3].writeUInt32LE(b[3].readUInt32LE(16),20));
await trial('word final offset outside file',b=>b[3].writeUInt32LE(b[3].length+1,16+128*4));
await trial('word group bitwidth exceeds16',b=>b[3][b[3].readUInt32LE(16)+2]=17);
await trial('short host copy',()=>{},true,true);
const report={status:'PASS',scope:'LOCAL_WASM_COMPRESSED_FORMAT_TESTS',publicTransactions:0,wasmSha256:createHash('sha256').update(wasm).digest('hex'),cases:rows,limitation:'Bounds and format rejection do not authenticate semantic model identity; production catalog/code-hash binding remains necessary.'};fs.writeFileSync(path.join(here,'malformed-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:rows.length}));
