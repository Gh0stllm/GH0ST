// Exact GPO pricing in a disposable LOCAL Anvil fork. No keys or transactions.
// Default is offline dry-run. --run permits public state reads and three FIXED
// synthetic oracle comparisons; workload eth_call requests stay on localhost.
// The upstream proxy rejects eth_call, estimation, signing and all send methods.
// The canonical snapshot is never changed. Output goes to a new reports/ file.
// Requires Node >=20, the package's ethers dependency and Anvil in PATH (or ANVIL_BIN).
// Example: node scripts/quote-opbnb-posting.mjs --run
// Historical: add --block=199271251 --block-hash=0x1d3853ecd4ff3ae7f82e700b8e97116d90c28fd9a20c83d958e37c9a82dc327c
// Historical source-state availability depends on the public RPC's archive retention.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Interface,Transaction,keccak256} from 'ethers';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FJORD_RUNTIME_HASH='0xa88fa50a2745b15e6794247614b5298483070661adacb8d32d716434ed24c6b2';
function parseArgs(args){
  if(args.length===1&&args[0]==='--help')return {help:true};
  const names=['ledger','benchmark','out','block','block-hash'];
  assert(args.every(x=>x==='--run'||names.some(k=>x.startsWith('--'+k+'='))),'Unknown option');
  for(const name of [...names,'run'])assert(args.filter(x=>x==='--'+name||x.startsWith('--'+name+'=')).length<=1,'Duplicate option');
  const option=(key,fallback)=>args.find(x=>x.startsWith('--'+key+'='))?.slice(key.length+3)??fallback;
  const block=option('block',null),blockHash=option('block-hash',null);
  assert(block===null||/^[0-9]+$/.test(block)&&Number.isSafeInteger(Number(block)),'Invalid block');
  assert(blockHash===null||block!==null&&/^0x[0-9a-fA-F]{64}$/.test(blockHash),'Block hash requires a block number');
  const output=path.resolve(ROOT,option('out','reports/opbnb-posting/quote.json'));
  assert(output.startsWith(path.join(ROOT,'reports')+path.sep)&&output.endsWith('.json'),'Output must be a reports/ JSON file');
  let parent=path.dirname(output);while(!fs.existsSync(parent))parent=path.dirname(parent);
  assert(fs.realpathSync(parent).startsWith(fs.realpathSync(ROOT)+path.sep),'Output parent escapes project');
  assert(!fs.existsSync(output),'Refusing to overwrite existing evidence');
  return {run:args.includes('--run'),block,blockHash,output,ledger:path.resolve(ROOT,option('ledger','reports/job-opbnb-full/transactions.jsonl')),benchmark:path.resolve(ROOT,option('benchmark','reports/job-opbnb-full/results.json'))};
}
const help='quote-opbnb-posting.mjs [--run] [--ledger=reports/job-opbnb-full/transactions.jsonl] [--benchmark=reports/job-opbnb-full/results.json] [--out=reports/opbnb-posting/quote.json] [--block=NUMBER --block-hash=0xHASH]\nOffline validation by default. --run uses a disposable local oracle fork; only public state and fixed synthetic patterns reach the public RPC. No signing, broadcasts or canonical snapshot edits. Historical block reproduction requires upstream archive availability.';
const upstream='https://opbnb-mainnet-rpc.bnbchain.org',gpo='0x420000000000000000000000000000000000000f';
const allowed=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getStorageAt','eth_getBalance','eth_getTransactionCount','eth_getProof','net_version','web3_clientVersion','eth_gasPrice']);
export function publicStateRequest(q) {
  assert(q && typeof q === 'object' && allowed.has(q.method), 'Public state method required');
  assert(Number.isSafeInteger(q.id) && q.id >= 0, 'Numeric request ID required');
  const p=q.params??[]; assert(Array.isArray(p),'Positional parameters required');
  const address=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{40}$/.test(x);
  const word=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{1,64}$/.test(x);
  const hash=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{64}$/.test(x);
  const tag=x=>word(x)||['latest','earliest','pending','safe','finalized'].includes(x);
  if(['eth_chainId','eth_blockNumber','net_version','web3_clientVersion','eth_gasPrice'].includes(q.method)) assert.equal(p.length,0);
  else if(q.method==='eth_getBlockByNumber') assert(p.length===2&&tag(p[0])&&typeof p[1]==='boolean');
  else if(q.method==='eth_getBlockByHash') assert(p.length===2&&hash(p[0])&&typeof p[1]==='boolean');
  else if(q.method==='eth_getStorageAt') assert(p.length===3&&address(p[0])&&word(p[1])&&tag(p[2]));
  else if(q.method==='eth_getProof') assert(p.length===3&&address(p[0])&&Array.isArray(p[1])&&p[1].length<=64&&p[1].every(word)&&tag(p[2]));
  else assert(p.length===2&&address(p[0])&&tag(p[1]));
  return {jsonrpc:'2.0',id:q.id,method:q.method,params:p};
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function createOracleFork(options){
const stats={};let id=0;async function stateRead(request){const queries=(Array.isArray(request)?request:[request]).map(publicStateRequest);assert(queries.length>0&&queries.length<=100);for(const q of queries)stats[q.method]=(stats[q.method]??0)+1;const res=await fetch(upstream,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Array.isArray(request)?queries:queries[0]),signal:AbortSignal.timeout(12000),redirect:'error'});assert(res.ok);return res.json();}
async function read(method,params=[]){const r=await stateRead({jsonrpc:'2.0',id:++id,method,params});assert(!r.error,JSON.stringify(r.error));return r.result;}
assert.equal(await read('eth_chainId'),'0xcc');const block=await read('eth_getBlockByNumber',[options.block===null?'latest':'0x'+BigInt(options.block).toString(16),false]);assert(block?.hash,'Requested source block is unavailable; historical reproduction needs an archive-capable source');if(options.blockHash)assert.equal(block.hash.toLowerCase(),options.blockHash.toLowerCase(),'Pinned block hash differs');
assert.equal(BigInt(block.baseFeePerGas),0n,'The fixed bid scenarios require source base fee zero');
const proxy=http.createServer(async(req,res)=>{try{let body='';for await(const part of req){body+=part;assert(body.length<1000000);}const data=await stateRead(JSON.parse(body));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));}catch{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32000,message:'Public state request failed validation or lookup'}}));}});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const p=net.createServer();await new Promise(r=>p.listen(0,'127.0.0.1',r));const port=p.address().port;await new Promise(r=>p.close(r));
const args=['--host','127.0.0.1','--port',String(port),'--chain-id','204','--network','ethereum','--hardfork','cancun','--fork-url',`http://127.0.0.1:${proxy.address().port}`,'--fork-block-number',String(BigInt(block.number)),'--fork-state-by-number','--no-fork-node-info','--no-bal','--retries','0','--timeout','12000','--gas-limit','100000000','--gas-price','0','--block-base-fee-per-gas','0','--silent'];
const child=spawn(process.env.ANVIL_BIN||'anvil',args,{stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',b=>err=(err+b).slice(-2000));const url=`http://127.0.0.1:${port}`;
let spawnError=null;child.on('error',error=>{spawnError=error;});
async function local(method,params=[]){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)}).then(r=>r.json());assert(!r.error,JSON.stringify(r.error));return r.result;}
async function stop(){if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(1000)]);if(child.exitCode===null)child.kill('SIGKILL');}await new Promise(r=>proxy.close(r));}
try{let ready=false;for(let i=0;i<100;i++){if(spawnError)throw Error('Anvil is unavailable; set ANVIL_BIN or install it in PATH');if(child.exitCode!==null)throw Error(err);try{ready=(await local('eth_chainId'))==='0xcc';if(ready)break;}catch{}await delay(100);}assert(ready,err);
const itf=new Interface(['function getL1Fee(bytes) view returns(uint256)']);const validations=[];
// ONLY these three literal public synthetic patterns may enter this separate public call.
for(const bytes of ['0x'+'00'.repeat(100),'0x'+'ab'.repeat(143),'0x'+'0123456789abcdef'.repeat(40)]){
 const data=itf.encodeFunctionData('getL1Fee',[bytes]);const request={jsonrpc:'2.0',id:++id,method:'eth_call',params:[{to:gpo,data},block.number]};
 const remote=await fetch(upstream,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(15000)}).then(r=>r.json());assert(!remote.error,JSON.stringify(remote.error));const actual=await local('eth_call',[{to:gpo,data},'latest']);assert.equal(actual,remote.result,'Synthetic local/remote oracle mismatch');validations.push({patternBytes:(bytes.length-2)/2,pattern:bytes.slice(0,18),l1FeeWei:String(itf.decodeFunctionResult('getL1Fee',actual)[0])});
}
return{url,block,stats,validations,stop,info:{status:'LOCAL_FORK_ORACLE_MATCHED_PUBLIC_SYNTHETIC_PATTERNS',publicWorkloadCalls:0,syntheticPublicCalls:validations.length,publicProxyAllowedMethods:[...allowed],nodeArguments:args,localNodeInfo:await local('anvil_nodeInfo')}};
}catch(e){await stop();throw e;}
}

