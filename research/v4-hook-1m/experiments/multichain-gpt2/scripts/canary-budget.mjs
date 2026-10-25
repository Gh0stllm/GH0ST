// One durable native-currency budget per session and chain, shared by deployment and relay.
// Reservations survive crashes. An unknown broadcast outcome is never automatically released.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Contract,Transaction,keccak256,getBytes} from 'ethers';
import {HERE} from './build.mjs';
import {checkedOutput,equal,validHash} from './canary-runtime.mjs';

const GPO='0x420000000000000000000000000000000000000F';
const decimal=x=>{assert(/^(?:0|[1-9][0-9]*)$/.test(String(x)),'Invalid unsigned budget number');return BigInt(x);};
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
function save(file,value){const tmp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,json(value),{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}
function locations(config,chain){
  assert(validHash(config.sessionId),'Invalid session identity');
  assert([4663,204].includes(chain.chainId),'Unsupported budget chain');
  const dir=checkedOutput(path.join(HERE,'deployments','canary-spend',config.sessionId.toLowerCase()));
  fs.mkdirSync(dir,{recursive:true});
  const file=checkedOutput(path.join(dir,chain.chainId+'.json'));
  return {file,lock:file+'.lock'};
}
function acquire(paths){
  try{fs.writeFileSync(paths.lock,json({pid:process.pid,host:os.hostname()}),{flag:'wx',mode:0o600});}
  catch(e){
    if(e.code!=='EEXIST')throw e;
    // Never unlink based on a stale PID: two recovery processes could delete each other's
    // new lock. A crash requires an operator to stop all runners and remove only this lock.
    throw Error('Budget lock exists; stop all runners and inspect crash recovery before removing the lock');
  }
}
function unlock(res){if(!res.released){fs.unlinkSync(res.lock);res.released=true;}}
function readLedger(file,config,chain){
  const cap=decimal(chain.maxTotalSpendWei);assert(cap>0n,'Positive total budget required');
  const identity={schemaVersion:1,sessionId:config.sessionId.toLowerCase(),chainId:chain.chainId,admin:config.admin.toLowerCase(),maxTotalSpendWei:cap.toString()};
  if(!fs.existsSync(file))return {...identity,spentWei:'0',pending:null,receipts:[]};
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const [k,v] of Object.entries(identity))assert(data[k]===v,'Budget identity or approved cap changed');
  decimal(data.spentWei);assert(Array.isArray(data.receipts),'Invalid budget history');return data;
}
async function network(config,chain,provider){
  assert(config.budgetApproved===true&&config.enabled===true&&config.messagingReviewed===true,'Canary budget is not approved and enabled');
  assert(Number((await provider.getNetwork()).chainId)===chain.chainId,'Budget provider chain mismatch');
  const block=await provider.getBlock('latest');assert(block&&block.timestamp<=config.deadline,'Canary deadline expired');
}
export function canaryBudgetPath(config,chain){return locations(config,chain).file;}

