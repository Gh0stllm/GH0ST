// Independent fixture parity in an isolated local EVM. Diagnostic calls above32M do not prove deployability.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';
import * as ethers from 'ethers';
const DIR=path.dirname(fileURLToPath(import.meta.url)),BASE=path.resolve(DIR,'../../../../..');
const source=path.relative(BASE,path.resolve(DIR,'../kernel/SimpleStoriesV2SampledModel.sol'));
const fixturePath=path.resolve(DIR,'../quality/exact-reference.json'),fixtures=JSON.parse(readFileSync(fixturePath));
const manifestPath=path.resolve(DIR,'../../full-sentence/codeweights/model/manifest.json'),manifest=JSON.parse(readFileSync(manifestPath)),dataDir=path.dirname(manifestPath);
const URL='http://127.0.0.1:18577',CAP=32000000n,DIAGNOSTIC=128000000n;
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n',sha=x=>createHash('sha256').update(x).digest('hex');
const report={status:'RUNNING',scope:'UNFORKED_LOCAL_FIXTURE_PARITY_ONLY',chainId:31337,diagnosticEthCallGasLimit:DIAGNOSTIC,
  note:'Diagnostic eth_call gas is above the32M transaction cap. Matching reference outputs does not establish a32M swap pass.',
  modelSourceSha256:sha(readFileSync(path.join(BASE,source))),fixtureSha256:sha(readFileSync(fixturePath)),scriptSha256:sha(readFileSync(fileURLToPath(import.meta.url))),cases:[]};
