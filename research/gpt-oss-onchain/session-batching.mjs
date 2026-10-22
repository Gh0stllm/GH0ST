import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,hexlify,keccak256} from 'ethers';
import {kernelBody,fixture,reference,operands,compile} from './session-optimize.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const LUT='0x000102030406080c00fffefdfcfaf8f400000000000000000000000000000000';
const body=kernelBody('shift8');
const memoryBody=body.replace('let ww:=calldataload(','let ww:=mload(');
const source=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
/// @notice Research matrix-vector kernel; synthetic tests only.
/// @dev Rows <=64; groups <=4096. Q32 dyadic arithmetic, int16 inputs, scales [96,160].
contract BatchMxfp4 {
function matvec(bytes calldata w,bytes calldata scales,bytes calldata x,uint256 rows) external pure returns(int256[] memory result){
require(rows>0&&rows<=64&&x.length%64==0);
uint256 groups=x.length/64;
require(groups<=4096&&scales.length==rows*groups&&w.length==scales.length*16);
result=new int256[](rows);
assembly ("memory-safe") {let lut:=${LUT}
for {let r:=0} lt(r,rows) {r:=add(r,1)} {let sum:=0
for {let g:=0} lt(g,groups) {g:=add(g,1)} {let index:=add(mul(r,groups),g)
let s:=byte(0,calldataload(add(scales.offset,index)))
if or(lt(s,96),gt(s,160)){revert(0,0)}
let wp:=add(w.offset,mul(index,16))
let xp:=add(x.offset,mul(g,64))
let dot:=0
${body}
sum:=add(sum,shl(sub(s,96),dot))}
mstore(add(add(result,32),mul(r,32)),sum)}}}

/// @dev Immutable code data starts with STOP, then [16 packed bytes, 1 scale] per group.
function matvecCode(address weightStore,bytes32 expectedHash,uint256 groups,uint256 rows,bytes calldata x) external view returns(int256[] memory result){
require(rows>0&&rows<=64&&groups<=4096&&x.length==groups*64);
require(weightStore.codehash==expectedHash&&expectedHash!=bytes32(0));
bytes memory data=weightStore.code;
require(data.length==rows*groups*17+1&&data[0]==bytes1(0));
result=new int256[](rows);
assembly ("memory-safe") {let lut:=${LUT}
for {let r:=0} lt(r,rows) {r:=add(r,1)} {let sum:=0
for {let g:=0} lt(g,groups) {g:=add(g,1)} {let index:=add(mul(r,groups),g)
let wp:=add(add(data,33),mul(index,17))
let s:=byte(0,mload(add(wp,16)))
if or(lt(s,96),gt(s,160)){revert(0,0)}
let xp:=add(x.offset,mul(g,64))
let dot:=0
${memoryBody}
sum:=add(sum,shl(sub(s,96),dot))}
mstore(add(add(result,32),mul(r,32)),sum)}}}
}
`;
fs.writeFileSync(ROOT+'BatchMxfp4.sol',source);

function matrix(seed,rows,groups){
const items=Array.from({length:rows},(_,r)=>fixture(seed+r*0x18273,groups));
for(const c of items)c.x=items[0].x;
const w=Buffer.concat(items.map(c=>c.w)),s=Buffer.concat(items.map(c=>c.s));
const x=operands(items[0])[2],expected=items.map(reference);
const frames=Buffer.alloc(rows*groups*17);
for(let i=0;i<s.length;i++){w.copy(frames,i*17,i*16,i*16+16);frames[i*17+16]=s[i];}
return {items,w,s,x,expected,frames};
}
async function main(){
const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',chainId:31337},miner:{blockGasLimit:100_000_000},wallet:{totalAccounts:1}});
const provider=new BrowserProvider(local);provider.pollingInterval=10;const signer=await provider.getSigner();
const deploy=async build=>{const c=await new ContractFactory(build.abi,build.evm.bytecode.object,signer).deploy();await c.waitForDeployment();return c;};
const build=compile(source,100000,true,'BatchMxfp4'),batch=await deploy(build);
const previous=await deploy(compile(fs.readFileSync(ROOT+'Mxfp4Kernel.sol','utf8'),200,true,'Mxfp4Kernel'));
const current=await deploy(compile(fs.readFileSync(ROOT+'OptimizedMxfp4.sol','utf8'),10000,true));
const report={status:'RUNNING_SYNTHETIC_BATCH_TESTS',synthetic_only:true,source_sha256:crypto.createHash('sha256').update(source).digest('hex'),
environment:{chain_id:31337,hardfork:'shanghai',compiler_runs:100000,viaIR:true,weight_layout:'STOP prefix; 16 MXFP4 bytes plus scale per block'},benchmarks:[],validation:{cases:0,invalid_rejections:0},
limitations:['Synthetic matrices and int16 vectors only; no GPT-OSS inference/quality claim.',
'Row reuse changes workload/API; report separate single-row, batch-calldata and predeployed-code costs.',
'Predeployed code path excludes its one-time deployment from execution gas; deployment recorded separately.',
'Single local data shard; no production multi-shard executor, persistence policy or routing.']};
const save=()=>fs.writeFileSync(ROOT+'evidence/batching-experiments.json',JSON.stringify(report,null,2)+'\n');
async function send(method,args){const tx=await method.populateTransaction(...args);const sent=await signer.sendTransaction({...tx,gasLimit:90_000_000});const receipt=await sent.wait();assert.equal(receipt.status,1);return {gas:Number(receipt.gasUsed),calldata_bytes:(tx.data.length-2)/2};}
async function dataStore(frames,prefix=0){
const runtime=Buffer.concat([Buffer.from([prefix]),frames]);assert(runtime.length<=24576);
const length=runtime.length.toString(16).padStart(4,'0');
const data='0x61'+length+'61000f60003961'+length+'6000f3'+runtime.toString('hex');
const tx=await signer.sendTransaction({data,gasLimit:20_000_000});const receipt=await tx.wait();assert.equal(receipt.status,1);
return {address:receipt.contractAddress,hash:keccak256(runtime),deployment_gas:Number(receipt.gasUsed),runtime_bytes:runtime.length};}
for(const rows of [1,4,8,16]){
const m=matrix(0x454321+rows,rows,90),args=[hexlify(m.w),hexlify(m.s),m.x,rows];
assert.deepEqual(Array.from(await batch.matvec(...args)),m.expected);report.validation.cases++;
const store=await dataStore(m.frames),codeArgs=[store.address,store.hash,90,rows,m.x];
assert.deepEqual(Array.from(await batch.matvecCode(...codeArgs)),m.expected);report.validation.cases++;
let oldGas=0,newGas=0;
for(const c of m.items){assert.equal(await previous.packed(...operands(c)),reference(c));oldGas+=(await send(previous.packed,operands(c))).gas;newGas+=(await send(current.packed,operands(c))).gas;}
const calldata=await send(batch.matvec,args),code=await send(batch.matvecCode,codeArgs),saved=calldata.gas-code.gas;
const entry={rows,groups:90,scalar_products:rows*2880,previous_single_row_transactions_gas:oldGas,
optimized_single_row_transactions_gas:newGas,batch_calldata:calldata,batch_code:code,
code_store:store,break_even_repeated_calls_vs_batch_calldata:saved>0?Math.ceil(store.deployment_gas/saved):null,
batch_code_reduction_vs_previous_single_row_transactions_percent:100*(oldGas-code.gas)/oldGas};
report.benchmarks.push(entry);save();console.log(JSON.stringify({stage:'batch',...entry}));
}
// Varied non-model shapes and zero/signed edge cases, including cross-row offsets.
for(let i=0;i<96;i++){
 const rows=1+i%8,groups=[0,1,2,3,7,8,16,31,90][i%9],m=matrix(0x123400+i,rows,groups);
 assert.deepEqual(Array.from(await batch.matvec(hexlify(m.w),hexlify(m.s),m.x,rows)),m.expected);report.validation.cases++;
 const store=await dataStore(m.frames);assert.deepEqual(Array.from(await batch.matvecCode(store.address,store.hash,groups,rows,m.x)),m.expected);report.validation.cases++;
 if(i%24===0){save();console.log(JSON.stringify({stage:'batch_tests',cases:report.validation.cases}));}
}
const m=matrix(9,4,3),store=await dataStore(m.frames);
for(const args of [[hexlify(m.w),hexlify(m.s),m.x,0],[hexlify(m.w),hexlify(m.s),m.x,65],['0x00',hexlify(m.s),m.x,4],[hexlify(m.w),'0x',m.x,4],[hexlify(m.w),hexlify(m.s),'0x00',4]]){await assert.rejects(batch.matvec(...args));report.validation.invalid_rejections++;}
for(const args of [[store.address,'0x'+'00'.repeat(32),3,4,m.x],[store.address,store.hash,4,4,m.x],[store.address,store.hash,3,3,m.x],[store.address,store.hash,3,0,m.x],[store.address,store.hash,3,65,m.x]]){await assert.rejects(batch.matvecCode(...args));report.validation.invalid_rejections++;}
const invalid=matrix(17,4,3);invalid.s[5]=95;invalid.frames[5*17+16]=95;
await assert.rejects(batch.matvec(hexlify(invalid.w),hexlify(invalid.s),invalid.x,4));report.validation.invalid_rejections++;
const badStore=await dataStore(invalid.frames);await assert.rejects(batch.matvecCode(badStore.address,badStore.hash,3,4,invalid.x));report.validation.invalid_rejections++;
const badPrefix=await dataStore(m.frames,1);await assert.rejects(batch.matvecCode(badPrefix.address,badPrefix.hash,3,4,m.x));report.validation.invalid_rejections++;
report.status='PASS_SYNTHETIC_BATCH_AND_CODE_ACCESS';report.finished_at=new Date().toISOString();save();await local.disconnect();console.log(JSON.stringify({stage:'batch_complete',validation:report.validation}));
}
main().catch(e=>{fs.writeFileSync(ROOT+'evidence/batching-failure.json',JSON.stringify({error:String(e),stack:e.stack},null,2)+'\n');console.error(e);process.exitCode=1;});
