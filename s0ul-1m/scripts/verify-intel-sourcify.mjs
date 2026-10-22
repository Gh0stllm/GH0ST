#!/usr/bin/env node
// Publishes only the already public Intel Solidity sources. No keys, wallet,
// transaction construction/signing/broadcast, or non-public RPCs are used here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),solc=require('solc');
const {JsonRpcProvider,ContractFactory,Contract,keccak256}=require('ethers');
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BUILD=path.join(ROOT,'reports/intel-build'),OUT=path.join(ROOT,'reports/intel-source-verification');
const REPORT=path.join(ROOT,'reports/intel-source-verification.json');
const API='https://sourcify.dev/server';
const DOCS='https://docs.sourcify.dev/docs/api/';
const UA='GH0ST-Intel-SourceVerifier/1.0 (+https://github.com/Gh0stllm/GH0ST)';
const RPCS=['https://rpc.mainnet.chain.robinhood.com','https://api.blockvectra.com/v1/robinhood_mainnet/public'];
const NAMES={model:'S0ULIntelModel',observations:'S0ULObservations',reports:'S0ULIntelReports'};
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
function save(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',json(value));fs.renameSync(file+'.tmp',file);}
function normalize(code,refs){let hex=code.slice(2).toLowerCase();for(const spans of Object.values(refs??{}))for(const p of spans)hex=hex.slice(0,p.start*2)+'0'.repeat(p.length*2)+hex.slice((p.start+p.length)*2);return'0x'+hex;}
function prepare(){
 const manifest=JSON.parse(fs.readFileSync(path.join(BUILD,'manifest.json')));
 if(solc.version()!==manifest.compiler)throw Error('Compiler version differs from frozen deployment build');
 const sources={};for(const [file,pin]of Object.entries(manifest.sourceHashes)){if(!/^contracts\/intel\/S0UL[A-Za-z]+\.sol$/.test(file))throw Error('Unexpected source path');const bytes=fs.readFileSync(path.join(ROOT,file));if(sha(bytes)!==pin)throw Error('Source changed since frozen deployment build: '+file);sources[file]={content:bytes.toString()};}
 const input={language:'Solidity',sources,settings:manifest.settings},output=JSON.parse(solc.compile(JSON.stringify(input)));
 const errors=(output.errors??[]).filter(e=>e.severity==='error');if(errors.length)throw Error('Verification recompile failed');
 const artifacts={};save(path.join(OUT,'standard-input.json'),input);
 for(const [role,name]of Object.entries(NAMES)){const compiled=output.contracts['contracts/intel/'+name+'.sol'][name],frozen=JSON.parse(fs.readFileSync(path.join(BUILD,name+'.json')));if(!same(keccak256('0x'+compiled.evm.bytecode.object),frozen.creationCodeHash)||!same(keccak256(normalize('0x'+compiled.evm.deployedBytecode.object,compiled.evm.deployedBytecode.immutableReferences)),frozen.normalizedRuntimeHash))throw Error('Recompiled bytecode differs from frozen artifact: '+name);const metadata=JSON.parse(compiled.metadata);save(path.join(OUT,name+'.metadata.json'),metadata);artifacts[role]={name,...frozen,metadata};}
 return {manifest,input,artifacts,compilerVersion:manifest.compiler.split('.Emscripten')[0]};
}
async function allConfirmed(build,rpc){
 const journal=JSON.parse(fs.readFileSync(path.join(ROOT,'deployments/robinhood-mainnet-intel.json')));
 if(journal.chainId!==4663||journal.buildFingerprint!==build.manifest.buildFingerprint)throw Error('Deployment journal chain/build mismatch');
 if(Object.keys(NAMES).some(role=>!journal.contracts?.[role]?.transactionHash))throw Error('Wait for all three confirmed contract deployment records before verification');
 const p=new JsonRpcProvider(rpc,4663,{staticNetwork:true,batchMaxCount:10,cacheTimeout:-1});
 try{
  if(BigInt(await p.send('eth_chainId',[]))!==4663n)throw Error('Public RPC chain mismatch');const contracts=[];
  for(const [role,name]of Object.entries(NAMES)){
   const binding=journal.contracts[role],artifact=build.artifacts[role];
   const [receipt,tx,code]=await Promise.all([p.getTransactionReceipt(binding.transactionHash),p.getTransaction(binding.transactionHash),p.getCode(binding.address)]);
   if(!receipt||Number(receipt.status)!==1||!tx||!same(receipt.contractAddress,binding.address)||!same(tx.from,journal.owner)||tx.to!==null||BigInt(tx.chainId)!==4663n||BigInt(tx.value)!==0n)throw Error(name+' deployment is not confirmed with the expected owner/address');
   const block=await p.getBlock(receipt.blockNumber);if(!block||!same(block.hash,receipt.blockHash))throw Error(name+' creation receipt is not canonical');
   if(!same(keccak256(code),binding.codeHash)||!same(keccak256(normalize(code,artifact.immutableReferences)),artifact.normalizedRuntimeHash))throw Error(name+' live runtime differs from frozen deployed build');
   const args=role==='model'?[]:role==='observations'?[journal.owner,60,3600]:[journal.contracts.observations.address,journal.contracts.model.address];
   const creation=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(...args);if(!same(creation.data,tx.data))throw Error(name+' creation input/constructor arguments differ from compiled deployment');
   contracts.push({role,name,address:binding.address,creationTransactionHash:binding.transactionHash,creationBlock:receipt.blockNumber,creationBlockHash:receipt.blockHash,codeHash:binding.codeHash,normalizedRuntimeHash:artifact.normalizedRuntimeHash,constructorArguments:args,compilerVersion:build.compilerVersion,contractIdentifier:'contracts/intel/'+name+'.sol:'+name,repositoryUrl:'https://repo.sourcify.dev/4663/'+binding.address});
  }
  const model=new Contract(journal.contracts.model.address,build.artifacts.model.abi,p),obs=new Contract(journal.contracts.observations.address,build.artifacts.observations.abi,p),reports=new Contract(journal.contracts.reports.address,build.artifacts.reports.abi,p);
  const got=await Promise.all([model.modelId(),model.trainingManifestHash(),obs.owner(),obs.minSpacing(),obs.maxAge(),reports.observations(),reports.classifier(),reports.chainId(),reports.modelId(),reports.trainingManifestHash()]);
  if(!same(got[0],journal.modelId)||!same(got[1],journal.trainingManifestHash)||!same(got[2],journal.owner)||Number(got[3])!==60||Number(got[4])!==3600||!same(got[5],journal.contracts.observations.address)||!same(got[6],journal.contracts.model.address)||BigInt(got[7])!==4663n||!same(got[8],got[0])||!same(got[9],got[1]))throw Error('Confirmed dependency getters differ from deployment journal');
  return {journal,contracts};
 }finally{await p.destroy();}
}
async function api(route,{method='GET',body}={}){
 const response=await fetch(API+route,{method,headers:{'User-Agent':UA,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data={message:text.slice(0,500)};}
 return {httpStatus:response.status,ok:response.ok,retryAfter:response.headers.get('retry-after'),data};
}
function isExactMatch(data,contract){return String(data?.chainId)==='4663'&&same(data?.address,contract.address)&&data?.match==='exact_match'&&data?.runtimeMatch==='exact_match'&&data?.creationMatch==='exact_match';}
async function verify(build,proof,rpc,retryFailed=false){
 let report=fs.existsSync(REPORT)?JSON.parse(fs.readFileSync(REPORT)):{format:'s0ul-intel-source-verification-v1',chainId:4663,api:API,apiDocumentation:DOCS,buildFingerprint:build.manifest.buildFingerprint,transactionsSent:0,entries:[]};
 if(report.buildFingerprint!==build.manifest.buildFingerprint)throw Error('Existing source verification report belongs to another build');report.checkedAt=new Date().toISOString();report.publicRpc=rpc;
 for(const contract of proof.contracts){
  let entry=report.entries.find(e=>same(e.address,contract.address));if(!entry){entry={...contract,status:'prepared',attempts:[]};report.entries.push(entry);}save(REPORT,report);
  const request={stdJsonInput:build.input,compilerVersion:build.compilerVersion,contractIdentifier:contract.contractIdentifier,creationTransactionHash:contract.creationTransactionHash};save(path.join(OUT,contract.name+'.request.json'),request);
  try{
   if(entry.status==='verified'&&isExactMatch(entry.match,contract))continue;
   if(retryFailed&&entry.verificationId&&entry.job?.data?.isJobCompleted&&!isExactMatch(entry.job.data.contract,contract)){entry.priorJobs??=[];entry.priorJobs.push({verificationId:entry.verificationId,job:entry.job,archivedAt:new Date().toISOString()});delete entry.verificationId;delete entry.job;entry.status='prepared';save(REPORT,report);}
   // These are three user-owned contracts, not a chain crawl. Reuse any existing
   // match or ticket and never ask for fields=all/source payloads in lookups.
   const lookup=await api('/v2/contract/4663/'+contract.address);entry.lookup=lookup;
   if(lookup.ok&&isExactMatch(lookup.data,contract)){entry.status='verified';entry.match=lookup.data;save(REPORT,report);continue;}
   if(lookup.httpStatus===429||lookup.httpStatus>=500){entry.status='deferred';entry.error='Lookup temporarily unavailable; stop all requests and observe Retry-After before retrying';report.retryAfter=lookup.retryAfter;save(REPORT,report);break;}
   if(!entry.verificationId){
    const submission=await api('/v2/verify/4663/'+contract.address,{method:'POST',body:request});entry.attempts.push({submittedAt:new Date().toISOString(),requestSha256:sha(json(request)),...submission});
    if(submission.httpStatus===429||submission.httpStatus>=500){entry.status='deferred';entry.error=submission.data;report.retryAfter=submission.retryAfter;save(REPORT,report);break;}
    if(!submission.ok||!submission.data.verificationId){entry.status='submission-error';entry.error=submission.data;save(REPORT,report);continue;}
    entry.verificationId=submission.data.verificationId;entry.status='pending';save(REPORT,report);
   }
   let deferred=false;for(let round=0;round<12;round++){
    const job=await api('/v2/verify/'+entry.verificationId);entry.job=job;entry.lastCheckedAt=new Date().toISOString();save(REPORT,report);
    if(job.httpStatus===429||job.httpStatus>=500){entry.status='deferred';entry.error='Job lookup temporarily unavailable; stop all requests and observe Retry-After before retrying';report.retryAfter=job.retryAfter;deferred=true;break;}
    if(!job.ok){entry.status='job-error';entry.error=job.data;break;}
    if(job.data.isJobCompleted){entry.status=isExactMatch(job.data.contract,contract)?'verified':'verification-failed';entry.match=job.data.contract??null;entry.error=job.data.error??(entry.status==='verified'?null:'Exact creation/runtime match for the expected chain/address was not established');break;}
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
   save(REPORT,report);if(deferred)break;
  }catch(error){entry.status=entry.verificationId?'pending':'request-error';entry.error=String(error.message).slice(0,500);save(REPORT,report);}
 }
 report.complete=report.entries.length===3&&report.entries.every(e=>e.status==='verified');report.allExact=report.complete&&report.entries.every(e=>e.match?.match==='exact_match'&&e.match?.runtimeMatch==='exact_match'&&e.match?.creationMatch==='exact_match');save(REPORT,report);
 console.log(json({complete:report.complete,allExact:report.allExact,transactionsSent:0,report:path.relative(path.dirname(ROOT),REPORT),contracts:report.entries.map(e=>({name:e.name,address:e.address,status:e.status,verificationId:e.verificationId,match:e.match?.match,runtimeMatch:e.match?.runtimeMatch,creationMatch:e.match?.creationMatch,error:e.error,repositoryUrl:e.repositoryUrl}))}));if(!report.complete)process.exitCode=2;
}
async function main(){const args=process.argv.slice(2),mode=args.shift()??'prepare',retryFailed=args.includes('--retry-failed'),rpc=args.find(v=>v!=='--retry-failed')??RPCS[0];if(!['prepare','verify'].includes(mode)||!RPCS.includes(rpc)||args.some(v=>v!=='--retry-failed'&&!RPCS.includes(v)))throw Error('Usage: verify-intel-sourcify.mjs prepare|verify [--retry-failed] [official-public-RPC-or-BlockVectra]');const build=prepare();if(mode==='prepare'){console.log(json({prepared:true,buildFingerprint:build.manifest.buildFingerprint,compilerVersion:build.compilerVersion,contracts:Object.values(build.artifacts).map(a=>a.name),artifactDirectory:path.relative(path.dirname(ROOT),OUT),submitted:false,transactionsSent:0}));return;}const proof=await allConfirmed(build,rpc);await verify(build,proof,rpc,retryFailed);}
main().catch(error=>{console.error('S0UL Intel source verification: '+String(error.message).slice(0,700));process.exitCode=1;});
