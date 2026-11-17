// Root-run, read-only chain audit + NEW-state copy. Never stops a process or sends.
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {Journal,DemoEngine,digest,json,ensure} from './engine.mjs';
import {validateConfig} from './worker.mjs';
const{Transaction,Interface,AbiCoder,getCreateAddress,JsonRpcProvider}=createRequire('/workspace/gl3/durable/neutral/dispute/package.json')('ethers');
export const OLD_CONFIG='1e203f27e8668824a20fcceb9db75eae9e78f5f800f553e2040cddfc1038ad59';
export function parseOriginal(bytes){
 const text=bytes.toString('utf8');ensure(bytes.length>0&&bytes.length<=128*1024*1024&&text.endsWith('\n'),'ORIGINAL_JOURNAL_SIZE_OR_TAIL');
 let previous='0'.repeat(64);const events=[];
 for(const line of text.split('\n').filter(Boolean)){const{sha256,...body}=JSON.parse(line);ensure(body.prev===previous&&sha256===digest(json(body)),'ORIGINAL_JOURNAL_HASH_CHAIN');previous=sha256;events.push(body.event);}
 ensure(events[0]?.type==='identity'&&!events.some(e=>e.type==='policy-transition'),'ORIGINAL_V1_IDENTITY_REQUIRED');return events;
}
export async function auditOriginal({bytes,config,newConfigSHA256,artifacts,rpc}){
 const events=parseOriginal(bytes),identity=events[0].identity,signer=config.signer;
 ensure(identity.chainId===config.chainId&&identity.genesis===config.genesis&&identity.signer.toLowerCase()===signer.toLowerCase()&&identity.configSHA256===OLD_CONFIG,'ORIGINAL_IDENTITY_MISMATCH');
 const derived=[];const memory={events:[...events],append(e){this.events.push(e);derived.push(e)}};
 const engine=new DemoEngine({rpc,sign:async()=>{throw Error('MIGRATION_MUST_NOT_SIGN')},decode:r=>Transaction.from(r),journal:memory,identity,budgetWei:config.budgetWei,reserveWei:config.reserveWei,maxPending:1});
 ensure(engine.intents.length>=3&&engine.intents.length<=250000,'ORIGINAL_INTENT_COUNT');
 const names=['GL3AutomatedDemoPulse','GL3AutomatedDemoToken','GL3AutomatedDemoNFT'];
 const addresses=names.map((_,nonce)=>getCreateAddress({from:signer,nonce}));
 const definitions={pulse:[addresses[0],new Interface(artifacts[names[0]].abi).encodeFunctionData('pulse')],token:[addresses[1],new Interface(artifacts[names[1]].abi).encodeFunctionData('transfer',[config.tokenRecipient,10n**18n])],nft:[addresses[2],new Interface(artifacts[names[2]].abi).encodeFunctionData('mintDemo')]};
 ensure(BigInt(await rpc('eth_chainId',[]))===BigInt(config.chainId)&&(await rpc('eth_getBlockByNumber',['0x0',false])).hash===config.genesis,'WRONG_CHAIN_OR_GENESIS');
 let spent=0n;const seen=new Set();
 for(let n=0;n<engine.intents.length;n++){
  const i=engine.intents[n],tx=Transaction.from(i.raw);ensure(i.nonce===n,'ORIGINAL_NONCE_NOT_CONTIGUOUS');
  if(n<3){const data=artifacts[names[n]].bytecode+AbiCoder.defaultAbiCoder().encode(['address'],[signer]).slice(2);ensure(tx.to===null&&tx.data===data&&i.key==='deploy:'+names[n],'ORIGINAL_DEPLOYMENT_MISMATCH');}
  else {const match=/^activity:(0|[1-9][0-9]*):(pulse|token|nft)$/.exec(i.key);ensure(match,'ORIGINAL_ACTIVITY_KEY');const[to,data]=definitions[match[2]];ensure(tx.to?.toLowerCase()===to.toLowerCase()&&tx.data===data,'ORIGINAL_ACTIVITY_TARGET_OR_DATA');}
  ensure(!seen.has(i.hash),'DUPLICATE_ORIGINAL_HASH');seen.add(i.hash);
  const r=await rpc('eth_getTransactionReceipt',[i.hash]);ensure(r?.status==='0x1'&&r.transactionHash===i.hash,'MISSING_PENDING_OR_FAILED_RECEIPT');
  const block=await rpc('eth_getBlockByNumber',[r.blockNumber,false]);ensure(block?.hash===r.blockHash,'NONCANONICAL_ORIGINAL_RECEIPT');
  const paid=BigInt(r.gasUsed)*BigInt(r.effectiveGasPrice);ensure(paid<=BigInt(i.maxCost),'ORIGINAL_FEE_EXCEEDS_INTENT');spent+=paid;
  if(i.receipt){for(const field of ['blockNumber','blockHash','status','gasUsed','effectiveGasPrice'])ensure(i.receipt[field]===r[field],'SAVED_RECEIPT_DIFFERS_FROM_CHAIN');ensure(BigInt(i.receipt.paidWei)===paid,'SAVED_SPEND_MISMATCH');}
  else memory.append({type:'receipt',hash:i.hash,nonce:i.nonce,blockNumber:r.blockNumber,blockHash:r.blockHash,status:r.status,gasUsed:r.gasUsed,effectiveGasPrice:r.effectiveGasPrice,paidWei:String(paid),observedUTC:new Date().toISOString()});
 }
 const latest=BigInt(await rpc('eth_getTransactionCount',[signer,'latest'])),pending=BigInt(await rpc('eth_getTransactionCount',[signer,'pending']));
 ensure(latest===pending&&latest===BigInt(engine.intents.length),'NOT_DRAINED_OR_UNTRACKED_NONCE');
 ensure(Array.isArray(config.fundingReceipts)&&config.fundingReceipts.length===2,'TWO_APPROVED_FUNDING_RECEIPTS_REQUIRED');
 const funding=[];const hashes=new Set();
 for(let n=0;n<2;n++){
  const f=config.fundingReceipts[n],expected=(n===0?100000n:250000n)*10n**18n;
  ensure(/^0x[0-9a-f]{64}$/i.test(f.hash)&&!hashes.has(f.hash)&&BigInt(f.amountWei)===expected,'APPROVED_FUNDING_DESCRIPTION');hashes.add(f.hash);
  const tx=await rpc('eth_getTransactionByHash',[f.hash]),r=await rpc('eth_getTransactionReceipt',[f.hash]);
  ensure(tx&&r?.status==='0x1'&&tx.from.toLowerCase()==='0x8d6b11cfdf079e27c17e05cb7ea81235887691c6'&&tx.to?.toLowerCase()===signer.toLowerCase()&&BigInt(tx.value)===expected&&(tx.input??tx.data)==='0x','FUNDING_TRANSACTION_MISMATCH');
  ensure((await rpc('eth_getBlockByNumber',[r.blockNumber,false]))?.hash===r.blockHash,'FUNDING_NOT_CANONICAL');funding.push({hash:f.hash,amountWei:String(expected),blockNumber:r.blockNumber,blockHash:r.blockHash});
 }
 const budget=350000n*10n**18n,balance=BigInt(await rpc('eth_getBalance',[signer,'latest']));
 ensure(BigInt(config.budgetWei)===budget&&spent+BigInt(config.reserveWei)<budget&&balance>=budget-spent,'CUMULATIVE_BUDGET_OR_BALANCE_MISMATCH');
 const transition={type:'policy-transition',version:2,oldConfigSHA256:OLD_CONFIG,newConfigSHA256,oldBudgetWei:String(100000n*10n**18n),newBudgetWei:String(budget),firstNewNonce:Number(latest),
  oldIntentCount:engine.intents.length,oldSpentWei:String(spent),originalJournalSHA256:digest(bytes),originalJournalBytes:bytes.length,fundingReceipts:funding,
  policy:'ONE_ACTION_PER_TICK_RECEIPT_BEFORE_NEXT_MIN_1000MS_MAX_PENDING_1',migratedUTC:new Date().toISOString()};
 return{derived,transition,identity,spentWei:String(spent),nextNonce:Number(latest),unbudgetedSurplusWei:String(balance-(budget-spent))};
}
export function writeNewState({bytes,destination,audit}){
 ensure(!fs.existsSync(destination),'NEW_STATE_ALREADY_EXISTS');fs.mkdirSync(destination,{mode:0o700});
 const file=path.join(destination,'intents.jsonl');fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
 const journal=new Journal(destination);try{for(const e of audit.derived)journal.append(e);journal.append(audit.transition);}finally{journal.close();}
 const after=fs.readFileSync(file);ensure(after.subarray(0,bytes.length).equals(bytes),'ORIGINAL_PREFIX_NOT_PRESERVED');
 return{newJournalSHA256:digest(after),newJournalBytes:after.length,originalPrefixSHA256:digest(after.subarray(0,bytes.length)),originalBytesPreservedExactly:true};
}
function safeRead(file,maxBytes){const s=fs.lstatSync(file);ensure(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.uid===process.getuid()&&(s.mode&0o777)===0o600&&s.size<=maxBytes,'UNSAFE_PRIVATE_METADATA_OR_JOURNAL');return fs.readFileSync(file);}
export function ensureNoWriter(file){
 const target=fs.statSync(file);
 for(const proc of fs.readdirSync('/proc').filter(n=>/^[0-9]+$/.test(n))){let fds;try{fds=fs.readdirSync('/proc/'+proc+'/fd')}catch{continue}
  for(const fd of fds){try{const s=fs.statSync('/proc/'+proc+'/fd/'+fd);if(s.dev!==target.dev||s.ino!==target.ino)continue;
   const info=fs.readFileSync('/proc/'+proc+'/fdinfo/'+fd,'utf8'),flags=/^flags:\s+([0-7]+)/m.exec(info);ensure(flags&&(parseInt(flags[1],8)&3)===0,'ORIGINAL_JOURNAL_HAS_WRITER');
  }catch(e){if(e.message==='ORIGINAL_JOURNAL_HAS_WRITER')throw e;}}
 }
}
async function main(){
 const directory=path.dirname(new URL(import.meta.url).pathname),specBytes=fs.readFileSync(process.argv[2]);ensure(process.env.GL3_DEMO_MIGRATION_APPROVAL_SHA256===digest(specBytes),'EXACT_MIGRATION_APPROVAL_REQUIRED');
 const spec=JSON.parse(specBytes);ensure(spec.schema==='gh0st.gl3.demo-migration-approval.v2'&&spec.approved===true,'MIGRATION_NOT_APPROVED');
 for(const pid of [spec.oldControllerPID,spec.oldWorkerPID]){ensure(Number.isSafeInteger(pid)&&pid>1,'OLD_PID_REQUIRED');let gone=false;try{process.kill(pid,0)}catch(e){gone=e.code==='ESRCH'}ensure(gone,'OLD_PROCESS_STILL_EXISTS');}
 ensure(spec.oldStateDir==='/workspace/gl3/mainnet/private/demo/state-v1'&&!fs.existsSync(path.join(spec.oldStateDir,'worker.lock')),'OLD_JOURNAL_STILL_LOCKED');
 ensure(spec.oldExitReceiptPath?.startsWith(spec.oldStateDir+'/run-')&&path.basename(spec.oldExitReceiptPath)==='result.json','OLD_CONTROLLER_EXIT_RECEIPT_REQUIRED');
 const oldExit=JSON.parse(safeRead(spec.oldExitReceiptPath,65536));ensure(oldExit.schema==='gh0st.gl3.automated-demo.controller.v1'&&oldExit.actualExitCode===0&&Array.isArray(oldExit.remainingOwnedPIDs)&&oldExit.remainingOwnedPIDs.length===0,'OLD_CONTROLLER_NOT_CLEANLY_STOPPED');
 const configBytes=safeRead(spec.newConfigPath,65536),newSHA=digest(configBytes);ensure(newSHA===spec.newConfigSHA256,'NEW_CONFIG_HASH_MISMATCH');const c=validateConfig(JSON.parse(configBytes));
 ensure(c.stateDir==='/workspace/gl3/mainnet/private/demo/state-v2'&&c.stateDir!==spec.oldStateDir,'NEW_PRIVATE_STATE_REQUIRED');
 for(const[file,field]of[['engine.mjs','engineSHA256'],['worker.mjs','workerSHA256'],['artifacts.json','artifactsSHA256']])ensure(digest(fs.readFileSync(path.join(directory,file)))===c[field],'NEW_SOURCE_HASH_MISMATCH');
 ensure(spec.migratorSHA256===digest(fs.readFileSync(new URL(import.meta.url))),'MIGRATOR_SOURCE_HASH_MISMATCH');
 const oldFile=path.join(spec.oldStateDir,'intents.jsonl');ensureNoWriter(oldFile);const bytes=safeRead(oldFile,128*1024*1024),originalSHA=digest(bytes);
 const provider=new JsonRpcProvider(c.rpc,undefined,{cacheTimeout:-1,batchMaxCount:1});
 try{const audit=await auditOriginal({bytes,config:c,newConfigSHA256:newSHA,artifacts:JSON.parse(fs.readFileSync(path.join(directory,'artifacts.json'))),rpc:(m,a)=>{ensure(!m.startsWith('eth_send'),'MIGRATION_CANNOT_SEND');return provider.send(m,a)}});
  ensure(digest(safeRead(oldFile,128*1024*1024))===originalSHA&&!fs.existsSync(path.join(spec.oldStateDir,'worker.lock')),'ORIGINAL_CHANGED_DURING_AUDIT');ensureNoWriter(oldFile);const copied=writeNewState({bytes,destination:c.stateDir,audit});
  const result={schema:'gh0st.gl3.automated-demo.migration.v2',passed:true,newConfigSHA256:newSHA,originalJournalSHA256:originalSHA,oldConfigSHA256:OLD_CONFIG,nextNonce:audit.nextNonce,spentWei:audit.spentWei,
   newCumulativeBudgetWei:c.budgetWei,unbudgetedSurplusWei:audit.unbudgetedSurplusWei,derivedMissingReceiptObservations:audit.derived.length,...copied,fundingReceipts:audit.transition.fundingReceipts,
   scope:'Original bytes preserved in new hash-chained state. All original signed intents and receipts audited; old process absent; no send/sign/key read, no reset or automatic replay.'};
  const out=path.join(directory,'evidence');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'actual-migration.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{provider.destroy();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname)main().catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message)?e.message:'MIGRATION_AUDIT_ERROR_NO_SEND');process.exitCode=1});
