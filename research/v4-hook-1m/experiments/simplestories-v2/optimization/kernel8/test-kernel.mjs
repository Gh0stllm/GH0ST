import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {JsonRpcProvider, ContractFactory} from 'ethers';
const dir=path.dirname(new URL(import.meta.url).pathname);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ss8-kernel-'));
const anvil=spawn('/Users/abhijith/.foundry/bin/anvil',['--host','127.0.0.1','--port','18554','--chain-id','31337','--hardfork','cancun','--gas-limit','32000000','--quiet','--no-cors','--disable-console-log'],{cwd:tmp,env:{PATH:process.env.PATH},stdio:'ignore'});
const rpc=new JsonRpcProvider('http://127.0.0.1:18554',31337,{staticNetwork:true});
let rng=428191;
function random(){rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng;}
function encRow(ws){const words=[];for(let off=0;off<ws.length;off+=8){let n=0n;for(let i=0;i<8;i++)n|=(BigInt(ws[off+i]??0)+2048n)<<BigInt(i*32);words.push(n.toString(16).padStart(64,'0'));}const sum=ws.reduce((a,b)=>a+BigInt(b),0n);words.push(BigInt.asUintN(256,sum).toString(16).padStart(64,'0'));return '0x'+words.join('');}
try{
 for(let i=0;i<100;i++){try{if(await rpc.send('eth_chainId',[])==='0x7a69')break;}catch{}await new Promise(r=>setTimeout(r,50));}
 if(await rpc.send('eth_chainId',[])!=='0x7a69')throw Error('Wrong local chain');
 const c=JSON.parse(fs.readFileSync(path.join(dir,'Swar8KernelProbe.compiled.json')));
 const contract=await new ContractFactory(c.abi,c.evm.bytecode.object,await rpc.getSigner(0)).deploy();await contract.waitForDeployment();
 const results=[];
 for(const n of [1,7,8,9,128,341])for(const mode of ['bounded','full32','boundary'])for(let trial=0;trial<3;trial++){
  const ws=Array.from({length:n},()=>Number(random()%4096)-2048);
  const xs=Array.from({length:n},(_,i)=>mode==='bounded'?Number(random()%131072)-65536:mode==='full32'?Number(random()|0):[-2147483648,-65537,-65536,65535,65536,2147483647,0][i%7]);
  const expected=ws.reduce((a,w,i)=>a+BigInt(w)*BigInt(xs[i]),0n);
  const [actual,fast]=await contract.dot(encRow(ws),xs);
  if(actual!==expected)throw Error(`Parity failed ${n} ${mode} ${actual} != ${expected}`);
  const expectedFast=xs.every(x=>x>=-65536&&x<=65535);
  if(fast!==expectedFast)throw Error('Wrong guard result');
  results.push({length:n,mode,trial,fast,parity:true});
 }
 const report={status:'PASS',chainId:31337,localhost:'127.0.0.1:18554',forking:false,cases:results.length,results};
 fs.writeFileSync(path.join(dir,'kernel-boundary-tests.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases}));
}finally{rpc.destroy();anvil.kill('SIGTERM');fs.rmSync(tmp,{recursive:true,force:true});}
