#!/usr/bin/env node
// New intel extension only. compile/plan never use a real signer. Mainnet writes
// require explicit chain/cap/build flags and non-TTY JSON stdin, never env/files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),solc=require('solc');
const ethers=require('ethers');
const {Interface,Contract,ContractFactory,JsonRpcProvider,BrowserProvider,Wallet,keccak256,getCreateAddress,ZeroAddress,AbiCoder}=ethers;
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const REPO=path.dirname(ROOT),BUILD=path.join(ROOT,'reports/intel-build');
const JOURNAL=path.join(ROOT,'deployments/robinhood-mainnet-intel.json');
const PLAN=path.join(ROOT,'reports/intel-deploy-plan.json');
const CONFIG=path.join(REPO,'website/s0ul-intel-deployment.json');
const RPCS=['https://rpc.mainnet.chain.robinhood.com','https://api.blockvectra.com/v1/robinhood_mainnet/public'];
const CHAIN=4663n,MAX_CAP=1_000_000_000_000_000n,OP_CAP=31_000_000n;
const MIN_SPACING=60,MAX_AGE=3600;
const GH0ST_TOKEN='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559',GH0ST_CODE_HASH='0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164';
const ZERO32='0x'+'0'.repeat(64),NAMES=['S0ULIntelModel','S0ULObservations','S0ULIntelReports'];
const ROLE={S0ULIntelModel:'model',S0ULObservations:'observations',S0ULIntelReports:'reports'};
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const rpcError=error=>({code:error?.info?.error?.code??error?.error?.code??error?.code??null,message:String(error?.info?.error?.message??error?.error?.message??error?.shortMessage??error?.message??'Unknown RPC failure').replace(/0x[0-9a-fA-F]{64,}/g,'[hex redacted]').replace(/\b[0-9a-fA-F]{128,}\b/g,'[hex redacted]').slice(0,700)});
const exact=(value,name)=>{if(typeof value!=='string'||!/^\d+$/.test(value))throw Error(name+' must be an exact decimal integer');return BigInt(value);};
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,json(value),{mode:0o600});fs.renameSync(temp,file);}
function argsOf(argv){const result={mode:argv[0]??'help'};for(let i=1;i<argv.length;i++){const flag=argv[i];if(!flag.startsWith('--'))throw Error('Unexpected positional argument');if(flag==='--help'){result.mode='help';continue;}const key=flag.slice(2);if(!['rpc','chain','cap-wei','build-hash','subjects','subject-id','hash'].includes(key))throw Error('Unsupported flag '+flag);const value=argv[++i];if(!value||value.startsWith('--'))throw Error('Missing value for '+flag);if(key in result)throw Error('Duplicate flag '+flag);result[key]=value;}return result;}
function publicRpc(value){const rpc=(value??RPCS[0]).replace(/\/$/,'');if(!RPCS.includes(rpc))throw Error('Only the official or BlockVectra public RPC is permitted');return rpc;}
function normalizeRuntime(code,refs){let hex=code.replace(/^0x/,'').toLowerCase();for(const spans of Object.values(refs??{}))for(const {start,length} of spans){if((start+length)*2>hex.length)throw Error('Immutable reference exceeds runtime');hex=hex.slice(0,start*2)+'0'.repeat(length*2)+hex.slice((start+length)*2);}return '0x'+hex;}
function trainingIdentity(){const weightsHash=hash(fs.readFileSync(path.join(ROOT,'intel-model/weights.json'))),manifestHash=hash(fs.readFileSync(path.join(ROOT,'intel-model/training-manifest.json'))),report=JSON.parse(fs.readFileSync(path.join(ROOT,'intel-model/training-report.json'))),modelId=hash(Buffer.concat([Buffer.from('S0UL_INTEL_OBSERVATION_V1'),Buffer.from(weightsHash,'hex'),Buffer.from(manifestHash,'hex')]));if(!same(report.modelId,'0x'+modelId)||!same(report.trainingManifestHash,'0x'+manifestHash)||!same(report.weightsHash,'0x'+weightsHash))throw Error('Training provenance hashes are inconsistent');return {modelId:'0x'+modelId,trainingManifestHash:'0x'+manifestHash};}
function compile(){
 trainingIdentity();
 if(!solc.version().startsWith('0.8.30+'))throw Error('Compiler must be exactly Solidity0.8.30');
 const dir=path.join(ROOT,'contracts/intel'),sources={};
 for(const file of fs.readdirSync(dir).filter(n=>n.endsWith('.sol')).sort())sources['contracts/intel/'+file]={content:fs.readFileSync(path.join(dir,file),'utf8')};
 if(Object.keys(sources).length!==4)throw Error('Expected the four reviewed top-level intel source files only');
 const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences','metadata']}}};
 const result=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings})));
 const errors=(result.errors??[]).filter(e=>e.severity==='error');if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
 const sourceHashes=Object.fromEntries(Object.entries(sources).map(([name,s])=>[name,hash(s.content)]));
 const trainingFiles=Object.fromEntries(['weights.json','training-manifest.json','training-report.json'].map(file=>{const p=path.join(ROOT,'intel-model',file);if(!fs.existsSync(p))throw Error('Missing trained intel provenance '+file);return ['intel-model/'+file,hash(fs.readFileSync(p))];}));
 const artifacts={};
 for(const name of NAMES){const output=result.contracts['contracts/intel/'+name+'.sol']?.[name];if(!output?.evm.bytecode.object)throw Error('No creation code for '+name);const runtime='0x'+output.evm.deployedBytecode.object,refs=output.evm.deployedBytecode.immutableReferences??{};if((runtime.length-2)/2>24576)throw Error(name+' exceeds EIP170 runtime limit');const normalizedRuntime=normalizeRuntime(runtime,refs);artifacts[name]={name,abi:output.abi,bytecode:'0x'+output.evm.bytecode.object,runtimeTemplate:runtime,immutableReferences:refs,normalizedRuntime,normalizedRuntimeHash:keccak256(normalizedRuntime),creationCodeHash:keccak256('0x'+output.evm.bytecode.object),runtimeBytes:(runtime.length-2)/2};}
 const candidateBytes=fs.readFileSync(path.join(ROOT,'reports/intel-candidates.json'));
 const identity={compiler:solc.version(),settings,sourceHashes,trainingFiles,candidatesSha256:hash(candidateBytes),artifacts:Object.fromEntries(NAMES.map(n=>[n,{creationCodeHash:artifacts[n].creationCodeHash,normalizedRuntimeHash:artifacts[n].normalizedRuntimeHash}]))};
 const buildFingerprint=hash(json(identity));const manifest={format:'s0ul-intel-build-v1',...identity,buildFingerprint,generatedAt:new Date().toISOString(),warnings:(result.errors??[]).filter(e=>e.severity!=='error').map(e=>e.formattedMessage)};
 fs.mkdirSync(BUILD,{recursive:true});for(const [name,artifact]of Object.entries(artifacts))atomic(path.join(BUILD,name+'.json'),artifact);atomic(path.join(BUILD,'manifest.json'),manifest);return {manifest,artifacts};
}
function candidateSubjects(selection='gh0st,pool'){
 if(!['gh0st','gh0st,pool'].includes(selection))throw Error('--subjects must be gh0st or gh0st,pool');
 const evidence=JSON.parse(fs.readFileSync(path.join(ROOT,'reports/intel-candidates.json'),'utf8'));
 if(evidence.chainId!==Number(CHAIN)||!evidence.readOnly||!evidence.anchor?.crossCheck?.matchesPrimaryHash)throw Error('Candidate evidence chain/anchor validation failed');
 const token=evidence.candidates.find(c=>c.name==='GH0ST');if(!token?.matchesRecordedCodeHash||!same(token.address,GH0ST_TOKEN)||!same(token.codeHash,GH0ST_CODE_HASH)||token.codeHash!==token.expectedCodeHash)throw Error('GH0ST evidence pin mismatch');
 const deployer=JSON.parse(fs.readFileSync(path.join(ROOT,'deployments/robinhood-mainnet-agent.json'),'utf8')).sender;
 if(!same(evidence.deployer.address,deployer))throw Error('Public owner differs between project journals');
 const subjects=[{key:'gh0st-supply',label:'GH0ST total supply',kind:1,target:token.address,account:ZeroAddress,codeHash:token.codeHash,asset0:token.address,asset1:ZeroAddress},{key:'gh0st-deployer-balance',label:'GH0ST public deployer balance',kind:2,target:token.address,account:deployer,codeHash:token.codeHash,asset0:token.address,asset1:ZeroAddress}];
 if(selection.includes('pool')){const p=evidence.initialRegistrySubjects.find(s=>s.id==='RAPH_WETH'),discovered=evidence.discoveredPools.find(s=>same(s.address,p?.address));if(!p||!discovered||!same(discovered.codeHash,p.codeHash)||!same(discovered.discoveredBy.factory,p.factory))throw Error('Pool evidence lacks factory/code provenance');subjects.push({key:'raph-weth-reserves',label:'Raphael RAPH/WETH pool',kind:3,target:p.address,account:ZeroAddress,codeHash:p.codeHash,asset0:p.token0,asset1:p.token1,factory:p.factory});}
 return {owner:deployer,subjects,selection};
}
async function rpcContext(provider){
 const chain=BigInt(await provider.send('eth_chainId',[]));if(chain!==CHAIN)throw Error('RPC chain ID mismatch');
 const gas=new Contract('0x000000000000000000000000000000000000006C',['function getMaxTxGasLimit() view returns(uint256)','function getMaxBlockGasLimit() view returns(uint256)'],provider);
 const [block,fee,maxTxGas,maxBlockGas]=await Promise.all([provider.getBlock('latest'),provider.getFeeData(),gas.getMaxTxGasLimit(),gas.getMaxBlockGasLimit()]);
 const gasPriceWei=BigInt(fee.gasPrice??0);if(!block||gasPriceWei<=0n||maxTxGas<=0n||maxBlockGas<=0n)throw Error('Live fee/limit data unavailable');
 const cap=[OP_CAP,BigInt(maxTxGas),BigInt(maxBlockGas)].reduce((a,b)=>a<b?a:b);
 return {chainId:chain,blockNumber:block.number,blockHash:block.hash,timestamp:block.timestamp,reportedBlockGasLimit:BigInt(block.gasLimit),maxTxGasLimit:BigInt(maxTxGas),maxBlockGasLimit:BigInt(maxBlockGas),operationalGasCap:cap,gasPriceWei};
}
async function verifyCandidates(provider,subjects){
 for(const s of subjects){const code=await provider.getCode(s.target);if(code==='0x'||!same(keccak256(code),s.codeHash))throw Error(s.key+' live runtime differs from reviewed evidence');const token=new Contract(s.target,['function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)','function token0() view returns(address)','function token1() view returns(address)','function factory() view returns(address)','function getReserves() view returns(uint112,uint112,uint32)'],provider);const supply=BigInt(await token.totalSupply());if(supply>=(1n<<128n))throw Error('Reader supply out of uint128 range');if(s.kind===1||s.kind===2){if(Number(await token.decimals())!==18)throw Error('GH0ST decimals changed');if(s.kind===2&&BigInt(await token.balanceOf(s.account))>supply)throw Error('Account balance exceeds supply');}else{const [a,b,f,reserves]=await Promise.all([token.token0(),token.token1(),token.factory(),token.getReserves()]);if(!same(a,s.asset0)||!same(b,s.asset1)||!same(f,s.factory))throw Error('Pool factory/token metadata differs from reviewed evidence');if(reserves.length!==3)throw Error('Unsupported pool reserve ABI');for(const asset of [a,b])if(await provider.getCode(asset)==='0x')throw Error('Pool asset has no runtime');}}
}
async function credential(expectedOwner){
 if(process.stdin.isTTY)throw Error('Signing credential must arrive as JSON on non-TTY stdin; terminal input is disabled');
 let input='';for await(const chunk of process.stdin){input+=chunk.toString();if(input.length>4096)throw Error('Signing input too large');}
 let parsed;try{parsed=JSON.parse(input);}catch{throw Error('Expected privateKey JSON on non-TTY stdin');}input='';
 if(!parsed||Object.keys(parsed).some(k=>k!=='privateKey')||typeof parsed.privateKey!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(parsed.privateKey))throw Error('Signing input must contain only a valid privateKey field');
 let wallet;try{wallet=new Wallet(parsed.privateKey);}catch{throw Error('Signing credential is invalid');}parsed.privateKey='';parsed=null;
 if(!same(wallet.address,expectedOwner))throw Error('Signing account differs from the reviewed public owner');return wallet;
}
function writeAuthorization(args,build){
 if(args.chain!=='4663')throw Error('Write modes require explicit --chain 4663');
 const capWei=exact(args['cap-wei'],'--cap-wei');if(capWei<=0n||capWei>MAX_CAP)throw Error('Maximum approved cumulative fee must be positive and no more than 1000000000000000 wei');
 if(args['build-hash']!==build.manifest.buildFingerprint)throw Error('Explicit --build-hash must match the reviewed compile/plan fingerprint');return capWei;
}
async function verifyRuntime(provider,address,artifact,receipt){
 const code=await provider.getCode(address,receipt?.blockNumber??'latest');if(code==='0x'||!same(keccak256(normalizeRuntime(code,artifact.immutableReferences)),artifact.normalizedRuntimeHash))throw Error(artifact.name+' normalized deployed runtime mismatch');return {address,codeHash:keccak256(code),normalizedRuntimeHash:artifact.normalizedRuntimeHash,runtimeBytes:(code.length-2)/2};
}
async function verifyGetters(provider,deployed,owner,build){
 const model=new Contract(deployed.model.address,build.artifacts.S0ULIntelModel.abi,provider);
 const observations=new Contract(deployed.observations.address,build.artifacts.S0ULObservations.abi,provider);
 const reports=new Contract(deployed.reports.address,build.artifacts.S0ULIntelReports.abi,provider);
 const values=await Promise.all([model.modelId(),model.trainingManifestHash(),observations.owner(),observations.minSpacing(),observations.maxAge(),reports.observations(),reports.classifier(),reports.observationsCodeHash(),reports.classifierCodeHash(),reports.chainId(),reports.modelId(),reports.trainingManifestHash()]);
 const [modelId,trainingManifestHash,who,spacing,age,obs,head,obsHash,headHash,chain,reportModel,reportManifest]=values;
 const expected=trainingIdentity();if(!same(modelId,expected.modelId)||!same(trainingManifestHash,expected.trainingManifestHash))throw Error('Deployed model differs from the reviewed training provenance');
 if(!same(who,owner)||Number(spacing)!==MIN_SPACING||Number(age)!==MAX_AGE||!same(obs,deployed.observations.address)||!same(head,deployed.model.address)||!same(obsHash,deployed.observations.codeHash)||!same(headHash,deployed.model.codeHash)||BigInt(chain)!==CHAIN||!same(modelId,reportModel)||!same(trainingManifestHash,reportManifest)||same(modelId,ZERO32)||same(trainingManifestHash,ZERO32))throw Error('Confirmed intel dependency getters differ from reviewed deployment');
 return {model,observations,reports,modelId,trainingManifestHash};
}
async function verifyPartialGetters(provider,role,deployed,owner,build){if(role==='model'){const model=new Contract(deployed.model.address,build.artifacts.S0ULIntelModel.abi,provider),expected=trainingIdentity();if(!same(await model.modelId(),expected.modelId)||!same(await model.trainingManifestHash(),expected.trainingManifestHash))throw Error('Deployed model identity differs from reviewed training files');}else if(role==='observations'){const obs=new Contract(deployed.observations.address,build.artifacts.S0ULObservations.abi,provider);if(!same(await obs.owner(),owner)||Number(await obs.minSpacing())!==MIN_SPACING||Number(await obs.maxAge())!==MAX_AGE)throw Error('Observation constructor getters differ from approved arguments');}else await verifyGetters(provider,deployed,owner,build);}
function receiptData(receipt,price){return {hash:receipt.hash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,status:Number(receipt.status),gasUsed:BigInt(receipt.gasUsed),gasPriceWei:BigInt(price),spentWei:BigInt(receipt.gasUsed)*BigInt(price),contractAddress:receipt.contractAddress};}
function eventOf(iface,receipt,name){for(const log of receipt.logs??[]){try{const parsed=iface.parseLog(log);if(parsed?.name===name)return parsed;}catch{}}throw Error('Confirmed receipt lacks '+name+' event');}
async function settle(provider,journal,journalPath,hashValue){
 const pending=journal.pending;if(!pending||!same(pending.hash,hashValue))throw Error('Exact saved transaction hash is required');
 const receipt=await provider.waitForTransaction(hashValue,1,120000);if(!receipt)throw Error('Receipt unavailable; reconcile exact saved hash before continuing');
 const [tx,block]=await Promise.all([provider.getTransaction(hashValue),provider.getBlock(receipt.blockNumber)]);
 if(!tx||!block||!same(block.hash,receipt.blockHash)||!same(tx.from,journal.owner)||Number(tx.nonce)!==pending.nonce||BigInt(tx.chainId)!==CHAIN||BigInt(tx.value)!==0n||!same(keccak256(tx.data),pending.calldataHash)||!((!tx.to&&!pending.to)||same(tx.to,pending.to)))throw Error('Receipt transaction/canonical identity mismatch');
 const price=BigInt(receipt.gasPrice??tx.gasPrice??0);if(price<=0n)throw Error('Actual receipt fee unavailable');const record={...pending,receipt:receiptData(receipt,price)};
 if(!journal.receipts.some(r=>same(r.hash,hashValue))){journal.receipts.push(record);journal.spentWei=(BigInt(journal.spentWei)+record.receipt.spentWei).toString();}
 // Retain receipt evidence but block retry/recovery if the intended operation failed.
 journal.steps[pending.key]=record;journal.pending=null;atomic(journalPath,journal);
 if(Number(receipt.status)!==1)throw Error('Transaction reverted; gas recorded, no retry authorized');
 if(BigInt(tx.gasLimit)>BigInt(pending.gasLimit)||price>BigInt(pending.feeCeilingWeiPerGas)||BigInt(journal.spentWei)>BigInt(journal.approvedCapWei))throw Error('Actual transaction exceeds approved reserve; stop and review');
 return {receipt,record};
}
async function sender(provider,journal,journalPath,signing,{local=false,localContext=null}={}){
 // Ganache executes EVM bytecode but does not implement Nitro precompiles. A
 // fork plan uses the independently read public-chain limits/price, while all
 // state-changing calls still go exclusively to its in-process provider.
 const context=()=>local?Promise.resolve(localContext):rpcContext(provider);
 const initial=await context();if(!initial)throw Error('Fork plan requires a verified public gas context');journal.acceptedFeeCeilingWeiPerGas=((initial.gasPriceWei*3n+1n)/2n).toString();atomic(journalPath,journal);
 return async function send(key,request){
  if(journal.pending)throw Error('Unresolved transaction blocks all further sends; use reconcile');
  if(journal.steps[key]){if(Number(journal.steps[key].receipt?.status)!==1)throw Error('A failed operation cannot be automatically retried');return {receipt:await provider.getTransactionReceipt(journal.steps[key].hash),record:journal.steps[key],resumed:true};}
  const live=await context(),ceiling=BigInt(journal.acceptedFeeCeilingWeiPerGas);if(live.gasPriceWei>ceiling)throw Error('Live gas price exceeds the accepted fee ceiling');
  const estimate=BigInt(await provider.estimateGas({...request,from:journal.owner,value:0n})),gasLimit=(estimate*12000n+9999n)/10000n;if(gasLimit>live.operationalGasCap)throw Error('Padded gas exceeds31M/live execution cap');
  const reserve=gasLimit*ceiling;if(BigInt(journal.spentWei)+reserve>BigInt(journal.approvedCapWei))throw Error('Cumulative fee cap cannot cover the next reserved transaction');
  if(BigInt(await provider.getBalance(journal.owner))<reserve)throw Error('Owner balance is below next reserved transaction');
  const nonce=await provider.getTransactionCount(journal.owner,'pending');if(BigInt(await provider.send('eth_chainId',[]))!==CHAIN)throw Error('Chain changed before signing');
  const tx={chainId:CHAIN,nonce,to:request.to??null,data:request.data,value:0n,gasLimit,gasPrice:live.gasPriceWei,type:0};
  let raw,transactionHash;
  if(!local){raw=await signing.signTransaction(tx);transactionHash=keccak256(raw);}
  journal.pending={key,hash:transactionHash??null,nonce,to:tx.to,data:tx.data,calldataHash:keccak256(tx.data),gasEstimate:estimate.toString(),gasLimit:gasLimit.toString(),gasPriceWei:live.gasPriceWei.toString(),feeCeilingWeiPerGas:ceiling.toString(),reserveWei:reserve.toString(),predictedAddress:tx.to?null:getCreateAddress({from:journal.owner,nonce}),preparedAt:new Date().toISOString(),status:'prepared'};atomic(journalPath,journal);
  try{
   if(local){transactionHash=await signing.request({method:'eth_sendTransaction',params:[{from:journal.owner,to:tx.to??undefined,data:tx.data,value:'0x0',gas:ethers.toQuantity(gasLimit),gasPrice:ethers.toQuantity(live.gasPriceWei),nonce:ethers.toQuantity(nonce)}]});journal.pending.hash=transactionHash;}
   else {const response=await provider.broadcastTransaction(raw);if(!same(response.hash,transactionHash))throw Error('RPC returned an unexpected signed transaction hash');}
   journal.pending.status='broadcast';journal.pending.broadcastAt=new Date().toISOString();atomic(journalPath,journal);
  }catch(error){journal.pending.status='ambiguous';journal.pending.broadcastError=rpcError(error);atomic(journalPath,journal);throw Error('Broadcast outcome is ambiguous; stop and reconcile the exact journal hash. No retry was sent. RPC reason: '+journal.pending.broadcastError.message);}
  return settle(provider,journal,journalPath,transactionHash);
 };
}
function freshJournal(build,owner,selection,capWei,mode,rpc){return {format:'s0ul-intel-deployment-v1',mode,chainId:Number(CHAIN),owner,selection,publicRpc:rpc,buildFingerprint:build.manifest.buildFingerprint,candidatesSha256:build.manifest.candidatesSha256,approvedCapWei:capWei.toString(),spentWei:'0',contracts:{},subjects:[],steps:{},receipts:[],proofs:[],pending:null,complete:false,createdAt:new Date().toISOString()};}
async function verifyPastReceipts(provider,journal){let spent=0n;for(const saved of journal.receipts){const [r,tx]=await Promise.all([provider.getTransactionReceipt(saved.hash),provider.getTransaction(saved.hash)]);if(!r||!tx||!same(r.blockHash,saved.receipt.blockHash)||!same(tx.from,journal.owner)||BigInt(tx.chainId)!==CHAIN)throw Error('Prior receipt unavailable or reorganized');const block=await provider.getBlock(r.blockNumber);if(!block||!same(block.hash,r.blockHash))throw Error('Prior receipt block is not canonical');const price=BigInt(r.gasPrice??tx.gasPrice??0);if(price<=0n)throw Error('Prior receipt fee unavailable');spent+=BigInt(r.gasUsed)*price;}journal.spentWei=spent.toString();}
async function deployAll(provider,send,journal,journalPath,build,subjects){
 for(const name of NAMES){const role=ROLE[name],artifact=build.artifacts[name],args=name==='S0ULIntelModel'?[]:name==='S0ULObservations'?[journal.owner,MIN_SPACING,MAX_AGE]:[journal.contracts.observations.address,journal.contracts.model.address];const factory=new ContractFactory(artifact.abi,artifact.bytecode),request=await factory.getDeployTransaction(...args);const {receipt,record}=await send('deploy:'+role,request);const address=receipt?.contractAddress??record.predictedAddress;if(!address||!same(address,record.predictedAddress))throw Error('Deployment address differs from signed nonce prediction');journal.contracts[role]={...await verifyRuntime(provider,address,artifact,receipt),name,constructorArguments:args,transactionHash:record.hash,blockNumber:receipt.blockNumber};await verifyPartialGetters(provider,role,journal.contracts,journal.owner,build);atomic(journalPath,journal);}
 const verified=await verifyGetters(provider,journal.contracts,journal.owner,build);journal.modelId=verified.modelId;journal.trainingManifestHash=verified.trainingManifestHash;atomic(journalPath,journal);
 for(const subject of subjects){const request=await verified.observations.registerSubject.populateTransaction(subject.kind,subject.target,subject.account,subject.codeHash),{receipt,record}=await send('register:'+subject.key,request);const event=eventOf(verified.observations.interface,receipt,'SubjectRegistered'),id=BigInt(event.args.subjectId);const actual=await verified.observations.subject(id);if(Number(actual.kind)!==subject.kind||!actual.enabled||!same(actual.target,subject.target)||!same(actual.account,subject.account)||!same(actual.codeHash,subject.codeHash)||!same(actual.asset0,subject.asset0)||!same(actual.asset1,subject.asset1))throw Error('Registered subject differs from reviewed metadata');if(!journal.subjects.some(s=>s.key===subject.key))journal.subjects.push({...subject,id:id.toString(),transactionHash:record.hash});atomic(journalPath,journal);}
 journal.complete=true;journal.completedAt=new Date().toISOString();atomic(journalPath,journal);return verified;
}
async function capture(provider,send,journal,journalPath,verified,subjectId,key){
 const bound=journal.subjects.find(s=>s.id===subjectId.toString());if(!bound)throw Error('Subject ID is not in confirmed deployment journal');
 const request=await verified.reports.captureAndAnalyze.populateTransaction(subjectId,1),{receipt,record}=await send(key,request),event=eventOf(verified.reports.interface,receipt,'ReportPublished'),reportId=BigInt(event.args.reportId);
 return proofFromReceipt(provider,journal,journalPath,verified,subjectId,receipt,record,reportId,bound);
}
async function proofFromReceipt(provider,journal,journalPath,verified,subjectId,receipt,record,reportId=null,bound=null){
 bound??=journal.subjects.find(s=>s.id===subjectId.toString());if(!bound)throw Error('Subject ID is not in confirmed deployment journal');reportId??=BigInt(eventOf(verified.reports.interface,receipt,'ReportPublished').args.reportId);
 const [report,render]=await Promise.all([verified.reports.report(reportId),verified.reports.render(reportId)]);const current=await verified.observations.sampleAt(subjectId,report.currentSequence);
 const currentHash=await verified.observations.snapshotHash(subjectId,report.currentSequence);if(!same(currentHash,report.currentHash)||Number(report.subjectId)!==Number(subjectId)||Number(report.observedBlock)!==Number(current.blockNumber)||!same(report.modelId,journal.modelId))throw Error('Published report proof differs from stored observations/model');
 // Snapshot field values collides with Array.values; getValue is required.
 const rawValues=Array.from(current.getValue('values'),v=>BigInt(v));if(rawValues.some((v,i)=>v!==BigInt(report.currentValues[i])))throw Error('Report raw values differ from captured snapshot');
 const proof={subjectId:subjectId.toString(),subject:bound.label,reportId:reportId.toString(),label:Number(report.label),lookback:1,report:report.toObject(true),snapshot:current.toObject(true),render,currentHash,transactionHash:record.hash,receipt:record.receipt,baseline:Number(report.label)===5,modelId:journal.modelId,trainingManifestHash:journal.trainingManifestHash};
 if(!journal.proofs.some(p=>same(p.transactionHash,record.hash)))journal.proofs.push(proof);atomic(journalPath,journal);return proof;
}
function frontendConfig(journal,build){return {format:'s0ul-intel-browser-deployment-v1',chainId:Number(CHAIN),owner:journal.owner,buildFingerprint:journal.buildFingerprint,modelId:journal.modelId,trainingManifestHash:journal.trainingManifestHash,minSpacing:MIN_SPACING,maxAge:MAX_AGE,contracts:Object.fromEntries(Object.entries(journal.contracts).map(([role,record])=>[role,{...record,abi:build.artifacts[record.name].abi}])),subjects:journal.subjects,readRpcUrl:journal.publicRpc,readOnlyPublicRpc:journal.publicRpc,deploymentJournal:'s0ul-1m/deployments/robinhood-mainnet-intel.json',confirmedComplete:true};}
function saveProofs(journal,build){atomic(path.join(ROOT,'reports/intel-mainnet-proof.json'),{format:'s0ul-intel-mainnet-proof-v1',chainId:Number(CHAIN),buildFingerprint:build.manifest.buildFingerprint,contracts:journal.contracts,proofs:journal.proofs,spentWei:journal.spentWei});}
async function main(){
 const args=argsOf(process.argv.slice(2));if(args.mode==='help'){console.log('Modes: compile | plan [--subjects gh0st,pool] | deploy --chain 4663 --cap-wei N --build-hash H | sample --chain 4663 --cap-wei N --build-hash H --subject-id ID | reconcile [--hash H]. Write modes accept only non-TTY stdin JSON {privateKey}; never environment/files. Public RPC options are fixed.');return;}
 if(!['compile','plan','deploy','sample','reconcile'].includes(args.mode))throw Error('Unknown mode');
 const build=compile();if(args.mode==='compile'){console.log(json({mode:'compile',buildFingerprint:build.manifest.buildFingerprint,compiler:build.manifest.compiler,contracts:Object.fromEntries(NAMES.map(n=>[n,{runtimeBytes:build.artifacts[n].runtimeBytes,normalizedRuntimeHash:build.artifacts[n].normalizedRuntimeHash}])),manifest:path.relative(REPO,path.join(BUILD,'manifest.json'))}));return;}
 const rpc=publicRpc(args.rpc),definition=candidateSubjects(args.subjects),publicProvider=new JsonRpcProvider(rpc,Number(CHAIN),{staticNetwork:true,batchMaxCount:args.mode==='plan'?10:1,cacheTimeout:-1});let provider=publicProvider,local;
 try{
  const live=await rpcContext(publicProvider);
  if(args.mode==='plan'){
   await verifyCandidates(publicProvider,definition.subjects);const readMethods=new Set(['eth_chainId','net_version','web3_clientVersion','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionCount','eth_getBalance','eth_getCode','eth_getStorageAt','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getLogs','eth_getProof']);
   const forkSource={request:({method,params=[]})=>{if(!readMethods.has(method))throw Error('Fork transport refuses non-read upstream method '+method);return publicProvider.send(method,params);}};
   const ganache=require('ganache');local=ganache.provider({fork:{provider:forkSource,blockNumber:live.blockNumber},wallet:{unlockedAccounts:[definition.owner],totalAccounts:0},chain:{chainId:Number(CHAIN),networkId:Number(CHAIN),hardfork:'shanghai'},miner:{blockGasLimit:Number(live.operationalGasCap)},logging:{quiet:true}});provider=new BrowserProvider(local,Number(CHAIN),{cacheTimeout:-1});provider.pollingInterval=50;
   await local.request({method:'evm_setAccountBalance',params:[definition.owner,'0x56bc75e2d63100000']});await verifyCandidates(provider,definition.subjects);
   const journalPath=path.join(ROOT,'reports/intel-build/fork-journal.json'),journal=freshJournal(build,definition.owner,definition.selection,MAX_CAP,'local-fork-plan',rpc);journal.forkAnchor=live;
   const send=await sender(provider,journal,journalPath,local,{local:true,localContext:live}),verified=await deployAll(provider,send,journal,journalPath,build,definition.subjects);
   for(const s of journal.subjects)await capture(provider,send,journal,journalPath,verified,BigInt(s.id),'plan-baseline:'+s.id);
   await local.request({method:'evm_increaseTime',params:[61]});await local.request({method:'evm_mine',params:[]});await capture(provider,send,journal,journalPath,verified,1n,'plan-second:1');
   const deployment=journal.receipts.filter(r=>r.key.startsWith('deploy:')||r.key.startsWith('register:')),deploymentGas=deployment.reduce((sum,r)=>sum+BigInt(r.receipt.gasUsed),0n),totalGas=journal.receipts.reduce((sum,r)=>sum+BigInt(r.receipt.gasUsed),0n);
   const plan={format:'s0ul-intel-deploy-plan-v1',readOnlyMainnet:true,realTransactionsSent:0,buildFingerprint:build.manifest.buildFingerprint,selection:definition.selection,owner:definition.owner,publicRpc:rpc,forkAnchor:live,minSpacing:MIN_SPACING,maxAge:MAX_AGE,capWei:MAX_CAP,feeCeilingWeiPerGas:journal.acceptedFeeCeilingWeiPerGas,feeBufferBps:5000,gasBufferBps:2000,gasCap:OP_CAP,deploymentTransactions:deployment.length,deploymentGas,allPlanGas:totalGas,estimatedDeploymentFeeWei:deploymentGas*live.gasPriceWei,bufferedDeploymentReserveWei:deployment.reduce((sum,r)=>sum+BigInt(r.reserveWei),0n),actualLocalPlanFeeWei:journal.spentWei,operations:journal.receipts,contracts:journal.contracts,subjects:journal.subjects,proofs:journal.proofs,notes:['All plan sends execute only on an in-process Ganache fork with the public owner impersonated and locally funded.','No real signer or private key is used by plan.','Fork gas measures ordinary EVM execution; Nitro L1 data-posting gas is not emulated. Mainnet writes are independently estimated on the live public chain before each send.','First sample is a baseline label5; second after61 local seconds demonstrates stored-history comparison.','Deployment addresses in this plan are nonce predictions on a local fork and are not confirmed mainnet deployments.']};atomic(PLAN,plan);console.log(json({mode:'plan',path:path.relative(REPO,PLAN),buildFingerprint:plan.buildFingerprint,deploymentTransactions:plan.deploymentTransactions,deploymentGas,estimatedDeploymentFeeWei:plan.estimatedDeploymentFeeWei,bufferedDeploymentReserveWei:plan.bufferedDeploymentReserveWei,allPlanGas:totalGas,firstLabel:journal.proofs[0].label,secondLabel:journal.proofs.at(-1).label}));return;
  }
  if(args.mode==='reconcile'){
   if(!fs.existsSync(JOURNAL))throw Error('No mainnet deployment journal');const journal=JSON.parse(fs.readFileSync(JOURNAL));if(!journal.pending)throw Error('Journal has no unresolved transaction');if(journal.buildFingerprint!==build.manifest.buildFingerprint)throw Error('Build differs from unresolved transaction journal');const pending={...journal.pending},{receipt,record}=await settle(provider,journal,JOURNAL,args.hash??pending.hash);
   if(pending.key.startsWith('deploy:')){const role=pending.key.slice(7),name=NAMES.find(n=>ROLE[n]===role);if(!name||!same(receipt.contractAddress,pending.predictedAddress))throw Error('Reconciled deployment identity mismatch');journal.contracts[role]={...await verifyRuntime(provider,receipt.contractAddress,build.artifacts[name],receipt),name,transactionHash:record.hash,blockNumber:receipt.blockNumber};await verifyPartialGetters(provider,role,journal.contracts,journal.owner,build);atomic(JOURNAL,journal);}
   if(pending.key.startsWith('sample:')){const verified=await verifyGetters(provider,journal.contracts,journal.owner,build);await proofFromReceipt(provider,journal,JOURNAL,verified,BigInt(pending.key.split(':')[1]),receipt,record);saveProofs(journal,build);}
   console.log(json({mode:'reconcile',resolved:true,hash:record.hash,spentWei:journal.spentWei,next:'Re-run the original explicit write command to verify and continue.'}));return;
  }
  await verifyCandidates(publicProvider,definition.subjects);const capWei=writeAuthorization(args,build);let journal;
  if(fs.existsSync(JOURNAL)){journal=JSON.parse(fs.readFileSync(JOURNAL));if(journal.buildFingerprint!==build.manifest.buildFingerprint||journal.selection!==definition.selection||!same(journal.owner,definition.owner)||journal.chainId!==Number(CHAIN))throw Error('Existing mainnet journal identity/build/selection differs');if(journal.pending)throw Error('Unresolved journal transaction: reconcile exact saved hash first');await verifyPastReceipts(provider,journal);if(BigInt(journal.spentWei)>capWei)throw Error('Approved cumulative cap is below already spent fees');journal.approvedCapWei=capWei.toString();}else{if(args.mode==='sample')throw Error('No confirmed deployment to sample');journal=freshJournal(build,definition.owner,definition.selection,capWei,'mainnet',rpc);}
  const wallet=await credential(definition.owner),send=await sender(provider,journal,JOURNAL,wallet);
  if(args.mode==='deploy'){
   const verified=await deployAll(provider,send,journal,JOURNAL,build,definition.subjects);atomic(CONFIG,frontendConfig(journal,build));console.log(json({mode:'deploy',complete:true,contracts:journal.contracts,subjects:journal.subjects,modelId:verified.modelId,spentWei:journal.spentWei,config:path.relative(REPO,CONFIG)}));
  }else{
   if(!journal.complete)throw Error('Deployment is not confirmed complete');for(const name of NAMES)await verifyRuntime(provider,journal.contracts[ROLE[name]].address,build.artifacts[name]);const verified=await verifyGetters(provider,journal.contracts,journal.owner,build),id=exact(args['subject-id'],'--subject-id');
   const current=await verified.observations.subject(id);if(current.sequence>0n){const latest=await verified.observations.latest(id),block=await provider.getBlock('latest');if(block.timestamp<Number(latest.timestamp)+MIN_SPACING)throw Error('Sampling interval has not elapsed; no transaction was sent');}
   const proof=await capture(provider,send,journal,JOURNAL,verified,id,'sample:'+id+':'+(BigInt(current.sequence)+1n));saveProofs(journal,build);console.log(json({mode:'sample',proof,spentWei:journal.spentWei}));
  }
 }finally{if(provider!==publicProvider)await provider.destroy();await local?.disconnect();await publicProvider.destroy();}
}
main().catch(error=>{console.error('S0UL Intel: '+String(error?.shortMessage??error?.message??'Operation failed').slice(0,1200));process.exitCode=1;});
