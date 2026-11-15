// Replay every existing dense reference vector against a separately compiled V2.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider,ContractFactory } from 'ethers';
const ROOT=dirname(fileURLToPath(import.meta.url));
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
const sha=x=>createHash('sha256').update(x).digest('hex');
const source=readFileSync(join(ROOT,'NnueKernelV2.sol'),'utf8');
const baseline=readFileSync(join(ROOT,'NnueKernel.sol'),'utf8');
const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',metadata:{bytecodeHash:'none'},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'NnueKernel.sol':{content:baseline},'NnueKernelV2.sol':{content:source}},settings})));
const errors=(compiled.errors||[]).filter(x=>x.severity==='error');assert.equal(errors.length,0,errors.map(x=>x.formattedMessage).join('\n'));
const artifact=compiled.contracts['NnueKernelV2.sol'].NnueDenseKernelV2;
const old=JSON.parse(readFileSync(join(ROOT,'gas-results.json')));
const positions=JSON.parse(readFileSync(join(ROOT,'position-vectors.json')));
const positionGas=JSON.parse(readFileSync(join(ROOT,'position-gas-results.json')));
assert.equal(sha(baseline),old.sourceSha256);assert.equal(old.passed,true);assert.equal(positionGas.passed,true);
const cases=[...old.denseCases.map(x=>({kind:'synthetic',bucket:x.bucket,name:x.input,
 input:readFileSync(join(ROOT,`.cache/input-${x.input}.bin`)).toString('hex'),expected:BigInt(x.upstreamScalarOutput),baselineGas:BigInt(x.packed.gasUsed)})),
 ...positions.vectors.map(x=>({kind:'native-search-sample',bucket:x.bucket,name:String(x.sample),input:x.inputHex,
 expected:BigInt(x.nativeOutput),baselineGas:BigInt(positionGas.cases.find(y=>y.sample===x.sample).gasUsed)}))];
const eip=ganache.provider({logging:{quiet:true},wallet:{mnemonic:'test test test test test test test test test test test junk',defaultBalance:1000},
 chain:{chainId:31337,hardfork:'shanghai',allowUnlimitedContractSize:true,allowUnlimitedInitCodeSize:true},miner:{blockGasLimit:32_000_000}});
const provider=new BrowserProvider(eip,undefined,{cacheTimeout:-1});provider.pollingInterval=10;const signer=await provider.getSigner();
const report={scope:'Isolated local EVM V2 dense component only, compared against prior actual receipt-backed baseline; not a whole chess move',
 generatedAt:new Date().toISOString(),sourceSha256:sha(source),baselineSourceSha256:sha(baseline),compiler:solc.version(),settings,
 runtimeBytes:artifact.evm.deployedBytecode.object.length/2,deployments:[],cases:[],completed:false};
const save=()=>writeFileSync(join(ROOT,'gas-v2-results.json'),json(report));
try{
 const kernels={};
 for(const bucket of [...new Set(cases.map(x=>x.bucket))]){
  const bytes=readFileSync(join(ROOT,`.cache/stack-${bucket}-packed.bin`));
  const runtime=Buffer.concat([Buffer.from([0]),bytes]);const size=runtime.length.toString(16).padStart(8,'0');
  const tx=await signer.sendTransaction({data:'0x63'+size+'601260003963'+size+'6000f3'+runtime.toString('hex'),gasLimit:31_000_000});const r=await tx.wait();
  const c=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signer).deploy(r.contractAddress,{gasLimit:31_000_000});await c.waitForDeployment();const cr=await c.deploymentTransaction().wait();
  report.deployments.push({bucket,dataGas:r.gasUsed,kernelGas:cr.gasUsed,kernelTransactionHash:cr.hash,dataTransactionHash:r.hash});kernels[bucket]=c;
 }
 for(const test of cases){
  const c=kernels[test.bucket],input='0x'+test.input;const actual=await c.evaluateV2(input);assert.equal(actual,test.expected);
  const call=await c.evaluateV2.populateTransaction(input);const tx=await signer.sendTransaction({...call,gasLimit:31_000_000});const r=await tx.wait();assert.equal(r.status,1);
  report.cases.push({kind:test.kind,bucket:test.bucket,name:test.name,inputSha256:sha(Buffer.from(test.input,'hex')),expected:test.expected,actual,
   baselineGas:test.baselineGas,gasUsed:r.gasUsed,gasReductionPercent:Number((test.baselineGas-r.gasUsed)*10000n/test.baselineGas)/100,transactionHash:r.hash});save();
 }
 const samples=report.cases.filter(x=>x.kind==='native-search-sample').map(x=>x.gasUsed);
 const count=BigInt(positionGas.summary.actualNativeNetworkInvocations);
 report.actualSampleSummary={sampleCount:samples.length,minimumReceiptGas:samples.reduce((a,b)=>a<b?a:b),maximumReceiptGas:samples.reduce((a,b)=>a>b?a:b),meanReceiptGas:samples.reduce((a,b)=>a+b,0n)/BigInt(samples.length),
  invocationCount:count,conditionalComponentScenario:{minimum:samples.reduce((a,b)=>a<b?a:b)*count,maximum:samples.reduce((a,b)=>a>b?a:b)*count,
   caveat:positionGas.summary.conditionalComponentScenario.caveat}};
 report.completed=true;report.passed=true;report.localReceipts=report.deployments.length*2+report.cases.length;save();console.log(json(report.actualSampleSummary));
}finally{await eip.disconnect();}
