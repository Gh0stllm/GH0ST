// Local inference benchmark only: data code injection is NOT a deployment simulation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import solc from 'solc';
import hre from 'hardhat';
import * as ethers from 'ethers';
const here=path.dirname(fileURLToPath(import.meta.url));
const modelDir=path.resolve(here,'../../nova-optimization/selected');
const sha=x=>createHash('sha256').update(x).digest('hex');
const report={mode:'UNFORKED_LOCAL_ONLY',publicTransactions:0,modelWeightsUnchanged:true,variants:[],vectors:[]};
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
const name=process.argv[2]??'assembly-gru';
const save=()=>fs.writeFileSync(path.join(here,(process.env.NOVA_BENCH_TAG??name)+'-results.json'),json(report));
const names=['baseline',name];
const variants=names.map(n=>[n,fs.readFileSync(path.join(here,n+'.sol'),'utf8'),n==='baseline'?modelDir:(process.env.NOVA_VARIANT_EXPORT?path.resolve(here,process.env.NOVA_VARIANT_EXPORT):modelDir)]);
const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
function compile(content){const localSettings={...settings,optimizer:{enabled:true,runs:content===variants[0][1]?200:Number(process.env.NOVA_OPTIMIZER_RUNS??200)}};const r=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Model.sol':{content}},settings:localSettings}))); const e=(r.errors||[]).filter(x=>x.severity==='error');assert.equal(e.length,0,e.map(x=>x.formattedMessage).join('\n'));return r.contracts['Model.sol'].GRU2SIMDModel;}
const rpc=(method,params=[])=>hre.network.provider.request({method,params});
const GAS=32000000n,hex=ethers.toBeHex,coder=ethers.AbiCoder.defaultAbiCoder();
async function send(req){assert.equal(await rpc('eth_chainId'),'0x7a69');await rpc('hardhat_setNextBlockBaseFeePerGas',['0x0']);const hash=await rpc('eth_sendTransaction',[{from:account,gas:hex(GAS),gasPrice:'0x0',...req}]);const r=await rpc('eth_getTransactionReceipt',[hash]);assert.equal(r.status,'0x1');return r;}
let account;
async function main(){
 const artifacts=variants.map(([name,content,directory])=>[name,compile(content),directory]);
 hre.config.networks.hardhat.blockGasLimit=Number(GAS);hre.config.networks.hardhat.throwOnTransactionFailures=false;await rpc('hardhat_reset');assert.equal(await rpc('eth_chainId'),'0x7a69');[account]=await rpc('eth_accounts');
 const groups=['core','groups','words','vocabulary','fused','punctuation'],catalogSets={};let next=0x100000n;
 for(const directory of new Set(variants.map(v=>v[2]))){const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'))),catalogs={};
 for(const group of groups){const data=fs.readFileSync(path.join(directory,group+'.bin'));assert.equal(sha(data),manifest.artifacts[group+'.bin'].sha256);const addresses=[];
  for(let i=0;i<data.length;i+=24000){const a=ethers.getAddress(hex(next++,20));await rpc('hardhat_setCode',[a,'0x00'+data.subarray(i,i+24000).toString('hex')]);addresses.push(a);}
  const pages=[];for(let i=0;i<addresses.length;i+=1024){const a=ethers.getAddress(hex(next++,20));await rpc('hardhat_setCode',[a,'0x00'+addresses.slice(i,i+1024).map(x=>x.slice(2)).join('')]);pages.push(a);}
  const a=ethers.getAddress(hex(next++,20));await rpc('hardhat_setCode',[a,'0x00'+pages.map(x=>x.slice(2)).join('')]);catalogs[group]=a;
 }
 catalogSets[directory]=catalogs;
 }
 report.injectedShardsAndCatalogs=Number(next-0x100000n);const contracts=[];
 for(const [name,a,directory]of artifacts){const catalogs=catalogSets[directory];const r=await send(await new ethers.ContractFactory(a.abi,a.evm.bytecode.object).getDeployTransaction(...groups.map(g=>catalogs[g])));contracts.push({name,address:r.contractAddress,iface:new ethers.Interface(a.abi)});assert(a.evm.deployedBytecode.object.length/2<=24576,'runtime size');assert(a.evm.bytecode.object.length/2<=49152,'initcode size');report.variants.push({name,optimizerRuns:name==='baseline'?200:Number(process.env.NOVA_OPTIMIZER_RUNS??200),initcodeBytes:a.evm.bytecode.object.length/2,sourceHash:sha(variants.find(v=>v[0]===name)[1]),runtimeBytes:a.evm.deployedBytecode.object.length/2,deployGas:BigInt(r.gasUsed)});save();}
 const seed=ethers.zeroPadValue('0x2a',32);
 let vectors=[{name:'zero',input:[8192,0,Array(768).fill(0),[0,0,0,0,1024,1024],seed,0,512]},
 {name:'limits',input:[1047,4,Array.from({length:768},(_,i)=>i%2?1024:-1024),[4096,-4096,4096,-4096,4096,-4096],seed,99,64]},
 {name:'mixed',input:[3412,2,Array.from({length:768},(_,i)=>((i*7919)%2049)-1024),[185,776,-313,1024,-1024,1024],seed,101,4096]}];
 if(process.argv.includes('--full')){
  const previous=[8192,0,8191,4096,1,63,64,127,128,4095,4096,7777,8101,8190,32,1024];
  const temps=[64,128,256,512,1024,2048,4096,4096];
  let rng=0x8a173429;
  const next=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return rng>>>0;};
  const diverse=previous.map((p,k)=>{
   const state=Array.from({length:768},(_,j)=>{
    if(k===0)return -1024;if(k===1)return 1024;if(k===2)return j%2?-1024:1024;
    if(k===3)return j-384;if(k===4)return (j%3)-1;if(k===5)return j%31===0?1024:0;
    return(next()%2049)-1024;
   });
   const features=Array.from({length:6},(_,j)=>k%3===0?(j%2?-4096:4096):k%3===1?((next()%8193)-4096):0);
   return{name:'diverse-'+k,input:[p,k%5,state,features,ethers.keccak256(ethers.toUtf8Bytes('N0VA flat parity '+k)),k===15?(1n<<64n)-1n:k*137,temps[k%8]]};
  });
 vectors.push(...diverse);
 }
 if(process.argv.includes('--full')){
  const exp=fs.readFileSync(path.join(modelDir,'exp-q32.bin'));
  const sampling=(scores,start,count,entropy)=>{
   const maximum=scores.slice(start,start+count).reduce((a,b)=>a>b?a:b);
   const weights=scores.slice(start,start+count).map(score=>{let index=((maximum-score)*1024n/4096n+32n)/64n;if(index>256n)index=256n;return exp.readBigUInt64BE(Number(index)*8);});
   let draw=entropy%weights.reduce((a,b)=>a+b,0n);for(let i=0;i<count;i++){if(draw<weights[i])return i;draw-=weights[i];}throw new Error('Invalid sampler');
  };
  const entropy=(candidate,branch)=>BigInt(ethers.keccak256(coder.encode(['bytes32','uint256','uint256'],[candidate,0,branch])));
  const initial=[8192,0,Array(768).fill(0),[0,0,0,0,1024,1024],seed,0,4096];
  const baseContract=contracts[0];
  const getScores=async input=>baseContract.iface.decodeFunctionResult('stepSampled',await rpc('eth_call',[{to:baseContract.address,data:baseContract.iface.encodeFunctionData('stepSampled',input),gas:hex(GAS)},'latest']))[3];
  const groupScores=await getScores(initial);
  for(const group of [0,127]){
   let prefix;
   for(let i=0;i<100000;i++){const candidate=ethers.keccak256(ethers.toUtf8Bytes('N0VA targeted group '+group+' '+i));if(sampling(groupScores,0,128,entropy(candidate,0))===group){prefix=candidate;break;}}
   assert(prefix);const headScores=await getScores([...initial.slice(0,4),prefix,...initial.slice(5)]);
   for(const within of [0,63]){
    let target;
    for(let i=0;i<1000000;i++){const candidate=ethers.keccak256(ethers.toUtf8Bytes('N0VA targeted word '+group+' '+within+' '+i));if(sampling(groupScores,0,128,entropy(candidate,0))===group&&sampling(headScores,128,64,entropy(candidate,1))===within){target=candidate;break;}}
    assert(target,'Seed search exhausted');vectors.push({name:'target-group-'+group+'-word-'+within,input:[...initial.slice(0,4),target,...initial.slice(5)],expectedToken:group*64+within});
   }
  }
 }
 for(const vector of vectors){let baseline;const row={name:vector.name,input:vector.input,gas:{},hashes:{}};for(const c of contracts){const data=c.iface.encodeFunctionData('stepSampled',vector.input);const r=await send({to:c.address,data});const out=await rpc('eth_call',[{to:c.address,data,gas:hex(GAS)},'latest']);row.gas[c.name]=BigInt(r.gasUsed);row.hashes[c.name]=ethers.keccak256(out);if(baseline)assert.equal(out,baseline,'All return bytes identical for '+vector.name);else baseline=out;const decoded=c.iface.decodeFunctionResult('stepSampled',out);row.token=Number(decoded[0]);if(vector.expectedToken!==undefined)assert.equal(row.token,vector.expectedToken);row.group=Math.floor(row.token/64);row.withinGroup=row.token%64;row.punct=Number(decoded[1]);row.text=decoded[4];}report.vectors.push(row);save();console.log(json({...row,input:undefined}));}
 report.status='PASS_EXACT_OUTPUT_PARITY';save();
}
main().catch(e=>{report.status='FAIL';report.error=String(e.stack||e);save();console.error(e);process.exitCode=1;});
