import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,hexlify,keccak256} from 'ethers';
import {fixture,reference,operands,compile} from './session-optimize.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const options=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const deadline=options.deadline?Date.parse(options.deadline):Date.now()+600_000;
const polynomial=options.decoder==='polynomial';
const lanes=options.lanes==='9'?9:8;
const spacing=lanes===9?26:32,groupCap=lanes===9?160:180;
const coefficientBytes=lanes*16,frameStride=lanes*17;
const outputSource=lanes===9?'NineLaneMxfp4.sol':polynomial?'LaneMxfp4V2.sol':'LaneMxfp4.sol';
const outputReport=lanes===9?'nine-lane-experiments.json':polynomial?'lane-v2-experiments.json':'lane-experiments.json';
const mask=(width,spacing,count)=>'0x'+Array.from({length:count},(_,i)=>((1n<<BigInt(width))-1n)<<BigInt(spacing*i)).reduce((a,b)=>a|b,0n).toString(16);
const ONES=mask(1,spacing,lanes),C12='0x'+Array.from({length:lanes},(_,i)=>12n<<BigInt(i*spacing)).reduce((a,b)=>a|b,0n).toString(16);
const spreadMasks=lanes===9?['0x'+((1n<<32n)-1n|(15n<<208n)).toString(16),mask(16,104,3),mask(8,52,5),mask(4,26,9)]:[mask(16,128,2),mask(8,64,4),mask(4,32,8)];
const spreadShifts=lanes===9?[176,88,44,22]:[112,56,28];

