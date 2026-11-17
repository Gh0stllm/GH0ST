import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { digest, ensure } from './engine.mjs';
import { patchedRuntime } from './worker.mjs';
const req=createRequire('/workspace/gl3/durable/neutral/dispute/package.json');
const {JsonRpcProvider,getCreateAddress,Interface,formatUnits}=req('ethers');
const dir=path.dirname(new URL(import.meta.url).pathname),out=path.join(dir,'evidence/live');
fs.mkdirSync(out,{recursive:true});
const signer='0xe03f5f1392072f93795f95f778161ba989e7c32c',fund='0x039a2bda3b4e915e41d27b0d1669c5ba008e702ce38228ed1839969157600ed8';
const p=new JsonRpcProvider('http://127.0.0.1:8547',undefined,{cacheTimeout:-1,batchMaxCount:1});
const rpc=(m,a)=>p.send(m,a);
const names=['GL3AutomatedDemoPulse','GL3AutomatedDemoToken','GL3AutomatedDemoNFT'];
const artifacts=JSON.parse(fs.readFileSync(path.join(dir,'artifacts.json')));
const contracts=names.map((name,nonce)=>({name,address:getCreateAddress({from:signer,nonce}),artifact:artifacts[name]}));
try{
 ensure(BigInt(await rpc('eth_chainId',[]))===4663001n,'WRONG_CHAIN');
 const funding=await rpc('eth_getTransactionReceipt',[fund]);ensure(funding?.status==='0x1','FUNDING_NOT_MINED');
 const initial=await rpc('eth_getBlockByNumber',[funding.blockNumber,false]);ensure(initial.hash===funding.blockHash,'FUNDING_NOT_CANONICAL');
 const latest=await rpc('eth_getBlockByNumber',['latest',false]),tag=latest.number;
 ensure(BigInt(tag)-BigInt(funding.blockNumber)<=2000n,'BOUNDED_OBSERVER_RANGE_EXCEEDED');
 const rows=[],blocks=[],histogram={},byKind={};let fee=0n;
 for(let h=BigInt(funding.blockNumber)+1n;h<=BigInt(tag);h++){
  const b=await rpc('eth_getBlockByNumber',['0x'+h.toString(16),true]);ensure(b,'MISSING_BLOCK');
  const own=b.transactions.filter(t=>t.from.toLowerCase()===signer);let activity=0;
  for(const t of own){
   const r=await rpc('eth_getTransactionReceipt',[t.hash]);ensure(r?.status==='0x1'&&r.blockHash===b.hash,'FAILED_OR_NONCANONICAL_DEMO_RECEIPT');
   ensure(BigInt(t.value)===0n,'UNEXPECTED_NATIVE_TRANSFER');
   let kind;
   if(!t.to){const c=contracts.find(c=>c.address.toLowerCase()===r.contractAddress?.toLowerCase());ensure(c,'UNKNOWN_DEPLOYMENT');kind='deploy:'+c.name;}
   else {const c=contracts.find(c=>c.address.toLowerCase()===t.to.toLowerCase());ensure(c,'UNKNOWN_DEMO_TARGET');kind=c.name.endsWith('Pulse')?'pulse':c.name.endsWith('Token')?'test-token':'demo-nft';activity++;}
   const paid=BigInt(r.gasUsed)*BigInt(r.effectiveGasPrice);fee+=paid;
   byKind[kind]??={count:0,gasUsed:'0',paidWei:'0'};byKind[kind].count++;byKind[kind].gasUsed=String(BigInt(byKind[kind].gasUsed)+BigInt(r.gasUsed));byKind[kind].paidWei=String(BigInt(byKind[kind].paidWei)+paid);
   rows.push({hash:t.hash,nonce:Number(BigInt(t.nonce)),blockNumber:b.number,blockHash:b.hash,timestamp:Number(BigInt(b.timestamp)),kind,gasUsed:String(BigInt(r.gasUsed)),gasUsedForL1:r.gasUsedForL1??null,effectiveGasPrice:String(BigInt(r.effectiveGasPrice)),paidWei:String(paid),status:r.status});
  }
  if(activity)histogram[activity]=(histogram[activity]??0)+1;
  blocks.push({number:b.number,hash:b.hash,timestamp:Number(BigInt(b.timestamp)),demoTransactions:own.length,demoActivityTransactions:activity,otherTransactions:b.transactions.length-own.length});
 }
 const state={};
 for(const c of contracts){
  const runtime=await rpc('eth_getCode',[c.address,tag]);ensure(runtime===patchedRuntime(c.artifact,signer),'RUNTIME_MISMATCH');
  const iface=new Interface(c.artifact.abi),read=async(method,args=[])=>iface.decodeFunctionResult(method,await rpc('eth_call',[{to:c.address,data:iface.encodeFunctionData(method,args)},tag]));
  state[c.name]={address:c.address,runtimeSHA256:digest(Buffer.from(runtime.slice(2),'hex'))};
  if(c.name.endsWith('Pulse')) {state[c.name].pulses=String((await read('pulses'))[0]);ensure(BigInt(state[c.name].pulses)===BigInt(byKind.pulse?.count??0),'PULSE_COUNT_MISMATCH');}
  if(c.name.endsWith('Token')){
   state[c.name].totalSupply=String((await read('totalSupply'))[0]);state[c.name].operatorBalance=String((await read('balanceOf',[signer]))[0]);state[c.name].sinkBalance=String((await read('balanceOf',['0x000000000000000000000000000000000000dEaD']))[0]);
   ensure(BigInt(state[c.name].totalSupply)===10n**24n&&BigInt(state[c.name].sinkBalance)===BigInt(byKind['test-token']?.count??0)*10n**18n,'TOKEN_ACCOUNTING_MISMATCH');
   ensure(BigInt(state[c.name].operatorBalance)+BigInt(state[c.name].sinkBalance)===10n**24n,'TOKEN_SUPPLY_MISMATCH');
  }
  if(c.name.endsWith('NFT')){state[c.name].minted=String((await read('minted'))[0]);state[c.name].operatorBalance=String((await read('balanceOf',[signer]))[0]);ensure(state[c.name].minted===String(byKind['demo-nft']?.count??0)&&state[c.name].minted===state[c.name].operatorBalance,'NFT_ACCOUNTING_MISMATCH');}
 }
 const activityRows=rows.filter(x=>!x.kind.startsWith('deploy:')),activityBlocks=blocks.filter(x=>x.demoActivityTransactions>0);
 const pilotStart=activityBlocks[0]?.timestamp;
 const pilotRows=activityRows.filter(r=>r.timestamp<pilotStart+120);
 const pilotBlocks=activityBlocks.filter(b=>b.timestamp<pilotStart+120);
 const pilotHistogram={};for(const b of pilotBlocks)pilotHistogram[b.demoActivityTransactions]=(pilotHistogram[b.demoActivityTransactions]??0)+1;
 const span=activityBlocks.length>1?activityBlocks.at(-1).timestamp-activityBlocks[0].timestamp:0;
 const balance=BigInt(await rpc('eth_getBalance',[signer,tag]));ensure(balance+fee===100000n*10n**18n,'FUNDED_BALANCE_ACCOUNTING_MISMATCH');
 ensure((await rpc('eth_getBlockByNumber',[tag,false])).hash===latest.hash,'SNAPSHOT_REORG');
 // Only these explicitly authorized safe metadata files are read. No intents, secrets or logs.
 const launch=JSON.parse(fs.readFileSync('/workspace/gl3/mainnet/private/demo/launch-v1.json'));
 const status=JSON.parse(fs.readFileSync('/workspace/gl3/mainnet/private/demo/state-v1/status.json'));
 const report={schema:'gh0st.gl3.automated-demo.live-observation.v1',passed:true,observedUTC:new Date().toISOString(),label:'AUTOMATED DEMO - NOT ORGANIC ADOPTION OR ECONOMIC VOLUME',chainId:4663001,signer,
  funding:{hash:fund,blockNumber:funding.blockNumber,amountWei:String(100000n*10n**18n)},snapshot:{blockNumber:tag,blockHash:latest.hash},
  controllerPID:launch.controllerPID,controllerAlive:fs.existsSync('/proc/'+launch.controllerPID),startedUTC:launch.startedUTC,approvedConfigSHA256:launch.configSHA256,
  workerStatus:{observedUTC:status.observedUTC,running:status.running,stopReason:status.stopReason,intentCount:status.intentCount,receiptCount:status.receiptCount,pending:status.pending},
  first120SecondPilot:{complete:span>=120,activityReceipts:pilotRows.length,demoBlocks:pilotBlocks.length,activityTxPerDemoBlockHistogram:pilotHistogram,activityFeesWei:String(pilotRows.reduce((n,r)=>n+BigInt(r.paidWei),0n)),windowStartHeaderTimestamp:pilotStart,windowEndExclusiveHeaderTimestamp:pilotStart+120},
  canonicalDemoReceipts:rows.length,activityReceipts:activityRows.length,byKind,activityTxPerDemoBlockHistogram:histogram,
  demoActivityBlocks:activityBlocks.length,otherTransactions:blocks.reduce((n,b)=>n+b.otherTransactions,0),
  activityHeaderTimestampSpanSeconds:span,observedAverageActivityTxPerSecond:span?Number((activityRows.length-activityBlocks[0].demoActivityTransactions)/span):null,
  maximumGapBetweenDemoBlockHeaderSeconds:activityBlocks.length>1?Math.max(...activityBlocks.slice(1).map((b,i)=>b.timestamp-activityBlocks[i].timestamp)):null,
  nativePaidWei:String(fee),nativePaidGH0ST:formatUnits(fee,18),remainingNativeGH0ST:formatUnits(balance,18),allThreeRuntimeAndStateChecksPassed:true,contracts:state,receipts:rows,blocks,
  scope:'Actual sequenced demo receipts/runtime/state at a pinned canonical child head; not parent finality, organic adoption or economically valued token volume. No signer/key/intents/logs read, no signing/broadcast/config/service changes.'};
 const file=path.join(out,'observation-'+String(BigInt(tag))+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({file,SHA256:digest(fs.readFileSync(file)),...Object.fromEntries(Object.entries(report).filter(([k])=>!['receipts','blocks','contracts'].includes(k)))}));
}finally{p.destroy();}
