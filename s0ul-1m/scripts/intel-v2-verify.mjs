#!/usr/bin/env node
// Read-only independent-RPC verification. No signing, broadcasting or compilation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{Contract,ContractFactory,JsonRpcProvider,FetchRequest,Interface,keccak256,ZeroAddress}=require('ethers');
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),REPO=path.dirname(ROOT);
const BUILD=path.join(ROOT,'reports/intel-v2-build'),JOURNAL=path.join(ROOT,'deployments/robinhood-mainnet-intel-v2.json');
const OUT=path.join(ROOT,'reports/intel-v2-mainnet-proof.json');
const RPCS=['https://rpc.mainnet.chain.robinhood.com','https://api.blockvectra.com/v1/robinhood_mainnet/public'];
const READS=new Set(['eth_chainId','net_version','web3_clientVersion','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getStorageAt','eth_getBalance','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getLogs','eth_getProof','eth_call','eth_gasPrice','eth_maxPriorityFeePerGas']);
class ReadOnlyProvider extends JsonRpcProvider{
 constructor(...args){super(...args);this.readQueue=Promise.resolve();this.lastReadAt=0;this.readStopped=false;this.verificationRpc=args[0].url;}
 send(method,params){
  if(!READS.has(method))return Promise.reject(Error('Verification refuses non-read RPC method '+method));
  const job=this.readQueue.then(async()=>{
   if(this.readStopped)throw Error('Read-only verifier has stopped');
   const pause=Math.max(0,1000-(Date.now()-this.lastReadAt));if(pause)await new Promise(resolve=>setTimeout(resolve,pause));
   if(this.readStopped)throw Error('Read-only verifier has stopped');this.lastReadAt=Date.now();
   try{return await super.send(method,params);}catch(error){if(error?.code!=='TIMEOUT')throw error;return super.send(method,params);}
  });
  const annotated=job.catch(error=>{throw Error(this.verificationRpc+' '+method+': '+String(error?.shortMessage??error?.message??error));});this.readQueue=annotated.catch(()=>{});return annotated;
 }
 destroy(){this.readStopped=true;return super.destroy();}
}
function readProvider(rpc){const r=new FetchRequest(rpc);r.timeout=20_000;r.setThrottleParams({maxAttempts:1});r.retryFunc=()=>false;return new ReadOnlyProvider(r,4663,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});}

