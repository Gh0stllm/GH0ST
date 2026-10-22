import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory} from 'ethers';
import {fixture,reference,operands,compile} from './session-optimize.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const HASH=s=>crypto.createHash('sha256').update(s).digest('hex');
const LUT='0x000102030406080c00fffefdfcfaf8f400000000000000000000000000000000';
const BIASED='0x0c0d0e0f101214180c0b0a090806040000000000000000000000000000000000';

function helper(mode) {
  let body='';
  for(let j=0;j<8;j++){
    const w=`byte(${j},ww)`,x0=`sar(240,shl(${j*32},xx))`,x1=`sar(240,shl(${j*32+16},xx))`;
    body+=`{let b:=${w}\n`;
    if(mode==='biased')body+=`let a:=${x0}\nlet b1:=${x1}\nsum:=add(sum,add(a,b1))\ndot:=add(dot,add(mul(byte(and(b,15),lut),a),mul(byte(shr(4,b),lut),b1)))\n`;
    else body+=`dot:=add(dot,add(mul(signextend(0,byte(and(b,15),lut)),${x0}),mul(signextend(0,byte(shr(4,b),lut)),${x1})))\n`;
    body+='}\n';
  }
  return `function dot8(ww,xx)->dot { let lut:=${mode==='biased'?BIASED:LUT}\n${mode==='biased'?'let sum:=0':''}\n${body}\n${mode==='biased'?'dot:=sub(dot,mul(12,sum))':''}\n}`;
}

function source(mode) {
  const cached=mode!=='inlineBiased',biased=mode==='biased'||mode==='inlineBiased';
  const h=helper(biased?'biased':'signed');
  // Helper is deliberately tested with normal compiler inlining enabled.
  let dot=`let dot:=add(dot8(calldataload(wp),calldataload(xp)),dot8(calldataload(add(wp,8)),calldataload(add(xp,32))))`;
  if(!cached) dot=`let dot:=0\nlet sum:=0\nlet lut:=${BIASED}\nfor {let j:=0} lt(j,16) {j:=add(j,1)} {let b:=byte(0,calldataload(add(wp,j)))\nlet xx:=calldataload(add(xp,mul(j,4)))\nlet a:=sar(240,xx)\nlet b1:=sar(240,shl(16,xx))\nsum:=add(sum,add(a,b1))\ndot:=add(dot,add(mul(byte(and(b,15),lut),a),mul(byte(shr(4,b),lut),b1)))}\ndot:=sub(dot,mul(12,sum))`;
  return `// SPDX-License-Identifier: MIT\npragma solidity 0.8.30;\ncontract OptimizedMxfp4 {function packed(bytes calldata w,bytes calldata scales,bytes calldata x) external pure returns(int256 result) {require(w.length%16==0&&scales.length==w.length/16&&x.length==w.length*4&&scales.length<=4096);\nassembly ("memory-safe") {${cached?h:''}\nfor {let g:=0} lt(g,scales.length) {g:=add(g,1)} {let s:=byte(0,calldataload(add(scales.offset,g)))\nif or(lt(s,96),gt(s,160)) {revert(0,0)}\nlet wp:=add(w.offset,mul(g,16))\nlet xp:=add(x.offset,mul(g,64))\n${dot}\nresult:=add(result,shl(sub(s,96),dot))}}}}`;
}