const save=()=>writeFileSync(path.join(DIR,'fixture-parity.json'),json(report));
async function rpc(method,params=[],timeout=180000){const r=await fetch(URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(timeout)});const j=await r.json();if(j.error)throw Object.assign(Error(j.error.message),{data:j.error.data});return j.result;}
async function guard(){assert.equal(await rpc('eth_chainId'),'0x7a69');assert((await rpc('web3_clientVersion')).toLowerCase().includes('anvil'));}
let child,temp,provider;
try{
  save();assert.equal(fixtures.sampler_source_sha256,report.modelSourceSha256);
  const diagnosticSource='SampledDiagnosticProbe.sol';
  const diagnosticText=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
interface IModel{function generateSentence(uint16[] calldata,uint8)external view returns(uint16[] memory,bool,bool,bytes32);function generateSampledSentence(uint16[] calldata,uint8,bytes32,uint8,uint16)external view returns(uint16[] memory,bool,bool,bytes32);}
contract SampledDiagnosticProbe{event Generated(uint16[] ids,bool eos,bool sentence,bytes32 hash);function greedy(IModel m,uint16[] calldata p)external{(uint16[] memory ids,bool eos,bool sentence,bytes32 hash)=m.generateSentence(p,4);emit Generated(ids,eos,sentence,hash);}function sampled(IModel m,uint16[] calldata p,bytes32 seed,uint8 k,uint16 t)external{(uint16[] memory ids,bool eos,bool sentence,bytes32 hash)=m.generateSampledSentence(p,4,seed,k,t);emit Generated(ids,eos,sentence,hash);}}`;
  const input={language:'Solidity',sources:{[source]:{content:readFileSync(path.join(BASE,source),'utf8')},[diagnosticSource]:{content:diagnosticText}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
  const compiled=JSON.parse(solc.compile(json(input)));assert.deepEqual((compiled.errors??[]).filter(x=>x.severity==='error'),[]);const art=compiled.contracts[source].SimpleStoriesV2SampledModel;assert(art.evm.deployedBytecode.object.length/2<=24576);
  try{await rpc('web3_clientVersion',[],200);throw Error('Reserved local port occupied.');}catch(e){if(e.message==='Reserved local port occupied.')throw e;}
  temp=mkdtempSync(path.join(os.tmpdir(),'sampled-fixture-parity-'));
  child=spawn('/Users/abhijith/.foundry/bin/anvil',['--host','127.0.0.1','--port','18577','--chain-id','31337','--hardfork','cancun','--gas-limit',CAP.toString(),'--code-size-limit','24576','--quiet','--no-cors','--disable-console-log'],{cwd:temp,stdio:['ignore','ignore','ignore'],env:{PATH:process.env.PATH}});
  let ready=false;for(let i=0;i<100;i++){try{await guard();ready=true;break;}catch{}await new Promise(r=>setTimeout(r,50));}assert(ready);
  provider=new ethers.JsonRpcProvider(URL,31337,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=10;const signer=await provider.getSigner(0),groups={weights:[],tables:[],tiles:[]},entries=[];
  for(const group of ['weights','tables']){const data=readFileSync(path.join(dataDir,group+'.bin'));assert.equal(sha(data),manifest.artifacts[group+'.bin'].sha256);for(let offset=0;offset<data.length;offset+=24000){const address=ethers.getAddress(ethers.toBeHex(0x100000n+BigInt(entries.length),20));groups[group].push(address);entries.push({address,runtime:'0x00'+data.subarray(offset,offset+24000).toString('hex')});}}
  for(const[i,tile]of manifest.executable_tiles.entries()){const data=readFileSync(path.resolve(dataDir,tile.path));assert.equal(sha(data),tile.sha256);assert.equal(ethers.keccak256(data),tile.keccak256);const address=ethers.getAddress(ethers.toBeHex(0x200000n+BigInt(i),20));groups.tiles.push(address);entries.push({address,runtime:'0x'+data.toString('hex')});}
  for(let i=0;i<entries.length;i+=16)await Promise.all(entries.slice(i,i+16).map(async e=>{await guard();await rpc('anvil_setCode',[e.address,e.runtime]);assert.equal(await provider.getCode(e.address),e.runtime);}));
  await guard();const model=await new ethers.ContractFactory(art.abi,art.evm.bytecode.object,signer).deploy(groups.weights,groups.tables,groups.tiles,{gasLimit:CAP});await model.waitForDeployment();
  report.modelAddress=model.target;report.modelHash=await model.modelHash();
  for(const c of fixtures.cases){await guard();const started=Date.now();const [ids,eos,sentence,hash]=await model.generateSampledSentence.staticCall(c.prompt_ids,4,c.seed,c.top_k,c.temperature_milli,{gasLimit:DIAGNOSTIC});
    assert.deepEqual(Array.from(ids,Number),c.tokens);assert.equal(eos,c.ended_eos);assert.equal(sentence,c.ended_sentence);assert.equal(hash,c.last_logit_hash);
    report.cases.push({seed:c.seed,prompt:c.prompt_ids,topK:c.top_k,temperatureMilli:c.temperature_milli,tokens:Array.from(ids,Number),endedEos:eos,endedSentence:sentence,lastLogitHash:hash,text:c.text,complete:c.complete,elapsedMs:Date.now()-started,exactMatch:true});save();
    console.log('Fixture '+report.cases.length+'/'+fixtures.cases.length+' matches: '+c.text+(c.complete?'':' [INCOMPLETE]'));
  }
  // Separate high-gas diagnostics explain costs; these transactions are never32M pass evidence.
  await guard();await rpc('evm_setBlockGasLimit',[ethers.toBeHex(DIAGNOSTIC)]);await guard();await rpc('evm_mine',[]);
  assert.equal((await provider.getBlock('latest')).gasLimit,DIAGNOSTIC);
  const diagnosticArtifact=compiled.contracts[diagnosticSource].SampledDiagnosticProbe;
  await guard();const probe=await new ethers.ContractFactory(diagnosticArtifact.abi,diagnosticArtifact.evm.bytecode.object,signer).deploy({gasLimit:1000000n});await probe.waitForDeployment();
  report.diagnosticTransactions=[];
  for(const c of [{label:'sampled_source_greedy_because',method:'greedy',args:[model.target,[1703]],expected:[550,127,599,15]},
    {label:'sampled_source_top8_colon_seed0',method:'sampled',args:[model.target,[27],ethers.ZeroHash,8,700]},
    {label:'sampled_source_top8_because_seed0',method:'sampled',args:[model.target,[1703],ethers.ZeroHash,8,700]}]){
    await guard();const tx=await signer.sendTransaction({to:probe.target,data:probe.interface.encodeFunctionData(c.method,c.args),gasLimit:DIAGNOSTIC}),receipt=await tx.wait();assert.equal(receipt.status,1);
    const event=receipt.logs.map(l=>probe.interface.parseLog(l)).find(e=>e?.name==='Generated');assert(event);const ids=Array.from(event.args.ids,Number);
    if(c.expected)assert.deepEqual(ids,c.expected);else{const f=fixtures.cases.find(f=>JSON.stringify(f.prompt_ids)===JSON.stringify(c.args[1])&&f.seed===ethers.ZeroHash&&f.top_k===8&&f.temperature_milli===700);assert(f);assert.deepEqual(ids,f.tokens);assert.equal(event.args.hash,f.last_logit_hash);}
    report.diagnosticTransactions.push({label:c.label,gasLimit:DIAGNOSTIC,gasUsed:receipt.gasUsed,tokens:ids,endedEos:event.args.eos,endedSentence:event.args.sentence,lastLogitHash:event.args.hash,mode:'LOCAL_ABOVE_CAP_DIAGNOSTIC'});save();console.log(c.label+': '+receipt.gasUsed+' gas');
  }
  report.status='PASS_DIAGNOSTIC_PARITY_ONLY';report.summary={fixtures:report.cases.length,exactMatches:report.cases.length,complete:report.cases.filter(c=>c.complete).length,incomplete:report.cases.filter(c=>!c.complete).length};save();
}catch(e){report.status='FAIL';report.error=String(e.shortMessage||e.message);save();console.error(report.error);process.exitCode=1;}
finally{await provider?.destroy();if(child){child.kill('SIGTERM');await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,1000);});}if(temp)rmSync(temp,{recursive:true,force:true});}
