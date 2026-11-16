// Linux-only regression of the pinned challenge manager's terminal proof path.
// Ancestors/history siblings are fixtures; this is not a complete BoLD dispute.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

assert.equal(process.platform,'linux','Run all execution on Runpod');
const here=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.join(process.env.GL3_DISPUTE_PACKAGE||here,'package.json'));
const ganache=require('ganache');
const {BrowserProvider,ContractFactory,ZeroAddress,ZeroHash,keccak256,concat,toUtf8Bytes}=require('ethers');
const sourceRoot=path.resolve(process.env.GL3_CONTRACT_SOURCE);
const artifactRoot=path.resolve(process.env.GL3_CONTRACT_ARTIFACTS);
const dependencyRoot=path.resolve(process.env.GL3_CONTRACT_DEPS);
const manifestPath=path.resolve(process.env.GL3_CONTRACT_MANIFEST);
const proofsPath=path.resolve(process.env.GL3_SELECTED_PROOFS);
const reportPath=path.resolve(process.env.GL3_TERMINAL_REPORT);
const manifest=JSON.parse(fs.readFileSync(manifestPath));
const solc=require('solc/wrapper')(require(path.join(dependencyRoot,'solc/package/soljson.js')));
assert(solc.version().startsWith('0.8.17+'),'Use the exact pinned source compiler');
const root='0xd45324627b0b3118dfdf1ad585769024cfa6008da8cdcaa745de32edc724613b';
const sha=b=>createHash('sha256').update(b).digest('hex');
const report={schema:'gh0st.gl3.terminal-challenge-regression.v1',passed:false,
 scope:'Inherited real EdgeChallengeManager terminal OSP path over authentic custom-machine witnesses; fixture ancestors/history siblings/config; not full assertion creation, bisection or assertion confirmation',
 fullIncorrectChessResultDisputePassed:false,fullHistoryBisectionTested:false,assertionConfirmationTested:false,
 ancestorEdgesSeeded:true,historySiblingsSynthetic:true,assertionConfigFixture:true,realOneStepVerifier:true,
 allExecutionOnRunpod:true,publicDeployment:false,realChainSpend:0,chessPolicyChanged:false,moduleRoot:root,
 verifierSourceCommit:'4341b132cfbdcc980ead03765ca5224ff6cb5d97',runnerSHA256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),
 harnessSHA256:sha(fs.readFileSync(path.join(here,'TerminalChallengeHarness.sol'))),proofFileSHA256:sha(fs.readFileSync(proofsPath)),artifacts:{},records:[]};
