import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import solc from 'solc';
import {JsonRpcProvider,ContractFactory,keccak256} from 'ethers';
const dir=path.dirname(new URL(import.meta.url).pathname), url='http://127.0.0.1:18557';
const source=fs.readFileSync(path.join(dir,'RmsKernels.sol'),'utf8');
const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}};
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'RmsKernels.sol':{content:source}},settings})));
assert(!(compiled.errors??[]).some(x=>x.severity==='error'),JSON.stringify(compiled.errors));
const artifact=compiled.contracts['RmsKernels.sol'].RmsKernels;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ss-norm-'));
const child=spawn('/Users/abhijith/.foundry/bin/anvil',['--host','127.0.0.1','--port','18557','--chain-id','31337','--hardfork','cancun','--quiet'],{cwd:tmp,stdio:'ignore',env:{PATH:process.env.PATH}});
let provider;
try {
 provider=new JsonRpcProvider(url,undefined,{cacheTimeout:-1}); provider.pollingInterval=10;
 let ready=false;for(let i=0;i<100;i++){try{assert.equal((await provider.getNetwork()).chainId,31337n);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,50));}assert(ready);
 const signer=await provider.getSigner(0), c=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer).deploy();await c.waitForDeployment();
 let seed=37812682n;const random=()=>{seed=(1664525n*seed+1013904223n)&0xffffffffn;return seed;};const vectors=[];
 for(let k=0;k<64;k++){
  const offset=k%3;let x=Array.from({length:128+offset},()=>Number(BigInt.asIntN(32,random())));
  if(k===0)x.fill(0);if(k===1)x.fill(2147483647);if(k===2)x.fill(-2147483648);if(k===3)x=x.map((_,i)=>i%2?2147483647:-2147483648);
  if(k===4)x=x.map((_,i)=>i===offset?1:0);if(k===5)x=x.map((_,i)=>i===offset?2147483647:0);
  const weightOffset=k%5;const weights=Buffer.alloc(256+weightOffset);for(let i=0;i<128;i++)weights.writeInt16BE(k===1?32767:k===2?-32768:Number(BigInt.asIntN(16,random())),weightOffset+i*2);
  const args=[x,offset,'0x'+weights.toString('hex'),weightOffset];
  const slow=Array.from(await c.slow(...args)),fast=Array.from(await c.fast(...args));assert.deepEqual(fast,slow);
  vectors.push({case:k,offset,weightOffset,resultHash:keccak256(Buffer.from(fast.map(String).join(',')))});
 }
 const args=[Array(128).fill(4096),0,'0x'+Buffer.from(Array(128).fill('1000').join(''),'hex').toString('hex'),0];
 const result={status:'PASS',cases:vectors.length,vectors,sourceSha256:(await import('node:crypto')).createHash('sha256').update(source).digest('hex'),slowGas:String(await c.slow.estimateGas(...args)),fastGas:String(await c.fast.estimateGas(...args)),network:'isolated Anvil31337',mainnetTransactions:0};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,cases:result.cases,slowGas:result.slowGas,fastGas:result.fastGas}));
}finally{if(provider)await provider.destroy();child.kill('SIGTERM');fs.rmSync(tmp,{recursive:true,force:true});}
