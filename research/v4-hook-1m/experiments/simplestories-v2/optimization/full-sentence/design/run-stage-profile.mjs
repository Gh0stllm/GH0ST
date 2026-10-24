import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import crypto from 'node:crypto';
import solc from 'solc';import {JsonRpcProvider,ContractFactory} from 'ethers';
const root=path.resolve('experiments/simplestories-v2/optimization/full-sentence'),dir=path.join(root,'design');
const source=fs.readFileSync(path.join(dir,'SimpleStoriesStageProfile.sol'),'utf8');
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'P.sol':{content:source}},settings:{viaIR:true,optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
const errors=compiled.errors?.filter(x=>x.severity==='error')??[];if(errors.length)throw Error(errors.map(x=>x.formattedMessage).join('\n'));
const artifact=compiled.contracts['P.sol'].SimpleStoriesV2Model;
const url='http://127.0.0.1:18565';let id=0;
async function rpc(method,params=[]){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const x=await r.json();if(x.error)throw Error(x.error.message);return x.result;}
try{await rpc('eth_chainId');throw Error('Port18565 already occupied');}catch(e){if(e.message==='Port18565 already occupied')throw e;}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gh0st-stage-profile-'));
const child=spawn('/Users/abhijith/.foundry/bin/anvil',['--host','127.0.0.1','--port','18565','--chain-id','31337','--hardfork','cancun','--gas-limit','200000000','--code-size-limit','24576','--quiet','--no-cors','--disable-console-log'],{cwd:temp,env:{PATH:process.env.PATH},stdio:'ignore'});
let provider;
try{
 let ready=false;for(let i=0;i<100;i++){try{if(await rpc('eth_chainId')==='0x7a69'){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}if(!ready)throw Error('Anvil startup failed');
 provider=new JsonRpcProvider(url,undefined,{staticNetwork:true});provider.pollingInterval=10;
 const modelDir=path.resolve('experiments/simplestories-v2/optimization/kernel8/model');
 const groups={};
 for(const [name,base] of [['weights',65536],['tables',131072]]){
  const blob=fs.readFileSync(path.join(modelDir,name+'.bin'));groups[name]=[];const tasks=[];
  for(let pos=0,index=0;pos<blob.length;pos+=24000,index++){
   const address='0x'+(base+index).toString(16).padStart(40,'0');groups[name].push(address);
   const code='0x00'+blob.subarray(pos,pos+24000).toString('hex');
   tasks.push(async()=>{await rpc('anvil_setCode',[address,code]);if(await rpc('eth_getCode',[address,'latest'])!==code)throw Error('Shard mismatch');});
  }
  for(let i=0;i<tasks.length;i+=20)await Promise.all(tasks.slice(i,i+20).map(f=>f()));
 }
 const c=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,await provider.getSigner(0)).deploy(groups.weights,groups.tables,{gasLimit:32000000});await c.waitForDeployment();
 const refs=JSON.parse(fs.readFileSync(path.join(root,'quality/reference.json'))).cases;
 const quote=refs.find(x=>x.prompt_ids.length===1&&x.prompt_ids[0]===3);if(!quote)throw Error('Missing quote reference');
 const measurements=[];
 for(const test of [{name:'one-token',ids:[85],cap:1,expected:[307]}, {name:'quote-sentence',ids:quote.prompt_ids,cap:16,expected:quote.output_ids,hash:quote.steps.at(-1).logit_hash}]){
  const returned=await c.profileSentence.staticCall(test.ids,test.cap,{gasLimit:200000000});
  if(JSON.stringify(returned[0].map(Number))!==JSON.stringify(test.expected))throw Error('Token mismatch '+test.name);
  if(test.hash&&returned[3]!==test.hash)throw Error('Hash mismatch '+test.name);
  const receipt=await(await c.profileSentence(test.ids,test.cap,{gasLimit:200000000})).wait();
  const values=[];for(let i=0;i<8;i++)values.push(Number(await c.stageGas(i)));
  measurements.push({name:test.name,tokens:returned[0].map(Number),endedEos:returned[1],endedSentence:returned[2],logitHash:returned[3],receiptGas:Number(receipt.gasUsed),stages:['transformer_linear','rms','rope','attention','silu_and_residual','vocabulary_head','embedding','total'],gas:values,notes:'Profiling storage writes add overhead; use actual noninstrumented v4 transactions for cost claims.'});
 }
 const report={localOnly:true,chainId:31337,port:18565,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),runtimeBytes:artifact.evm.deployedBytecode.object.length/2,measurements};
 fs.writeFileSync(path.join(dir,'stage-profile.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{if(provider)provider.destroy();try{await rpc('evm_setBlockGasLimit',['0x1e84800']);}catch{}child.kill('SIGTERM');await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));fs.rmSync(temp,{recursive:true,force:true});}