const MODEL='0x9329833849A0938647217D1e42A1199d174Cf8c0',MODEL_HASH='0xe5b3abd4a9b85451b0ff708d34f4c1eabfa2bdfa5e970a4c3f9dcc202e0e5626';
const MODEL_ID='0x033f3bbf93ed8c7465a86389cd01aecb8fa64a582dfd9ff403da7b47fe04cbbd',MANIFEST='0x06c8d5497bba57f04b6418dd1510711cfe9383450a1464b6d73d9169f9a6c070';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const plain=v=>v?.toObject?v.toObject(true):Array.isArray(v)?v.map(plain):v;
function normalize(code,refs){let h=code.slice(2).toLowerCase();for(const spans of Object.values(refs??{}))for(const{start,length}of spans){if((start+length)*2>h.length)throw Error('Immutable span outside runtime');h=h.slice(0,start*2)+'0'.repeat(length*2)+h.slice((start+length)*2);}return'0x'+h;}
function assert(v,message){if(!v)throw Error(message);}
async function main(){
 const args=process.argv.slice(2);if(args.some(a=>a!=='--minimal')||args.length>1)throw Error('Only optional --minimal is supported');const minimal=args.includes('--minimal');
 const journal=JSON.parse(fs.readFileSync(JOURNAL,'utf8')),manifest=JSON.parse(fs.readFileSync(path.join(BUILD,'manifest.json'),'utf8'));
 assert(journal.complete&&journal.pending===null&&journal.mode==='mainnet'&&journal.chainId===4663,'Deployment journal is not confirmed complete');
 assert(journal.buildFingerprint===manifest.buildFingerprint,'Journal and frozen build fingerprint differ');
 const config=JSON.parse(fs.readFileSync(path.join(REPO,'website/s0ul-intel-v2-deployment.json'),'utf8'));
 assert(config.confirmedComplete&&config.buildFingerprint===journal.buildFingerprint&&config.chainId===4663,'Browser config differs from confirmed deployment');
 for(const[n,expected]of Object.entries(manifest.sourceHashes))assert(hash(fs.readFileSync(path.join(ROOT,n)))===expected,'Source differs from reviewed build: '+n);
 const providers=RPCS.map(readProvider);
 try{
  const chains=await Promise.all(providers.map(p=>p.send('eth_chainId',[])));assert(chains.every(c=>BigInt(c)===4663n),'Independent RPC chain mismatch');
  const heads=await Promise.all(providers.map(p=>p.getBlockNumber())),anchor=Math.min(...heads);
  assert(anchor>=Math.max(...journal.receipts.map(r=>r.receipt.blockNumber)),'Secondary RPC has not reached deployment block');
  const blocks=await Promise.all(providers.map(p=>p.getBlock(anchor)));assert(blocks[0]&&blocks[1]&&same(blocks[0].hash,blocks[1].hash),'Independent RPC anchor hashes differ');
  const at={blockTag:anchor,gasLimit:31_000_000n},runtime=[],receipts=[];
  const names={observations:'S0ULPermissionlessObservations',universalReader:'S0ULUniversalReader',reports:'S0ULIntelReports'};
  for(const[role,name]of Object.entries(names)){
   const a=JSON.parse(fs.readFileSync(path.join(BUILD,name+'.json'),'utf8')),record=journal.contracts[role];assert(record&&same(config.contracts[role]?.address,record.address)&&same(config.contracts[role]?.codeHash,record.codeHash),'Browser contract pin differs: '+role);
   const codes=await Promise.all(providers.map(p=>p.getCode(record.address,anchor)));assert(codes[0]!=='0x'&&same(codes[0],codes[1]),'Runtime differs between independent RPCs: '+role);
   assert(same(keccak256(codes[0]),record.codeHash)&&same(keccak256(normalize(codes[0],a.immutableReferences)),a.normalizedRuntimeHash),'Frozen runtime pin mismatch: '+role);
   runtime.push({role,name,address:record.address,codeHash:record.codeHash,normalizedRuntimeHash:a.normalizedRuntimeHash,runtimeBytes:(codes[0].length-2)/2,bothRpcExact:true});
   if(minimal)continue;
   const saved=journal.receipts.find(r=>r.key==='deploy:'+role);assert(saved,'No deployment receipt for '+role);
   const pairs=await Promise.all(providers.map(async p=>({tx:await p.getTransaction(saved.hash),receipt:await p.getTransactionReceipt(saved.hash)})));
   const args=role==='observations'?[60,3600]:role==='reports'?[journal.contracts.observations.address,MODEL]:[];
   const creation=await new ContractFactory(a.abi,a.bytecode).getDeployTransaction(...args);
   for(let i=0;i<pairs.length;i++){
    const{tx,receipt:r}=pairs[i];assert(tx&&r&&same(tx.hash,saved.hash)&&same(r.hash,saved.hash)&&r.status===1&&same(r.contractAddress,record.address),'Receipt identity/status mismatch: '+role);
    assert(tx.to===null&&same(tx.from,journal.owner)&&BigInt(tx.chainId)===4663n&&tx.value===0n&&tx.nonce===saved.nonce&&same(tx.data,creation.data)&&same(keccak256(tx.data),saved.calldataHash),'Creation calldata/constructor/deployer mismatch: '+role);
    assert(same(r.blockHash,saved.receipt.blockHash)&&r.blockNumber===saved.receipt.blockNumber,'Saved receipt block differs: '+role);
    const b=await providers[i].getBlock(r.blockNumber);assert(b&&same(b.hash,r.blockHash),'Receipt is not canonical: '+role);
    const price=BigInt(r.gasPrice??tx.gasPrice??0);assert(price>0n&&price<=BigInt(saved.feeCeilingWeiPerGas)&&tx.gasLimit<=BigInt(saved.gasLimit),'Deployment fee/gas exceeded accepted reserve: '+role);
   }
   assert(pairs[0].receipt.gasUsed===pairs[1].receipt.gasUsed&&pairs[0].receipt.gasPrice===pairs[1].receipt.gasPrice,'Independent receipt fee data differ');
   const r=pairs[0].receipt;receipts.push({role,hash:saved.hash,from:journal.owner,nonce:saved.nonce,blockNumber:r.blockNumber,blockHash:r.blockHash,gasUsed:r.gasUsed,gasPriceWei:r.gasPrice,spentWei:r.gasUsed*r.gasPrice,creationCalldataHash:keccak256(creation.data),constructorArguments:args,bothRpcExact:true});
  }
  const modelCodes=await Promise.all(providers.map(p=>p.getCode(MODEL,anchor)));assert(modelCodes.every(c=>same(keccak256(c),MODEL_HASH))&&same(modelCodes[0],modelCodes[1]),'Existing model runtime differs');
  if(minimal){
   const primaryReceipts=journal.receipts.map(r=>({role:r.key,hash:r.hash,nonce:r.nonce,recordedReceipt:r.receipt}));
   const proof={format:'s0ul-intel-v2-mainnet-proof-v1',verifiedUtc:new Date().toISOString(),result:'PASS',verificationScope:'Minimal independent RPC corroboration of shared block and four current runtimes; primary deployment evidence retained separately',chainId:4663,buildFingerprint:journal.buildFingerprint,readOnly:true,signedTransactionsInVerification:0,submittedTransactionsInVerification:0,rpcs:RPCS,transport:{readOnlyMethodAllowlist:true,batchMaxCount:1,minRequestIntervalMsPerRpc:1000,requestTimeoutMs:20000,timeoutRetries:1,rateLimitRetries:0},anchor:{blockNumber:anchor,blockHash:blocks[0].hash,timestamp:blocks[0].timestamp,bothRpcExact:true},sourceHashes:manifest.sourceHashes,runtime,model:{address:MODEL,codeHash:MODEL_HASH,bothRpcExact:true},primaryEvidence:{journal:'s0ul-1m/deployments/robinhood-mainnet-intel-v2.json',journalSha256:hash(fs.readFileSync(JOURNAL)),script:'s0ul-1m/scripts/intel-v2-deploy.mjs',scriptSha256:hash(fs.readFileSync(path.join(ROOT,'scripts/intel-v2-deploy.mjs'))),recordedReceipts:primaryReceipts,recordedDeploymentGas:journal.receipts.reduce((n,r)=>n+BigInt(r.receipt.gasUsed),0n),recordedDeploymentFeeWei:journal.spentWei,approvedCumulativeCapWei:journal.approvedCapWei,complete:journal.complete,pending:journal.pending,noSeedingTransactionsInJournal:journal.receipts.length===3&&journal.receipts.every(r=>r.key.startsWith('deploy:'))},notIndependentlyRequeried:['Constructor getter calls','Receipts and creation calldata','Subject/report counts','Address inspections and generated commentary','Bounded raw getter calls'],limits:['The deployment script verified constructor arguments, canonical receipts, runtime identities and immutable getters as primary evidence; this minimal verifier does not repeat those calls.','Independent checks here compare shared block hash and byte-for-byte runtime code on both public RPCs. They do not establish arbitrary contract safety or source-code verification.','Full secondary inspection/getter runs stopped on public RPC HTTP429 and are not reported as passing.','No watch, snapshot, report or background operator was created by this verification.']};
   const temp=OUT+'.tmp';fs.writeFileSync(temp,json(proof),{mode:0o600});fs.renameSync(temp,OUT);console.log(json({result:'PASS',scope:'minimal',path:path.relative(REPO,OUT),buildFingerprint:proof.buildFingerprint,anchor:proof.anchor,contracts:runtime.map(r=>({role:r.role,address:r.address})),sha256:hash(fs.readFileSync(OUT))}));return;
  }

  const obs=providers.map(p=>new Contract(journal.contracts.observations.address,config.contracts.observations.abi,p));
  const reader=providers.map(p=>new Contract(journal.contracts.universalReader.address,config.contracts.universalReader.abi,p));
  const reports=providers.map(p=>new Contract(journal.contracts.reports.address,config.contracts.reports.abi,p));
  const getterResults=await Promise.all(providers.map(async(p,i)=>{
   const model=new Contract(MODEL,['function modelId() view returns(bytes32)','function trainingManifestHash() view returns(bytes32)'],p);
   const values=await Promise.all([obs[i].owner(at),obs[i].minSpacing(at),obs[i].maxAge(at),obs[i].MAX_WATCHES(at),obs[i].subjectCount(at),obs[i].watchlist(journal.owner,at),reports[i].reportCount(at),reports[i].observations(at),reports[i].classifier(at),reports[i].observationsCodeHash(at),reports[i].classifierCodeHash(at),reports[i].modelId(at),reports[i].trainingManifestHash(at),reports[i].chainId(at),model.modelId(at),model.trainingManifestHash(at),reader[i].MAX_CODE_SCAN(at),reader[i].MAX_SELECTOR_SCAN(at),reader[i].MAX_CALLDATA(at),reader[i].MAX_RETURN(at)]);
   const keys=['owner','minSpacing','maxAge','maxWatches','subjectCount','deployerWatchlist','reportCount','observations','classifier','observationsCodeHash','classifierCodeHash','reportModelId','reportManifestHash','chainId','modelId','trainingManifestHash','maxCodeScan','maxSelectorScan','maxCalldata','maxReturn'];return Object.fromEntries(keys.map((k,n)=>[k,plain(values[n])]));
  }));
  assert(json(getterResults[0])===json(getterResults[1]),'Independent getters differ');const getters=getterResults[0];
  assert(same(getters.owner,ZeroAddress)&&getters.minSpacing===60n&&getters.maxAge===3600n&&getters.maxWatches===64n,'Permissionless observations settings mismatch');
  assert(getters.subjectCount===0n&&getters.reportCount===0n&&getters.deployerWatchlist.length===0,'Unexpected seeded subject/report/watch state');
  assert(same(getters.observations,journal.contracts.observations.address)&&same(getters.classifier,MODEL)&&same(getters.observationsCodeHash,journal.contracts.observations.codeHash)&&same(getters.classifierCodeHash,MODEL_HASH)&&getters.chainId===4663n&&same(getters.modelId,MODEL_ID)&&same(getters.reportModelId,MODEL_ID)&&same(getters.trainingManifestHash,MANIFEST)&&same(getters.reportManifestHash,MANIFEST),'Reports/model immutable identity differs');
  assert(getters.maxCodeScan===24576n&&getters.maxSelectorScan===4096n&&getters.maxCalldata===4096n&&getters.maxReturn===2048n,'Universal bounded-reader settings differ');
  const targets=[{name:'GH0ST token',target:'0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559',account:journal.owner},{name:'Raphael RAPH/WETH pool',target:'0xCC6e395c870E36AEC40ace400c32FD253966415e',account:ZeroAddress},{name:'Public deployer',target:journal.owner,account:ZeroAddress},{name:'Zero address',target:ZeroAddress,account:ZeroAddress},{name:'GH0ST Genesis NFT',target:'0xc2933932231870a9300b55d19f04c0873d3ed2f3',account:ZeroAddress},{name:'Universal reader itself',target:journal.contracts.universalReader.address,account:ZeroAddress}];
  const inspections=[];
  for(const t of targets){const outcomes=await Promise.all(providers.map(async(p,i)=>{const[inspection,text,universal]=await Promise.all([obs[i].inspect(t.target,t.account,at),obs[i].inspectText(t.target,t.account,at),reader[i].analyze(t.target,at)]);return{inspection:plain(inspection),text:String(text),universalProfile:plain(universal[0]),universalText:String(universal[1])};}));assert(json(outcomes[0])===json(outcomes[1]),'Independent inspection results differ: '+t.name);inspections.push({...t,...outcomes[0],bothRpcExact:true});}
  assert(inspections[0].inspection.preferredKind===2n&&(inspections[0].inspection.compatibleKinds&3n)===3n&&inspections[1].inspection.preferredKind===3n,'Token/account and pool detection failed');
  assert(inspections[2].inspection.codeSize===0n&&inspections[3].inspection.codeSize===0n,'No-code address facts mismatch');
  const iface=new Interface(['function totalSupply() view returns(uint256)']),callData=iface.encodeFunctionData('totalSupply',[]),raw=await Promise.all(reader.map(c=>c.read(targets[0].target,callData,at)));
  assert(json(plain(raw[0]))===json(plain(raw[1]))&&raw[0][0]===0n&&raw[0][1]===32n,'Independent bounded raw getter failed');
  const supply=iface.decodeFunctionResult('totalSupply',raw[0][2])[0];assert(supply===inspections[0].inspection.supplyValues[0],'Raw totalSupply and on-chain inspector supply differ');
  const spent=receipts.reduce((n,r)=>n+r.spentWei,0n);assert(spent===BigInt(journal.spentWei)&&spent<=BigInt(journal.approvedCapWei),'Total actual fee differs from confirmed journal or cap');
  const proof={format:'s0ul-intel-v2-mainnet-proof-v1',verifiedUtc:new Date().toISOString(),result:'PASS',chainId:4663,buildFingerprint:journal.buildFingerprint,readOnly:true,signedTransactionsInVerification:0,submittedTransactionsInVerification:0,rpcs:RPCS,transport:{readOnlyMethodAllowlist:true,batchMaxCount:1,minRequestIntervalMsPerRpc:1000,requestTimeoutMs:20000,timeoutRetries:1,rateLimitRetries:0},anchor:{blockNumber:anchor,blockHash:blocks[0].hash,timestamp:blocks[0].timestamp,bothRpcExact:true},sourceHashes:manifest.sourceHashes,runtime,model:{address:MODEL,codeHash:MODEL_HASH,modelId:MODEL_ID,trainingManifestHash:MANIFEST,bothRpcExact:true},deploymentReceipts:receipts,actualDeploymentGas:receipts.reduce((n,r)=>n+r.gasUsed,0n),actualDeploymentFeeWei:spent,approvedCumulativeCapWei:journal.approvedCapWei,getters,inspections,rawGetter:{target:targets[0].target,calldata:callData,status:raw[0][0],returnSize:raw[0][1],returnData:raw[0][2],decodedTotalSupply:supply,bothRpcExact:true},initialSubjectCount:0,initialReportCount:0,noOwnerRegistrationRequired:true,limits:['These read-only checks validate the deployed software and factual outputs; they do not establish arbitrary contract safety or source-code verification.','Getter responses can lie; selector/interface/opcode hints do not certify semantics. No-code addresses are not certified as EOAs.','Solidity block counters on Nitro are not canonical L2 block numbers; canonical RPC hashes above verify receipts separately.','Watch sampling and report publication require a funded trigger transaction; no automatic background operator was created.']};
  const temp=OUT+'.tmp';fs.writeFileSync(temp,json(proof),{mode:0o600});fs.renameSync(temp,OUT);
  console.log(json({result:'PASS',path:path.relative(REPO,OUT),buildFingerprint:proof.buildFingerprint,anchor:proof.anchor,contracts:runtime.map(r=>({role:r.role,address:r.address})),inspections:inspections.length,actualDeploymentGas:proof.actualDeploymentGas,actualDeploymentFeeWei:spent,sha256:hash(fs.readFileSync(OUT))}));
 }finally{await Promise.all(providers.map(p=>p.destroy()));}
}
main().catch(e=>{console.error('S0UL V2 verification: '+String(e?.shortMessage??e?.message??e).slice(0,900));process.exitCode=1;});
