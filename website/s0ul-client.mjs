import * as Ethers from './mint/vendor/ethers.js';
import { planGas, forecastRemaining, paddedGasLimit, checkSpendBudget, OPERATIONAL_GAS_CAP } from './s0ul-gas.mjs';

// These are deployment identities, never user supplied RPC endpoints or signers.
export const S0UL_DEPLOYMENT = Object.freeze({
  chainId: 4663,
  controller: '0x9F92776e33087DCF0d77b9BE23145efAC6cE695D',
  controllerCodeHash: '0x0d89f81a955230d7ebb01d2549770041f796429abba6d229a2089a3e310636ed',
  engine: '0x07bB8455Db0928bEBEb3E7F27A22A0599AF1b650',
  engineCodeHash: '0xb7a6bc7ae646bde8afce18291fe14fff72cde8efa7e718d9f4c933c346184ae2',
  model: '0xa62C2d6fbba575732AAB38c56fCd73B2361B1D98',
  modelCodeHash: '0x30a7cd1a35da7887f21896c5769ec13dfad35b53e4bf7645612918a3e8319abc',
  tokenizer: '0x3Cf3739D8e587C3AB5706fd459e75A6fCE26d333',
  tokenizerCodeHash: '0x209c23483d5d255d013e30b7f8c7ae1f7f613121efecbb5d5f546454a8cb6987',
  modelId: '0x6b0817a3bc4d0ba1f03ec6e14387285e1bcda0e40fdd40d7daee2cbc3c2ff89a',
  sourceCheckpoint: '0x44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692',
  tokenizerDomain: '0x7de4830b9e32e5884d2ee9776fdae6c8c1b42a9278342ae22d7105b039e9a726',
  gh0stToken: '0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559',
  gh0stCodeHash: '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164',
});
export const PHASE_NAMES = Object.freeze(['None','Embed','AttnNorm','Q','K','V','RoPEQ','RoPEKCache','Attend','O','AttnResidual','FFNUp','FFNDown','FFNResidual','FinalNorm','Logits','Select','Done','Cancelled']);
export const REASON_NAMES = Object.freeze(['None','EngineCancelled','InvalidOutput','InvalidAction','ActionNotAllowed','StaleState','TaskLimit','TaskMissing','TokenDisabled','TokenChanged','TokenReadFailed','ActionMismatch']);
const CONFIG_TUPLE = '(uint16 vocabSize,uint16 dim,uint16 layers,uint16 heads,uint16 hiddenDim,uint16 maxSeqLen,uint32 epsQ28,uint32 attentionScaleQ14)';
export const S0UL_ABIS = Object.freeze({
  controller: [
    'function beginConstrained(string,uint16,uint16,bytes32) returns(uint256)',
    'function advanceBatch(uint256,uint256,uint256) returns(bool)', 'function finalize(uint256) returns(bool)', 'function cancel(uint256)',
    'function requests(uint256) view returns(address owner,uint16 allowedActions,uint64 stateRevision,bool adopted,uint8 outcome,uint8 action,uint8 reason,bytes32 promptHash,bytes32 outputHash,bytes32 expectedActionHash)',
    'function resultOf(uint256) view returns(bytes output,bytes result)',
    'function memoryOf(address,bytes32) view returns(bytes)', 'function tasksOf(address) view returns((bytes title,bool done)[])',
    'function stateRevision(address) view returns(uint64)',
    ...['engine','model','tokenizer','gh0stToken'].map(name => 'function '+name+'() view returns(address)'),
    ...['engineCodeHash','modelCodeHash','tokenizerCodeHash','modelId','sourceCheckpoint','gh0stCodeHash'].map(name => 'function '+name+'() view returns(bytes32)'),
    'event Bound(uint256 indexed requestId,address indexed owner,bytes32 indexed modelId,uint16 allowedActions,bytes32 promptHash,bool adopted)',
    'event Executed(uint256 indexed requestId,address indexed owner,uint8 kind,bytes32 outputHash,bytes result)',
    'event Rejected(uint256 indexed requestId,address indexed owner,uint8 reason,bytes32 outputHash)',
    'event Cancelled(uint256 indexed requestId,address indexed owner,bool engineCancelled)',
    'event BatchAdvanced(uint256 indexed requestId,uint256 executed,bool done)',
  ],
  engine: [
    'function model() view returns(address)', 'function tokenizer() view returns(address)', 'function modelId() view returns(bytes32)',
    'function configuration() view returns('+CONFIG_TUPLE+')',
    'function status(uint256) view returns((address owner,uint8 phase,uint16 position,uint16 layer,uint16 row,uint16 head,uint16 promptLength,uint16 maxNewTokens,uint16 generated,uint256 saturationCount,bool done,bool cancelled,bool logitsReady))',
    'function tokens(uint256) view returns(uint16[])', 'function outputTokens(uint256) view returns(uint16[])', 'function logits(uint256) view returns(int32[])',
  ],
  model: ['function configuration() view returns('+CONFIG_TUPLE+')', 'function modelId() view returns(bytes32)', 'function sourceCheckpoint() view returns(bytes32)'],
  tokenizer: ['function encode(string) pure returns(uint16[])', 'function decode(uint16[],bool) pure returns(bytes)', 'function domainSha256() pure returns(bytes32)'],
});
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const unsigned = (v,name) => { if((typeof v==='number'&&!Number.isSafeInteger(v))||!['number','bigint','string'].includes(typeof v)||(typeof v==='string'&&!/^\d+$/.test(v)))throw Error(name+' must be an exact integer');let n; try { n=BigInt(v); } catch { throw Error(name+' must be an integer'); } if(n<0n) throw Error(name+' must be nonnegative'); return n; };
const number = (v,name,max=65535) => { const n=unsigned(v,name); if(n>BigInt(max)) throw Error(name+' is out of range'); return Number(n); };
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?{$s0ulBigInt:v.toString()}:v),(_,v)=>v && typeof v==='object' && Object.keys(v).length===1 && '$s0ulBigInt' in v?BigInt(v.$s0ulBigInt):v);
const fingerprint = value => JSON.stringify(value,(_,v)=>typeof v==='bigint'?{$s0ulBigInt:v.toString()}:v);
const errorText = error => String(error?.shortMessage || error?.reason || error?.message || error || 'Unknown error').slice(0,700);
const requestFields=['owner','allowedActions','stateRevision','adopted','outcome','action','reason','promptHash','outputHash','expectedActionHash'];
const statusFields=['owner','phase','position','layer','row','head','promptLength','maxNewTokens','generated','saturationCount','done','cancelled','logitsReady'];
const objectFromTuple = (value,fields) => Object.fromEntries(fields.map((key,i)=>[key,value[key]??value[i]]));
const normalizeRequest = value => {const r=objectFromTuple(value,requestFields); for(const k of ['allowedActions','outcome','action','reason'])r[k]=Number(r[k]); r.stateRevision=BigInt(r.stateRevision);return r;};
const normalizeStatus = value => {const s=objectFromTuple(value,statusFields); for(const k of ['phase','position','layer','row','head','promptLength','maxNewTokens','generated'])s[k]=Number(s[k]);s.saturationCount=BigInt(s.saturationCount);s.phaseName=PHASE_NAMES[s.phase]??'Unknown';return s;};

