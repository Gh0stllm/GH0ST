import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {HERE} from '../scripts/build.mjs';
import {JOB_ROUTE_ID,JOB_ROUTE_IDS,makeJobPlan} from '../scripts/job-plan.mjs';
import {validateJobRuntimeConfig,resolveJobSelection,jobReportPath} from '../scripts/verify-job-deployment.mjs';
import {packJobTokens,validateJobInput,parseJobArgs,nextJobAction,sendJobAction,jobFeeOverrides} from '../scripts/job-worker.mjs';
const example=JSON.parse(fs.readFileSync(path.join(HERE,'config/job.runtime.example.json')));
const address=n=>'0x'+n.toString(16).padStart(40,'0');
function config() {
 const c=structuredClone(example);Object.assign(c,{sessionId:'0x'+'12'.repeat(32),admin:address(1),requester:address(2),deadline:2000000000});
 for(const [i,ch] of c.chains.entries()){ch.router=address(10+i);ch.routerDeploymentTx='0x'+'ab'.repeat(32);if(i){ch.engine=address(20);ch.root=address(21);ch.engineDeploymentTx='0x'+'cd'.repeat(32);}}
 return c;
}
test('job configuration pins canonical home-only and complete compute roles',()=>assert.equal(validateJobRuntimeConfig(config()).routeId,JOB_ROUTE_ID));
test('disabled example cannot be mistaken for populated deployment',()=>assert.throws(()=>validateJobRuntimeConfig(example)));
test('arbitrary engine, router and route configuration are rejected',()=>{
 for(const update of [{engineContract:'GPT2ShardOptimizedV2'},{engineContract:'MockGPT2Shard'},{routerContract:'GPT2InferenceOApp'},{routeConfiguration:'/tmp/job.json'},{routeKind:'pipeline'}])assert.throws(()=>validateJobRuntimeConfig({...config(),...update}));
 assert.equal(resolveJobSelection().engineContract,'GPT2ShardOptimized');
});
test('wrong model, route or zero session cannot authorize a job',()=>{
 for(const field of ['modelId','routeId','sessionId']){const c=config();c[field]='0x'+'00'.repeat(32);assert.throws(()=>validateJobRuntimeConfig(c));}
});
test('home cannot contain an engine, weights or engine creation transaction',()=>{
 for(const field of ['engine','root','engineDeploymentTx']){const c=config();c.chains[0][field]=field.endsWith('Tx')?'0x'+'ab'.repeat(32):address(99);assert.throws(()=>validateJobRuntimeConfig(c),/HOME_MUST_NOT_COMPUTE/);}
});
test('compute requires exact role/chain/EID and every deployment identity',()=>{
 for(const [field,value] of [['chainId',56],['eid',30102],['role','home'],['stage',0],['key','bsc'],['engine',null],['root',null],['engineDeploymentTx',null]]){const c=config();c.chains[1][field]=value;assert.throws(()=>validateJobRuntimeConfig(c));}
});
test('positive bounded native gas limits and strict fee decimals are required',()=>{
 for(const [index,value] of [[0,'16777217'],[1,'30000001'],[1,'100000'],[1,'-1'],[1,'3e7']]){const c=config();c.chains[index].maxTransactionGas=value;assert.throws(()=>validateJobRuntimeConfig(c));}
 for(const value of ['-1','1e9','1.5',null,Infinity]){const c=config();c.chains[1].maxFeePerGasWei=value;assert.throws(()=>validateJobRuntimeConfig(c));}
});
test('RPC config uses names rather than URLs and confirmation count is bounded',()=>{
 for(const update of [{rpcEnv:'https://secret.invalid'},{confirmations:0},{confirmations:100001}]){const c=config();Object.assign(c.chains[0],update);assert.throws(()=>validateJobRuntimeConfig(c));}
});
test('verification reports cannot overwrite model data or escape the project',()=>{
 for(const verificationFile of ['../../../../outside.json','../../data/manifest.json'])assert.throws(()=>jobReportPath(path.join(HERE,'deployments/job/runtime.json'),{verificationFile}));
 assert.equal(jobReportPath(path.join(HERE,'deployments/job/runtime.json'),{verificationFile:'verified.json'}),path.join(HERE,'deployments/job/verified.json'));
});
test('token packing is exact four-byte big-endian and input budget includes prefill',()=>{
 assert.equal(packJobTokens([0,1,50256]),'0x00000000000000010000c450');
 assert.equal(validateJobInput([50256],1024),'0x0000c450');
 assert.throws(()=>validateJobInput([1,2],1024));
 for(const values of [[],[-1],[50257],[1.1],['1']])assert.throws(()=>packJobTokens(values));
});
test('CLI defaults read-only and rejects malformed/duplicate options',()=>{
 assert.equal(parseJobArgs([]).execute,false);assert.equal(parseJobArgs(['--help']).help,true);
 for(const args of [['--execute=false'],['--prompt-tokens=1,,2'],['--prompt-tokens='],['--generate=1','--generate=2'],['--once','--watch'],['--interval-ms=999'],['--interval-ms=60001'],['--engine=evil']])assert.throws(()=>parseJobArgs(args));
});
function connections(state={}) {
 const h={resultFinalized:false,requested:true,...state.home},c={awaitingActivation:false,running:false,completed:false,resultDispatched:false,...state.compute};
 const home={router:Object.fromEntries(Object.entries(h).map(([k,v])=>[k,async()=>v]))};
 const compute={router:Object.fromEntries(Object.entries(c).map(([k,v])=>[k,async()=>v])),engine:{phase:async()=>state.phase??1}};
 return [home,compute];
}
test('worker requests once, waits for receipt, and finalizes only a complete job',async()=>{
 let [h,c]=connections({home:{requested:false}});assert.equal((await nextJobAction(h,c,{packed:'0x00000001',generate:2})).method,'requestJob');
 [h,c]=connections();assert.equal((await nextJobAction(h,c)).kind,'idle');
 [h,c]=connections({home:{resultFinalized:true}});assert.equal((await nextJobAction(h,c)).kind,'complete');
});
test('worker activates authenticated prompt then computes and continues locally',async()=>{
 for(const [state,expected] of [[{compute:{awaitingActivation:true}},'activate'],[{compute:{running:true},phase:3},'compute'],[{compute:{running:true},phase:12},'continueJob'],[{compute:{completed:true}},'dispatchResult']]){
  const [h,c]=connections(state),a=await nextJobAction(h,c);assert.equal(a.method??a.kind,expected);
 }
 const [h,c]=connections({compute:{running:true},phase:0});await assert.rejects(nextJobAction(h,c));
});
function fakeConnection({failPreflight=false,fee=2n,deadline=100,blockTime=1,changingQuote=false}={}) {
 const calls=[];
 const action=async(...args)=>{calls.push(['send',args]);return {wait:async()=>({status:1,hash:'0xreceipt',gasUsed:100000n})};};
 action.estimateGas=async(...args)=>{calls.push(['estimate',args]);return 100000n;};
 action.staticCall=async(...args)=>{calls.push(['simulate',args]);if(failPreflight)throw Error('revert');};
 let quotes=0;
 return {calls,execute:true,deadline,config:{key:'monad',chainId:143,maxTransactionGas:'30000000',maxMessageFeeWei:'10',maxFeePerGasWei:'5',confirmations:1},
  provider:{getBlock:async()=>({timestamp:blockTime}),getFeeData:async()=>({maxFeePerGas:fee,maxPriorityFeePerGas:1n,gasPrice:null})},
  router:{continueJob:action,dispatchResult:action,quoteResult:async()=>({nativeFee:changingQuote?BigInt(++quotes):1n,lzTokenFee:0n})}};
}
test('failed preflight, expired deadline and fee cap failures never send',async()=>{
 for(const options of [{failPreflight:true},{deadline:0},{fee:6n}]){const c=fakeConnection(options);await assert.rejects(sendJobAction(c,'continueJob'));assert.equal(c.calls.filter(x=>x[0]==='send').length,0);}
});
test('paid helper refuses read-only connection and changing message fees',async()=>{
 const c=fakeConnection();c.execute=false;await assert.rejects(sendJobAction(c,'continueJob'));assert.equal(c.calls.length,0);
 const d=fakeConnection({changingQuote:true});await assert.rejects(sendJobAction(d,'dispatchResult',[],'quoteResult'));assert.equal(d.calls.filter(x=>x[0]==='send').length,0);
});
test('Monad router actions use estimate plus1percent+1000 and exact-limit preflight',async()=>{
 const c=fakeConnection();await sendJobAction(c,'continueJob');
 assert.equal(c.calls[1][0],'simulate');assert.equal(c.calls[1][1].at(-1).gasLimit,102000n);assert.equal(c.calls[2][1].at(-1).gasLimit,102000n);
});
test('canonical offline plan gives RH no data and all77 tensors to Monad',()=>{
 const data=path.resolve(HERE,'../gpt2-bsc/data');if(!fs.existsSync(path.join(data,'manifest.json')))return;
 const p=makeJobPlan(data);assert.equal(p.routeId,JOB_ROUTE_ID);assert.equal(p.stages[0].tensorIds.length,0);
 assert.equal(p.stages[0].catalogContracts,0);assert.equal(p.stages[1].tensorIds.length,77);assert.equal(p.totals.duplicatedPayloadBytes,0);assert.equal(p.totals.messagesPerJob,2);
});

