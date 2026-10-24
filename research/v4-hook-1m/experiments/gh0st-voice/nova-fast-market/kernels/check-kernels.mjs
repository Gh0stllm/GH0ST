// Independent local EVM checks for arithmetic-only kernels. No external RPC.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import solc from 'solc';
import hre from 'hardhat';
import * as ethers from 'ethers';
const here=path.dirname(fileURLToPath(import.meta.url));
const original=fs.readFileSync(path.join(here,'baseline.sol'),'utf8');
const candidate=fs.readFileSync(path.join(here,process.argv[2]??'assembly-unrolled.sol'),'utf8');
const sha=x=>createHash('sha256').update(x).digest('hex');
const constant=(src,name)=>src.match(new RegExp(name+'=hex"([a-f0-9]+)"'))[1];
const oldDelta=constant(original,'SIGMOID_DELTA');
const newValues=constant(candidate,'SIGMOID_DELTA');
const table=Buffer.from(oldDelta,'hex'), fastTable=Buffer.from(newValues,'hex');
assert.equal(table.length,514);assert.equal(fastTable.length,1028);
const slow=x=>{const i=Math.min(256,Math.floor((Math.abs(x)+32)/64));return Math.floor(((x<0?32768-table.readUInt16BE(i*2):32768+table.readUInt16BE(i*2))+32)/64);};
const fast=x=>{const i=Math.min(256,Math.floor((Math.abs(x)+32)/64));return fastTable.readUInt16BE((x<0?514:0)+i*2);};
for(let x=-32768;x<=32768;x++)assert.equal(slow(x),fast(x));
for(const x of [-2147483648,-10485760,-1048576,-16385,16385,1048576,10485760,2147483647])assert.equal(slow(x),fast(x));
const sampleOld=original.slice(original.indexOf(' function _sample('),original.indexOf(' function word(')).replace('_sample(','_sampleOld(');
const sampleNew=candidate.slice(candidate.indexOf(' function _sample('),candidate.indexOf(' function word(')).replace('_sample(','_sampleNew(');
const src=`pragma solidity 0.8.30;
contract Kernels {
error InvalidInput();
bytes private constant EXP_Q32=hex"${constant(original,'EXP_Q32')}";
bytes private constant OLD=hex"${oldDelta}";
bytes private constant FAST=hex"${newValues}";
function oldSigmoid(int256 x,bytes memory d) private pure returns(int256 result){
assembly("memory-safe") {
let a:=x if slt(x,0){a:=sub(0,x)}
let index:=shr(6,add(a,32)) if gt(index,256){index:=256}
let delta:=shr(240,mload(add(add(d,32),shl(1,index))))
let value:=add(32768,delta) if slt(x,0){value:=sub(32768,delta)}
result:=shr(6,add(value,32))
}}
function newSigmoid(int256 x,bytes memory d) private pure returns(int256 result){
assembly("memory-safe") {
let a:=x let neg:=0 if slt(x,0){a:=sub(0,x) neg:=514}
let index:=shr(6,add(a,32)) if gt(index,256){index:=256}
result:=shr(240,mload(add(add(d,32),add(neg,mul(index,2)))))
}}
function checkSigmoid(int256 start,uint256 count) external pure returns(bool){bytes memory a=OLD;bytes memory b=FAST;for(uint256 i;i<count;i++){int256 x=start+int256(i);require(oldSigmoid(x,a)==newSigmoid(x,b),"sigmoid mismatch");}return true;}
${sampleOld}
${sampleNew}
function checkSample(int256[197] memory scores,uint256 start,uint256 count,uint256 temperature,uint256 entropy) external pure returns(uint256 result){result=_sampleOld(scores,start,count,temperature,entropy);require(result==_sampleNew(scores,start,count,temperature,entropy),"sample mismatch");}
}`;
fs.writeFileSync(path.join(here,'KernelChecks.sol'),src);
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'K.sol':{content:src}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
const errors=(compiled.errors??[]).filter(e=>e.severity==='error');assert.equal(errors.length,0,errors.map(e=>e.formattedMessage).join('\n'));
const artifact=compiled.contracts['K.sol'].Kernels;
assert(artifact.evm.deployedBytecode.object.length/2<=24576);assert(artifact.evm.bytecode.object.length/2<=49152);
const rpc=(m,p=[])=>hre.network.provider.request({method:m,params:p});
const report={status:'RUNNING',scope:'UNFORKED_LOCAL_ONLY',publicTransactions:0,baselineSourceSha256:sha(original),candidateSourceSha256:sha(candidate),pythonEquivalentSigmoidComparisons:65545,evmSigmoidComparisons:0,evmSampleComparisons:0};
const save=()=>fs.writeFileSync(path.join(here,'kernel-checks.json'),JSON.stringify(report,null,2)+'\n');
try {
hre.config.networks.hardhat.blockGasLimit=32000000;await rpc('hardhat_reset');assert.equal(await rpc('eth_chainId'),'0x7a69');const [from]=await rpc('eth_accounts');
const iface=new ethers.Interface(artifact.abi);
const deploy=await rpc('eth_sendTransaction',[{from,data:'0x'+artifact.evm.bytecode.object,gas:'0x1e84800'}]);const receipt=await rpc('eth_getTransactionReceipt',[deploy]);assert.equal(receipt.status,'0x1');
const call=async(name,args)=>iface.decodeFunctionResult(name,await rpc('eth_call',[{from,to:receipt.contractAddress,data:iface.encodeFunctionData(name,args),gas:'0x1e84800'},'latest']));
for(let begin=-32768;begin<=32768;begin+=1024){const count=Math.min(1024,32769-begin);assert.equal((await call('checkSigmoid',[begin,count]))[0],true);report.evmSigmoidComparisons+=count;}
for(const x of [-2147483648,-10485760,-1048576,-16385,16385,1048576,10485760,2147483647]){assert.equal((await call('checkSigmoid',[x,1]))[0],true);report.evmSigmoidComparisons++;}
let rng=0x83a95fc7;const next=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return rng>>>0;};
for(let k=0;k<200;k++){
 const count=[128,64,5][k%3],start=[0,128,192][k%3];
 const scores=Array.from({length:197},(_,i)=>k<3?0:k<6?(i%2?-1:1)*1048576:k<9?i*64:(next()%4194305)-2097152);
 const temp=[64,65,128,256,512,1024,2048,4095,4096][k%9];
 const entropy=k<3?0:k<6?ethers.MaxUint256:BigInt(ethers.keccak256(ethers.toUtf8Bytes('N0VA sampling parity '+k)));
 await call('checkSample',[scores,start,count,temp,entropy]);report.evmSampleComparisons++;
}
report.status='PASS';report.saturationProof='For abs(x)>=16352 both use index256; positive table value1024 and negative table value0. All smaller integers are exhaustively covered.';save();console.log(JSON.stringify(report,null,2));
} catch(e){report.status='FAIL';report.error=String(e.stack??e);save();throw e;}