assert.equal(manifest.main.sourceCommit,report.verifierSourceCommit);
const loadedSources={};
function findImport(name){
 let file;
 if(name.startsWith('src/')){
  file=path.join(sourceRoot,name);const bytes=fs.readFileSync(file);
  assert.equal(sha(bytes),manifest.main.sourceFileHashes[name],name);loadedSources[name]=sha(bytes);
  return {contents:bytes.toString()};
 }
 const parts=name.split('/'),count=name.startsWith('@')?2:1,pkg=parts.slice(0,count).join('/');
 const record=manifest.npmDependencyArchives.find(x=>x.package===pkg);assert(record,'unrecorded package '+pkg);
 file=path.join(dependencyRoot,pkg.replaceAll('/','__'),'package',...parts.slice(count));
 return {contents:fs.readFileSync(file,'utf8')};
}
const input={language:'Solidity',sources:{'TerminalChallengeHarness.sol':{content:fs.readFileSync(path.join(here,'TerminalChallengeHarness.sol'),'utf8')}},settings:{optimizer:{enabled:true,runs:100},viaIR:true,evmVersion:'london',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const compiled=JSON.parse(solc.compile(JSON.stringify(input),{import:findImport}));
const failures=(compiled.errors||[]).filter(x=>x.severity==='error');assert.equal(failures.length,0,JSON.stringify(failures));
report.compiler=solc.version();report.sourceHashes=loadedSources;
const sourceArtifacts=new Map(manifest.main.artifacts.map(x=>[x.path,x]));
function pinned(name){
 const p=path.join(artifactRoot,'src/osp',name+'.sol',name+'.json'),bytes=fs.readFileSync(p);
 assert.equal(sha(bytes),sourceArtifacts.get(path.relative(artifactRoot,p))?.sha256,name);
 report.artifacts[name]=sha(bytes);return JSON.parse(bytes);
}
const server=ganache.provider({logging:{quiet:true},chain:{chainId:13373,hardfork:'shanghai',allowUnlimitedContractSize:true},miner:{blockGasLimit:100000000},wallet:{deterministic:true}});
const provider=new BrowserProvider(server);provider.pollingInterval=25;
async function rejected(fn,label){
 try{await fn();}catch(e){assert.equal(e.code,'CALL_EXCEPTION',label+': non-contract error');return {label,rejected:true,reason:e.reason||e.shortMessage};}
 assert.fail(label+' accepted');
}
const machine=x=>'0x'+x;
function inclusion(leaf,index,siblings){let h=keccak256(leaf);for(let i=0;i<siblings.length;i++)h=keccak256((index>>BigInt(i))&1n?concat([siblings[i],h]):concat([h,siblings[i]]));return h;}
try{
 const signer=await provider.getSigner();
 async function deployArtifact(a,args=[]){const b=typeof a.bytecode==='string'?a.bytecode:a.evm.bytecode.object;const c=await new ContractFactory(a.abi,b,signer).deploy(...args,{gasLimit:30000000});await c.waitForDeployment();return c;}
 const components=[];for(const n of ['OneStepProver0','OneStepProverMemory','OneStepProverMath','OneStepProverHostIo'])components.push(await deployArtifact(pinned(n),n==='OneStepProverHostIo'?[ZeroAddress]:[]));
 const entry=await deployArtifact(pinned('OneStepProofEntry'),await Promise.all(components.map(x=>x.getAddress())));
 const previous=keccak256(toUtf8Bytes('gl3 isolated previous-assertion config fixture'));
 const config=await deployArtifact(compiled.contracts['TerminalChallengeHarness.sol'].FixedAssertionConfig,[previous,root]);
 const manager=await deployArtifact(compiled.contracts['TerminalChallengeHarness.sol'].TerminalChallengeHarness,[await config.getAddress(),await entry.getAddress(),previous]);
 await(await config.setManager(await manager.getAddress())).wait();
 const prevConfig={wasmModuleRoot:root,requiredStake:0,challengeManager:await manager.getAddress(),confirmPeriodBlocks:1,nextInboxPosition:1000000};
 const rows=JSON.parse(fs.readFileSync(proofsPath));assert(rows.length>=1&&rows.length<=10,'bounded authentic witness set');report.witnessReasons=rows.map(x=>x.reason);
 for(const row of rows){
  const step=BigInt(row.step),caseId=keccak256(toUtf8Bytes('gl3-terminal-'+row.step));
  const before=machine(row.before),after=machine(row.after),wrongAfter='0x'+(BigInt(after)^1n).toString(16).padStart(64,'0');
  const siblings=Array.from({length:40},(_,i)=>keccak256(toUtf8Bytes('fixture-history-sibling-'+caseId+'-'+i)));
  const beforeRoot=inclusion(before,step,siblings),afterRoot=inclusion(after,step+1n,siblings),wrongRoot=inclusion(wrongAfter,step+1n,siblings);
  const args=[caseId,step,beforeRoot,afterRoot,wrongRoot];
  const [honestId,wrongId]=await manager.seedTerminalRivals.staticCall(...args);await(await manager.seedTerminalRivals(...args,{gasLimit:4000000})).wait();
  const data={beforeHash:before,proof:machine(row.proof)},call=(id,d=data,c=prevConfig,b=siblings,a=siblings)=>manager.confirmEdgeByOneStepProof.staticCall(id,d,c,b,a,{gasLimit:30000000});
  const checks=[];
  checks.push(await rejected(()=>call(wrongId),'Wrong terminal claim rejected'));
  const changed=Buffer.from(row.proof,'hex');changed[0]^=1;
  checks.push(await rejected(()=>call(honestId,{...data,proof:'0x'+changed.toString('hex')}),'Corrupt witness rejected'));
  const corruptBefore='0x'+(BigInt(before)^1n).toString(16).padStart(64,'0');
  checks.push(await rejected(()=>call(honestId,{...data,beforeHash:corruptBefore}),'Wrong prestate rejected'));
  checks.push(await rejected(()=>call(honestId,data,{...prevConfig,wasmModuleRoot:ZeroHash}),'Wrong module config rejected'));
  const changedSiblings=[...siblings];changedSiblings[0]=ZeroHash;
  checks.push(await rejected(()=>call(honestId,data,prevConfig,changedSiblings),'Wrong history inclusion rejected'));
  const receipt=await(await manager.confirmEdgeByOneStepProof(honestId,data,prevConfig,siblings,siblings,{gasLimit:30000000})).wait();assert.equal(receipt.status,1);
  assert.equal(await manager.fixtureStatus(honestId),1n);assert.equal(await manager.fixtureStatus(wrongId),0n);
  assert.equal(await manager.fixtureConfirmedRival(honestId),honestId);
  assert(receipt.logs.some(x=>{try{return manager.interface.parseLog(x)?.name==='EdgeConfirmedByOneStepProof';}catch{return false;}}));
  checks.push(await rejected(()=>call(wrongId),'Rival cannot replace confirmed winner'));
  checks.push(await rejected(()=>call(honestId),'Repeated confirmation rejected'));
  report.records.push({step:row.step,reason:row.reason,proofBytes:row.proof.length/2,honestId,wrongId,transaction:receipt.hash,gasUsed:String(receipt.gasUsed),honestConfirmed:true,incorrectRivalPending:true,checks});
 }
 report.passed=true;
}catch(e){report.error={message:e.shortMessage||e.message,stack:e.stack};process.exitCode=1;}
finally{provider.destroy();await server.disconnect();report.asOfUTC=new Date().toISOString();fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