/** Mirrors the deployed parser; syntax alone never authorizes an action. */
export function parseExpectedAction(text, suppliedKind) {
  if(typeof text!=='string'||text.length<1||text.length>100||!/^[A-Za-z0-9_|]+$/.test(text)) throw Error('Choose an exact canonical S0UL action');
  const f=text.split('|'), slug=/^[a-z][a-z0-9_]{0,23}$/, key=v=>['theme','language','mode'].includes(v);
  let kind=-1;
  if(text==='WAIT')kind=0;
  else if(f.length===3&&f[0]==='BALANCE'&&f[1]==='SELF'&&['ETH','GH0ST'].includes(f[2]))kind=f[2]==='ETH'?1:2;
  else if(f.length===3&&f[0]==='MEM_SET'&&key(f[1])&&slug.test(f[2]))kind=3;
  else if(f.length===2&&f[0]==='MEM_GET'&&key(f[1]))kind=4;
  else if(f.length===2&&f[0]==='TASK_ADD'&&slug.test(f[1]))kind=5;
  else if(text==='TASK_LIST|SELF')kind=6;
  else if(f.length===2&&f[0]==='TASK_DONE'&&/^[1-9][0-9]{0,3}$/.test(f[1]))kind=7;
  else if(f.length===2&&f[0]==='CLARIFY'&&['asset','key','value','title','task_id','request'].includes(f[1]))kind=8;
  else if(f.length===2&&f[0]==='REFUSE'&&['unsupported','unauthorized','unsafe'].includes(f[1]))kind=9;
  if(kind<0||(suppliedKind!==undefined&&Number(suppliedKind)!==kind))throw Error('Action does not match the selected intent');
  return {text,kind,mask:1<<kind,expectedActionHash:Ethers.keccak256(Ethers.toUtf8Bytes(text))};
}

/** Validate actual output IDs before asking the tokenizer to decode them. */
export function decodeOutputIds(values,{done=false,generated=values.length}={}) {
  const ids=Array.from(values,v=>number(v,'Output token',511));
  if(ids.length!==Number(generated))throw Error('Generated token count does not match engine output');
  if(ids.length>32)throw Error('Output exceeds controller token limits');
  if(done&&(ids.length<2||ids.at(-1)!==2))throw Error('Completed output has no terminal EOS');
  const content=done?ids.slice(0,-1):ids;
  if(content.some(v=>v<4||v>=421))throw Error('Output contains a control or reserved token');
  return {ids,content,endedWithEOS:done&&ids.at(-1)===2};
}

