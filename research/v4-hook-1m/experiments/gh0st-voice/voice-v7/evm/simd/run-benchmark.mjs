import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import solc from 'solc';
import hre from 'hardhat';
import * as ethers from 'ethers';

const here=path.dirname(fileURLToPath(import.meta.url)),CAP=32000000n,CHUNK=24000;
const manifest=JSON.parse(readFileSync(path.join(here,'data/manifest.json')));
const sha=x=>createHash('sha256').update(x).digest('hex');
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const report={status:'RUNNING',scope:'LOCAL_ONLY_PACKED_DOT_MICROBENCHMARK_NOT_FULL_SWAP',compiler:solc.version(),settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun'},cap:CAP,results:[],data:[],publicTransactions:0};
const save=()=>writeFileSync(path.join(here,'benchmark.json'),json(report)+'\n');
let provider;
async function main(){
 const source=readFileSync(path.join(here,'PackedDotBenchmark.sol'),'utf8');report.sourceSha256=sha(source);
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'PackedDotBenchmark.sol':{content:source}},settings:{...report.settings,outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
 const errors=(output.errors||[]).filter(e=>e.severity==='error');assert.equal(errors.length,0,errors.map(e=>e.formattedMessage).join('\n'));
 const artifact=output.contracts['PackedDotBenchmark.sol'].PackedDotBenchmark;
 hre.config.networks.hardhat.blockGasLimit=Number(CAP);hre.config.networks.hardhat.throwOnTransactionFailures=false;
 await hre.network.provider.request({method:'hardhat_reset',params:[]});
 const guard=async()=>assert.equal(await hre.network.provider.request({method:'eth_chainId'}),'0x7a69');await guard();
 provider=new ethers.BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 assert.equal((await provider.getBlock('latest')).gasLimit,CAP);const signer=await provider.getSigner(0);
 const factory=new ethers.ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer);const contract=await factory.deploy({gasLimit:CAP});const deployed=await contract.deploymentTransaction().wait();
 report.deployment={gas:deployed.gasUsed,runtimeBytes:artifact.evm.deployedBytecode.object.length/2,address:contract.target};
 let codeIndex=0,catalogIndex=0;
 async function install(bytes){
  const addresses=[];
  for(let offset=0;offset<bytes.length;offset+=CHUNK){const address=ethers.getAddress(ethers.toBeHex(0x810000n+BigInt(codeIndex++),20)),code='0x00'+bytes.subarray(offset,offset+CHUNK).toString('hex');await guard();await hre.network.provider.request({method:'hardhat_setCode',params:[address,code]});addresses.push(address);}
  const address=ethers.getAddress(ethers.toBeHex(0x9f0000n+BigInt(catalogIndex++),20)),code='0x00'+addresses.map(a=>a.slice(2)).join('');assert((code.length-2)/2<=24576);await guard();await hre.network.provider.request({method:'hardhat_setCode',params:[address,code]});
  return {address,shards:addresses.length,bytes:bytes.length,sha256:sha(bytes)};
 }
 async function execute(method,catalog,rows,vector,expected,extra){
  await guard();const tx=await signer.sendTransaction({to:contract.target,data:contract.interface.encodeFunctionData(method,[catalog.address,rows,vector]),gasLimit:CAP});let receipt;
  try{receipt=await tx.wait();}catch(e){receipt=e.receipt;if(!receipt)throw e;}
  const result={...extra,method,rows,dim:vector.length,macs:rows*vector.length,gasUsed:receipt.gasUsed,status:receipt.status,expectedHash:expected};
  if(receipt.status===1){const event=receipt.logs.map(l=>contract.interface.parseLog(l)).find(e=>e.name==='BenchResult');result.actualHash=event.args.resultHash;assert.equal(result.actualHash,expected);result.exactCPUReferenceMatch=true;}
  else result.failure='EXCEEDED_32M_OR_REVERTED';
  report.results.push(result);save();console.log(json(result));
 }
 for(const entry of manifest.cases){
  const scalar=readFileSync(path.join(here,'data',entry.files.scalar.name)),packed=readFileSync(path.join(here,'data',entry.files.packed.name)),expectedBytes=readFileSync(path.join(here,'data',entry.files.expected.name));
  assert.equal(sha(scalar),entry.files.scalar.sha256);assert.equal(sha(packed),entry.files.packed.sha256);assert.equal(sha(expectedBytes),entry.files.expected.sha256);
  const scalarCatalog=await install(scalar),packedCatalog=await install(packed);report.data.push({case:entry.name,scalar:scalarCatalog,packed:packedCatalog});save();
  const counts=entry.dim===128?[128,1152]:entry.dim===256?[576,1152,2304]:[288,1152,2304,4608];
  for(const rows of counts){const expected=ethers.keccak256(expectedBytes.subarray(0,rows*32));for(const method of ['scalar','packed'])await execute(method,method==='scalar'?scalarCatalog:packedCatalog,rows,entry.vector,expected,{case:entry.name,vector:'random_plus_endpoints'});}
  for(const value of [-1024,1024]){
   const vector=Array(entry.dim).fill(value),out=[];
   for(let r=0;r<16;r++){let sum=0;for(let i=0;i<entry.dim;i++)sum+=scalar.readInt16BE((r*entry.dim+i)*2)*value;out.push(ethers.zeroPadValue(ethers.toBeHex(BigInt.asUintN(256,BigInt(sum))),32).slice(2));}
   const expected=ethers.keccak256('0x'+out.join(''));for(const method of ['scalar','packed'])await execute(method,method==='scalar'?scalarCatalog:packedCatalog,16,vector,expected,{case:entry.name,vector:'all_'+value});
  }
 }
 report.status='COMPLETE';report.completedAt=new Date().toISOString();save();
}
main().catch(e=>{report.status='FAIL';report.error=String(e.stack||e);save();console.error(report.error);process.exitCode=1;}).finally(async()=>provider?.destroy());
