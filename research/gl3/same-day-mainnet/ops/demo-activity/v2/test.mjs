import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {Journal as OldJournal} from '../engine.mjs';import {Journal,DemoEngine,digest,json} from './engine.mjs';
import {auditOriginal,parseOriginal,writeNewState,ensureNoWriter,OLD_CONFIG} from './migrate.mjs';import {tickActions,ReceiptPacer,validateConfig,CHAIN,GENESIS} from './worker.mjs';
import {readySample} from './prestop-check.mjs';
const{Wallet,Transaction,Interface,AbiCoder,getCreateAddress}=createRequire('/workspace/gl3/durable/neutral/dispute/package.json')('ethers');
const dir=path.dirname(new URL(import.meta.url).pathname),artifacts=JSON.parse(fs.readFileSync(path.join(dir,'artifacts.json'))),reports=[];
const H=c=>'0x'+c.repeat(64);const root=fs.mkdtempSync(path.join(os.tmpdir(),'gl3-demo-v2-'));fs.chmodSync(root,0o700);
async function test(name,fn){const t=performance.now();await fn();reports.push({name,passed:true,elapsedMs:performance.now()-t});console.log('PASS '+name);}
const wallet=new Wallet('0x'+'1'.padStart(64,'0')); // Published TEST scalar; never a production key.
const cfg={schema:'gh0st.gl3.automated-demo.config.v2',activationApproved:true,policyVersion:2,journalIdentityConfigSHA256:OLD_CONFIG,label:'AUTOMATED DEMO - NOT ORGANIC ADOPTION OR ECONOMIC VOLUME',
 chainId:CHAIN,genesis:GENESIS,rpc:'http://127.0.0.1:8547',signer:wallet.address,intervalMs:1000,maxPending:1,tokenEveryTicks:10,nftEveryTicks:30,maxRunSeconds:86400,maxTransactions:100000,
 budgetWei:String(350000n*10n**18n),reserveWei:String(100n*10n**18n),gasMarginBps:12500,feeMultiplierBps:20000,mode:'counter',keyFile:'/workspace/gl3/mainnet/private/demo/wallet.json',stateDir:'/workspace/gl3/mainnet/private/demo/state-v2',
 artifactsSHA256:'a'.repeat(64),engineSHA256:'b'.repeat(64),workerSHA256:'c'.repeat(64),tokenRecipient:'0x000000000000000000000000000000000000dEaD',
 fundingReceipts:[{hash:H('e'),amountWei:String(100000n*10n**18n)},{hash:H('f'),amountWei:String(250000n*10n**18n)}]};