export function createS0ULClient({ethereum=globalThis.ethereum,onUpdate=()=>{},storage=globalThis.localStorage,dependencies={}}={}) {
  const eth=dependencies.ethers??Ethers, now=dependencies.now??Date.now;
  let provider=dependencies.provider??null, contracts=dependencies.contracts??null;
  let journal=null, record=null, journalKey=null, authorization=null, paused=true, lock=false, recoveryRequired=false;
  const quotes=new Map();
  const state={connected:false,address:null,chainId:null,status:'disconnected',busy:false,authorizationActive:false,requestId:null,request:null,progress:null,intent:null,quote:null,budgetWei:0n,spentWei:0n,pending:null,ambiguous:false,actualAction:null,outputIds:[],result:null,receipts:[],decisions:[],lastError:null};
  const snapshot=()=>clone(state);
  function publish(patch={}) {Object.assign(state,patch); try{onUpdate(snapshot());}catch{} return snapshot();}
  function persist() {
    if(!journal||!journalKey||!record)throw Error('A durable wallet journal is required before sending');
    journal.records[record.key]=record; journal.active=record.key;
    const serialized=JSON.stringify(journal,(_,v)=>typeof v==='bigint'?{$s0ulBigInt:v.toString()}:v);
    try {storage.setItem(journalKey,serialized);if(storage.getItem(journalKey)!==serialized)throw Error('Journal write was not retained');} catch {throw Error('Browser storage is unavailable. No further wallet request can be made safely.');}
  }
  function syncRecord() {if(!record)return;publish({requestId:record.requestId??null,intent:record.intent??null,spentWei:BigInt(record.spentWei??0),budgetWei:BigInt(record.budgetWei??0),pending:record.pending??null,ambiguous:!!record.ambiguous,receipts:record.receipts??[],decisions:record.decisions??[]});}
  function makeRecord(key,intent=null,requestId=null) {return {key,owner:state.address,chainId:S0UL_DEPLOYMENT.chainId,controller:S0UL_DEPLOYMENT.controller,requestId,intent,spentWei:0n,budgetWei:0n,receipts:[],decisions:[],pending:null,ambiguous:false};}
  function recoverJournal() {
    journalKey='gh0st:s0ul:v1:'+S0UL_DEPLOYMENT.chainId+':'+S0UL_DEPLOYMENT.controller.toLowerCase()+':'+state.address.toLowerCase();
    let saved;
    try{saved=storage?.getItem(journalKey);journal=saved?JSON.parse(saved,(_,v)=>v&&typeof v==='object'&&Object.keys(v).length===1&&'$s0ulBigInt'in v?BigInt(v.$s0ulBigInt):v):{version:1,records:{},active:null};}catch{throw Error('Wallet journal cannot be read. Restore its saved copy before continuing.');}
    if(journal.version!==1||!journal.records||typeof journal.records!=='object')throw Error('Unrecognized wallet journal');
    const unresolved=Object.values(journal.records).filter(r=>r.pending||r.ambiguous);
    if(unresolved.length>1)throw Error('Multiple unresolved wallet operations require journal recovery');
    record=unresolved[0]??journal.records[journal.active]??null;
    if(record&&(!same(record.owner,state.address)||Number(record.chainId)!==S0UL_DEPLOYMENT.chainId||!same(record.controller,S0UL_DEPLOYMENT.controller)))throw Error('Wallet journal identity mismatch');
    recoveryRequired=!!(record?.pending||record?.ambiguous); authorization=null;syncRecord();
  }
  function getContracts() {
    if(!provider)provider=new eth.BrowserProvider(ethereum,'any',{cacheTimeout:-1});
    if(!contracts)contracts=Object.fromEntries(Object.entries(S0UL_ABIS).map(([key,abi])=>[key,new eth.Contract(S0UL_DEPLOYMENT[key],abi,provider)]));
    return contracts;
  }
  async function identity() {
    if(!ethereum||!state.connected)throw Error('Connect your wallet first');
    const [accounts,chain]=await Promise.all([ethereum.request({method:'eth_accounts'}),ethereum.request({method:'eth_chainId'})]);
    if(Number(BigInt(chain))!==S0UL_DEPLOYMENT.chainId||!accounts?.[0]||!same(accounts[0],state.address)) {paused=true;authorization=null;quotes.clear();publish({quote:null,status:'paused',authorizationActive:false});throw Error('Wallet account or network changed. Reconnect and get a fresh quote.');}
    return state.address;
  }
  async function verifyDeployment() {
    getContracts();
    if(dependencies.verifyDeployment)return dependencies.verifyDeployment({provider,contracts,deployment:S0UL_DEPLOYMENT});
    const d=S0UL_DEPLOYMENT;
    const codes=await Promise.all(['controller','engine','model','tokenizer','gh0stToken'].map(async key=>{const code=await provider.getCode(d[key]);if(code==='0x'||!same(eth.keccak256(code),d[key==='gh0stToken'?'gh0stCodeHash':key+'CodeHash']))throw Error('Pinned '+key+' runtime does not match deployment');}));
    const checks=[
      ['controller','engine',d.engine],['controller','model',d.model],['controller','tokenizer',d.tokenizer],['controller','engineCodeHash',d.engineCodeHash],['controller','modelCodeHash',d.modelCodeHash],['controller','tokenizerCodeHash',d.tokenizerCodeHash],['controller','modelId',d.modelId],['controller','sourceCheckpoint',d.sourceCheckpoint],['controller','gh0stToken',d.gh0stToken],['controller','gh0stCodeHash',d.gh0stCodeHash],
      ['engine','model',d.model],['engine','tokenizer',d.tokenizer],['engine','modelId',d.modelId],['model','modelId',d.modelId],['model','sourceCheckpoint',d.sourceCheckpoint],['tokenizer','domainSha256',d.tokenizerDomain],
    ];
    await Promise.all(checks.map(async([c,m,expected])=>{if(!same(await contracts[c][m](),expected))throw Error('Pinned deployment identity changed: '+m);}));
    return codes;
  }
  async function configuration() {
    const fields=['vocabSize','dim','layers','heads','hiddenDim','maxSeqLen','epsQ28','attentionScaleQ14'];
    const [a,b]=await Promise.all([contracts.engine.configuration(),contracts.model.configuration()]);
    const cfg=Object.fromEntries(fields.map((k,i)=>[k,Number(a[k]??a[i])]));
    if(fields.some((k,i)=>cfg[k]!==Number(b[k]??b[i])))throw Error('Model and engine configuration differ');
    return cfg;
  }
  async function liveFees() {
    const [block,fee,balance]=await Promise.all([provider.getBlock('latest'),provider.getFeeData(),provider.getBalance(state.address)]);
    const gasPriceWei=BigInt(fee.gasPrice??fee.maxFeePerGas??0);
    if(!block||gasPriceWei<=0n)throw Error('Live fee data is unavailable');
    return {block,gasPriceWei,balanceWei:BigInt(balance),cap:BigInt(block.gasLimit)<OPERATIONAL_GAS_CAP?BigInt(block.gasLimit):OPERATIONAL_GAS_CAP};
  }
  async function estimate(method,args) {return BigInt(await contracts.controller.getFunction(method).estimateGas(...args,{from:state.address}));}
  function busy(operation) {return async(...args)=>{if(lock)throw Error('Wait for the current wallet operation');lock=true;publish({busy:true,lastError:null});try{return await operation(...args);}catch(error){paused=true;publish({lastError:errorText(error),status:record?.ambiguous?'ambiguous':record?.pending?'pending':'error'});throw error;}finally{lock=false;publish({busy:false});}};}
  function invalidateQuote() {quotes.clear();publish({quote:null});}
  function noPending() {if(record?.pending||record?.ambiguous||recoveryRequired)throw Error('Reconcile the exact pending transaction hash before sending another transaction');}
  function requireRunning() {if(!state.requestId||!state.request||state.request.outcome!==1)throw Error('Load a running request first');}
  function intentMatchesRequest(intent,r) {return !!intent&&same(intent.expectedActionHash,r.expectedActionHash)&&Number(intent.mask)===r.allowedActions;}
  async function refresh(id=state.requestId) {
    if(!id)return snapshot();
    const [r0,s0,ids0]=await Promise.all([contracts.controller.requests(id),contracts.engine.status(id),contracts.engine.outputTokens(id)]);
    const r=normalizeRequest(r0),s=normalizeStatus(s0),ids=Array.from(ids0,Number);
    if(!same(r.owner,state.address))throw Error('This request belongs to another wallet');
    if(!same(s.owner,r.adopted?r.owner:S0UL_DEPLOYMENT.controller))throw Error('Engine request owner does not match binding');
    let actualAction=null,outputError=null;
    try{const checked=decodeOutputIds(ids,{done:s.done,generated:s.generated});actualAction=eth.toUtf8String(await contracts.tokenizer.decode(checked.content,false));}catch(error){outputError=errorText(error);}
    let result=null;
    if([2,3].includes(r.outcome)){
      const pair=await contracts.controller.resultOf(id), output=pair.output??pair[0], bytes=pair.result??pair[1];
      const settledText=eth.toUtf8String(output);if(actualAction!==null&&settledText!==actualAction)throw Error('Stored controller output differs from actual generated output');
      result={outcome:r.outcome,kind:r.action,reason:r.reason,reasonName:REASON_NAMES[r.reason],output:settledText,raw:bytes};
      if(r.outcome===2)result={...result,...decodeResult(r.action,bytes)};
    }
    let status=r.outcome===2?'complete':r.outcome===3?'rejected':r.outcome===4?'cancelled':state.status;
    if(record?.pending)status='pending';if(record?.ambiguous)status='ambiguous';
    publish({requestId:String(id),request:r,progress:s,outputIds:ids,actualAction,outputError,result,status});
    return snapshot();
  }
  function decodeResult(kind,bytes) {
    const coder=eth.AbiCoder.defaultAbiCoder(), text=v=>eth.toUtf8String(v);
    switch(kind){
      case 0:return {message:'WAIT'};
      case 1:case 2:return {balanceWei:BigInt(coder.decode(['uint256'],bytes)[0]),asset:kind===1?'ETH':'GH0ST',rawUnits:kind===2};
      case 3:{const [key,value]=coder.decode(['bytes32','bytes'],bytes);return {key:eth.decodeBytes32String(key),value:text(value)};}
      case 4:return {value:text(coder.decode(['bytes'],bytes)[0])};
      case 5:{const [taskId,title]=coder.decode(['uint256','bytes'],bytes);return {taskId:BigInt(taskId),title:text(title)};}
      case 6:return {tasks:Array.from(coder.decode(['tuple(bytes title,bool done)[]'],bytes)[0],(t,i)=>({id:i+1,title:text(t.title??t[0]),done:t.done??t[1]}))};
      case 7:return {taskId:BigInt(coder.decode(['uint256'],bytes)[0])};
      case 8:case 9:return {message:eth.decodeBytes32String(coder.decode(['bytes32'],bytes)[0])};
      default:throw Error('Unknown executed action kind');
    }
  }
  async function load(id) {
    await identity();getContracts();await verifyDeployment();
    const requestId=unsigned(id,'Request ID').toString();if(requestId==='0')throw Error('Request ID must be positive');
    if(record?.pending||record?.ambiguous){if(record.requestId!==requestId)throw Error('Resolve the current pending transaction before loading another request');}
    const key='request:'+requestId;
    if(!record||record.requestId!==requestId){noPending();record=journal.records[key]??makeRecord(key,null,requestId);authorization=null;publish({authorizationActive:false});}
    syncRecord();await refresh(requestId);
    if(record.intent&&!intentMatchesRequest(record.intent,state.request)){record.intent=null;persist();syncRecord();}
    if(record.intent){
      const all=Array.from(await contracts.engine.tokens(requestId),Number), promptIds=all.slice(0,state.progress.promptLength);
      if(!same(eth.keccak256(eth.AbiCoder.defaultAbiCoder().encode(['uint16[]'],[promptIds])),state.request.promptHash))throw Error('Engine prompt differs from controller binding');
      record.intent={...record.intent,prompt:eth.toUtf8String(await contracts.tokenizer.decode(promptIds.slice(1,-1),false)),maxNewTokens:state.progress.maxNewTokens};syncRecord();
    }
    await verifyRecordedReceipts();
    persist();publish({status:record.ambiguous?'ambiguous':record.pending?'pending':state.request.outcome===1?'paused':state.status});return snapshot();
  }
  async function quote(input={}) {
    await identity();getContracts();publish({status:'quoting'});await verifyDeployment();
    const action=parseExpectedAction(input.expectedAction??record?.intent?.expectedAction,input.kind);
    let prompt=input.prompt, maxNewTokens=number(input.maxNewTokens??32,'Output budget',32),promptIds,requestId=null,requestState=null;
    if(input.requestId!==undefined&&input.requestId!==null&&String(input.requestId)!==''){
      requestId=unsigned(input.requestId,'Request ID').toString();if(state.requestId!==requestId)await load(requestId);else await refresh(requestId);
      if(state.request.outcome!==1)throw Error('This request has already settled');
      if(!same(state.request.expectedActionHash,action.expectedActionHash)||state.request.allowedActions!==action.mask)throw Error('Candidate action does not match the immutable request commitment');
      const all=Array.from(await contracts.engine.tokens(requestId),Number);promptIds=all.slice(0,state.progress.promptLength);
      if(!same(eth.keccak256(eth.AbiCoder.defaultAbiCoder().encode(['uint16[]'],[promptIds])),state.request.promptHash))throw Error('Engine prompt differs from controller binding');
      if(promptIds[0]!==1||promptIds.at(-1)!==3||promptIds.slice(1,-1).some(v=>v<4||v>=421))throw Error('Invalid original prompt token framing');
      prompt=eth.toUtf8String(await contracts.tokenizer.decode(promptIds.slice(1,-1),false));maxNewTokens=state.progress.maxNewTokens;requestState={...state.progress};
    } else {
      if(typeof prompt!=='string'||prompt.length===0||eth.toUtf8Bytes(prompt).length>4096)throw Error('Enter a prompt of 1–4096 bytes');
      if(maxNewTokens<2)throw Error('Output budget must include at least one content token and EOS');
      promptIds=[1,...Array.from(await contracts.tokenizer.encode(prompt),Number),3];
    }
    const actionTokens=Array.from(await contracts.tokenizer.encode(action.text),Number);
    if(actionTokens.length+1>maxNewTokens)throw Error('Output budget is too small for the selected action plus EOS');
    const cfg=await configuration();if(promptIds.length+maxNewTokens>cfg.maxSeqLen)throw Error('Prompt and output budget exceed the 128-token context');
    const live=await liveFees(),feeCeilingWeiPerGas=(live.gasPriceWei*3n+1n)/2n;
    const args=[prompt,maxNewTokens,action.mask,action.expectedActionHash];
    const beginGas=requestId?0n:await estimate('beginConstrained',args);
    if(!requestId)paddedGasLimit(beginGas,{cap:live.cap});
    let finalizeGas=action.kind===6?8_000_000n:1_000_000n;
    if(requestState?.done)finalizeGas=await estimate('finalize',[requestId]);
    const options={promptTokens:promptIds.length,maxNewTokens,configuration:cfg,beginGas,finalizeGas,gasPriceWei:live.gasPriceWei,feeCeilingWeiPerGas,blockGasLimit:live.block.gasLimit};
    const forecast=requestId?forecastRemaining({...options,status:requestState}):planGas(options);
    if(!forecast.feasible)throw Error('A model step exceeds the current transaction gas limit');
    const q={...forecast,id:eth.hexlify(eth.randomBytes(16)),owner:state.address,chainId:S0UL_DEPLOYMENT.chainId,controller:S0UL_DEPLOYMENT.controller,modelId:S0UL_DEPLOYMENT.modelId,prompt,maxNewTokens,expectedAction:action.text,expectedActionHash:action.expectedActionHash,kind:action.kind,mask:action.mask,promptIds,promptTokenCount:promptIds.length,configuration:cfg,requestId,requestState,balanceWei:live.balanceWei,expiresAt:now()+60_000,createdAt:now(),blockNumber:live.block.number,spentWei:state.spentWei,canAfford:live.balanceWei>=forecast.budgetFeeWei};
    if(requestId){record.intent={prompt,maxNewTokens,promptHash:state.request.promptHash,expectedAction:action.text,expectedActionHash:action.expectedActionHash,kind:action.kind,mask:action.mask};persist();syncRecord();}
    quotes.clear();quotes.set(q.id,clone(q));publish({quote:clone(q),status:'quoted'});return clone(q);
  }
  function validQuote(q,{requestId=null}={}) {
    const frozen=quotes.get(q?.id);if(!frozen)throw Error('Get a new gas quote before approving a task');
    // Use private quoted data, and reject edited objects instead of silently signing
    // a different intent than the one the visible review presented.
    for(const key of Object.keys(frozen))if(fingerprint(q[key])!==fingerprint(frozen[key]))throw Error('The gas quote was modified; get a fresh quote');
    if(frozen.expiresAt<=now())throw Error('Gas quote expired; refresh it before approval');
    if(!same(frozen.owner,state.address)||frozen.chainId!==S0UL_DEPLOYMENT.chainId||frozen.requestId!==requestId)throw Error('Quote belongs to another wallet, chain, or request');
    return frozen;
  }
  async function approveBudget(budgetWei,q,{newRequest=false,forceQuote=false}={}) {
    const budget=unsigned(budgetWei??record?.budgetWei??0,'Maximum total spend');
    if(!newRequest&&!forceQuote&&authorization&&budget<=authorization.budgetWei&&(!q||q.id===authorization.quoteId)){if(budget<state.spentWei)throw Error('Maximum total spend is below already spent gas');authorization.budgetWei=budget;record.budgetWei=budget;persist();syncRecord();publish({authorizationActive:true});return;}
    const frozen=validQuote(q,{requestId:newRequest?null:state.requestId});
    if(!newRequest&&!intentMatchesRequest(frozen,state.request))throw Error('Quote action differs from request commitment');
    const spent=newRequest?0n:state.spentWei;
    if(budget<spent+frozen.budgetFeeWei)throw Error('Maximum total spend must cover the quoted remaining budget plus gas already spent');
    const balance=BigInt(await provider.getBalance(state.address));if(balance<budget-spent)throw Error('Wallet balance is below the approved remaining maximum');
    authorization={budgetWei:budget,feeCeilingWeiPerGas:frozen.feeCeilingWeiPerGas,owner:state.address,requestId:newRequest?null:state.requestId,quoteId:frozen.id};
    record.budgetWei=budget;persist();syncRecord();publish({authorizationActive:true});
  }
  async function verifyRecordedReceipts() {
    let spent=0n;
    for(const saved of record.receipts??[]){
      const receipt=await provider.getTransactionReceipt(saved.hash);if(!receipt)throw Error('A previously recorded transaction receipt is no longer available');
      if(!same(receipt.blockHash,saved.blockHash))throw Error('A recorded transaction was reorganized. Refresh chain recovery before continuing.');
      const tx=await provider.getTransaction(saved.hash);if(!tx||!same(tx.from,state.address)||!same(tx.to,S0UL_DEPLOYMENT.controller)||Number(tx.chainId)!==S0UL_DEPLOYMENT.chainId)throw Error('Recorded receipt transaction identity mismatch');
      const price=BigInt(receipt.gasPrice??receipt.effectiveGasPrice??tx.gasPrice??0);if(price<=0n)throw Error('Actual receipt fee is unavailable');
      spent+=BigInt(receipt.gasUsed)*price;
    }
    record.spentWei=spent;syncRecord();
  }
  async function preflight(method,args) {
    await identity();noPending();await verifyDeployment();
    if(!authorization||!same(authorization.owner,state.address)||authorization.requestId!==(method==='beginConstrained'?null:state.requestId))throw Error('Approve a fresh quote and total spending cap first');
    if(method!=='beginConstrained'&&method!=='cancel'&&!intentMatchesRequest(record.intent,state.request))throw Error('Review the original request intent and approve a matching remaining-work quote');
    const live=await liveFees();if(live.gasPriceWei>authorization.feeCeilingWeiPerGas)throw Error('Live gas price exceeds your accepted fee ceiling. Refresh the quote before continuing.');
    const gasLimit=paddedGasLimit(await estimate(method,args),{cap:live.cap});
    const guard=checkSpendBudget({spentWei:state.spentWei,gasLimit,maxFeePerGas:authorization.feeCeilingWeiPerGas,budgetWei:authorization.budgetWei});
    if(!guard.allowed)throw Error('The next transaction exceeds your remaining spending cap. Get a fresh remaining-work quote.');
    if(live.balanceWei<guard.nextReserveWei)throw Error('Wallet balance cannot cover the next reserved transaction');
    return {live,gasLimit};
  }
  async function send(method,args,precomputed=null) {
    const {live,gasLimit}=precomputed??await preflight(method,args);
    const data=contracts.controller.interface.encodeFunctionData(method,args),nonce=await provider.getTransactionCount(state.address,'pending');
    // Account/network events may arrive while the wallet resolves its nonce.
    await identity();noPending();
    if(paused)throw Error('Run is paused before the next wallet request');
    const pending={method,args,owner:state.address,chainId:S0UL_DEPLOYMENT.chainId,to:S0UL_DEPLOYMENT.controller,data,dataHash:eth.keccak256(data),nonce:Number(nonce),gasLimit,gasPriceWei:live.gasPriceWei,feeCeilingWeiPerGas:authorization.feeCeilingWeiPerGas,hash:null,preparedAt:now(),requestId:state.requestId};
    record.pending=pending;record.ambiguous=false;
    try{persist();}catch(error){record.pending=null;syncRecord();throw error;}
    syncRecord();publish({status:'awaiting-wallet'});
    let hash;
    try {
      hash=await ethereum.request({method:'eth_sendTransaction',params:[{chainId:'0x1237',from:state.address,to:S0UL_DEPLOYMENT.controller,data,value:'0x0',nonce:eth.toQuantity(nonce),gas:eth.toQuantity(gasLimit),gasPrice:eth.toQuantity(live.gasPriceWei)}]});
      if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('Wallet returned no valid transaction hash');
      // Save the hash before any receipt polling or further asynchronous work.
      record.pending.hash=hash;persist();syncRecord();publish({status:'pending'});
    } catch(error) {
      if(Number(error?.code)===4001&&!hash){record.pending=null;record.ambiguous=false;persist();syncRecord();publish({status:'paused'});}else{record.ambiguous=true;recoveryRequired=true;try{persist();}catch{}syncRecord();publish({status:'ambiguous'});}
      throw error;
    }
    return settle(hash);
  }
  async function waitReceipt(hash) {
    if(dependencies.waitForReceipt)return dependencies.waitForReceipt(hash);
    const deadline=now()+(dependencies.receiptTimeoutMs??120000);
    for(;;){const receipt=await provider.getTransactionReceipt(hash);if(receipt)return receipt;if(now()>=deadline)throw Error('Transaction is still pending. Reconcile this exact hash; do not resubmit.');await new Promise(resolve=>setTimeout(resolve,1000));}
  }
  async function settle(hash) {
    const pending=record.pending;if(!pending)throw Error('No pending wallet operation to reconcile');
    if(pending.hash&&!same(pending.hash,hash))throw Error('Use the exact saved transaction hash');
    const receipt=await waitReceipt(hash),tx=await provider.getTransaction(hash);
    if(!tx||!same(tx.from,pending.owner)||!same(tx.to,pending.to)||Number(tx.nonce)!==pending.nonce||Number(tx.chainId)!==pending.chainId||BigInt(tx.value??0)!==0n||!same(eth.keccak256(tx.data??tx.input),pending.dataHash))throw Error('Transaction does not match the saved wallet intent and nonce');
    if(receipt.hash&&!same(receipt.hash,hash))throw Error('Receipt hash does not match pending transaction');
    const block=await provider.getBlock(receipt.blockNumber);if(!block||!same(block.hash,receipt.blockHash))throw Error('Receipt is not in the current canonical block');
    const price=BigInt(receipt.gasPrice??receipt.effectiveGasPrice??tx.gasPrice??0);if(price<=0n)throw Error('Actual transaction fee is unavailable');
    const spent=BigInt(receipt.gasUsed)*price;
    const changed=BigInt(tx.gasLimit??tx.gas??pending.gasLimit)>pending.gasLimit||price>pending.feeCeilingWeiPerGas;
    const entry={hash,method:pending.method,requestId:pending.requestId,nonce:pending.nonce,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,gasUsed:BigInt(receipt.gasUsed),gasPriceWei:price,spentWei:spent,status:Number(receipt.status),gasLimit:BigInt(tx.gasLimit??tx.gas??pending.gasLimit)};
    if(!record.receipts.some(r=>same(r.hash,hash))){record.receipts.push(entry);record.spentWei=BigInt(record.spentWei)+spent;}
    if(pending.method==='beginConstrained'&&Number(receipt.status)===1){
      const events=[];
      for(const log of receipt.logs??[]){if(!same(log.address,S0UL_DEPLOYMENT.controller))continue;try{const parsed=contracts.controller.interface.parseLog(log);if(parsed?.name==='Bound')events.push(parsed);}catch{}}
      const event=events.find(e=>same(e.args.owner??e.args[1],state.address)&&same(e.args.modelId??e.args[2],S0UL_DEPLOYMENT.modelId)
        && Number(e.args.allowedActions??e.args[3])===record.intent.mask
        && same(e.args.promptHash??e.args[4],record.intent.promptHash)
        && (e.args.adopted??e.args[5])===false);
      if(!event)throw Error('Successful begin receipt has no matching Bound event; reconcile request identity before continuing');
      record.requestId=String(event.args.requestId??event.args[0]);entry.requestId=record.requestId;
      const old=record.key;record.key='request:'+record.requestId;delete journal.records[old];
      if(authorization)authorization.requestId=record.requestId;
    }
    record.pending=null;record.ambiguous=false;recoveryRequired=false;persist();syncRecord();
    if(record.requestId)await refresh(record.requestId);
    publish({status:state.request?.outcome===2?'complete':state.request?.outcome===3?'rejected':state.request?.outcome===4?'cancelled':'paused'});
    if(Number(receipt.status)!==1){paused=true;throw Error('Transaction reverted. Its actual gas is included in spent gas; no automatic retry was sent.');}
    if(changed||state.spentWei>record.budgetWei){paused=true;authorization=null;publish({authorizationActive:false});throw Error('Wallet transaction parameters exceeded the accepted reserve. Review actual gas and get a fresh quote before continuing.');}
    return entry;
  }
  async function start(q,{budgetWei}={}) {
    await identity();getContracts();noPending();
    if(state.request?.outcome===1)throw Error('Finish or cancel the existing running request first');
    const frozen=validQuote(q);const action=parseExpectedAction(frozen.expectedAction,frozen.kind);
    record=makeRecord('draft:'+frozen.id,{prompt:frozen.prompt,maxNewTokens:frozen.maxNewTokens,promptHash:eth.keccak256(eth.AbiCoder.defaultAbiCoder().encode(['uint16[]'],[frozen.promptIds])),expectedAction:frozen.expectedAction,expectedActionHash:action.expectedActionHash,kind:action.kind,mask:action.mask},null);
    publish({requestId:null,request:null,progress:null,actualAction:null,result:null,outputIds:[]});syncRecord();persist();
    await approveBudget(budgetWei,q,{newRequest:true});paused=false;
    try{return await send('beginConstrained',[frozen.prompt,frozen.maxNewTokens,frozen.mask,frozen.expectedActionHash]);}finally{paused=true;}
  }
  async function recordDecision() {
    if(state.progress?.phase!==16)return;
    const p=state.progress,key=[p.generated,p.position,p.saturationCount].join(':');
    if(record.decisions.some(d=>d.key===key))return;
    const logits=Array.from(await contracts.engine.logits(state.requestId),Number);
    if(logits.length!==512||logits.some(n=>!Number.isInteger(n)))throw Error('Ready logits do not match the frozen vocabulary');
    record.decisions.push({key,position:p.position,generated:p.generated,saturationCount:p.saturationCount,logits,observedAt:now()});persist();syncRecord();
  }
  async function advance() {
    await identity();noPending();requireRunning();await refresh();
    if(state.progress.done)return snapshot();
    await recordDecision();
    let chosen=null,last;
    for(let steps=4;steps>=1;--steps){try{chosen={steps,preflight:await preflight('advanceBatch',[state.requestId,128,steps])};break;}catch(error){last=error;/* Smaller batches can reduce gas and the immediate reserve. */}}
    if(!chosen)throw last;
    return send('advanceBatch',[state.requestId,128,chosen.steps],chosen.preflight);
  }
  async function finalize() {
    await identity();noPending();requireRunning();await refresh();if(!state.progress.done&&!state.progress.cancelled)throw Error('Engine generation is not complete');
    return send('finalize',[state.requestId]);
  }
  async function run({budgetWei=record?.budgetWei,quote:q}={}) {
    await identity();noPending();requireRunning();await refresh();
    await approveBudget(budgetWei,q);paused=false;publish({status:'running'});
    try {
      while(!paused&&state.request?.outcome===1){
        await refresh();if(paused)break;
        if(state.progress.done){
          if(state.outputError||state.actualAction!==record.intent?.expectedAction){paused=true;publish({status:'paused',lastError:'Actual generated output differs from the approved action. Review the output; finalize records the controller outcome or cancel.'});break;}
          await finalize();break;
        }
        await advance();if(!paused&&state.request?.outcome===1)publish({status:'running'});
      }
    }finally{paused=true;if(state.request?.outcome===1&&!record.pending&&!record.ambiguous)publish({status:'paused'});}
    return snapshot();
  }
  async function approve(q,{budgetWei}={}){await identity();noPending();requireRunning();await refresh();await approveBudget(budgetWei,q,{forceQuote:true});return snapshot();}
  function pause(){paused=true;publish({status:record?.pending?'pending':record?.ambiguous?'ambiguous':state.request?.outcome===1?'paused':state.status});return snapshot();}
  async function cancel(){await identity();noPending();requireRunning();paused=false;try{return await send('cancel',[state.requestId]);}finally{paused=true;}}
  async function connect(){
    if(!ethereum?.request)throw Error('Install or open an Ethereum wallet to connect');publish({status:'connecting'});
    const accounts=await ethereum.request({method:'eth_requestAccounts'});if(!accounts?.length)throw Error('Wallet did not provide an account');
    let chain=Number(BigInt(await ethereum.request({method:'eth_chainId'})));
    if(chain!==S0UL_DEPLOYMENT.chainId){await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});chain=Number(BigInt(await ethereum.request({method:'eth_chainId'})));}
    if(chain!==S0UL_DEPLOYMENT.chainId)throw Error('Select Robinhood Chain mainnet (chain 4663) in your wallet');
    publish({connected:true,address:eth.getAddress(accounts[0]),chainId:chain,status:'ready',authorizationActive:false,requestId:null,request:null,progress:null,intent:null,quote:null,budgetWei:0n,spentWei:0n,pending:null,ambiguous:false,actualAction:null,outputIds:[],outputError:null,result:null,receipts:[],decisions:[]});getContracts();recoverJournal();await verifyDeployment();
    if(record?.requestId){await refresh(record.requestId);await verifyRecordedReceipts();}
    publish({status:record?.ambiguous?'ambiguous':record?.pending?'pending':state.request?.outcome===1?'paused':state.request?.outcome===2?'complete':state.request?.outcome===3?'rejected':state.request?.outcome===4?'cancelled':'ready'});return snapshot();
  }
  async function reconcile(hash=record?.pending?.hash) {
    await identity();if(!record?.pending)throw Error('No saved pending transaction to reconcile');if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('Supply the exact wallet transaction hash');
    if(record.pending.hash&&!same(hash,record.pending.hash))throw Error('Hash differs from the saved pending transaction');
    // Store a user-recovered hash first. settle verifies sender/nonce/calldata and
    // canonical receipt; an unrelated hash never clears the unresolved intent.
    if(!record.pending.hash){
      const tx=await provider.getTransaction(hash),pending=record.pending;
      if(!tx||!same(tx.from,pending.owner)||!same(tx.to,pending.to)||Number(tx.nonce)!==pending.nonce||Number(tx.chainId)!==pending.chainId||BigInt(tx.value??0)!==0n||!same(eth.keccak256(tx.data??tx.input),pending.dataHash))throw Error('Transaction does not match the saved wallet intent and nonce');
      record.pending.hash=hash;persist();syncRecord();
    }
    return settle(hash);
  }
  async function readMemory(key){await identity();getContracts();if(!['theme','language','mode'].includes(key))throw Error('Unknown memory key');return eth.toUtf8String(await contracts.controller.memoryOf(state.address,eth.encodeBytes32String(key)));}
  async function readTasks(){await identity();getContracts();return Array.from(await contracts.controller.tasksOf(state.address),(t,i)=>({id:i+1,title:eth.toUtf8String(t.title??t[0]),done:t.done??t[1]}));}
  const changed=()=>{paused=true;authorization=null;quotes.clear();publish({connected:false,authorizationActive:false,quote:null,status:record?.ambiguous?'ambiguous':record?.pending?'pending':'paused',lastError:'Wallet changed. Reconnect before continuing.'});};
  ethereum?.on?.('accountsChanged',changed);ethereum?.on?.('chainChanged',changed);
  return {get state(){return snapshot();},connect:busy(connect),quote:busy(quote),approve:busy(approve),start:busy(start),loadRequest:busy(load),run:busy(run),continue:busy(run),advance:busy(async()=>{paused=false;try{return await advance();}finally{paused=true;}}),pause,finalize:busy(async()=>{paused=false;try{return await finalize();}finally{paused=true;}}),cancel:busy(cancel),reconcile:busy(reconcile),invalidateQuote,readMemory:busy(readMemory),readTasks:busy(readTasks),destroy(){paused=true;ethereum?.removeListener?.('accountsChanged',changed);ethereum?.removeListener?.('chainChanged',changed);provider?.destroy?.();}};
}
