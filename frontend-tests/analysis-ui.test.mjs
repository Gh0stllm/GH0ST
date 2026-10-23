import test from 'node:test';
import assert from 'node:assert/strict';
import {mountS0ULAnalysis,parseAnalysisETH,formatAnalysisETH,analysisQuoteMatches,loadS0ULAnalysisDeployment} from '../website/s0ul-analysis.mjs';

const OWNER='0x1111111111111111111111111111111111111111',OTHER='0x2222222222222222222222222222222222222222',TARGET='0x3333333333333333333333333333333333333333';
function dom(){
  class Element{constructor(){this.dataset={};this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.textContent='';this.listeners=new Map();this.children=[];}addEventListener(type,fn){this.listeners.set(type,fn);}removeEventListener(type){this.listeners.delete(type);}async fire(type){await this.listeners.get(type)?.();}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}removeAttribute(name){delete this[name];}}
  const root=new Element(),nodes=new Map();root.ownerDocument={defaultView:{location:{origin:'https://example.test'}},createElement:()=>new Element(),getElementById:()=>null};root.querySelector=selector=>nodes.get(selector.slice(1));Object.defineProperty(root,'innerHTML',{set(html){for(const[,id]of html.matchAll(/\bid="([^"]+)"/g))nodes.set(id,new Element());}});return{root,get:id=>nodes.get('analysis-'+id)};
}
function fixture(options={}){
  const d=dom(),calls=[],env={now:1_800_000_000_000,clientState:{verified:true,connected:false,address:null,chainId:null,busy:false,jobId:null,job:null,creditsWei:0n},...options};let emit;
  const client={get state(){return{...env.clientState};},ready:Promise.resolve(),async connect(){calls.push('connect');Object.assign(env.clientState,{connected:true,address:OWNER,chainId:4663});emit(client.state);},async quote({target,maxNewTokens}){calls.push('quote');await env.onQuote?.();return{owner:env.quoteOwner??OWNER,chainId:4663,target,maxNewTokens,expiresAt:env.now+45_000,escrowWei:2000n,openFeeReserveWei:100n,totalRequiredWei:2100n,maxRewardPerBatchWei:50n,feeCeilingWeiPerGas:10n,logicalCalls:3811,...env.quoteOverride};},async start(q,{budgetWei}){calls.push({method:'start',q,budgetWei});Object.assign(env.clientState,{jobId:7n,job:{owner:OWNER,target:q.target,state:1,failure:0,maxNewTokens:32,remaining:budgetWei,totalPaid:0n},engineStatus:{phase:1,generated:0},workerStatus:'unknown'});emit(client.state);},async quoteAction(input){calls.push({method:'quoteAction',input});return{...input,owner:OWNER,chainId:4663,expiresAt:env.now+45_000,feeReserveWei:99n,valueWei:input.valueWei??0n};},async execute(q){calls.push({method:'execute',q});},async refresh(){calls.push('refresh');emit(client.state);},async loadJob(id){calls.push({method:'loadJob',id});Object.assign(env.clientState,{jobId:id,job:{owner:OWNER,target:TARGET,state:1,maxNewTokens:32,remaining:2000n,totalPaid:0n},engineStatus:{phase:8,generated:1}});emit(client.state);},async reconcile(hash){calls.push({method:'reconcile',hash});env.clientState.pending=null;emit(client.state);},destroy(){calls.push('destroy');}};
  const mounted=mountS0ULAnalysis(d.root,{deployment:options.noDeployment?null:{chainId:4663},createClient:({onUpdate})=>{emit=onUpdate;emit(client.state);return client;},now:()=>env.now,setInterval:fn=>{env.tick=fn;return 1;},clearInterval(){}});
  const update=next=>{Object.assign(env.clientState,next);emit(client.state);};
  async function quote(){await mounted.ready;await d.get('connect').fire('click');d.get('target').value=TARGET;await d.get('calculate').fire('click');}
  return{...d,mounted,calls,env,client,update,quote};
}

test('reporting UI amounts preserve exact wei and quote approval binds owner/chain/address/job/expiry',()=>{
  assert.equal(parseAnalysisETH('0.000000000000000001'),1n);const value='9007199254740993.123456789012345678';assert.equal(formatAnalysisETH(parseAnalysisETH(value)),value);
  for(const invalid of ['0','-1','1e3','NaN','1.0000000000000000001'])assert.throws(()=>parseAnalysisETH(invalid));
  const q={owner:OWNER,chainId:4663,target:TARGET,jobId:7n,action:'cancel',expiresAt:2000},context={address:OWNER,chainId:4663,target:TARGET,jobId:7n,action:'cancel',now:1000};assert.equal(analysisQuoteMatches(q,context),true);
  for(const changed of [{address:OTHER},{chainId:1},{target:OTHER},{jobId:8n},{action:'withdraw'},{now:2000}])assert.equal(analysisQuoteMatches(q,{...context,...changed}),false);
});
test('missing deployment leaves every funding control closed without wallet or client calls',async t=>{
  const f=fixture({noDeployment:true});t.after(()=>f.mounted.destroy());await f.mounted.ready;assert.equal(f.calls.length,0);assert.equal(f.get('connect').disabled,true);assert.equal(f.get('calculate').disabled,true);assert.equal(f.get('start').disabled,true);assert.equal(f.get('funding').hidden,true);assert.match(f.get('notice').textContent,/not available yet/);
});
test('connect and calculate never fund a job; exact escrow and starting fee require explicit consent',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.mounted.ready;assert.equal(f.calls.length,0);assert.equal(f.get('calculate').disabled,true);await f.quote();
  assert.deepEqual(f.calls,['connect','quote']);assert.equal(f.get('escrow').textContent,'0.000000000000002 ETH');assert.equal(f.get('open-fee').textContent,'0.0000000000000001 ETH');assert.equal(f.get('total').textContent,'0.0000000000000021 ETH');assert.equal(f.get('start').disabled,true);
  await f.get('start').fire('click');assert.equal(f.calls.filter(c=>c.method==='start').length,0);
  f.get('funding-consent').checked=true;await f.get('funding-consent').fire('change');assert.equal(f.get('start').disabled,false);await f.get('start').fire('click');
  const starts=f.calls.filter(c=>c.method==='start');assert.equal(starts.length,1);assert.equal(starts[0].budgetWei,2000n);assert.equal(f.mounted.state.jobId,7n);assert.equal(f.calls.filter(c=>c.method==='execute').length,0);assert.match(f.get('worker-status').textContent,/has not been confirmed/);
});
test('expired, changed, unaffordable and internally inconsistent funding quotes cannot start',async()=>{
  for(const change of [f=>{f.env.now+=45_000;},async f=>{f.get('target').value=OTHER;await f.get('target').fire('input');},f=>f.update({address:OTHER}),f=>f.update({chainId:1})]){const f=fixture();await f.quote();f.get('funding-consent').checked=true;await change(f);await f.get('start').fire('click');assert.equal(f.calls.filter(c=>c.method==='start').length,0);f.mounted.destroy();}
  for(const quoteOverride of [{canAfford:false},{affordable:false},{workerAvailable:false},{totalRequiredWei:1n},{openFeeReserveWei:0n}]){const f=fixture({quoteOverride});await f.quote();f.get('funding-consent').checked=true;await f.get('start').fire('click');assert.equal(f.calls.filter(c=>c.method==='start').length,0);f.mounted.destroy();}
});
test('address edits while calculating cannot install an old funding quote',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.mounted.ready;await f.get('connect').fire('click');f.get('target').value=TARGET;f.env.onQuote=async()=>{f.get('target').value=OTHER;await f.get('target').fire('input');};await f.get('calculate').fire('click');assert.equal(f.mounted.state.fundingQuote,null);assert.equal(f.get('start').disabled,true);assert.match(f.get('notice').textContent,/changed/);
});
test('only completed actual stored report appears; report text cannot inject markup',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.mounted.ready;f.update({jobId:7n,job:{owner:OWNER,target:TARGET,state:1,maxNewTokens:32,remaining:100n,totalPaid:3n},report:'not completed',engineStatus:{phase:15,generated:4}});assert.equal(f.get('report').textContent,'No completed report yet.');assert.equal(f.get('phase').textContent,'Output logits');assert.equal(f.get('generated').textContent,'4 / 32 maximum');
  const report='<img src=x onerror=alert(1)> Actual test-only contract bytes.';f.update({job:{...f.env.clientState.job,state:2},report});assert.equal(f.get('report').textContent,report);assert.equal(f.get('report').children.length,0);
  f.update({job:{...f.env.clientState.job,state:3,failure:2},report:'must not show'});assert.match(f.get('report').textContent,/No accepted report.*Invalid model output/);assert.doesNotMatch(f.get('report').textContent,/must not show/);
});
test('resume is a read; manual continuation and owner refunds each need their own quote and consent',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.mounted.ready;f.get('resume-id').value='7';await f.get('load').fire('click');assert.equal(f.calls.filter(c=>c.method==='loadJob').length,1);assert.equal(f.calls.includes('connect'),false);assert.equal(f.get('cancel').hidden,true);
  await f.get('connect').fire('click');await f.get('cancel').fire('click');assert.equal(f.mounted.state.actionQuote.action,'cancel');assert.equal(f.calls.filter(c=>c.method==='execute').length,0);assert.equal(f.get('action-send').disabled,true);
  f.get('action-consent').checked=true;await f.get('action-consent').fire('change');await f.get('action-send').fire('click');assert.equal(f.calls.filter(c=>c.method==='execute').length,1);
  f.update({job:{...f.env.clientState.job,state:2},creditsWei:123n});assert.equal(f.get('refund').hidden,false);assert.equal(f.get('credit').hidden,false);await f.get('withdraw').fire('click');assert.equal(f.mounted.state.actionQuote.action,'withdraw');assert.equal(f.get('action-consent').checked,false);assert.equal(f.calls.filter(c=>c.method==='execute').length,1);
});
test('ambiguous funding blocks new quotes and sends until exact hash reconciliation',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.quote();f.update({pending:{hash:null}});assert.equal(f.get('recovery').hidden,false);assert.equal(f.get('start').disabled,true);assert.equal(f.get('calculate').disabled,true);f.get('funding-consent').checked=true;await f.get('start').fire('click');assert.equal(f.calls.filter(c=>c.method==='start').length,0);
  const hash='0x'+'aa'.repeat(32);f.get('recovery-hash').value=hash;await f.get('reconcile').fire('click');assert.equal(f.calls.find(c=>c.method==='reconcile').hash,hash);assert.equal(f.get('recovery').hidden,true);
});
test('polling reads chain progress and never sends a wallet continuation loop',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.quote();f.get('funding-consent').checked=true;await f.get('start').fire('click');await f.env.tick();await new Promise(resolve=>setTimeout(resolve,0));assert.ok(f.calls.includes('refresh'));assert.equal(f.calls.filter(c=>c.method==='start').length,1);assert.equal(f.calls.filter(c=>c.method==='execute').length,0);
});
test('a known submitted hash is reconciled automatically without resending or asking for another wallet action',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.quote();const hash='0x'+'ab'.repeat(32);f.update({pending:{hash}});await f.env.tick();assert.equal(f.calls.find(c=>c.method==='reconcile').hash,hash);assert.equal(f.calls.filter(c=>c.method==='start'||c.method==='execute').length,0);assert.equal(f.mounted.state.pending,null);
});
test('broken inference pins preserve owner cancel, refund and withdrawal review controls',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.mounted.ready;await f.get('connect').fire('click');f.update({verified:false,jobId:7n,job:{owner:OWNER,target:TARGET,state:1,maxNewTokens:32,remaining:2000n,totalPaid:0n},engineStatus:null,creditsWei:44n});
  assert.equal(f.get('cancel').disabled,false);assert.equal(f.get('withdraw').disabled,false);assert.equal(f.get('advance').disabled,true);assert.equal(f.get('topup').disabled,true);assert.equal(f.get('phase').textContent,'Awaiting chain status');await f.get('cancel').fire('click');assert.equal(f.mounted.state.actionQuote.action,'cancel');f.get('action-consent').checked=true;await f.get('action-consent').fire('change');assert.equal(f.get('action-send').disabled,false);await f.get('action-send').fire('click');assert.equal(f.calls.filter(c=>c.method==='execute').length,1);
  f.update({job:{...f.env.clientState.job,state:3}});assert.equal(f.get('refund').hidden,false);assert.equal(f.get('refund').disabled,false);
});
test('worker acceptance is distinguished from actual chain completion and an unconfirmed service is never promised',async t=>{
  const f=fixture();t.after(()=>f.mounted.destroy());await f.mounted.ready;f.update({jobId:7n,job:{owner:OWNER,target:TARGET,state:1,maxNewTokens:32,remaining:2000n,totalPaid:0n},engineStatus:{phase:1,generated:0},workerStatus:{available:true,status:'submitted'}});assert.match(f.get('worker-status').textContent,/accepted the continuation request/);assert.equal(f.get('report').textContent,'No completed report yet.');f.update({workerStatus:{available:false,status:'unavailable'}});assert.match(f.get('worker-status').textContent,/paused or unavailable/);assert.equal(f.calls.filter(c=>c.method==='execute'||c.method==='start').length,0);
});
test('runtime config is same-origin, no-store, and missing config stays unavailable',async()=>{
  const d=dom(),calls=[];const config=await loadS0ULAnalysisDeployment(d.root,{fetch:async(url,options)=>{calls.push({url,options});return{status:404};}});assert.equal(config,null);assert.equal(calls[0].url,'https://example.test/s0ul-analysis-deployment.json');assert.equal(calls[0].options.cache,'no-store');d.root.dataset.deploymentSrc='https://other.test/config.json';await assert.rejects(()=>loadS0ULAnalysisDeployment(d.root,{fetch:async()=>{throw Error('must not fetch');}}),/this site/);
});
