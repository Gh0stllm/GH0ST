import {Transaction,keccak256} from 'ethers';
import {OWNER,TOKEN,GENESIS,FAST,ZERO,ADMIN,PUBLIC,GAS,NODE,TARGET,FUNDING,TOKEN_HASH,check,same,qty,hash,admin,token,inbox,pub,gas,ni,creator,rollup,bridge,validatePlan,validatePolicy,fullGasFloor,receiptGas,settled,validateAuthority,makeUnsigned,validateQuotedAction,validateSignedEnvelope} from './policy.mjs';
const json=x=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v));
export class SetupEngine {
 constructor({plan,planSHA256,policy,journal,parent,child,now=Date.now}){this.actions=validatePlan(plan);validatePolicy(policy);this.plan=plan;this.planSHA256=planSHA256;this.journal=journal;this.parent=parent;this.child=child;this.now=now;this.busy=false;}
 rpc(a){return a.chainId===4663?this.parent:this.child;}
 async call(rpc,abi,to,name,args=[],transition=false){const tx={from:OWNER,to,data:abi.encodeFunctionData(name,args)};if(transition)tx.skipL1Charging=true;return abi.decodeFunctionResult(name,await rpc.send('eth_call',[tx,'latest']));}
 async canonical(rpc,receipt,confirmations=1){
  check(receipt&&BigInt(receipt.status)===1n&&hash(receipt.blockHash),'Transaction is unconfirmed or failed.');
  const [b,latest]=await Promise.all([rpc.send('eth_getBlockByNumber',[receipt.blockNumber,false]),rpc.send('eth_blockNumber',[])]);
  check(b&&same(b.hash,receipt.blockHash)&&BigInt(latest)-BigInt(receipt.blockNumber)+1n>=BigInt(confirmations),'Canonical receipt confirmations are incomplete.');
 }
 async bindings(){
  check(BigInt(await this.parent.send('eth_chainId',[]))===4663n&&BigInt(await this.child.send('eth_chainId',[]))===4663001n,'Wrong RPC chain.');
  check(same((await this.child.send('eth_getBlockByNumber',['0x0',false]))?.hash,GENESIS),'Wrong child genesis.');
  const p=this.plan,receipt=await this.parent.send('eth_getTransactionReceipt',[p.creationTransactionHash]);await this.canonical(this.parent,receipt,p.parentConfirmationBlocks);
  check(same(receipt.blockHash,p.creationReceiptBlockHash),'Creation receipt was reorganized.');
  const matches=[];for(const l of receipt.logs||[]){if(!same(l.address,p.factoryAddress))continue;try{const e=creator.parseLog(l);if(e?.name==='RollupCreated'&&same(e.args.nativeToken,TOKEN))matches.push(e);}catch{}}
  check(matches.length===1,'Exactly one token-specific RollupCreated event is required.');const e=matches[0].args;
  for(const [key,eventKey]of[['rollupAddress','rollupAddress'],['inboxAddress','inboxAddress'],['bridgeAddress','bridge'],['outboxAddress','outbox']])check(same(p[key],e[eventKey]),'Bridge address differs from actual creation receipt.');
  for(const a of [p.factoryAddress,p.rollupAddress,p.inboxAddress,p.bridgeAddress,p.outboxAddress])check((await this.parent.send('eth_getCode',[a,'latest']))!=='0x','A receipt-bound parent contract has no code.');
  check(keccak256(await this.parent.send('eth_getCode',[TOKEN,'latest']))===TOKEN_HASH,'Unexpected GH0ST token code.');
  for(const [name,want]of[['chainId',4663001n],['bridge',p.bridgeAddress],['inbox',p.inboxAddress],['outbox',p.outboxAddress],['anyTrustFastConfirmer',FAST]])check(same((await this.call(this.parent,rollup,p.rollupAddress,name))[0],want),'Live rollup configuration differs.');
  check(same((await this.call(this.parent,bridge,p.bridgeAddress,'nativeToken'))[0],TOKEN)&&(await this.call(this.parent,bridge,p.bridgeAddress,'nativeTokenDecimals'))[0]===18n,'Wrong native backing token.');
 }
 async authority(childIndex){
  const transition=childIndex<2;const read=(abi,to,name)=>this.call(this.child,abi,to,name,[],transition);
  const [owners,minters,management,upgrade,network,infra,reward,minimum,h,q]=await Promise.all([read(pub,PUBLIC,'getAllChainOwners'),read(pub,PUBLIC,'getAllNativeTokenOwners'),read(pub,PUBLIC,'getNativeTokenManagementFrom'),read(pub,PUBLIC,'getScheduledUpgrade'),read(pub,PUBLIC,'getNetworkFeeAccount'),read(pub,PUBLIC,'getInfraFeeAccount'),read(gas,GAS,'getL1RewardRecipient'),read(gas,GAS,'getMinimumGasPrice'),this.child.send('eth_getBlockByNumber',['latest',false]),this.child.send('eth_gasPrice',[])]);
  const state=json({owners:owners[0],minters:minters[0],managementFrom:management[0],upgrade:Array.from(upgrade),network:network[0],infra:infra[0],reward:reward[0],minimum:minimum[0],number:h.number,blockHash:h.hash,baseFee:h.baseFeePerGas,quote:q});validateAuthority(state,childIndex);return state;
 }
 async nonce(rpc,expected){const [latest,pending]=await Promise.all(['latest','pending'].map(tag=>rpc.send('eth_getTransactionCount',[OWNER,tag])));check(BigInt(latest)===BigInt(expected)&&BigInt(pending)===BigInt(expected),'Wallet nonce changed or a transaction is pending.');}
 async verifyHistory(){for(const e of this.journal.value.entries){check(e.state==='confirmed','An earlier broadcast needs reconciliation.');const rpc=e.chainId===4663?this.parent:this.child;const receipt=await rpc.send('eth_getTransactionReceipt',[e.hash]);check(receipt&&same(receipt.blockHash,e.receipt.blockHash)&&same(receipt.transactionHash,e.hash),'A prior canonical receipt changed. Stop and reconcile.');await this.canonical(rpc,receipt,e.chainId===4663?this.plan.parentConfirmationBlocks:1);}}
 async preflight(action){
  await this.bindings();await this.verifyHistory();const rpc=this.rpc(action);await this.nonce(rpc,action.nonce);
  if(action.kind==='approve'){
   await this.authority(0);check(BigInt(await this.child.send('eth_getBalance',[OWNER,'latest']))===0n,'Initial child wallet must be empty.');await this.nonce(this.child,0);
   check((await this.call(this.parent,token,TOKEN,'balanceOf',[OWNER]))[0]>=FUNDING,'Insufficient parent GH0ST.');
  }else if(action.kind==='deposit')check((await this.call(this.parent,token,TOKEN,'allowance',[OWNER,this.plan.inboxAddress]))[0]===FUNDING,'Exact 1,000,000 GH0ST allowance not confirmed.');
  else {
   await this.authority(action.childIndex);
   if(action.childIndex===0)check(BigInt(await this.child.send('eth_getBalance',[OWNER,'latest']))===FUNDING,'Wait for the actual 1,000,000 GH0ST parent deposit credit.');
   if(action.childIndex===1||action.childIndex===2){const prior=this.journal.value.entries[action.index-1];const s=await this.authority(action.childIndex);check(prior?.state==='confirmed'&&settled(s,prior.receipt),'Wait for a genuine later header with matching current/minimum fees.');}
  }
 }
 async observation(action){
  const rpc=this.rpc(action),request={from:OWNER,to:action.to,data:action.data,value:'0x0'};
  const normal=BigInt(await rpc.send('eth_estimateGas',[request]));let fields={normal:String(normal)},gasLimit;
  if(action.kind==='child'){
   const compute=BigInt(await rpc.send('eth_estimateGas',[{...request,skipL1Charging:true}]));
   const l1=(await this.call(rpc,ni,NODE,'gasEstimateL1Component',[action.to,false,action.data],action.childIndex<2))[0];
   const f=fullGasFloor(normal,compute,l1);fields=json(f);gasLimit=f.gasLimit;
  }else {gasLimit=normal+normal/5n+10000n;check(gasLimit<1000000n,'Unexpected RH deposit/approval estimate.');}
  // Query direct after all estimates; never use cached ethers fee population.
  const price=BigInt(await rpc.send('eth_gasPrice',[]));check(price>0n,'Invalid fresh gas quote.');return {...fields,gasLimit:String(gasLimit),price:String(price)};
 }
 caps(chainId){return this.journal.value.entries.filter(x=>x.chainId===chainId).reduce((a,x)=>a+BigInt(x.maxCostUnits),0n);}
 async exclusive(fn){check(!this.busy,'Another setup operation is in progress.');this.busy=true;try{return await fn();}finally{this.busy=false;}}
 async quote(){return this.exclusive(async()=>{
  check(!this.journal.value.entries.some(x=>x.state!=='confirmed'),'An existing broadcast needs read-only reconciliation.');const index=this.journal.value.entries.length;if(index===9){await this.verifyHistory();const final=await this.authority(7);await this.bindings();await this.nonce(this.child,7);return {complete:true,final};}
  const action=this.actions[index];await this.preflight(action);const o=await this.observation(action);const now=this.now();const q={...o,index,planSHA256:this.planSHA256,chainCapsAlreadySigned:String(this.caps(action.chainId)),createdAt:now,expiresAt:now+30000,...makeUnsigned(action,o)};
  validateQuotedAction(this.plan,q,this.planSHA256,now);check(BigInt(await this.rpc(action).send('eth_getBalance',[OWNER,'latest']))>=BigInt(q.maxCostUnits),'Wallet cannot cover the complete signed fee cap.');this.journal.setQuote(q);return q;
 });}
 async submit(raw){return this.exclusive(async()=>{
  const q=this.journal.value.quote;check(q,'No active quote.');validateQuotedAction(this.plan,q,this.planSHA256,this.now());check(this.journal.value.entries.length===q.index);
  const tx=validateSignedEnvelope(Transaction.from(raw),q),action=this.actions[q.index],rpc=this.rpc(action);await this.preflight(action);
  const fresh=await this.observation(action);check(fresh.price===q.price&&BigInt(fresh.gasLimit)<=tx.gasLimit,'Quote changed. Nothing was sent; request a new quote.');check(BigInt(await rpc.send('eth_getBalance',[OWNER,'latest']))>=BigInt(q.maxCostUnits));
  // This durable write MUST precede the sole network send. No automatic retry, replacement or rebroadcast.
  this.journal.intent({index:q.index,chainId:action.chainId,nonce:action.nonce,hash:tx.hash,raw,maxCostUnits:q.maxCostUnits,quote:q,createdUTC:new Date(this.now()).toISOString()});
  try{const returned=await rpc.send('eth_sendRawTransaction',[raw]);check(same(returned,tx.hash),'RPC returned a different hash.');this.journal.update(q.index,{state:'broadcast'});}catch{this.journal.update(q.index,{state:'uncertain'});throw Error('Broadcast outcome is uncertain. Preserve journal; reconcile saved hash. Do not retry.');}
  return {hash:tx.hash,state:'broadcast'};
 });}
 async reconcile(){return this.exclusive(async()=>{
  const e=this.journal.value.entries.at(-1);if(!e||e.state==='confirmed')return {state:'ready',confirmed:this.journal.value.entries.length};
  const rpc=e.chainId===4663?this.parent:this.child;const r=await rpc.send('eth_getTransactionReceipt',[e.hash]);if(!r)return {state:e.state==='broadcast'?'pending':'reconciliation-required',hash:e.hash,message:'No canonical successful receipt yet. No retry was sent.'};
  await this.canonical(rpc,r,e.chainId===4663?this.plan.parentConfirmationBlocks:1);check(same(r.transactionHash,e.hash));const actual=await rpc.send('eth_getTransactionByHash',[e.hash]);check(actual&&same(actual.from,OWNER)&&Number(BigInt(actual.nonce))===e.nonce,'Actual receipt transaction differs.');
  check(same(actual.to,this.actions[e.index].to)&&same(actual.input,this.actions[e.index].data)&&BigInt(actual.value)===0n,'Actual transaction content differs.');
  const breakdown=receiptGas(r,e.chainId===4663001),actualFee=BigInt(r.gasUsed)*BigInt(r.effectiveGasPrice);check(actualFee<=BigInt(e.maxCostUnits),'Actual fee exceeds the signed maximum.');
  this.journal.update(e.index,{state:'confirmed',receipt:r,...breakdown,actualFeeUnits:String(actualFee),confirmedUTC:new Date(this.now()).toISOString()});
  return {state:'confirmed',hash:e.hash,confirmed:this.journal.value.entries.length};
 });}
}