function opbnbConfig() {
 const c=config();c.computeChain='opbnb';c.routeId=JOB_ROUTE_IDS.opbnb;
 Object.assign(c.chains[1],{key:'opbnb',chainId:204,eid:30202,rpcEnv:'OPBNB_RPC_URL',profile:'ethereum',endpoint:'0x1a44076050125825900e736c501f859c50fe728c',maxTransactionGas:'16777216'});
 return c;
}
test('opBNB selection has its own canonical route, endpoint, profile and cap',()=>{
 const c=opbnbConfig();assert.equal(validateJobRuntimeConfig(c),c);
 for(const update of [{routeId:JOB_ROUTE_ID},{computeChain:'bsc'}])assert.throws(()=>validateJobRuntimeConfig({...c,...update}));
 for(const update of [{endpoint:'0x'+'11'.repeat(20)},{profile:'monad'},{maxTransactionGas:'16777217'}]){const bad=structuredClone(c);Object.assign(bad.chains[1],update);assert.throws(()=>validateJobRuntimeConfig(bad));}
 const data=path.resolve(HERE,'../gpt2-bsc/data');if(fs.existsSync(path.join(data,'manifest.json'))){const plan=makeJobPlan(data,{computeChain:'opbnb'});assert.equal(plan.routeId,JOB_ROUTE_IDS.opbnb);assert.equal(plan.stages[1].tensorIds.length,77);assert.equal(plan.stages[1].profile,'ethereum');}
});
test('custom bids are optional, opBNB-only and bounded by the explicit operator cap',()=>{
 const c=opbnbConfig();c.chains[1].maxFeePerGasWei='10000';c.chains[1].gasPriceWei='1009';assert.equal(validateJobRuntimeConfig(c),c);
 for(const bid of ['0','10001','1e3',-1]){const bad=structuredClone(c);bad.chains[1].gasPriceWei=bid;assert.throws(()=>validateJobRuntimeConfig(bad));}
 const bad=config();bad.chains[1].gasPriceWei='1009';bad.chains[1].maxFeePerGasWei='10000';assert.throws(()=>validateJobRuntimeConfig(bad));
});
test('explicit opBNB bid is checked against live base plus1001wei immediately before send',async()=>{
 const c=fakeConnection();Object.assign(c.config,{key:'opbnb',chainId:204,maxFeePerGasWei:'10000',gasPriceWei:'1009'});
 let feeReads=0;c.provider={getBlock:async()=>({timestamp:1,baseFeePerGas:8n}),getFeeData:async()=>{feeReads++;throw Error('must not consult suggested fees');}};
 assert.deepEqual(await jobFeeOverrides(c),{gasPrice:1009n});assert.equal(feeReads,0);
 c.config.gasPriceWei='1008';await assert.rejects(jobFeeOverrides(c),/priority floor/);
 c.config.gasPriceWei='10001';await assert.rejects(jobFeeOverrides(c),/cap/);
 c.config.gasPriceWei='1009';c.provider.getBlock=async()=>({timestamp:1,baseFeePerGas:9n});await assert.rejects(jobFeeOverrides(c),/priority floor/);
 c.provider.getBlock=async()=>({timestamp:101,baseFeePerGas:8n});await assert.rejects(jobFeeOverrides(c),/expired/);
});
test('opBNB default keeps provider fee suggestions; missing base fee fails explicit lowbid',async()=>{
 const c=fakeConnection();Object.assign(c.config,{key:'opbnb',chainId:204,maxFeePerGasWei:'2000000'});
 c.provider.getFeeData=async()=>({maxFeePerGas:null,maxPriorityFeePerGas:null,gasPrice:1000000n});assert.deepEqual(await jobFeeOverrides(c),{gasPrice:1000000n});
 c.config.gasPriceWei='1009';await assert.rejects(jobFeeOverrides(c),/base fee/);
});
test('self-relay mode requires pinned two-DVN metadata and exact executor provenance inputs',()=>{
 const c=opbnbConfig();c.executorMode='self-relay';
 const transport={
  robinhood:{sendLibrary:'0xc39161c743d0307eb9bcc9fef03eeb9dc4802de7',receiveLibrary:'0xe1844c5d63a9543023008d332bd3d2e6f1fe1043',requiredDVNs:['0x1258a278519c7f4bd997a9c3bfd4aa802a028d89','0xd01ae6905d48315f7be10c7330aecf8360ef5b12']},
  opbnb:{sendLibrary:'0x44289609cc6781fa2c665796b6c5aabf9ffcedc5',receiveLibrary:'0x9c9e25f9fc4e8134313c2a9f5c719f5c9f4fbd95',requiredDVNs:['0x3ebb618b5c9d09de770979d552b27d6357aff73b','0xdd7b5e1db4aafd5c8ec3b764efb8ed265aa5445b']},
 };
 for(const chain of c.chains)Object.assign(chain,transport[chain.key],{selfRelayExecutor:addrForTest(chain.stage),selfRelayExecutorDeploymentTx:'0x'+'ef'.repeat(32),dvnConfirmations:20});
 function addrForTest(stage){return address(50+stage);}
 assert.equal(validateJobRuntimeConfig(c),c);
 for(const update of [{selfRelayExecutor:null},{selfRelayExecutorDeploymentTx:null},{requiredDVNs:[address(99),address(98)]},{dvnConfirmations:0},{sendLibrary:address(99)}]){
  const bad=structuredClone(c);Object.assign(bad.chains[1],update);assert.throws(()=>validateJobRuntimeConfig(bad));
 }
 const bad=structuredClone(c);bad.executorMode='dummy';assert.throws(()=>validateJobRuntimeConfig(bad));
});
