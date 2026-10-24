import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {ContractFactory,JsonRpcProvider} from 'ethers';
const dir=path.dirname(new URL(import.meta.url).pathname),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ss-dense-proof-'));
const child=spawn('/Users/abhijith/.foundry/bin/anvil',['--host','127.0.0.1','--port','18554','--chain-id','31337','--hardfork','cancun','--gas-limit','32000000','--quiet','--no-cors','--disable-console-log'],{cwd:tmp,env:{PATH:process.env.PATH},stdio:'ignore'});
const p=new JsonRpcProvider('http://127.0.0.1:18554',31337,{staticNetwork:true,cacheTimeout:-1});p.pollingInterval=10;
try{
 for(let i=0;i<100;i++){try{if(await p.send('eth_chainId',[])==='0x7a69')break;}catch{}await new Promise(r=>setTimeout(r,50));}
 if(await p.send('eth_chainId',[])!=='0x7a69')throw Error('Wronglocalchain');
 const a=JSON.parse(fs.readFileSync(path.join(dir,'dense-probe.compiled.json'))),c=await new ContractFactory(a.abi,a.evm.bytecode.object,await p.getSigner(0)).deploy();await c.waitForDeployment();
 const weights=fs.readFileSync(path.join(dir,'model/weights.bin'));const map=JSON.parse(fs.readFileSync(path.join(dir,'model/packed_offsets.json')));const cases=[];
 for(const name of ['model.layers.0.self_attn.q_proj.weight','model.layers.0.mlp.gate_proj.weight','model.layers.0.mlp.down_proj.weight','model.embed_tokens.weight']){
  const info=Object.values(map.matrices).find(x=>x.name===name);const rows=Math.min(info.rows,341);const data='0x'+weights.subarray(info.offset,info.offset+rows*info.row_stride).toString('hex');
  const input=Array.from({length:info.columns},(_,i)=>(i%2===0?1:-1)*(i%7===0?65535:32768));
  const args=[data,rows,info.columns,input];const slow=await c.baseline.staticCall(...args),fast=await c.optimized.staticCall(...args);if(slow.toString()!==fast.toString())throw Error('Parityfailed:'+name);
  const slowGas=await c.baseline.estimateGas(...args),fastGas=await c.optimized.estimateGas(...args);cases.push({name,rows,columns:info.columns,parity:true,baselineGas:String(slowGas),optimizedGas:String(fastGas),reductionPercent:100*(1-Number(fastGas)/Number(slowGas))});
 }
 const report={status:'PASS',chainId:31337,loopback:'127.0.0.1:18554',cases};fs.writeFileSync(path.join(dir,'dense-benchmark.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{p.destroy();child.kill('SIGTERM');fs.rmSync(tmp,{recursive:true,force:true});}
