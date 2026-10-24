import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {JsonRpcProvider,ContractFactory} from 'ethers';
const dir=path.dirname(new URL(import.meta.url).pathname),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ss-cache-proof-'));
const node=spawn('/Users/abhijith/.foundry/bin/anvil',['--host','127.0.0.1','--port','18554','--chain-id','31337','--hardfork','cancun','--gas-limit','32000000','--quiet','--no-cors','--disable-console-log'],{cwd:tmp,env:{PATH:process.env.PATH},stdio:'ignore'});
const rpc=new JsonRpcProvider('http://127.0.0.1:18554',31337,{staticNetwork:true});rpc.pollingInterval=50;
function values(layer,position,kind){return Array.from({length:64},(_,i)=>[(-2147483648),(2147483647),-1,0,1,-65537,65536,(Math.imul(layer*1024+position*64+i+1,1664525)+(kind+1)*1013904223)|0][i%8]);}
try{
 for(let i=0;i<100;i++){try{if(await rpc.send('eth_chainId',[])==='0x7a69')break;}catch{}await new Promise(r=>setTimeout(r,50));}
 if(await rpc.send('eth_chainId',[])!=='0x7a69')throw Error('Wrong localchain');
 const a=JSON.parse(fs.readFileSync(path.join(dir,'CachePackingProbe.compiled.json'))),signer=await rpc.getSigner(0);const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy();await c.waitForDeployment();
 let slots=0;
 for(let position=0;position<16;position++)for(let layer=0;layer<4;layer++){
  const tx=await c.put(layer,position,values(layer,position,0),values(layer,position,1));await tx.wait();slots+=16;
 }
 let checked=0;
 for(let layer=0;layer<4;layer++){
  const [keys,vals]=await c.get(layer,16);
  for(let position=0;position<16;position++)for(let i=0;i<64;i++){
   if(keys[position*64+i]!==BigInt(values(layer,position,0)[i])||vals[position*64+i]!==BigInt(values(layer,position,1)[i]))throw Error(`Mismatch ${layer}/${position}/${i}`);checked+=2;
  }
 }
 const report={status:'PASS',chainId:31337,loopback:'127.0.0.1:18554',forking:false,storageWords:slots,exactInt32ValuesVerified:checked,positions:16,layers:4,includes:['int32 minimum','int32 maximum','negative values','zero','positive values','distinct layers and positions']};fs.writeFileSync(path.join(dir,'cache-packing-proof.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{rpc.destroy();node.kill('SIGTERM');fs.rmSync(tmp,{recursive:true,force:true});}