export async function run(args){
const options=parseArgs(args);if(options.help){console.log(help);return;}
const root=ROOT;
const ledgerFile=options.ledger,reportFile=options.benchmark,snapshotFile=path.join(ROOT,'research/opbnb-snapshot.json');
const results=JSON.parse(fs.readFileSync(reportFile));assert(results.status.startsWith('PASS_'),'Complete successful local benchmark required');
const original=fs.readFileSync(ledgerFile),entries=original.toString().trim().split('\n').map(JSON.parse);
const included=new Set(['model_compute','job_control_and_begin','job_control_and_next_begin','job_result_send']);
const actions=entries.filter(x=>Number(x.chain_id)===204&&included.has(x.category));assert(actions.length>0,'No complete opBNB actions');
assert(actions.every(x=>typeof x.calldata==='string'&&/^0x[0-9a-f]*$/i.test(x.calldata)),'Missing full simulator calldata');
// Restrict inputs to the published benchmark. Workload calldata stays local even after these checks.
const disclosureAbi=new Interface(['function advance(uint32 expectedStep,uint32 maxRows)','function advanceMany(uint32 expectedStep,uint32 maxRows,uint16 maxSteps)','function activateJob(bytes tokens)','function continueJob()','function dispatchResult()']);
for(const action of actions){const call=disclosureAbi.parseTransaction({data:action.calldata});assert(call,'Unknown calldata is forbidden');assert.equal(disclosureAbi.encodeFunctionData(call.fragment,call.args),action.calldata);if(call.name==='activateJob')assert.equal(call.args[0],'0x0000c450','Only the canonical EOS50256 benchmark fixture is supported');else if(call.name==='advance'||call.name==='advanceMany'){assert(call.args[0]<100000n&&call.args[1]>0n&&call.args[1]<=512n);if(call.name==='advanceMany')assert(call.args[2]>0n&&call.args[2]<=64n);}else assert.equal(call.args.length,0);}

if(!options.run){console.log(JSON.stringify({status:'OFFLINE_DRY_RUN',actions:actions.length,sourceBlock:options.block??'latest at explicit run',output:path.relative(ROOT,options.output),networkRequests:0,publicWorkloadCalls:0},null,2));return;}
const oracleFork=await createOracleFork(options);try{
const snapshot=JSON.parse(fs.readFileSync(snapshotFile)),url=oracleFork.url,gpo='0x420000000000000000000000000000000000000f';
const itf=new Interface(['function getL1Fee(bytes) view returns(uint256)','function isFjord() view returns(bool)','function l1BaseFee() view returns(uint256)','function blobBaseFee() view returns(uint256)','function baseFeeScalar() view returns(uint32)','function blobBaseFeeScalar() view returns(uint32)']);
let rid=0;async function rpcBatch(requests){const batch=requests.map(x=>({jsonrpc:'2.0',id:++rid,...x}));const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(batch),signal:AbortSignal.timeout(25000)});assert(res.ok,'RPC transport failure');const payload=await res.json();assert(Array.isArray(payload),'Batch unsupported');const byId=new Map(payload.map(x=>[x.id,x]));return batch.map(q=>{const r=byId.get(q.id);assert(r&&!r.error&&r.result!==undefined,'RPC result missing or failed');return r.result;});}
const [cid]=await rpcBatch([{method:'eth_chainId',params:[]}]);assert.equal(cid,'0xcc');const [block]=await rpcBatch([{method:'eth_getBlockByNumber',params:['latest',false]}]);
assert.equal(BigInt(block.baseFeePerGas),0n,'Explicit price scenarios currently require live basefee0');
const implementationSlot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const [implementationWord]=await rpcBatch([{method:'eth_getStorageAt',params:[gpo,implementationSlot,block.number]}]);
const implementation='0x'+implementationWord.slice(-40);
const [implementationCode]=await rpcBatch([{method:'eth_getCode',params:[implementation,block.number]}]);
assert.equal(snapshot.gpo.deployedIdentity.implementationCodeHash,FJORD_RUNTIME_HASH,'Recorded oracle is not the verified Fjord runtime');
assert.equal(keccak256(implementationCode),FJORD_RUNTIME_HASH,'Fee oracle implementation changed');
const funcs=['isFjord','l1BaseFee','blobBaseFee','baseFeeScalar','blobBaseFeeScalar'];const stateRaw=await rpcBatch(funcs.map(f=>({method:'eth_call',params:[{to:gpo,data:itf.encodeFunctionData(f,[])},block.number]})));const state=Object.fromEntries(funcs.map((f,i)=>[f,String(itf.decodeFunctionResult(f,stateRaw[i])[0])]));assert.equal(state.isFjord,'true');
const rawLocal=x=>{const type=Number(x.transaction_type),tx={type,chainId:204,nonce:Number(x.nonce),gasLimit:BigInt(x.declared_gas),to:x.to,value:BigInt(x.value),data:x.calldata};if(type===0||type===1)tx.gasPrice=BigInt(x.gas_price);else {tx.maxFeePerGas=BigInt(x.max_fee_per_gas);tx.maxPriorityFeePerGas=BigInt(x.max_priority_fee_per_gas);}if(type===1||type===2)tx.accessList=x.access_list??[];return Transaction.from(tx).unsignedSerialized;};
const raws=actions.flatMap((x,index)=>{
 const local=rawLocal(x);const common={chainId:204,nonce:Number(x.nonce),gasLimit:BigInt(x.declared_gas),to:x.to,value:BigInt(x.value),data:x.calldata};
 return [{index,scenario:'original_local_fee_fields',raw:local},{index,scenario:'recommended_type2_1000000wei',raw:Transaction.from({...common,type:2,maxFeePerGas:1000000n,maxPriorityFeePerGas:1000000n,accessList:[]}).unsignedSerialized},{index,scenario:'observed_low_legacy_10000wei',raw:Transaction.from({...common,type:0,gasPrice:10000n}).unsignedSerialized}];
});
const feeByRaw=new Map(),unique=[...new Set(raws.map(x=>x.raw))],batches=[];for(let i=0;i<unique.length;i+=20)batches.push(unique.slice(i,i+20));let next=0;
await Promise.all(Array.from({length:Math.min(4,batches.length)},async()=>{while(next<batches.length){const items=batches[next++];const values=await rpcBatch(items.map(raw=>({method:'eth_call',params:[{to:gpo,data:itf.encodeFunctionData('getL1Fee',[raw])},block.number]})));items.forEach((raw,i)=>feeByRaw.set(raw,itf.decodeFunctionResult('getL1Fee',values[i])[0]));}}));
const [end]=await rpcBatch([{method:'eth_getBlockByNumber',params:[block.number,false]}]);assert.equal(end.hash,block.hash,'Snapshot block changed');
const rows=actions.map((x,index)=>({category:x.category,localTransactionHash:x.hash??x.transaction_hash??x.transactionHash??null,nonce:String(x.nonce),to:x.to,methodSelector:x.calldata.slice(0,10),calldataBytes:(x.calldata.length-2)/2,gasUsed:String(x.gas),declaredGas:String(x.declared_gas),scenarios:raws.filter(y=>y.index===index).map(y=>({scenario:y.scenario,unsignedRawKeccak256:keccak256(y.raw),unsignedRawBytes:(y.raw.length-2)/2,l1FeeWei:String(feeByRaw.get(y.raw))}))}));
const names=raws.slice(0,3).map(x=>x.scenario),nativeUsd=snapshot.gpo.fullJobLedger.market.raw.binancecoin.usd;
const totals=names.map(name=>{const posting=rows.reduce((a,x)=>a+BigInt(x.scenarios.find(y=>y.scenario===name).l1FeeWei),0n),gas=rows.reduce((a,x)=>a+BigInt(x.gasUsed),0n),bid=name.includes('1000000')?1000000n:name.includes('10000')?10000n:0n,execution=name==='original_local_fee_fields'?actions.reduce((a,x)=>a+BigInt(x.gas)*BigInt(x.effective_gas_price??0),0n):gas*bid;return{scenario:name,actions:rows.length,gasUsed:String(gas),l1PostingFeeWei:String(posting),executionGasPriceWei:String(bid),executionFeeWei:String(execution),combinedExecutionAndPostingWei:String(execution+posting),combinedExecutionAndPostingUsd:Number(execution+posting)/1e18*nativeUsd};});
const out={status:'EXACT_LOCAL_FORK_GPO_QUOTES_OF_LOCAL_ACTION_STRUCTURES_NOT_PAID_FEES',oracleExecution:oracleFork.info,publicStateReads:oracleFork.stats,syntheticValidation:oracleFork.validations,benchmarkStatus:results.status,localLedger:path.relative(root,ledgerFile),localLedgerSha256:createHash('sha256').update(original).digest('hex'),blockNumber:Number(BigInt(block.number)),blockHash:block.hash,oracle:gpo,implementation,implementationCodeHash:keccak256(implementationCode),oracleState:state,nativeUsd,actionCount:actions.length,excludedCategories:[...new Set(entries.filter(x=>!included.has(x.category)||Number(x.chain_id)!==204).map(x=>x.category))],totals,rows,limitations:['Local simulator addresses and nonces, not a deployed public job.','Data oracle input is unsigned serialization. Oracle adds68 signaturebytes exactly once.','Recommended scenario uses type2 maxFee=maxPriority=1000000wei, valid at capturedbasefee0. Low scenario useslegacy10000wei, no guaranteed inclusion.','Posting excludes model deployment, RH transactions and simulated endpoint delivery. Result-send source gas is local mock transport gas; production sender and messaging/treasury fees need separate quotes.','Provider executor pricing already includes destination execution; simulated receives must not be added again.']};
out.priceReference=snapshot.gpo.fullJobLedger.market;out.reproduction={scriptSha256:createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),sourceState:'Pinned public opBNB block through a read-only state proxy; no workload call is forwarded',note:'USD uses the bundled historical price reference, not a new market quote.'};
const categoryTotals={};for(const row of rows){const value=categoryTotals[row.category]??={actions:0,gasUsed:0n,postingFeeWei:0n};value.actions++;value.gasUsed+=BigInt(row.gasUsed);value.postingFeeWei+=BigInt(row.scenarios[1].l1FeeWei);}out.categoryTotals=categoryTotals;
fs.mkdirSync(path.dirname(options.output),{recursive:true});fs.writeFileSync(options.output,JSON.stringify(out,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:out.status,output:path.relative(ROOT,options.output),block:out.blockNumber,actions:out.actionCount,totals:out.totals},null,2));


}finally{await oracleFork.stop();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({status:'FAILED',reason:'LOCAL_ORACLE_PRICING_FAILED'}));process.exitCode=1;});