const newSHA=digest(json(cfg));
async function fixture(){
 const oldDir=fs.mkdtempSync(path.join(root,'original-'));fs.chmodSync(oldDir,0o700);const j=new OldJournal(oldDir);
 const identity={chainId:CHAIN,genesis:GENESIS,signer:wallet.address,configSHA256:OLD_CONFIG};j.append({type:'identity',identity});
 const names=['GL3AutomatedDemoPulse','GL3AutomatedDemoToken','GL3AutomatedDemoNFT'],addresses=names.map((_,nonce)=>getCreateAddress({from:wallet.address,nonce}));
 const definitions=names.map((n,i)=>({key:'deploy:'+n,to:null,data:artifacts[n].bytecode+AbiCoder.defaultAbiCoder().encode(['address'],[wallet.address]).slice(2)}));
 definitions.push({key:'activity:1:pulse',to:addresses[0],data:new Interface(artifacts[names[0]].abi).encodeFunctionData('pulse')},
  {key:'activity:10:token',to:addresses[1],data:new Interface(artifacts[names[1]].abi).encodeFunctionData('transfer',[cfg.tokenRecipient,10n**18n])},
  {key:'activity:30:nft',to:addresses[2],data:new Interface(artifacts[names[2]].abi).encodeFunctionData('mintDemo')});
 const receipts=new Map(),transactions=new Map(),blocks=new Map([['0x0',{hash:GENESIS}]]);let spent=0n;
 for(let nonce=0;nonce<definitions.length;nonce++){
  const d=definitions[nonce],tx={type:2,chainId:CHAIN,nonce,to:d.to,data:d.data,value:0n,gasLimit:10000000n,maxFeePerGas:20000000000000n,maxPriorityFeePerGas:0n};
  const raw=await wallet.signTransaction(tx),hash=Transaction.from(raw).hash;
  j.append({type:'intent',key:d.key,label:'AUTOMATED DEMO',nonce,hash,raw,maxCost:String(tx.gasLimit*tx.maxFeePerGas),timeMs:1000+nonce*1000});j.append({type:'accepted',hash,timeMs:1000+nonce*1000});
  // Two old v1 receipts deliberately share one block. v2 applies the new constraint prospectively.
  const number='0x'+(nonce<4?nonce+1:5).toString(16),blockHash=H(String(nonce<4?nonce+1:5));blocks.set(number,{hash:blockHash});
  const r={transactionHash:hash,status:'0x1',blockNumber:number,blockHash,gasUsed:'0x5208',effectiveGasPrice:'0x9184e72a000'};receipts.set(hash,r);spent+=21000n*10n**13n;
  if(nonce!==5)j.append({type:'receipt',hash,nonce,blockNumber:number,blockHash,status:r.status,gasUsed:r.gasUsed,effectiveGasPrice:r.effectiveGasPrice,paidWei:String(21000n*10n**13n),observedUTC:'2026-01-01T00:00:00Z'});
 }
 j.append({type:'stop',reason:'OPERATOR_STOP',pending:1,timeMs:8000});j.close();
 for(let n=0;n<2;n++){const f=cfg.fundingReceipts[n],number='0x'+(16+n).toString(16),blockHash=H(n?'b':'a');blocks.set(number,{hash:blockHash});receipts.set(f.hash,{transactionHash:f.hash,status:'0x1',blockNumber:number,blockHash});transactions.set(f.hash,{from:'0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6',to:wallet.address,value:'0x'+BigInt(f.amountWei).toString(16),input:'0x'});}
 const chain={latest:6,pending:6,balance:350000n*10n**18n-spent,sent:0,now:10000,blocks,receipts,transactions};
 const rpc=async(m,a)=>{
  if(m==='eth_chainId')return'0x'+CHAIN.toString(16);if(m==='eth_getBlockByNumber')return blocks.get(a[0]);if(m==='eth_getTransactionReceipt')return receipts.get(a[0])??null;
  if(m==='eth_getTransactionByHash')return transactions.get(a[0])??null;if(m==='eth_getTransactionCount')return'0x'+chain[a[1]==='latest'?'latest':'pending'].toString(16);if(m==='eth_getBalance')return'0x'+chain.balance.toString(16);
  if(m==='eth_sendRawTransaction'){chain.sent++;const t=Transaction.from(a[0]);chain.pending=t.nonce+1;transactions.set(t.hash,{hash:t.hash,from:t.from,nonce:'0x'+t.nonce.toString(16),blockHash:null});return t.hash;}
  throw Error('unexpected RPC '+m);
 };
 return{oldDir,bytes:fs.readFileSync(path.join(oldDir,'intents.jsonl')),identity,chain,rpc,spent,addresses};
}
const audit=f=>auditOriginal({bytes:f.bytes,config:cfg,newConfigSHA256:newSHA,artifacts,rpc:f.rpc});
try{
 await test('original-writer-rejected-readonly-reader-allowed',async()=>{const f=path.join(root,'writer-check');fs.writeFileSync(f,'test',{mode:0o600});ensureNoWriter(f);const rd=fs.openSync(f,'r');ensureNoWriter(f);fs.closeSync(rd);const wr=fs.openSync(f,'a');assert.throws(()=>ensureNoWriter(f),/HAS_WRITER/);fs.closeSync(wr);ensureNoWriter(f);});
 await test('prestop-readiness-uses-canonical-nonces-not-stale-pending-counter',async()=>{const status={running:true,stopReason:null,intentCount:6,pending:1};assert(readySample({latest:'0x6',pending:'0x6',status}));assert(!readySample({latest:'0x6',pending:'0x7',status}));assert(!readySample({latest:'0x7',pending:'0x7',status}));assert(!readySample({latest:'0x6',pending:'0x6',status:{...status,running:false}}));});
 await test('one-action-rotation-NFT-priority-no-bursts',async()=>{let counts={pulse:0,token:0,nft:0};for(let n=1;n<=30;n++){const a=tickActions(n,cfg);assert.equal(a.length,1);counts[a[0]]++;}assert.deepEqual(counts,{pulse:27,token:2,nft:1});assert.deepEqual(tickActions(30,cfg),['nft']);});
 await test('monotonic-minimum-second-receipt-gate-without-new-head',async()=>{let time=100;const p=new ReceiptPacer(1000,()=>time);assert.equal(p.waitMs(0),1000);time+=1000;assert.equal(p.waitMs(1),null);assert.equal(p.waitMs(0),0);p.submitted();time+=999;assert.equal(p.waitMs(0),1);time++;assert.equal(p.waitMs(0),0);});
 await test('v2-policy-bounds-350k-one-pending-old-anchor',async()=>{assert.equal(validateConfig(cfg),cfg);for(const c of[{...cfg,maxPending:2},{...cfg,intervalMs:999},{...cfg,budgetWei:String(350001n*10n**18n)},{...cfg,journalIdentityConfigSHA256:'d'.repeat(64)}])assert.throws(()=>validateConfig(c));});
 await test('exact-old-format-signed-journal-migration-preserves-prefix-nonces-spend',async()=>{const f=await fixture(),a=await audit(f);assert.equal(a.nextNonce,6);assert.equal(a.spentWei,String(f.spent));assert.equal(a.derived.length,1);assert.equal(f.chain.sent,0);
  const dest=path.join(root,'valid-new');const r=writeNewState({bytes:f.bytes,destination:dest,audit:a});assert(r.originalBytesPreservedExactly);assert(fs.readFileSync(path.join(f.oldDir,'intents.jsonl')).equals(f.bytes));
  const j=new Journal(dest);const e=new DemoEngine({rpc:f.rpc,sign:tx=>wallet.signTransaction(tx),decode:r=>Transaction.from(r),journal:j,identity:f.identity,budgetWei:cfg.budgetWei,reserveWei:cfg.reserveWei,maxPending:1,policy:{configSHA256:newSHA},now:()=>f.chain.now});
  assert.equal(e.nextNonce,6);assert.equal(e.spent,f.spent);assert.equal(e.pending.length,0);assert.equal(e.policyStartNonce,6);await e.reconcile();j.close();assert.throws(()=>writeNewState({bytes:f.bytes,destination:dest,audit:a}),/ALREADY_EXISTS/);
 });
 await test('missing-or-wrong-transition-never-resets-identity',async()=>{const f=await fixture();const events=parseOriginal(f.bytes);assert.throws(()=>new DemoEngine({rpc:f.rpc,sign:async()=>'',decode:r=>Transaction.from(r),journal:{events,append(){}},identity:f.identity,budgetWei:cfg.budgetWei,reserveWei:cfg.reserveWei,maxPending:1,policy:{configSHA256:newSHA}}),/TRANSITION/);const a=await audit(f);a.transition.firstNewNonce=7;const d=path.join(root,'bad-transition');writeNewState({bytes:f.bytes,destination:d,audit:a});const j=new Journal(d);assert.throws(()=>new DemoEngine({rpc:f.rpc,sign:async()=>'',decode:r=>Transaction.from(r),journal:j,identity:f.identity,budgetWei:cfg.budgetWei,reserveWei:cfg.reserveWei,maxPending:1,policy:{configSHA256:newSHA}}),/TRANSITION/);j.close();});
 await test('pending-unknown-reverted-and-reorged-original-block-migration',async()=>{for(const mode of['pending','unknownNonce','failed','reorg']){const f=await fixture();const key=parseOriginal(f.bytes).find(x=>x.type==='intent').hash;const r=f.chain.receipts.get(key);if(mode==='pending')f.chain.receipts.delete(key);if(mode==='unknownNonce')f.chain.pending++;if(mode==='failed')r.status='0x0';if(mode==='reorg')f.chain.blocks.set(r.blockNumber,{hash:H('d')});await assert.rejects(audit(f));assert.equal(f.chain.sent,0);}});
 await test('funding-from-to-value-and-canonicality-required',async()=>{for(const mode of['from','to','value','block']){const f=await fixture(),t=f.chain.transactions.get(H('f'));if(mode==='from')t.from=wallet.address;if(mode==='to')t.to='0x2222222222222222222222222222222222222222';if(mode==='value')t.value='0x1';if(mode==='block')f.chain.receipts.get(H('f')).blockHash=H('c');await assert.rejects(audit(f));assert.equal(f.chain.sent,0);}});
 await test('tampered-truncated-wrong-artifact-and-spend-ledger-rejected',async()=>{const f=await fixture();assert.throws(()=>parseOriginal(f.bytes.subarray(0,-1)),/TAIL/);assert.throws(()=>parseOriginal(Buffer.from(f.bytes.toString().replace('"reason":"OPERATOR_STOP"','"reason":"OTHER"'))),/HASH_CHAIN/);const wrong=structuredClone(artifacts);wrong.GL3AutomatedDemoPulse.bytecode+='00';await assert.rejects(auditOriginal({bytes:f.bytes,config:cfg,newConfigSHA256:newSHA,artifacts:wrong,rpc:f.rpc}),/DEPLOYMENT/);f.chain.balance-=1n;await assert.rejects(audit(f),/BALANCE/);});
 await test('unbudgeted-extra-funds-do-not-increase-350k-budget',async()=>{const f=await fixture();f.chain.balance+=123n;const a=await audit(f);assert.equal(a.unbudgetedSurplusWei,'123');assert.equal(a.transition.newBudgetWei,cfg.budgetWei);});
 await test('one-pending-next-receipt-and-duplicate-new-block-stop',async()=>{const f=await fixture(),a=await audit(f),d=path.join(root,'prospective');writeNewState({bytes:f.bytes,destination:d,audit:a});const j=new Journal(d);let signed=0;
  const build=()=>new DemoEngine({rpc:f.rpc,sign:tx=>{signed++;return wallet.signTransaction(tx)},decode:r=>Transaction.from(r),journal:j,identity:f.identity,budgetWei:cfg.budgetWei,reserveWei:cfg.reserveWei,maxPending:1,policy:{configSHA256:newSHA},now:()=>f.chain.now});const e=build();
  const action=n=>({key:'activity:'+n+':pulse',label:'AUTOMATED DEMO pulse',to:f.addresses[0],data:new Interface(artifacts.GL3AutomatedDemoPulse.abi).encodeFunctionData('pulse'),gasLimit:1000000n,maxFeePerGas:20000000000000n,maxPriorityFeePerGas:0n,quoteTimeMs:f.chain.now});
  const one=await e.submit(action(100));assert.deepEqual(await e.submit(action(101)),{backpressure:true});assert.equal(signed,1);
  function mine(hash){const b='0x20',blockHash=H('9');f.chain.blocks.set(b,{hash:blockHash});f.chain.receipts.set(hash,{transactionHash:hash,status:'0x1',blockNumber:b,blockHash,gasUsed:'0x5208',effectiveGasPrice:'0x9184e72a000'});f.chain.latest++;f.chain.balance-=21000n*10n**13n;}
  mine(one.hash);await e.reconcile();assert.equal(e.pending.length,0);const two=await e.submit(action(101));mine(two.hash);await assert.rejects(e.reconcile(),/DEMO_BLOCK_DUPLICATE/);assert.equal(f.chain.sent,2);assert.throws(build,/DEMO_BLOCK_DUPLICATE/);j.close();
 });
 const result={schema:'gh0st.gl3.automated-demo.v2-tests.v1',passed:true,actualExitCode:0,cases:reports.length,tests:reports,liveKeysRead:0,liveJournalsRead:0,liveSigned:0,liveSent:0,
  scope:'Published TEST key signatures and exact original v1 journal encoding, synthetic canonical RPC graph. Tests validate migration/pacing/ledger rules, not a new live worker or STF benchmark.'};fs.mkdirSync(path.join(dir,'evidence'),{recursive:true});fs.writeFileSync(path.join(dir,'evidence/tests.json'),JSON.stringify(result,null,2)+'\n');console.log('ALL PASS '+reports.length);
}finally{fs.rmSync(root,{recursive:true,force:true});}
