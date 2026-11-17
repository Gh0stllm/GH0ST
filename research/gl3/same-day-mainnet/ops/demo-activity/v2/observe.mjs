// One-shot read-only post-transition audit. No raw journal, keys or log reads.
import fs from 'node:fs';import path from 'node:path';import {createRequire}from'node:module';
import{digest,ensure}from'./engine.mjs';import{patchedRuntime}from'./worker.mjs';
const{JsonRpcProvider,Interface,getCreateAddress,formatUnits}=createRequire('/workspace/gl3/durable/neutral/dispute/package.json')('ethers');
const dir=path.dirname(new URL(import.meta.url).pathname),privateBase='/workspace/gl3/mainnet/private/demo',out=path.join(dir,'evidence/live');fs.mkdirSync(out,{recursive:true});
const migration=JSON.parse(fs.readFileSync(path.join(dir,'evidence/actual-migration.json'))),launch=JSON.parse(fs.readFileSync(privateBase+'/launch-v2.json'));
ensure(migration.newConfigSHA256===launch.configSHA256&&launch.configSHA256==='c3e0dbf411a6ef4e183e4fe260c313eee5068e1ea382be8debb239e81046c42e'&&launch.sourceFreezeSHA256==='1e8fc55a9cedfbbd928e54532812fc619e86ff774ca0bba68898595fb0ace746','APPROVED_CONFIG_OR_SOURCE_BINDING');
ensure(migration.passed&&migration.originalBytesPreservedExactly&&launch.migrationReceiptSHA256===digest(fs.readFileSync(path.join(dir,'evidence/actual-migration.json'))),'MIGRATION_BINDING');
const first=migration.nextNonce,signer='0xe03f5f1392072f93795f95f778161ba989e7c32c';
const p=new JsonRpcProvider('http://127.0.0.1:8547',undefined,{cacheTimeout:-1,batchMaxCount:1}),rpc=(m,a)=>p.send(m,a);
const artifacts=JSON.parse(fs.readFileSync(path.join(dir,'artifacts.json'))),names=['GL3AutomatedDemoPulse','GL3AutomatedDemoToken','GL3AutomatedDemoNFT'];
const contracts=names.map((name,nonce)=>({name,address:getCreateAddress({from:signer,nonce}),a:artifacts[name],iface:new Interface(artifacts[name].abi)}));
const definitions=[['pulse','pulse',[]],['test-token','transfer',['0x000000000000000000000000000000000000dEaD',10n**18n]],['demo-nft','mintDemo',[]]];
try{
 ensure(BigInt(await rpc('eth_chainId',[]))===4663001n,'WRONG_CHAIN');ensure((await rpc('eth_getBlockByNumber',['0x0',false])).hash==='0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483','WRONG_GENESIS');
 const head=await rpc('eth_getBlockByNumber',['latest',false]),rows=[],blocks=[];let foundFirst=false;
 for(let h=BigInt(head.number);h>=0n&&h>BigInt(head.number)-512n;h--){
  const b=await rpc('eth_getBlockByNumber',['0x'+h.toString(16),true]);ensure(b,'MISSING_BLOCK');const own=b.transactions.filter(t=>t.from.toLowerCase()===signer&&Number(BigInt(t.nonce))>=first);
  for(const t of own){
   const r=await rpc('eth_getTransactionReceipt',[t.hash]);ensure(r?.status==='0x1'&&r.blockHash===b.hash&&BigInt(t.value)===0n,'BAD_DEMO_RECEIPT');
   const index=contracts.findIndex(c=>c.address.toLowerCase()===t.to?.toLowerCase());ensure(index>=0,'UNKNOWN_POST_TRANSITION_TARGET');
   const[kind,method,args]=definitions[index];ensure(t.input===contracts[index].iface.encodeFunctionData(method,args),'UNKNOWN_POST_TRANSITION_CALL');
   const eventName=index===0?'AutomatedDemoPulse':'Transfer',events=r.logs.filter(l=>l.address.toLowerCase()===contracts[index].address.toLowerCase()).map(l=>{try{return contracts[index].iface.parseLog(l)}catch{return null}}).filter(e=>e?.name===eventName);
   ensure(events.length===1,'EXPECTED_DEMO_EVENT_MISSING');let value;
   if(index===0)value=String(events[0].args.sequence);
   if(index===1){ensure(events[0].args.from.toLowerCase()===signer&&events[0].args.to.toLowerCase()==='0x000000000000000000000000000000000000dead'&&events[0].args.value===10n**18n,'TOKEN_EVENT_MISMATCH');value=String(events[0].args.value);}
   if(index===2){ensure(events[0].args.from==='0x0000000000000000000000000000000000000000'&&events[0].args.to.toLowerCase()===signer,'NFT_EVENT_MISMATCH');value=String(events[0].args.tokenId);}
   rows.push({hash:t.hash,nonce:Number(BigInt(t.nonce)),blockNumber:b.number,blockHash:b.hash,timestamp:Number(BigInt(b.timestamp)),kind,eventValue:value,gasUsed:String(BigInt(r.gasUsed)),gasPrice:String(BigInt(r.effectiveGasPrice)),paidWei:String(BigInt(r.gasUsed)*BigInt(r.effectiveGasPrice))});
   if(Number(BigInt(t.nonce))===first)foundFirst=true;
  }
  if(own.length)blocks.push({number:b.number,hash:b.hash,timestamp:Number(BigInt(b.timestamp)),demoTransactions:own.length,otherTransactions:b.transactions.length-own.length,otherTransactionTypes:b.transactions.filter(t=>t.from.toLowerCase()!==signer).map(t=>t.type)});
  if(foundFirst)break;
 }
 ensure(foundFirst,'BOUNDED_RANGE_DID_NOT_REACH_FIRST_V2_NONCE');rows.sort((a,b)=>a.nonce-b.nonce);blocks.sort((a,b)=>Number(BigInt(a.number)-BigInt(b.number)));
 for(let i=0;i<rows.length;i++)ensure(rows[i].nonce===first+i,'POST_TRANSITION_NONCE_GAP');
 ensure(new Set(rows.map(r=>r.blockNumber)).size===rows.length&&blocks.every(b=>b.demoTransactions===1),'DUPLICATE_POST_TRANSITION_DEMO_BLOCK');
 const gaps=rows.slice(1).map((r,i)=>r.timestamp-rows[i].timestamp);ensure(gaps.every(g=>g>=1),'HEADER_SPACING_BELOW_ONE_SECOND');
 const firstTime=rows[0].timestamp,pilot=rows.filter(r=>r.timestamp<firstTime+60),span=rows.at(-1).timestamp-firstTime;
 ensure(span>=60,'SIXTY_SECOND_WINDOW_NOT_COMPLETE');ensure(['pulse','test-token','demo-nft'].every(k=>pilot.some(r=>r.kind===k)),'PILOT_MISSING_A_DEMO_ACTION');
 const byKind={};for(const r of rows){byKind[r.kind]??={count:0,paidWei:'0'};byKind[r.kind].count++;byKind[r.kind].paidWei=String(BigInt(byKind[r.kind].paidWei)+BigInt(r.paidWei));}
 const states={};
 for(let n=0;n<contracts.length;n++){const c=contracts[n],code=await rpc('eth_getCode',[c.address,head.number]);ensure(code===patchedRuntime(c.a,signer),'DEPLOYED_RUNTIME_MISMATCH');
  const read=async(m,a=[])=>c.iface.decodeFunctionResult(m,await rpc('eth_call',[{to:c.address,data:c.iface.encodeFunctionData(m,a)},head.number]));const state={address:c.address,runtimeSHA256:digest(Buffer.from(code.slice(2),'hex'))};
  if(n===0){state.pulses=String((await read('pulses'))[0]);ensure(state.pulses===rows.filter(r=>r.kind==='pulse').at(-1).eventValue,'PULSE_STATE_MISMATCH');}
  if(n===1){state.totalSupply=String((await read('totalSupply'))[0]);state.operatorBalance=String((await read('balanceOf',[signer]))[0]);state.sinkBalance=String((await read('balanceOf',['0x000000000000000000000000000000000000dEaD']))[0]);ensure(BigInt(state.totalSupply)===10n**24n&&BigInt(state.operatorBalance)+BigInt(state.sinkBalance)===10n**24n,'TOKEN_ACCOUNTING_MISMATCH');}
  if(n===2){state.minted=String((await read('minted'))[0]);state.operatorBalance=String((await read('balanceOf',[signer]))[0]);ensure(state.minted===state.operatorBalance&&state.minted===rows.filter(r=>r.kind==='demo-nft').at(-1).eventValue,'NFT_STATE_MISMATCH');}
  states[c.name]=state;
 }
 const newPaid=rows.reduce((v,r)=>v+BigInt(r.paidWei),0n),oldPaid=BigInt(migration.spentWei),balance=BigInt(await rpc('eth_getBalance',[signer,head.number]));ensure(balance+oldPaid+newPaid===350000n*10n**18n,'CUMULATIVE_FUNDING_SPEND_BALANCE_MISMATCH');
 const chainProcesses={};for(const[pid,before]of Object.entries(launch.chainProcessesBefore)){const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1].trim().split(/\s+/);ensure(stat[19]===before.startTicks,'CHAIN_PROCESS_REPLACED');chainProcesses[pid]={pid:Number(pid),startTicks:stat[19],alive:true,unchanged:true};}
 const status=JSON.parse(fs.readFileSync(privateBase+'/state-v2/status.json'));ensure(status.running===true&&status.stopReason===null&&status.policyVersion===2&&status.pending<=1,'V2_WORKER_NOT_HEALTHY');
 ensure((await rpc('eth_getBlockByNumber',[head.number,false])).hash===head.hash,'SNAPSHOT_REORG');
 const result={schema:'gh0st.gl3.automated-demo.v2-live-audit.v1',passed:true,observedUTC:new Date().toISOString(),label:'AUTOMATED DEMO - NOT ORGANIC ADOPTION OR ECONOMIC VOLUME',chainId:4663001,
  signer,configSHA256:launch.configSHA256,sourceFreezeSHA256:launch.sourceFreezeSHA256,migrationReceiptSHA256:launch.migrationReceiptSHA256,controllerPID:launch.controllerPID,controllerAlive:fs.existsSync('/proc/'+launch.controllerPID),chainProcessesUnchanged:chainProcesses,
  firstNewNonce:first,lastObservedNonce:rows.at(-1).nonce,snapshot:{blockNumber:head.number,blockHash:head.hash},canonicalPostTransitionReceipts:rows.length,duplicateDemoReceiptBlocks:0,
  headerSpacingSeconds:{minimum:Math.min(...gaps),maximum:Math.max(...gaps),span,scope:'Actual canonical header timestamps have one-second resolution; not a millisecond send-time measurement. The pinned worker uses the separately tested monotonic minimum-second pacer.'},
  first60SecondPilot:{complete:true,receipts:pilot.length,counts:Object.fromEntries(['pulse','test-token','demo-nft'].map(k=>[k,pilot.filter(r=>r.kind===k).length])),nativePaidGH0ST:formatUnits(pilot.reduce((n,r)=>n+BigInt(r.paidWei),0n),18),allOneDemoPerBlock:true},
  byKind,oldPreservedSpentGH0ST:formatUnits(oldPaid,18),newPaidGH0ST:formatUnits(newPaid,18),remainingGH0ST:formatUnits(balance,18),cumulativeFundingGH0ST:'350000',contracts:states,
  workerStatus:{observedUTC:status.observedUTC,running:status.running,pending:status.pending,postTransitionIntentCount:status.postTransitionIntentCount},receipts:rows,blocks,
  scope:'Actual post-transition canonical child receipts/state and unchanged chain-process identities. Demo only, not organic usage, parent finality or valued token/NFT volume. No raw journal, keys, logs or private configs read; no stop/restart/sign/broadcast.'};
 const file=path.join(out,'observation-'+String(BigInt(head.number))+'.json');fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({file,SHA256:digest(fs.readFileSync(file)),...Object.fromEntries(Object.entries(result).filter(([k])=>!['receipts','blocks','contracts'].includes(k)))}));
}finally{p.destroy();}