export async function reserveCanarySpend({config,chain,configFile,provider,actionId,gasLimit,feeOverrides,value=0n,data='0x',to=null}){
  void configFile; // Deliberately not part of ledger identity: copying a config cannot reset its budget.
  await network(config,chain,provider);
  assert(typeof actionId==='string'&&actionId.length>0&&actionId.length<=160,'Invalid action identity');
  gasLimit=decimal(gasLimit);value=decimal(value);
  assert(gasLimit>0n&&gasLimit<=decimal(chain.maxTransactionGas),'Transaction exceeds gas limit');
  assert(value<=decimal(chain.maxMessageFeeWei),'Transaction value exceeds message fee cap');
  const legacy=feeOverrides.gasPrice!==undefined;
  assert(Object.keys(feeOverrides).every(k=>['gasPrice','maxFeePerGas','maxPriorityFeePerGas'].includes(k)),'Unexpected fee override');
  assert(legacy?(feeOverrides.maxFeePerGas===undefined&&feeOverrides.maxPriorityFeePerGas===undefined):feeOverrides.maxFeePerGas!==undefined,'Ambiguous transaction fee');
  const feeCap=decimal(legacy?feeOverrides.gasPrice:feeOverrides.maxFeePerGas);
  assert(feeCap>0n&&feeCap<=decimal(chain.maxFeePerGasWei),'Transaction gas price exceeds cap');
  if(!legacy)assert(decimal(feeOverrides.maxPriorityFeePerGas??0n)<=feeCap,'Priority fee exceeds fee cap');
  const paths=locations(config,chain);acquire(paths);
  const res={...paths,config,chain,provider,released:false};
  try{
    const ledger=readLedger(paths.file,config,chain);assert(!ledger.reviewRequired&&!ledger.overBudget,'Budget requires manual review');assert(!ledger.pending,'Pending canary spend must be reconciled first');
    const nonce=await provider.getTransactionCount(config.admin,'pending');
    assert(Number.isSafeInteger(nonce)&&nonce>=0,'Invalid pending nonce');
    const unsigned=Transaction.from({type:legacy?0:2,chainId:chain.chainId,nonce,to,value,data,gasLimit,...feeOverrides});
    let postingReserve=0n;
    const postingCap=decimal(chain.maxPostingFeeWei);
    if(chain.chainId===204){
      assert(postingCap>0n,'opBNB posting fee cap required');
      // Only a byte count is sent to the public oracle, never model data or transaction contents.
      const oracle=new Contract(GPO,['function getL1FeeUpperBound(uint256) view returns(uint256)'],provider);
      postingReserve=2n*BigInt(await oracle.getL1FeeUpperBound(getBytes(unsigned.unsignedSerialized).length));
      assert(postingReserve<=postingCap,'opBNB posting estimate exceeds cap');
    }else assert(postingCap===0n,'RH posting is already represented in gas estimation');
    const reservedWei=gasLimit*feeCap+value+postingReserve;
    assert(decimal(ledger.spentWei)+reservedWei<=decimal(ledger.maxTotalSpendWei),'Total canary budget would be exceeded');
    assert(BigInt(await provider.getBalance(config.admin,'pending'))>=reservedWei,'Insufficient native balance for reserved spend');
    const pending={id:randomUUID(),actionId,nonce,to:to?.toLowerCase()??null,dataHash:keccak256(data),valueWei:value.toString(),gasLimit:gasLimit.toString(),feeCapWei:feeCap.toString(),postingReserveWei:postingReserve.toString(),reservedWei:reservedWei.toString(),hash:null,createdAt:new Date().toISOString()};
    ledger.pending=pending;save(paths.file,ledger);return Object.assign(res,{id:pending.id,nonce,reservedWei});
  }catch(e){unlock(res);throw e;}
}
function current(res){assert(!res.released,'Budget reservation lock is released');const ledger=readLedger(res.file,res.config,res.chain);assert(ledger.pending?.id===res.id,'Budget reservation changed');return ledger;}
export function markCanaryBroadcast(res,hash){assert(validHash(hash),'Invalid broadcast hash');const ledger=current(res);assert(!ledger.pending.hash||equal(ledger.pending.hash,hash),'Broadcast hash changed');ledger.pending.hash=hash;save(res.file,ledger);}
export function releaseCanaryReservation(res){if(res&&!res.released)unlock(res);}
export function cancelCanaryReservation(res,{neverBroadcast=false}={}){
  assert(neverBroadcast===true,'Cancellation requires proof of no broadcast');const ledger=current(res);assert(!ledger.pending.hash,'A broadcast transaction cannot be canceled');ledger.pending=null;save(res.file,ledger);unlock(res);
}
async function settle(res,receipt,provider){
  const ledger=current(res),p=ledger.pending;
  assert(p.hash&&equal(receipt.hash??receipt.transactionHash,p.hash),'Receipt does not match reservation');
  const tx=await provider.getTransaction(p.hash);assert(tx,'Broadcast transaction unavailable');
  assert(equal(tx.from,res.config.admin)&&tx.nonce===p.nonce&&Number(tx.chainId)===res.chain.chainId,'Broadcast authority or nonce mismatch');
  assert((tx.to===null&&p.to===null)||(tx.to&&p.to&&equal(tx.to,p.to)),'Broadcast target mismatch');
  assert(keccak256(tx.data)===p.dataHash&&BigInt(tx.value)===decimal(p.valueWei)&&BigInt(tx.gasLimit)<=decimal(p.gasLimit),'Broadcast contents exceed reservation');
  const price=BigInt(receipt.gasPrice??receipt.effectiveGasPrice??0n);assert(price>0n&&price<=decimal(p.feeCapWei),'Receipt gas price outside reservation');
  const used=BigInt(receipt.gasUsed);assert(used<=decimal(p.gasLimit),'Receipt gas exceeds reservation');
  let posting=0n,postingSource='included-in-gas';
  if(res.chain.chainId===204){
    const raw=await provider.send('eth_getTransactionReceipt',[p.hash]);
    assert(raw&&equal(raw.transactionHash,p.hash)&&equal(raw.blockHash,receipt.blockHash),'Raw receipt mismatch');
    if(raw.l1Fee!==undefined&&raw.l1Fee!==null){posting=BigInt(raw.l1Fee);postingSource='receipt';}
    else{posting=decimal(p.postingReserveWei);postingSource='conservative-reservation';}
  }
  const status=Number(receipt.status);assert(status===0||status===1,'Unknown receipt status');
  const actual=used*price+posting+(status===1?decimal(p.valueWei):0n);
  const entry={...p,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,status,gasUsed:used.toString(),gasPriceWei:price.toString(),postingWei:posting.toString(),postingSource,chargedWei:actual.toString(),settledAt:new Date().toISOString()};
  ledger.spentWei=(decimal(ledger.spentWei)+actual).toString();ledger.receipts.push(entry);ledger.pending=null;
  ledger.overBudget=decimal(ledger.spentWei)>decimal(ledger.maxTotalSpendWei);
  ledger.reviewRequired=ledger.reviewRequired===true||actual>decimal(p.reservedWei)||ledger.overBudget;
  save(res.file,ledger);unlock(res);
  assert(!ledger.reviewRequired,'Actual chain fees exceeded the operational reservation; stop for review');
  return entry;
}
export async function recordCanaryReceipt(res,receipt,provider=res.provider){return settle(res,receipt,provider);}
export async function reconcileCanaryBudget({config,chain,configFile,provider}){
  void configFile;await network(config,chain,provider);const paths=locations(config,chain);acquire(paths);
  const res={...paths,config,chain,provider,released:false};
  try{
    const ledger=readLedger(paths.file,config,chain);
    assert(!ledger.reviewRequired&&!ledger.overBudget,'Canary budget exceeded or reservation breached; review required');
    if(!ledger.pending){unlock(res);return ledger;}
    res.id=ledger.pending.id;assert(ledger.pending.hash,'Unknown broadcast outcome; manual nonce and receipt recovery required');
    const receipt=await provider.getTransactionReceipt(ledger.pending.hash);assert(receipt,'Canary transaction still pending');
    assert(await receipt.confirmations()>=chain.confirmations,'Canary transaction awaits confirmations');
    await settle(res,receipt,provider);return readLedger(paths.file,config,chain);
  }finally{if(!res.released)unlock(res);}
}
