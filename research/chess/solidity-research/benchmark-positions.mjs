// Replay real transformed vectors from the instrumented native search through EVM.
// This measures only the dense component, never a complete Solidity chess move.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider,ContractFactory,keccak256 } from 'ethers';
const ROOT=dirname(fileURLToPath(import.meta.url));
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
const sha=x=>createHash('sha256').update(x).digest('hex');
const source=readFileSync(join(ROOT,'NnueKernel.sol'),'utf8');
const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',metadata:{bytecodeHash:'none'},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'NnueKernel.sol':{content:source}},settings})));
assert.equal((compiled.errors||[]).filter(x=>x.severity==='error').length,0);
const artifact=compiled.contracts['NnueKernel.sol'].NnueDenseKernel;
const captured=JSON.parse(readFileSync(join(ROOT,'position-vectors.json')));
const count=JSON.parse(readFileSync(join(ROOT,'search-counters.json')));
assert.equal(count.exactSearchOutcomePreserved,true);
const eip=ganache.provider({logging:{quiet:true},wallet:{mnemonic:'test test test test test test test test test test test junk',defaultBalance:1000},
 chain:{chainId:31337,hardfork:'shanghai',allowUnlimitedContractSize:true,allowUnlimitedInitCodeSize:true},miner:{blockGasLimit:32_000_000}});
const provider=new BrowserProvider(eip,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
const signer=await provider.getSigner();
const report={scope:'Local Shanghai EVM dense-component replay of16realSF19transformedvectors; NOT a full Solidity board evaluation/search/game bill',
 generatedAt:new Date().toISOString(),sourceSha256:sha(source),compiler:solc.version(),settings,
 nativeReference:count.runs[1],dataDeployments:[],kernelDeployments:[],cases:[],completed:false};
const save=()=>writeFileSync(join(ROOT,'position-gas-results.json'),json(report));
try{
 const kernels={};
 for(const bucket of [...new Set(captured.vectors.map(x=>x.bucket))]){
  const bytes=readFileSync(join(ROOT,`.cache/stack-${bucket}-packed.bin`));
  const runtime=Buffer.concat([Buffer.from([0]),bytes]);const size=runtime.length.toString(16).padStart(8,'0');
  const tx=await signer.sendTransaction({data:'0x63'+size+'601260003963'+size+'6000f3'+runtime.toString('hex'),gasLimit:31_000_000});
  const receipt=await tx.wait();assert.equal(await provider.getCode(receipt.contractAddress),'0x'+runtime.toString('hex'));
  report.dataDeployments.push({bucket,bytes:bytes.length,runtimeHash:keccak256('0x'+runtime.toString('hex')),gasUsed:receipt.gasUsed,transactionHash:receipt.hash});
  const kernel=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signer).deploy(receipt.contractAddress,true,{gasLimit:31_000_000});
  await kernel.waitForDeployment();const deployed=await kernel.deploymentTransaction().wait();
  report.kernelDeployments.push({bucket,gasUsed:deployed.gasUsed,transactionHash:deployed.hash});kernels[bucket]=kernel;
 }
 for(const vector of captured.vectors){
  const kernel=kernels[vector.bucket];const input='0x'+vector.inputHex;
  const output=await kernel.evaluate(input);assert.equal(output,BigInt(vector.nativeOutput));
  const call=await kernel.evaluate.populateTransaction(input);
  const tx=await signer.sendTransaction({...call,gasLimit:31_000_000});const receipt=await tx.wait();assert.equal(receipt.status,1);
  report.cases.push({sample:vector.sample,bucket:vector.bucket,networkInvocation:vector.networkInvocation,nonzero:vector.nonzero,
   inputSha256:vector.inputSha256,nativeOutput:vector.nativeOutput,solidityOutput:output,gasUsed:receipt.gasUsed,transactionHash:receipt.hash});save();
 }
 const gas=report.cases.map(x=>x.gasUsed);const low=gas.reduce((a,b)=>a<b?a:b);const high=gas.reduce((a,b)=>a>b?a:b);
 report.summary={sampleCount:gas.length,minimumReceiptGas:low,maximumReceiptGas:high,meanReceiptGas:gas.reduce((a,b)=>a+b,0n)/BigInt(gas.length),
  actualNativeNetworkInvocations:BigInt(count.runs[1].counters.network_evaluations),
  conditionalComponentScenario:{minimum:low*BigInt(count.runs[1].counters.network_evaluations),maximum:high*BigInt(count.runs[1].counters.network_evaluations),
   caveat:'Invocation count is measured. Gasperinvocation is a16sample range of standalone EVM transactions, not all1.576msearchvectors. Batching/caching/calldata change cost; FT/PSQT/search/TT/checkpoints are excluded. This is neither a measured fullmove bill nor a proven lower/upper bound.'}};
 report.localReceipts=report.dataDeployments.length+report.kernelDeployments.length+report.cases.length;
 report.completed=true;report.passed=true;save();console.log(json(report.summary));
}finally{await eip.disconnect();}