function calculation(load){return `
let ones:=${ONES}
for {let g:=0} lt(g,groups) {g:=add(g,1)} {
let base:=add(frameStart,mul(g,${frameStride}))
let xp:=add(x.offset,mul(g,64))
let sums:=0
let weightsums:=0
let sumx:=0
for {let j:=0} lt(j,32) {j:=add(j,1)} {
${lanes===9?`let n:=and(shr(sub(220,mul(and(j,1),4)),${load}(add(base,div(mul(j,9),2)))),0xfffffffff)`:`let n:=shr(224,${load}(add(base,mul(j,4))))`}
${spreadMasks.map((m,i)=>`n:=and(or(n,shl(${spreadShifts[i]},n)),${m})`).join('\n')}
let m:=and(n,ones)
let e0:=and(shr(1,n),ones)
let e1:=and(shr(2,n),ones)
let neg:=and(shr(3,n),ones)
${polynomial?`let highpair:=and(e1,e0)
let mag:=add(and(n,${mask(3,spacing,lanes)}),add(and(e1,m),shl(1,add(highpair,and(highpair,m)))))`:`let b0:=and(m,xor(e1,ones))
let b1:=or(and(xor(e1,ones),e0),and(and(e1,xor(e0,ones)),m))
let b2:=and(e1,or(xor(e0,ones),m))
let b3:=and(e1,e0)
let mag:=or(or(b0,shl(1,b1)),or(shl(2,b2),shl(3,b3)))`}
let weights:=sub(add(${C12},mag),shl(1,and(mag,mul(neg,${lanes===8?'0xffffffff':(1n<<BigInt(spacing))-1n}))))
let a:=sar(240,calldataload(add(xp,mul(j,2))))
sumx:=add(sumx,a)
weightsums:=add(weightsums,weights)
sums:=add(sums,mul(weights,add(a,32768)))
}
for {let r:=0} lt(r,${lanes}) {r:=add(r,1)} {
let s:=byte(0,${load}(add(add(base,${coefficientBytes}),r)))
if or(lt(s,96),gt(s,160)){revert(0,0)}
let shift:=mul(r,${spacing})
let value:=sub(sub(and(shr(shift,sums),${lanes===8?'0xffffffff':(1n<<BigInt(spacing))-1n}),shl(15,and(shr(shift,weightsums),${lanes===8?'0xffffffff':(1n<<BigInt(spacing))-1n}))),mul(12,sumx))
let slot:=add(add(result,32),${lanes===8?'shift':'mul(r,32)'})
mstore(slot,add(mload(slot),shl(sub(s,96),value)))
}
}`;}
const source=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
/// @notice ${lanes===8?'Eight':lanes}-lane synthetic research tile, not full GPT-OSS inference.
/// @dev Exactly ${lanes} rows, <=${groupCap} groups, 32 int16 inputs per group, scales [96,160].
///      Per-lane biased product sum <=32*24*65535 <2**26; ${spacing}-bit lane fields cannot carry.
///      Per-row scaled signed accumulation <2**96 within the supported domain.
contract LaneMxfp4 {
function tile(bytes calldata frames,bytes calldata x) external pure returns(int256[] memory result){
require(frames.length%${frameStride}==0);uint256 groups=frames.length/${frameStride};
require(groups<=${groupCap}&&x.length==groups*64);result=new int256[](${lanes});
assembly ("memory-safe"){let frameStart:=frames.offset ${calculation('calldataload')}}}
function tileCode(address store,bytes32 expectedHash,uint256 groups,bytes calldata x) external view returns(int256[] memory result){
require(groups<=${groupCap}&&x.length==groups*64&&store.codehash==expectedHash&&expectedHash!=bytes32(0));
bytes memory data=store.code;require(data.length==groups*${frameStride}+1&&data[0]==bytes1(0));
result=new int256[](${lanes});
assembly ("memory-safe"){let frameStart:=add(data,33) ${calculation('mload')}}}
}`;
if(options['check-source']==='true'){
const archived=fs.readFileSync(ROOT+outputSource,'utf8');
fs.writeFileSync(ROOT+'candidates/generated-check.sol',source);
console.log(JSON.stringify({file:outputSource,exact_match:source===archived,generated_sha256:crypto.createHash('sha256').update(source).digest('hex'),archived_sha256:crypto.createHash('sha256').update(archived).digest('hex')}));
process.exit(source===archived?0:1);
}
if(process.argv[1]===fileURLToPath(import.meta.url))fs.writeFileSync(ROOT+outputSource,source);

export function packItems(items,groups){
const frames=Buffer.alloc(groups*frameStride);
for(let g=0;g<groups;g++){
 const columns=[];
 for(let j=0;j<32;j++){
  let bits=0n;
  for(let r=0;r<lanes;r++){const b=items[r].w[g*16+(j>>1)],n=(b>>((j&1)*4))&15;bits|=BigInt(n)<<BigInt(r*4);}
  columns.push(bits);
  if(lanes===8)frames.writeUInt32BE(Number(bits),g*frameStride+j*4);
 }
 if(lanes===9)for(let j=0;j<32;j+=2){const bits=(columns[j]<<36n)|columns[j+1];Buffer.from(bits.toString(16).padStart(18,'0'),'hex').copy(frames,g*frameStride+j*9/2);}
 for(let r=0;r<lanes;r++)frames[g*frameStride+coefficientBytes+r]=items[r].s[g];
}
return frames;
}
export function tile(seed,groups,kind='dense'){
const items=Array.from({length:lanes},(_,r)=>fixture((seed+r*0x49f21)>>>0,groups,kind));
for(const c of items)c.x=items[0].x;
const frames=packItems(items,groups);
// Verify the packing transform is exactly reversible, including scale alignment.
for(let r=0;r<lanes;r++)for(let g=0;g<groups;g++){
 assert.equal(frames[g*frameStride+coefficientBytes+r],items[r].s[g]);
 for(let j=0;j<32;j++){
 const bits=lanes===8?BigInt(frames.readUInt32BE(g*frameStride+j*4)):(BigInt(frames.readUIntBE(g*frameStride+Math.floor(j*9/2),5))>>BigInt(j%2?0:4))&0xfffffffffn;
 assert.equal(Number((bits>>BigInt(r*4))&15n),(items[r].w[g*16+(j>>1)]>>((j&1)*4))&15);
 }
}
return {items,frames,x:operands(items[0])[2],expected:items.map(reference)};
}

async function main(){
const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',chainId:31337},miner:{blockGasLimit:100_000_000},wallet:{totalAccounts:1}});
const provider=new BrowserProvider(local);provider.pollingInterval=10;const signer=await provider.getSigner();
const deploy=async build=>{const c=await new ContractFactory(build.abi,build.evm.bytecode.object,signer).deploy();await c.waitForDeployment();return c;};
const report={status:'RUNNING_SYNTHETIC_LANES',lanes,spacing,decoder:polynomial?'polynomial':'boolean',started_at:new Date().toISOString(),synthetic_only:true,
source_sha256:crypto.createHash('sha256').update(source).digest('hex'),candidates:[],validation:{cases:0,invalid_rejections:0,packing_roundtrip:true},
limits:[`Exactly ${lanes} output rows and <=${groupCap} groups; not a complete model or router.`,
'All weights and activations synthetic. Lossless layout transform only; no GPT-OSS quality evaluation.',
'Predeployed-code cost excludes one-time shard creation, which is recorded separately.']};
const save=()=>fs.writeFileSync(ROOT+'evidence/'+outputReport,JSON.stringify(report,null,2)+'\n');
async function send(method,args){const tx=await method.populateTransaction(...args);const sent=await signer.sendTransaction({...tx,gasLimit:90_000_000});const receipt=await sent.wait();assert.equal(receipt.status,1);return {gas:Number(receipt.gasUsed),calldata_bytes:(tx.data.length-2)/2};}
async function dataStore(frames){const runtime=Buffer.concat([Buffer.from([0]),frames]);assert(runtime.length<=24576);const len=runtime.length.toString(16).padStart(4,'0');const tx=await signer.sendTransaction({data:'0x61'+len+'61000f60003961'+len+'6000f3'+runtime.toString('hex'),gasLimit:20_000_000});const receipt=await tx.wait();assert.equal(receipt.status,1);return {address:receipt.contractAddress,hash:keccak256(runtime),deployment_gas:Number(receipt.gasUsed),runtime_bytes:runtime.length};}
let best;
const training=tile(0x764522,90);
for(const runs of [1,200,1000,10000,100000,1000000]){
 const e={runs};
 try{const build=compile(source,runs,true,'LaneMxfp4'),contract=await deploy(build);assert.deepEqual(Array.from(await contract.tile(hexlify(training.frames),training.x)),training.expected);report.validation.cases++;e.gas=(await send(contract.tile,[hexlify(training.frames),training.x])).gas;e.runtime_bytes=build.evm.deployedBytecode.object.length/2;e.status='PASS';if(!best||e.gas<best.entry.gas)best={entry:e,contract,build};}
 catch(error){e.status='FAIL';e.error=String(error);}
 report.candidates.push(e);report.winner=best?.entry;save();console.log(JSON.stringify({stage:'lane_candidate',...e}));
}
assert(best,'No lane candidate passed');
report.benchmarks=[];
const old=await deploy(compile(fs.readFileSync(ROOT+'Mxfp4Kernel.sol','utf8'),200,true,'Mxfp4Kernel'));
for(const kind of ['dense','sparse','zeroInputs','zeroWeights','positiveBound','negativeBound']){
 const c=tile(0x712373,90,kind);assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),c.expected);report.validation.cases++;
 const store=await dataStore(c.frames),args=[store.address,store.hash,90,c.x];assert.deepEqual(Array.from(await best.contract.tileCode(...args)),c.expected);report.validation.cases++;
 let previous=0;for(const item of c.items)previous+=(await send(old.packed,operands(item))).gas;
 const calldata=await send(best.contract.tile,[hexlify(c.frames),c.x]),code=await send(best.contract.tileCode,args);
 const entry={kind,rows:lanes,groups:90,previous_scalar_transactions_gas:previous,tile_calldata:calldata,tile_code:code,store,
 reduction_vs_previous_eight_transactions_percent:100*(previous-code.gas)/previous,
 amortization_calls_vs_tile_calldata:calldata.gas>code.gas?Math.ceil(store.deployment_gas/(calldata.gas-code.gas)):null};
 report.benchmarks.push(entry);save();console.log(JSON.stringify({stage:'lane_bench',...entry}));
}
// Exhaust every encoded byte in each adjacent lane pair and every supported scale.
for(let scale=96;scale<=160;scale++)for(let byte=0;byte<256;byte++){
 const c=tile(0x3281,1);
 for(let r=0;r<lanes;r++){
  c.items[r].w.fill((r%2?byte>>4:byte&15)*17);c.items[r].s[0]=scale;
 }
 c.frames=packItems(c.items,1);
 const expected=c.items.map(reference);assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),expected);report.validation.cases++;
 if(byte===255&&scale%8===0){save();console.log(JSON.stringify({stage:'lane_exhaustive',scale,cases:report.validation.cases}));}
}
report.validation.exhaustive_byte_scale_cases=16640;
for(const kind of ['positiveBound','negativeBound','dense']){
 const c=tile(0x776755,groupCap,kind);assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),c.expected);const store=await dataStore(c.frames);assert.deepEqual(Array.from(await best.contract.tileCode(store.address,store.hash,groupCap,c.x)),c.expected);report.validation.cases+=2;
}
const invalid=tile(71,1);invalid.frames[coefficientBytes+6]=95;
await assert.rejects(best.contract.tile(hexlify(invalid.frames),invalid.x));report.validation.invalid_rejections++;
const badStore=await dataStore(invalid.frames);await assert.rejects(best.contract.tileCode(badStore.address,badStore.hash,1,invalid.x));report.validation.invalid_rejections++;
await assert.rejects(best.contract.tile('0x00','0x'));report.validation.invalid_rejections++;
const c1=tile(1,1);await assert.rejects(best.contract.tile(hexlify(c1.frames),'0x'));report.validation.invalid_rejections++;
const over=tile(1,groupCap+1);await assert.rejects(best.contract.tile(hexlify(over.frames),over.x));report.validation.invalid_rejections++;
const goodStore=await dataStore(c1.frames);await assert.rejects(best.contract.tileCode(goodStore.address,'0x'+'00'.repeat(32),1,c1.x));report.validation.invalid_rejections++;
let index=0,last=Date.now();
while(Date.now()<deadline){
 const groups=[0,1,2,3,7,8,16,31,64,90,128,groupCap][index%12],kind=['dense','dense','sparse','zeroWeights','zeroInputs','positiveBound','negativeBound'][Math.floor(index/12)%7];
 const c=tile((0x759ff+Math.imul(index+1,0x9e3779b9))>>>0,groups,kind);
 assert.deepEqual(Array.from(await best.contract.tile(hexlify(c.frames),c.x)),c.expected);report.validation.cases++;index++;report.validation.fuzz_cases=index;
 if(Date.now()-last>30000){save();console.log(JSON.stringify({stage:'lane_fuzz',cases:report.validation.cases,fuzz:index,remaining_seconds:Math.round((deadline-Date.now())/1000)}));last=Date.now();}
}
report.status=`PASS_SYNTHETIC_${lanes}_LANE_TILE`;report.finished_at=new Date().toISOString();save();await local.disconnect();console.log(JSON.stringify({stage:'lane_complete',cases:report.validation.cases,winner:best.entry}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{fs.writeFileSync(ROOT+'evidence/'+(lanes===9?'nine-lane-failure.json':polynomial?'lane-v2-failure.json':'lane-failure.json'),JSON.stringify({error:String(e),stack:e.stack},null,2)+'\n');console.error(e);process.exitCode=1;});
