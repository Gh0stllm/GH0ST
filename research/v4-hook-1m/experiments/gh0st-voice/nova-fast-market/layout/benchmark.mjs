// Only unforked chain31337. setCode installs read-only weight data for inference benchmarks.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';import solc from'solc';import hre from'hardhat';import*as ethers from'ethers';
const here=path.dirname(fileURLToPath(import.meta.url)),sha=x=>createHash('sha256').update(x).digest('hex');
const baselineDir=path.resolve(here,'../../nova-optimization/selected');
const names=process.argv.slice(2);if(!names.length)names.push('b25x10a5','b26x9a13','b27x9a28','b28x9a43');
for(const name of names)assert(/^[bs]\d+x\d+a\d+$/.test(name));
const variants=[['baseline',baselineDir],...names.map(name=>[name,path.join(here,name)])];
const report={mode:'UNFORKED_LOCAL_ONLY',publicTransactions:0,modelWeightsUnchanged:true,variants:[],vectors:[]},json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
const save=()=>fs.writeFileSync(path.join(here,'benchmark-'+names.join('-')+'.json'),json(report));
const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
function compile(content){const r=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Model.sol':{content}},settings})));const e=(r.errors||[]).filter(x=>x.severity==='error');assert.equal(e.length,0,e.map(x=>x.formattedMessage).join('\n'));return r.contracts['Model.sol'].GRU2SIMDModel;}
const rpc=(method,params=[])=>hre.network.provider.request({method,params}),GAS=32000000n,hex=ethers.toBeHex;let account;
async function send(req){assert.equal(await rpc('eth_chainId'),'0x7a69');await rpc('hardhat_setNextBlockBaseFeePerGas',['0x0']);const hash=await rpc('eth_sendTransaction',[{from:account,gas:hex(GAS),gasPrice:'0x0',...req}]);const r=await rpc('eth_getTransactionReceipt',[hash]);assert.equal(r.status,'0x1');return r;}
async function main(){
 const artifacts=[];for(const[name,directory]of variants){const source=fs.readFileSync(path.join(directory,'GRU2SIMDModel.sol'),'utf8');artifacts.push({name,directory,source,artifact:compile(source)});console.log('compiled',name);}
 hre.config.networks.hardhat.blockGasLimit=Number(GAS);hre.config.networks.hardhat.throwOnTransactionFailures=false;await rpc('hardhat_reset');assert.equal(await rpc('eth_chainId'),'0x7a69');[account]=await rpc('eth_accounts');
 const groups=['core','groups','words','vocabulary','fused','punctuation'],sets={},dedup=new Map;let next=0x100000n;
 for(const{directory}of artifacts){const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))),catalogs={};
  for(const group of groups){const data=fs.readFileSync(path.join(directory,group+'.bin'));assert.equal(sha(data),manifest.artifacts[group+'.bin'].sha256);const key=sha(data);if(dedup.has(key)){catalogs[group]=dedup.get(key);continue;}const addresses=[];
   for(let i=0;i<data.length;i+=24000){const a=ethers.getAddress(hex(next++,20));await rpc('hardhat_setCode',[a,'0x00'+data.subarray(i,i+24000).toString('hex')]);addresses.push(a);}
   const pages=[];for(let i=0;i<addresses.length;i+=1024){const a=ethers.getAddress(hex(next++,20));await rpc('hardhat_setCode',[a,'0x00'+addresses.slice(i,i+1024).map(x=>x.slice(2)).join('')]);pages.push(a);}const a=ethers.getAddress(hex(next++,20));await rpc('hardhat_setCode',[a,'0x00'+pages.map(x=>x.slice(2)).join('')]);catalogs[group]=a;dedup.set(key,a);
  }sets[directory]=catalogs;
 }
 report.injectedShardsAndCatalogs=Number(next-0x100000n);const contracts=[];
 for(const{name,directory,source,artifact:a}of artifacts){const c=sets[directory],r=await send(await new ethers.ContractFactory(a.abi,a.evm.bytecode.object).getDeployTransaction(...groups.map(g=>c[g])));contracts.push({name,address:r.contractAddress,iface:new ethers.Interface(a.abi)});report.variants.push({name,sourceHash:sha(source),runtimeBytes:a.evm.deployedBytecode.object.length/2,deployGas:BigInt(r.gasUsed)});save();}
 const seed=ethers.zeroPadValue('0x2a',32),vectors=[{name:'zero',input:[8192,0,Array(768).fill(0),[0,0,0,0,1024,1024],seed,0,512]},{name:'limits',input:[1047,4,Array.from({length:768},(_,i)=>i%2?1024:-1024),[4096,-4096,4096,-4096,4096,-4096],seed,99,64]},{name:'mixed',input:[3412,2,Array.from({length:768},(_,i)=>((i*7919)%2049)-1024),[185,776,-313,1024,-1024,1024],seed,101,4096]}];
 for(const v of vectors){let base;const row={name:v.name,gas:{},hashes:{}};for(const c of contracts){const data=c.iface.encodeFunctionData('stepSampled',v.input),r=await send({to:c.address,data}),out=await rpc('eth_call',[{to:c.address,data,gas:hex(GAS)},'latest']);row.gas[c.name]=BigInt(r.gasUsed);row.hashes[c.name]=ethers.keccak256(out);if(base)assert.equal(out,base,'all return bytes identical '+v.name+' '+c.name);else base=out;const d=c.iface.decodeFunctionResult('stepSampled',out);row.token=Number(d[0]);row.punct=Number(d[1]);row.text=d[4];console.log(v.name,c.name,r.gasUsed);}report.vectors.push(row);save();}
 report.status='PASS_EXACT_OUTPUT_PARITY';save();
}main().catch(e=>{report.status='FAIL';report.error=String(e.stack||e);save();console.error(e);process.exitCode=1;});
