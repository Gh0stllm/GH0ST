import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../chess/package.json',import.meta.url));
const solc = require('solc');
const { Interface, getAddress, id, formatEther, toQuantity } = require('ethers');
const url = 'https://rpc.mainnet.chain.robinhood.com';
const genesis = '0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c';
const address = getAddress('0x'+id('mp1-fixed-arithmetic-simulation-20261123').slice(-40));
const gasLimit = 32_000_000;
const Q16 = 65536n;
const Q24 = 16777216n;

const table = Array.from({length:257},(_,i)=>BigInt(Math.round(2**24*2**(-i/256))));
function expNegative(x) {
  const value = x*94548n/Q16;
  const shift = value>>16n;
  if (shift>=25n) return 0n;
  const index = Number((value>>8n)&255n);
  const rem = value&255n;
  return ((table[index]*(256n-rem)+table[index+1]*rem)>>8n)>>shift;
}
function isqrt(value) {
  let x = value;
  let next = (value+1n)/2n;
  while (next<x) {
    x = next;
    next = (x+value/x)/2n;
  }
  return x;
}
function normReference(input,gain,bias) {
  const width = BigInt(input.length);
  const mean = input.reduce((sum,next)=>sum+next,0n)/width;
  const centered = input.map(x=>x-mean);
  const variance = centered.reduce((sum,next)=>sum+next*next,0n)/width;
  const sigma = isqrt(variance+42950n);
  return centered.map((x,i)=>x*gain[i]/sigma+bias[i]);
}
function attentionReference(query,keys,values) {
  const tokens = keys.length/48;
  const scores = Array.from({length:tokens},(_,j)=>
    (query.reduce((acc,q,c)=>acc+q*keys[48*j+c],0n)/Q16)*2421583n/Q24
  );
  const max = scores.reduce((high,next)=>high>next?high:next);
  const weights = scores.map(x=>expNegative(max-x));
  const sum = weights.reduce((a,b)=>a+b,0n);
  return query.map((_,c)=>weights.reduce((acc,w,j)=>acc+w*values[48*j+c],0n)/sum);
}
function bytes(values) {
  const output=Buffer.alloc(values.length*4);
  values.forEach((value,i)=>output.writeInt32LE(Number(value),i*4));
  return '0x'+output.toString('hex');
}
function sequence(n,seed,amplitude=131_072) {
  let x = seed>>>0;
  return Array.from({length:n},()=>{
    x = (Math.imul(x,1664525)+1013904223)>>>0;
    return BigInt(x%(2*amplitude+1)-amplitude);
  });
}
const x = sequence(192,31);
const gain = sequence(192,56,20_000).map(value=>value+Q16);
const bias = sequence(192,93,5_000);
const query=sequence(48,42),keys=sequence(269*48,58),values=sequence(269*48,209);
const latent=sequence(1024,501),conditional=sequence(1024,407),unconditional=sequence(1024,293);
const step=6n, t=300n-step*19n, next=t-19n;
const expectedStep = latent.map((z,i)=>(next*z+19n*((3n*conditional[i]-unconditional[i])/2n))/t);
const silu = x.map(v=>{
  const exp=expNegative(v>=0n?v:-v);
  return v*(v>=0n?Q24:exp)/(Q24+exp);
});
const cases=[
  {id:'normalize',args:[bytes(x),bytes(gain),bytes(bias)],expected:bytes(normReference(x,gain,bias)),shape:[192]},
  {id:'silu',args:[bytes(x)],expected:bytes(silu),shape:[192]},
  {id:'attention',args:[bytes(query),bytes(keys),bytes(values)],expected:bytes(attentionReference(query,keys,values)),shape:[269,48]},
  {id:'euler',args:[bytes(latent),bytes(conditional),bytes(unconditional),Number(step)],expected:bytes(expectedStep),shape:[1024]},
];

