// Isolated Shanghai EVM receipts, exact upstream C++ dense-stack cross-checks.
// No public RPC, wallet, model deployment, or transaction is used.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider,ContractFactory,keccak256 } from 'ethers';
const ROOT=dirname(fileURLToPath(import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
const source=readFileSync(join(ROOT,'NnueKernel.sol'),'utf8');
const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',metadata:{bytecodeHash:'none'},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'NnueKernel.sol':{content:source}},settings})));
const errors=(compiled.errors||[]).filter(x=>x.severity==='error');
assert.equal(errors.length,0,errors.map(x=>x.formattedMessage).join('\n'));
const artifacts=compiled.contracts['NnueKernel.sol'];
mkdirSync(join(ROOT,'build'),{recursive:true});
writeFileSync(join(ROOT,'build/artifacts.json'),json(artifacts));
const eip=ganache.provider({logging:{quiet:true},wallet:{mnemonic:'test test test test test test test test test test test junk',defaultBalance:1000},
 chain:{chainId:31337,hardfork:'shanghai',allowUnlimitedContractSize:true,allowUnlimitedInitCodeSize:true},
 miner:{blockGasLimit:32_000_000}});
const provider=new BrowserProvider(eip,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
const signer=await provider.getSigner();
const report={scope:'Isolated local Shanghai EVM actual transaction receipts; exact dense/accumulator components only; no chess/search/game gas measurement',
 generatedAt:new Date().toISOString(), compiler:solc.version(),settings,sourceSha256:sha(source),
 localLimits:{blockGasLimit:32000000,codeAndInitLimitsRelaxed:'Required to model independently verified Robinhood96KiB/192KiB limits; Ethereum defaults24KiB/48KiB would reject packed weights'},
 modelSha256:'1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2',
 dataDeployments:[],kernelDeployments:[],denseCases:[],accumulatorCases:[],packedWordCases:0,completed:false};
const save=()=>writeFileSync(join(ROOT,'gas-results.json'),json(report));
async function deployData(bytes,name){
 const runtime=Buffer.concat([Buffer.from([0]),bytes]);
 const size=runtime.length.toString(16).padStart(8,'0');
 const init='0x63'+size+'601260003963'+size+'6000f3'+runtime.toString('hex');
 const tx=await signer.sendTransaction({data:init,gasLimit:31_000_000});const r=await tx.wait();
 const code=await provider.getCode(r.contractAddress);assert.equal(code,'0x'+runtime.toString('hex'));
 report.dataDeployments.push({name,bytes:bytes.length,runtimeBytes:runtime.length,runtimeHash:keccak256(code),gasUsed:r.gasUsed,transactionHash:r.hash});save();
 return r.contractAddress;
}
async function deployKernel(name,args){
 const a=artifacts[name];const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args,{gasLimit:31_000_000});await c.waitForDeployment();
 const r=await c.deploymentTransaction().wait();report.kernelDeployments.push({name,args,runtimeBytes:a.evm.deployedBytecode.object.length/2,gasUsed:r.gasUsed,transactionHash:r.hash});save();return c;
}
async function receiptGas(contract,method,args){
 const call=await contract[method].populateTransaction(...args);
 const tx=await signer.sendTransaction({...call,gasLimit:31_000_000});const r=await tx.wait();assert.equal(r.status,1);
 return{gasUsed:r.gasUsed,transactionHash:r.hash};
}
try{
 const names=['zero','sparse','half-sparse','dense','max'];
 for(const bucket of [0,3,7]){
  const kernels={};
  for(const kind of ['scalar','packed']){
   const bytes=readFileSync(join(ROOT,`.cache/stack-${bucket}-${kind}.bin`));
   const address=await deployData(bytes,`bucket${bucket}-${kind}`);
   kernels[kind]=await deployKernel('NnueDenseKernel',[address,kind==='packed']);
  }
  for(const name of names){
   const data=readFileSync(join(ROOT,`.cache/input-${name}.bin`));
   const native=BigInt(execFileSync(join(ROOT,'.cache/dense-reference'),[join(ROOT,`.cache/stack-${bucket}-native.bin`),join(ROOT,`.cache/input-${name}.bin`)],{encoding:'utf8'}).trim());
   const row={bucket,input:name,nonzero:[...data].filter(x=>x).length,inputSha256:sha(data),upstreamScalarOutput:native};
   for(const kind of ['scalar','packed']){
    const out=await kernels[kind].evaluate('0x'+data.toString('hex'),{gasLimit:31_000_000});
    assert.equal(out,native,`${kind} bucket${bucket} ${name}`);
    row[kind]={output:out,...await receiptGas(kernels[kind],'evaluate',['0x'+data.toString('hex')])};
   }
   row.packedGasReductionPercent=Number((row.scalar.gasUsed-row.packed.gasUsed)*10000n/row.scalar.gasUsed)/100;
   report.denseCases.push(row);save();console.log(json(row).trim());
  }
 }
 const featureBytes=readFileSync(join(ROOT,'.cache/feature-rows.bin'));
 const featureAddress=await deployData(featureBytes,'1024biases+4PSQrows+4threatRows');
 const acc=await deployKernel('NnueAccumulatorKernel',[featureAddress]);
 for(let row=0;row<4;row++)for(const subtract of [false,true]){
  const expected=Buffer.alloc(2048);
  for(let i=0;i<1024;i++){
   const a=featureBytes.readInt16BE(i*2),b=featureBytes.readInt16BE(2048+row*2048+i*2);
   expected.writeUInt16BE((a+(subtract?-b:b))&65535,i*2);
  }
  const output=await acc.updateRow(row,subtract);assert.equal(output,'0x'+expected.toString('hex'));
  const packedOutput=await acc.updateRowPacked(row,subtract);assert.equal(packedOutput,output);
  const scalar=await receiptGas(acc,'updateRow',[row,subtract]);
  const packed=await receiptGas(acc,'updateRowPacked',[row,subtract]);
  report.accumulatorCases.push({row,subtract,outputSha256:sha(expected),scalar,packed,
    packedGasReductionPercent:Number((scalar.gasUsed-packed.gasUsed)*10000n/scalar.gasUsed)/100});save();
 }
 const special=[0,1,32767,32768,65535,65534,16384,49152];
 for(let seed=0;seed<32;seed++)for(const subtract of [false,true]){
  let a=0n,b=0n,expected=0n;
  for(let lane=0;lane<16;lane++){
   const av=seed<8?special[(seed+lane)%special.length]:(seed*3571+lane*12731)&65535;
   const bv=seed<8?special[(seed*3+lane*5)%special.length]:(seed*1693+lane*31991)&65535;
   a|=BigInt(av)<<BigInt(lane*16);b|=BigInt(bv)<<BigInt(lane*16);
   expected|=BigInt((av+(subtract?-bv:bv))&65535)<<BigInt(lane*16);
  }
  assert.equal(await acc.addWords(a,b,subtract),expected);report.packedWordCases++;
 }
 report.completed=true;report.passed=true;report.localReceipts=report.dataDeployments.length+report.kernelDeployments.length+report.denseCases.length*2+report.accumulatorCases.length*2;
 save();console.log(json({completed:report.completed,denseReferenceCases:report.denseCases.length,accumulatorReferenceCases:report.accumulatorCases.length,localReceipts:report.localReceipts}));
}finally{await eip.disconnect();}