async function main(){
const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',chainId:31337},miner:{blockGasLimit:100_000_000},wallet:{totalAccounts:1}});
const provider=new BrowserProvider(local);provider.pollingInterval=10;const signer=await provider.getSigner();
const deploy=async build=>{const c=await new ContractFactory(build.abi,build.evm.bytecode.object,signer).deploy();await c.waitForDeployment();return c;};
const report={status:'RUNNING',started_at:new Date().toISOString(),synthetic_only:true,candidates:[],validation:{cases:0,invalid_rejections:0}};
function save(){fs.writeFileSync(ROOT+'evidence/helper-experiments.json',JSON.stringify(report,null,2)+'\n');}
let best;
const training=[fixture(0x13579,90),fixture(0xbad5eed,90)];
for(const runs of [1,200,1000,10000,100000,1000000])for(const mode of ['signed','biased','inlineBiased']){
 const text=source(mode),entry={mode,runs,source_sha256:HASH(text)};
 try{const build=compile(text,runs,true),contract=await deploy(build);entry.gas=[];
 for(const c of training){const args=operands(c);assert.equal(await contract.packed(...args),reference(c));report.validation.cases++;const tx=await contract.packed.populateTransaction(...args);const sent=await signer.sendTransaction({...tx,gasLimit:90_000_000});entry.gas.push(Number((await sent.wait()).gasUsed));}
 for(const c of [fixture(51,1,'positiveBound'),fixture(52,65,'negativeBound'),fixture(53,4,'zeroInputs')]){assert.equal(await contract.packed(...operands(c)),reference(c));report.validation.cases++;}
 entry.mean=entry.gas.reduce((a,b)=>a+b)/2;entry.runtime_bytes=build.evm.deployedBytecode.object.length/2;entry.status='PASS';
 if(!best||entry.mean<best.entry.mean){best={entry,text,build,contract};fs.writeFileSync(ROOT+'HelperMxfp4.sol',text);}
 }catch(e){entry.status='FAIL';entry.error=String(e);}
 report.candidates.push(entry);report.winner=best?.entry;save();console.log(JSON.stringify({stage:'helper',...entry,best:best?.entry.mean}));
}
assert(best);report.source_sha256=HASH(best.text);report.heldout=[];
for(const kind of ['dense','sparse','zeroInputs','zeroWeights']){const c=fixture(0x80ffee,90,kind),args=operands(c);assert.equal(await best.contract.packed(...args),reference(c));const tx=await best.contract.packed.populateTransaction(...args);const sent=await signer.sendTransaction({...tx,gasLimit:90_000_000});report.heldout.push({kind,gas:Number((await sent.wait()).gasUsed)});report.validation.cases++;}
// Capture opcode counts for the prior implementation and helper candidate.
report.opcode_profiles=[];
for(const [name,text,runs,contractName] of [['previous',fs.readFileSync(ROOT+'Mxfp4Kernel.sol','utf8'),200,'Mxfp4Kernel'],['helper',best.text,best.entry.runs,'OptimizedMxfp4']]){
 const contract=await deploy(compile(text,runs,true,contractName)),tx=await contract.packed.populateTransaction(...operands(fixture(0x80ffee,90)));
 const sent=await signer.sendTransaction({...tx,gasLimit:90_000_000});const receipt=await sent.wait();
 const trace=await local.request({method:'debug_traceTransaction',params:[sent.hash,{disableStorage:true,disableMemory:true,disableStack:true}]});
 const counts={};for(const step of trace.structLogs)counts[step.op]=(counts[step.op]??0)+1;
 report.opcode_profiles.push({name,receipt_gas:Number(receipt.gasUsed),steps:trace.structLogs.length,opcode_counts:counts});
}
save();
// Exhaustive encoded-byte/scale pairs for this independently selected helper candidate.
let last=Date.now();
for(let s=96;s<=160;s++)for(let b=0;b<256;b++){
 const c={w:Buffer.alloc(16,b),s:Buffer.from([s]),x:Array.from({length:32},(_,i)=>i%2?-32768:32767)};
 assert.equal(await best.contract.packed(...operands(c)),reference(c));report.validation.cases++;
 if(Date.now()-last>30000){save();console.log(JSON.stringify({stage:'helper_exhaustive',scale:s,byte:b,cases:report.validation.cases}));last=Date.now();}
}
report.validation.exhaustive_scale_byte_pairs=16640;
for(const kind of ['positiveBound','negativeBound','dense']){const c=fixture(98,4096,kind);assert.equal(await best.contract.packed(...operands(c)),reference(c));report.validation.cases++;}
for(let p=0;p<32;p++){const c=fixture(87123+p,1);c.x.fill(0);c.x[p]=p%2?-32768:32767;assert.equal(await best.contract.packed(...operands(c)),reference(c));report.validation.cases++;}
for(const s of [0,95,161,255]){const c=fixture(1,1);c.s[0]=s;await assert.rejects(best.contract.packed(...operands(c)));report.validation.invalid_rejections++;}
await assert.rejects(best.contract.packed(...operands(fixture(1,4097))));report.validation.invalid_rejections++;
report.status='PASS_SYNTHETIC_HELPER_EXPERIMENTS';report.finished_at=new Date().toISOString();save();await local.disconnect();console.log(JSON.stringify({stage:'helper_complete',winner:best.entry,cases:report.validation.cases}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