const vectorRoot = new URL('../reference/evidence/', import.meta.url);
const vectors = JSON.parse(await readFile(new URL('vectors.json',vectorRoot),'utf8'));
const attentionKv = await readFile(new URL('attention-kv.bin',vectorRoot));
const eulerStep = await readFile(new URL('euler-first-step.bin',vectorRoot));
assert.equal(attentionKv.length,103296);
assert.equal(eulerStep.length,16384);
const hex = source=>'0x'+source.toString('hex');
cases.push(
  {id:'normalize',fixture:'authentic-blue-crystal',shape:[192],args:[vectors.norm1.inputQ16,vectors.norm1.gammaQ16,vectors.norm1.biasQ16].map(bytes),expected:bytes(vectors.norm1.outputQ16)},
  {id:'attention',fixture:'authentic-blue-crystal',shape:[269,48],args:[bytes(vectors.attention.query),hex(attentionKv.subarray(0,51648)),hex(attentionKv.subarray(51648))],expected:bytes(vectors.attention.outputQ16)},
  {id:'attentionBatch',fixture:'repeated-authentic-blue-crystal-query',shape:[4,269,48],args:[bytes(Array.from({length:4},()=>vectors.attention.query).flat()),hex(attentionKv.subarray(0,51648)),hex(attentionKv.subarray(51648))],expected:bytes(Array.from({length:4},()=>vectors.attention.outputQ16).flat())},
  {id:'euler',fixture:'authentic-blue-crystal',shape:[1024],args:[...Array.from({length:3},(_,i)=>hex(eulerStep.subarray(i*4096,(i+1)*4096))),0],expected:hex(eulerStep.subarray(12288))},
);

const code=await readFile(new URL('./Mp1Fixed.sol',import.meta.url),'utf8');
const compiled=JSON.parse(solc.compile(JSON.stringify({
  language:'Solidity',sources:{'Mp1Fixed.sol':{content:code}},
  settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.deployedBytecode.object']}}},
})));
assert(!(compiled.errors??[]).some(entry=>entry.severity==='error'),JSON.stringify(compiled.errors));
const runtime=compiled.contracts['Mp1Fixed.sol'].Mp1Fixed;
const abi=new Interface(runtime.abi);
const override={[address]:{code:'0x'+runtime.evm.deployedBytecode.object}};
let requestId=0;
async function rpc(method,params=[]) {
  assert(['eth_chainId','eth_getBlockByNumber','eth_gasPrice','eth_getCode','eth_call','eth_estimateGas'].includes(method));
  const id=++requestId;
  const res=await fetch(url,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),
    redirect:'error',signal:AbortSignal.timeout(20_000),
  });
  const reply=await res.json();
  if(!res.ok||reply.error||reply.id!==id||!Object.hasOwn(reply,'result'))throw Error(method+' '+(reply.error?.message??res.status));
  return reply.result;
}

const [chain,first,block,gasPrice]=await Promise.all([
  rpc('eth_chainId'),rpc('eth_getBlockByNumber',['0x0',false]),rpc('eth_getBlockByNumber',['latest',false]),rpc('eth_gasPrice'),
]);
assert.equal(chain,'0x1237');
assert.equal(first.hash,genesis);
assert.equal(await rpc('eth_getCode',[address,block.number]),'0x');
const rows=[];
for(const {id,fixture='synthetic',shape,args,expected} of cases){
  const tx={to:address,data:abi.encodeFunctionData(id,args),gas:toQuantity(gasLimit)};
  const raw=await rpc('eth_call',[tx,block.number,override]);
  assert.equal(abi.decodeFunctionResult(id,raw)[0],expected,'Reference output mismatch for '+id);
  const gas=BigInt(await rpc('eth_estimateGas',[tx,block.number,override]));
  rows.push({id,fixture,shape,calldataBytes:(tx.data.length-2)/2,estimatedGas:Number(gas),feeETH:formatEther(gas*BigInt(gasPrice)),matched:true});
}
assert.equal((await rpc('eth_getBlockByNumber',[block.number,false])).hash,block.hash);
const evidence={
  scope:'Read-only Robinhood state override for individual fixed-point operations using synthetic and authentic M-P1 tensors.',
  chainId:4663,block:Number(BigInt(block.number)),blockHash:block.hash,gasPriceWei:String(BigInt(gasPrice)),
  runtimeBytes:runtime.evm.deployedBytecode.object.length/2,results:rows,
};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
