import * as Ethers from './mint/vendor/ethers.js';

// Addresses, model identities and service paths come only from the reviewed,
// same-origin deployment manifest. A user supplies a target address, never data.
export const ANALYSIS_GAS_CAP = 31_000_000n;
export const ANALYSIS_CONFIG = Object.freeze({ vocabSize:512, dim:128, layers:4, heads:4, hiddenDim:640, maxSeqLen:128 });
export const ANALYSIS_JOB_FIELDS = Object.freeze(['owner','target','requestId','state','failure','promptLength','maxNewTokens','deadline','capturedAt','evmBlockCounter','targetCodeHash','modelId','factsHash','promptHash','outputHash','feeCeilingWeiPerGas','maxRewardPerBatchWei','totalFunded','remaining','totalPaid']);
export const ANALYSIS_STATUS_FIELDS = Object.freeze(['owner','phase','position','layer','row','head','promptLength','maxNewTokens','generated','saturationCount','done','cancelled','logitsReady']);
const CONFIG_TUPLE = '(uint16 vocabSize,uint16 dim,uint16 layers,uint16 heads,uint16 hiddenDim,uint16 maxSeqLen,uint32 epsQ28,uint32 attentionScaleQ14)';
const STATUS_TUPLE = '(address owner,uint8 phase,uint16 position,uint16 layer,uint16 row,uint16 head,uint16 promptLength,uint16 maxNewTokens,uint16 generated,uint256 saturationCount,bool done,bool cancelled,bool logitsReady)';
const JOB_TUPLE = '(address owner,address target,uint256 requestId,uint8 state,uint8 failure,uint16 promptLength,uint16 maxNewTokens,uint64 deadline,uint64 capturedAt,uint64 evmBlockCounter,bytes32 targetCodeHash,bytes32 modelId,bytes32 factsHash,bytes32 promptHash,bytes32 outputHash,uint256 feeCeilingWeiPerGas,uint256 maxRewardPerBatchWei,uint256 totalFunded,uint256 remaining,uint256 totalPaid)';
export const ANALYSIS_ABIS = Object.freeze({
  executor: [
    'function open(address,uint16,uint256,uint256,uint64,bytes32) payable returns(uint256)',
    'function advance(uint256,uint256,uint256) returns(bool)', 'function finalize(uint256) returns(bool)',
    'function cancel(uint256)', 'function topUp(uint256) payable', 'function refundCompleted(uint256)', 'function withdraw()',
    `function getJob(uint256) view returns(${JOB_TUPLE})`, 'function factsOf(uint256) view returns(bytes)',
    'function reportOf(uint256) view returns(bytes)', 'function outputTokensOf(uint256) view returns(uint16[])',
    'function credits(address) view returns(uint256)', 'function engineRequestToJob(uint256) view returns(uint256)',
    'function chainId() view returns(uint256)', 'function configurationHash() view returns(bytes32)',
    ...['engine','model','adapter','codec'].map(k=>`function ${k}() view returns(address)`),
    ...['engineCodeHash','modelCodeHash','adapterCodeHash','codecCodeHash','modelId','domainSha256','schemaHash'].map(k=>`function ${k}() view returns(bytes32)`),
    'event JobOpened(uint256 indexed jobId,address indexed owner,address indexed target,uint256 requestId,bytes32 modelId,bytes32 targetCodeHash,bytes32 factsHash,bytes32 promptHash,uint16 promptLength,uint16 maxNewTokens,uint64 deadline,uint256 fundedWei,uint256 feeCeilingWeiPerGas,uint256 maxRewardPerBatchWei)',
    'event RewardCredited(uint256 indexed jobId,address indexed worker,uint256 amountWei,uint256 measuredGas,uint256 remainingWei)',
    'event ReportCompleted(uint256 indexed jobId,uint256 indexed requestId,bytes32 indexed modelId,bytes32 factsHash,bytes32 promptHash,bytes32 outputHash,bytes report)',
  ],
  engine: ['function model() view returns(address)','function tokenizer() view returns(address)','function modelId() view returns(bytes32)',`function configuration() view returns(${CONFIG_TUPLE})`,`function status(uint256) view returns(${STATUS_TUPLE})`,'function outputTokens(uint256) view returns(uint16[])','function tokens(uint256) view returns(uint16[])'],
  model: ['function modelId() view returns(bytes32)','function sourceCheckpoint() view returns(bytes32)'],
  adapter: ['function schemaHash() view returns(bytes32)','function chainId() view returns(uint256)','function reader() view returns(address)','function readerCodeHash() view returns(bytes32)','function capture(address) view returns(bytes facts,uint16[] prompt)'],
  codec: ['function domainSha256() pure returns(bytes32)','function schemaSha256() pure returns(bytes32)','function decode(uint16[],bool) pure returns(bytes)'],
  reader: [],
});
const HASH=/^0x[0-9a-fA-F]{64}$/;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const uint=(v,name='Integer')=>{if(typeof v==='number'&&!Number.isSafeInteger(v)||!['bigint','number','string'].includes(typeof v)||typeof v==='string'&&!/^\d+$/.test(v))throw Error(name+' must be an exact unsigned integer');const n=BigInt(v);if(n<0n)throw Error(name+' must be nonnegative');return n;};
const count=(v,name,max)=>{const n=uint(v,name);if(n>BigInt(max))throw Error(name+' exceeds its bound');return Number(n);};
const ceil=(a,b)=>(a+b-1n)/b;
const margin=(n,bps)=>ceil(n*BigInt(bps),10_000n);
const encode=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?{$s0ulAnalysisInteger:v.toString()}:v);
const decode=value=>JSON.parse(value,(_,v)=>v&&typeof v==='object'&&Object.keys(v).length===1&&'$s0ulAnalysisInteger'in v?BigInt(v.$s0ulAnalysisInteger):v);
const clone=value=>value===undefined?undefined:decode(encode(value));
const textError=e=>String(e?.shortMessage??e?.reason??e?.message??e).slice(0,700);
const objectTuple=(value,fields)=>Object.fromEntries(fields.map((k,i)=>[k,value[k]??value[i]]));
const normalizeJob=value=>{const j=objectTuple(value,ANALYSIS_JOB_FIELDS);for(const k of ['state','failure','promptLength','maxNewTokens'])j[k]=Number(j[k]);for(const k of ['requestId','deadline','capturedAt','evmBlockCounter','feeCeilingWeiPerGas','maxRewardPerBatchWei','totalFunded','remaining','totalPaid'])j[k]=BigInt(j[k]);return j;};
const normalizeStatus=value=>{const s=objectTuple(value,ANALYSIS_STATUS_FIELDS);for(const k of ['phase','position','layer','row','head','promptLength','maxNewTokens','generated'])s[k]=Number(s[k]);s.saturationCount=BigInt(s.saturationCount);return s;};

export function normalizeAnalysisDeployment(input,eth=Ethers) {
  if(!input||typeof input!=='object')throw Error('The analysis deployment is unavailable');
  const d={...input,chainId:count(input.chainId,'Deployment chain',Number.MAX_SAFE_INTEGER),contracts:{}};
  if(d.chainId!==4663)throw Error('S0UL analysis supports Robinhood Chain4663 only');
  for(const key of ['executor','engine','model','adapter','codec','reader']) {
    const item=input.contracts?.[key]??input[key];
    const address=typeof item==='string'?item:item?.address;
    const codeHash=typeof item==='string'?input[key+'CodeHash']:item?.codeHash??item?.runtimeCodeHash;
    if(!address||!HASH.test(codeHash??''))throw Error('Missing reviewed '+key+' deployment identity');
    d.contracts[key]={address:eth.getAddress(address),codeHash};
  }
  for(const key of ['modelId','domainSha256','schemaHash','configurationHash'])if(!HASH.test(d[key]??''))throw Error('Missing reviewed '+key);
  d.publicRpc=input.publicRpc??input.rpcUrl??input.rpc?.primary;
  if(typeof d.publicRpc!=='string'||!/^https?:\/\//.test(d.publicRpc))throw Error('Missing analysis RPC');
  d.worker=input.worker??{};
  return d;
}
export function analysisContracts(provider,deployment,eth=Ethers) {
  return Object.fromEntries(Object.entries(ANALYSIS_ABIS).filter(([,abi])=>abi.length).map(([key,abi])=>[key,new eth.Contract(deployment.contracts[key].address,abi,provider)]));
}
export async function verifyAnalysisDeployment({provider,deployment,contracts,eth=Ethers}) {
  const d=normalizeAnalysisDeployment(deployment,eth), c=contracts??analysisContracts(provider,d,eth);
  const network=BigInt(await provider.send('eth_chainId',[]));
  if(network!==BigInt(d.chainId))throw Error('The analysis RPC is on a different chain');
  // Sequential reads avoid large request bursts against the public RPC.
  for(const key of ['executor','engine','model','adapter','codec','reader']) {
    const code=await provider.getCode(d.contracts[key].address);
    if(code==='0x'||!same(eth.keccak256(code),d.contracts[key].codeHash))throw Error('The '+key+' runtime no longer matches the reviewed deployment');
  }
  for(const key of ['engine','model','adapter','codec']) {
    if(!same(await c.executor[key](),d.contracts[key].address)||!same(await c.executor[key+'CodeHash'](),d.contracts[key].codeHash))throw Error('Executor dependency mismatch: '+key);
  }
  for(const key of ['modelId','domainSha256','schemaHash','configurationHash'])if(!same(await c.executor[key](),d[key]))throw Error('Executor identity mismatch: '+key);
  if(BigInt(await c.executor.chainId())!==BigInt(d.chainId)||BigInt(await c.adapter.chainId())!==BigInt(d.chainId))throw Error('Pinned analysis chain mismatch');
  if(!same(await c.engine.model(),d.contracts.model.address)||!same(await c.engine.tokenizer(),eth.ZeroAddress)||!same(await c.engine.modelId(),d.modelId)||!same(await c.model.modelId(),d.modelId))throw Error('Analysis model mismatch');
  if(!same(await c.adapter.reader(),d.contracts.reader.address)||!same(await c.adapter.readerCodeHash(),d.contracts.reader.codeHash)||!same(await c.adapter.schemaHash(),d.schemaHash)||!same(await c.codec.domainSha256(),d.domainSha256))throw Error('Facts or codec identity mismatch');
  const cfg=await c.engine.configuration();
  for(const [key,expected]of Object.entries(ANALYSIS_CONFIG))if(Number(cfg[key])!==expected)throw Error('Unsupported analysis model configuration');
  if(!same(eth.keccak256(eth.AbiCoder.defaultAbiCoder().encode([CONFIG_TUPLE],[cfg.toArray?.()??Array.from(cfg)])),d.configurationHash))throw Error('Engine configuration hash mismatch');
  return {deployment:d,contracts:c,configuration:objectTuple(cfg,[...Object.keys(ANALYSIS_CONFIG),'epsQ28','attentionScaleQ14'])};
}
export async function verifyAnalysisRecovery({provider,deployment,contracts,eth=Ethers}) {
  const d=normalizeAnalysisDeployment(deployment,eth),c=contracts??analysisContracts(provider,d,eth);
  if(BigInt(await provider.send('eth_chainId',[]))!==BigInt(d.chainId)||BigInt(await c.executor.chainId())!==BigInt(d.chainId))throw Error('Analysis recovery chain mismatch');
  const code=await provider.getCode(d.contracts.executor.address);
  if(code==='0x'||!same(eth.keccak256(code),d.contracts.executor.codeHash))throw Error('The recovery executor does not match the reviewed runtime');
  return true;
}

/** Exact upper work count for the pinned 4-layer transformer, rows fixed128. */
export function analysisLogicalSteps(promptTokens,maxNewTokens) {
  const p=count(promptTokens,'Prompt tokens',96), n=count(maxNewTokens,'Output tokens',32);
  if(p<3||n<2||p+n>128)throw Error('Analysis context is out of range');
  return 77*(p+n-1)+6*n;
}
export function analysisWorkSchedule(promptTokens,maxNewTokens) {
  const p=count(promptTokens,'Prompt tokens',96), n=count(maxNewTokens,'Output tokens',32);
  analysisLogicalSteps(p,n);const work=[];
  for(let pos=0;pos<p+n-1;pos++) {
    work.push({phase:1,position:pos});
    for(let layer=0;layer<4;layer++) {
      for(const phase of [2,3,4,5,6,7])work.push({phase,position:pos,layer});
      for(let head=0;head<4;head++)work.push({phase:8,position:pos,layer,head});
      for(const phase of [9,10])work.push({phase,position:pos,layer});
      for(let row=0;row<640;row+=128)work.push({phase:11,position:pos,layer,row});
      for(const phase of [12,13])work.push({phase,position:pos,layer});
    }
    if(pos>=p-1)for(const phase of [14,15,15,15,15,16])work.push({phase,position:pos});
  }
  return work;
}
/** A calibrated operational estimate; hard reimbursement ceiling is separate. */
export function computeAnalysisFunding({promptTokens=16,maxNewTokens=32,feeCeilingWeiPerGas,maxRewardPerBatchWei,calibration,gasMarginBps=12_000,finalizeRewardGas=750_000n}) {
  const work=analysisWorkSchedule(promptTokens,maxNewTokens), logicalCalls=work.length;
  const price=uint(feeCeilingWeiPerGas,'Approved gas price ceiling');
  const maxReward=uint(maxRewardPerBatchWei,'Maximum batch reward');
  const padding=count(gasMarginBps,'Gas reserve multiplier',50_000);
  if(price===0n||maxReward===0n||padding<10_000)throw Error('Invalid analysis funding policy');
  if(!calibration||typeof calibration!=='object'||(calibration.includesRewardOverhead??calibration.rewardPolicy?.includesRewardOverhead)!==true)throw Error('A reviewed per-logical-step reimbursement calibration is required');
  const table=calibration.maxMeasuredGasByPhase??calibration.maxRewardMeasuredGasByPhase??calibration.rawMaxMeasuredGasByPhase;
  if(!table)throw Error('The analysis phase calibration is incomplete');
  const observed=count(calibration.maxPosition??calibration.observed?.maxProcessedPosition,'Calibrated context position',127);
  const attentionSlope=uint(calibration.attentionGasPerExtraPosition??calibration.attentionOperationalEnvelope?.gasPerPosition??0,'Attention extrapolation slope');
  const intercept=calibration.attentionBaseMeasuredGas??calibration.attentionOperationalEnvelope?.interceptIncludingRewardOverhead;
  const attentionBase=intercept===undefined?null:uint(intercept,'Attention reserve intercept');
  let measuredGas=0n,unmeasuredContext=false;
  for(const item of work) {
    let cost=uint(table[item.phase]??table[String(item.phase)],'Calibrated phase '+item.phase);
    if(cost===0n)throw Error('Zero analysis phase calibration');
    if(item.phase===8&&attentionBase!==null)cost=attentionBase+BigInt(item.position)*attentionSlope;
    if(item.phase===8&&item.position>observed) {
      if(attentionSlope===0n)throw Error('Longer attention contexts have no reviewed reserve policy');
      if(attentionBase===null)cost+=BigInt(item.position-observed)*attentionSlope;
      unmeasuredContext=true;
    }
    measuredGas+=cost;
  }
  const continuationGasReserve=margin(measuredGas,padding);
  const finalizeGasReserve=uint(finalizeRewardGas,'Finalization reserve');
  const estimatedEscrowWei=(continuationGasReserve+finalizeGasReserve)*price;
  const escrowWei=estimatedEscrowWei<maxReward?maxReward:estimatedEscrowWei;
  const hardEscrowCeilingWei=BigInt(logicalCalls+1)*maxReward;
  return {promptTokens:Number(promptTokens),maxNewTokens:Number(maxNewTokens),logicalCalls,totalLogicalCalls:logicalCalls,
    estimatedBatchTransactions:Math.ceil(logicalCalls/4)+Number(maxNewTokens),maxPaidAdvanceTransactions:logicalCalls,
    measuredGas,gasMarginBps:padding,continuationGasReserve,finalizeGasReserve,escrowWei,budgetWei:escrowWei,
    maxRewardPerBatchWei:maxReward,feeCeilingWeiPerGas:price,hardEscrowCeilingWei,
    completionGuaranteed:false,unmeasuredContext,calibrationSource:calibration.source??calibration.report??null,
    fundingPolicy:'Per-phase measured reimbursement maxima, charged as one paid transaction per logical step, plus explicit reserve. The job pauses at its approved balance; it never spends more automatically.'};
}

export async function planAnalysisAdvance({provider,executorAddress,executorInterface,from,jobId,gasPriceWei,maxGas=ANALYSIS_GAS_CAP}) {
  let last;
  for(const steps of [4,3,2,1]) {
    const data=executorInterface.encodeFunctionData('advance',[jobId,128,steps]);
    try {const estimated=BigInt(await provider.estimateGas({from,to:executorAddress,data,value:0n,gasPrice:gasPriceWei}));const gasLimit=margin(estimated,12_000);if(gasLimit<=maxGas)return {steps,rows:128,data,gasEstimate:estimated,gasLimit};}
    catch(error) {last=error;if(error?.code==='TIMEOUT'||/rate limit|too many requests|network|failed to fetch|429/i.test(textError(error)))throw error;}
  }
  throw Error('No supported inference batch currently fits the transaction cap. '+(last?textError(last):''));
}

export function createS0ULAnalysisClient({deployment,ethereum=globalThis.ethereum,onUpdate=()=>{},storage=globalThis.localStorage,eth=Ethers,provider:injectedProvider,dependencies={}}={}) {
  const d=normalizeAnalysisDeployment(deployment,eth), now=dependencies.now??Date.now;
  const provider=injectedProvider??new eth.JsonRpcProvider(d.publicRpc,d.chainId,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
  const contracts=dependencies.contracts??analysisContracts(provider,d,eth), quotes=new Map();
  let walletProvider=null,journal=null,journalKey=null,destroyed=false,lock=false,sequence=0;
  const state={verified:false,connected:false,address:null,chainId:null,busy:false,quote:null,jobId:null,job:null,engineStatus:null,report:null,outputTokens:[],creditsWei:0n,pending:null,lastError:null,workerStatus:{available:false,status:'unconfirmed',message:'Executor service availability has not been checked.'},receipts:[]};
  const recoveryAction=action=>['cancel','refundCompleted','withdraw'].includes(action);
  const actionContext=(action,j,s)=>recoveryAction(action)||action==='topUp'?{owner:j.owner,target:j.target,requestId:j.requestId,modelId:j.modelId,state:j.state,deadline:j.deadline,feeCeilingWeiPerGas:j.feeCeilingWeiPerGas,maxRewardPerBatchWei:j.maxRewardPerBatchWei}:{job:j,status:s};
  const publish=(patch={})=>{Object.assign(state,patch);if(!destroyed)try{onUpdate(clone(state));}catch{}return clone(state);};
  const invalidate=()=>{sequence++;quotes.clear();publish({quote:null});};
  const storageWrite=()=>{if(!journal||!journalKey)throw Error('Wallet recovery storage is unavailable');const value=encode(journal);try{storage.setItem(journalKey,value);if(storage.getItem(journalKey)!==value)throw Error('not retained');}catch{throw Error('Wallet recovery data cannot be saved. Check the pending transaction and your wallet before trying another transaction.');}};
  const syncJournal=()=>publish({pending:journal?.pending??null,jobId:journal?.jobId??state.jobId,receipts:journal?.receipts??[]});
  function restoreJournal() {
    journalKey=`gh0st:s0ul:analysis:v1:${d.chainId}:${d.contracts.executor.address.toLowerCase()}:${state.address.toLowerCase()}`;
    let raw;try{raw=storage?.getItem(journalKey);journal=raw?decode(raw):{version:1,owner:state.address,chainId:d.chainId,executor:d.contracts.executor.address,jobId:null,pending:null,receipts:[]};}catch{throw Error('Saved wallet recovery data cannot be read');}
    if(journal.version!==1||!same(journal.owner,state.address)||journal.chainId!==d.chainId||!same(journal.executor,d.contracts.executor.address)||!Array.isArray(journal.receipts))throw Error('Saved wallet recovery identity mismatch');
    if(journal.pending){const p=journal.pending;if(!same(p.owner,journal.owner)||!same(p.to,d.contracts.executor.address)||p.chainId!==d.chainId||!['open','advance','finalize','cancel','refundCompleted','withdraw','topUp'].includes(p.action)||!/^0x[0-9a-fA-F]+$/.test(p.data??'')||uint(p.gasLimit)<21_000n||uint(p.gasLimit)>ANALYSIS_GAS_CAP||uint(p.feeCeilingWeiPerGas)===0n)throw Error('Saved wallet request identity is invalid');}
    syncJournal();
  }
  let verification=null;
  async function verify() {
    if(verification)return verification;
    verification=(async()=>{try{await (dependencies.verifyDeployment?dependencies.verifyDeployment({provider,contracts,deployment:d}):verifyAnalysisDeployment({provider,contracts,deployment:d,eth}));publish({verified:true});}catch(error){publish({verified:false});throw error;}finally{verification=null;}})();
    return verification;
  }
  async function identity() {
    if(!state.connected||!ethereum?.request)throw Error('Connect your wallet first');
    const accounts=await ethereum.request({method:'eth_accounts'}),chain=BigInt(await ethereum.request({method:'eth_chainId'}));
    if(chain!==BigInt(d.chainId)||!same(accounts?.[0],state.address)){invalidate();publish({connected:false});throw Error('Wallet account or chain changed. Reconnect and calculate again.');}
    return state.address;
  }
  async function verifyRecovery() {return dependencies.verifyRecovery?dependencies.verifyRecovery({provider,contracts,deployment:d}):verifyAnalysisRecovery({provider,contracts,deployment:d,eth});}
  async function operation(fn) {
    if(destroyed)throw Error('Analysis client is closed');if(lock)throw Error('An analysis operation is already running');
    lock=true;publish({busy:true,lastError:null});try{return await fn();}catch(error){publish({lastError:textError(error)});throw error;}finally{lock=false;publish({busy:false});}
  }
  async function fees() {
    const [block,price]=await Promise.all([provider.getBlock('latest'),provider.send('eth_gasPrice',[])]);
    if(!block)throw Error('The current chain block is unavailable');
    const gasPriceWei=BigInt(price);if(gasPriceWei<=0n)throw Error('The chain returned an invalid gas price');
    let maxTx,maxBlock;
    if(dependencies.gasLimits){const limits=await dependencies.gasLimits();maxTx=BigInt(limits.maxTxGasLimit);maxBlock=BigInt(limits.maxBlockGasLimit);}
    else if(injectedProvider&&d.localOnly){maxTx=ANALYSIS_GAS_CAP;maxBlock=BigInt(block.gasLimit);}
    else {const info=new eth.Contract('0x000000000000000000000000000000000000006C',['function getMaxTxGasLimit() view returns(uint256)','function getMaxBlockGasLimit() view returns(uint256)'],provider);maxTx=BigInt(await info.getMaxTxGasLimit());maxBlock=BigInt(await info.getMaxBlockGasLimit());}
    if(maxTx<=0n||maxBlock<=0n)throw Error('The current Nitro transaction limits are unavailable');
    return {block,gasPriceWei,cap:[ANALYSIS_GAS_CAP,maxTx,maxBlock].reduce((a,b)=>a<b?a:b)};
  }
  const servicePath=(name)=>{const path=d.worker[name]??d.worker[name.replace('Url','Path')];return typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//')?path:null;};
  async function checkWorker() {
    if(dependencies.worker?.status){const result=await dependencies.worker.status();const available=result.available===true||result.ready===true;publish({workerStatus:{...result,available,ready:available,status:result.status??(available?'ready':'unavailable'),checkedAt:now()}});return state.workerStatus;}
    const path=servicePath('statusUrl');if(!path)return publish({workerStatus:{available:false,status:'unconfigured',message:'The continuation service is not configured.'}}).workerStatus;
    try{const response=await (dependencies.fetch??fetch)(path,{cache:'no-store',credentials:'same-origin'});const value=await response.json();const available=response.ok&&(value.available===true||value.ready===true)&&Number(value.chainId)===d.chainId&&same(value.executor,d.contracts.executor.address)&&same(value.modelId,d.modelId);publish({workerStatus:{available,ready:available,status:available?'ready':'unavailable',message:String(value.message??(available?'Continuation service available.':'Continuation service unavailable.')).slice(0,200),checkedAt:now()}});}catch{publish({workerStatus:{available:false,status:'unavailable',message:'The continuation service could not be reached.',checkedAt:now()}});}
    return clone(state.workerStatus);
  }
  async function triggerWorker(id) {
    if(dependencies.worker?.trigger){const value=await dependencies.worker.trigger(id);publish({workerStatus:{...state.workerStatus,status:'submitted',jobId:id,trigger:value}});return value;}
    const path=servicePath('triggerUrl');if(!path)throw Error('Continuation service is unavailable');
    const response=await (dependencies.fetch??fetch)(path,{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({jobId:String(id)})});
    if(!response.ok)throw Error('The continuation service did not accept this job');
    publish({workerStatus:{...state.workerStatus,status:'submitted',jobId:id,message:'The continuation request was accepted. On-chain progress is checked separately.'}});return {accepted:true};
  }
  async function connect() {
    invalidate();if(!ethereum?.request)throw Error('Open this page in an Ethereum wallet or connect a browser wallet');
    const accounts=await ethereum.request({method:'eth_requestAccounts'});
    let chain=BigInt(await ethereum.request({method:'eth_chainId'}));
    if(chain!==BigInt(d.chainId)){await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:eth.toBeHex(d.chainId)}]});chain=BigInt(await ethereum.request({method:'eth_chainId'}));}
    if(chain!==BigInt(d.chainId)||!accounts?.[0])throw Error('Select Robinhood Chain and a wallet account');
    walletProvider=new eth.BrowserProvider(ethereum,'any',{cacheTimeout:-1});
    publish({connected:true,address:eth.getAddress(accounts[0]),chainId:d.chainId});restoreJournal();
    try{await verify();}catch(error){await verifyRecovery();publish({verified:false,lastError:textError(error)});}
    await checkWorker();
    if(state.jobId)await refresh();else publish({creditsWei:BigInt(await contracts.executor.credits(state.address))});return clone(state);
  }
  function retain(value) {const q={...value,id:eth.hexlify(eth.randomBytes(16)),expiresAt:now()+45_000,owner:state.address,chainId:d.chainId,to:d.contracts.executor.address};quotes.set(q.id,encode(q));publish({quote:clone(q)});return clone(q);}
  function accepted(value) {
    const id=value?.id,expected=quotes.get(id);
    if(!expected||expected!==encode(value))throw Error('This quote is stale or changed. Calculate it again.');
    const retained=decode(expected);
    if(retained.id!==id||retained.expiresAt<=now()||!same(retained.owner,state.address)||retained.chainId!==d.chainId)throw Error('This quote is stale or changed. Calculate it again.');
    return retained;
  }
  async function quote({target,maxNewTokens=32}={}) {
    await identity();if(state.pending)throw Error('Resolve the pending wallet transaction first');invalidate();const generation=sequence;
    await verify();const address=eth.getAddress(target),n=count(maxNewTokens,'Output tokens',32);if(n<2)throw Error('At least two output tokens are required');
    const capture=await contracts.adapter.capture(address,{gasLimit:ANALYSIS_GAS_CAP});
    const facts=capture.facts??capture[0],prompt=Array.from(capture.prompt??capture[1],Number);
    if(eth.getBytes(facts).length<96||eth.getBytes(facts).length>8192||prompt.length!==16||prompt[0]!==1||prompt.at(-1)!==3)throw Error('The facts adapter returned an unsupported prompt');
    const [observedTarget,,targetCodeHash]=eth.AbiCoder.defaultAbiCoder().decode(['address','uint256','bytes32'],facts);
    if(!same(observedTarget,address))throw Error('The facts adapter returned another target');
    const f=await fees(),feeCeilingWeiPerGas=margin(f.gasPriceWei,d.quotePolicy?.feeCeilingBps??12_500);
    const maxRewardPerBatchWei=ANALYSIS_GAS_CAP*feeCeilingWeiPerGas;
    const calibration=d.calibration??d.quoteCalibration;
    const calibrationModelId=calibration?.modelId??calibration?.sourceProof?.modelId;
    if(calibrationModelId&&!same(calibrationModelId,d.modelId))throw Error('The gas calibration belongs to another model');
    const funding=computeAnalysisFunding({promptTokens:prompt.length,maxNewTokens:n,feeCeilingWeiPerGas,maxRewardPerBatchWei,calibration,gasMarginBps:d.quotePolicy?.gasReserveBps??12_000});
    const deadline=BigInt(f.block.timestamp)+86_400n;
    const args=[address,n,feeCeilingWeiPerGas,maxRewardPerBatchWei,deadline,targetCodeHash];
    const data=contracts.executor.interface.encodeFunctionData('open',args),valueWei=funding.escrowWei;
    const gasEstimate=BigInt(await provider.estimateGas({from:state.address,to:d.contracts.executor.address,data,value:valueWei,gasPrice:f.gasPriceWei}));
    const gasLimit=margin(gasEstimate,12_000);if(gasLimit>f.cap)throw Error('Opening this address-analysis job exceeds the transaction gas cap');
    const openFeeReserveWei=gasLimit*feeCeilingWeiPerGas;
    const recoveryFeeReserveWei=500_000n*feeCeilingWeiPerGas,totalRequiredWei=valueWei+openFeeReserveWei+recoveryFeeReserveWei;
    const balanceWei=BigInt(await provider.getBalance(state.address));
    await identity();if(generation!==sequence)throw Error('The wallet or target changed. Calculate again.');await checkWorker();
    return retain({...funding,action:'open',target:address,targetCodeHash,maxNewTokens:n,deadline,args,data,valueWei,gasEstimate,gasLimit,gasPriceWei:f.gasPriceWei,feeCeilingWeiPerGas,openFeeReserveWei,feeReserveWei:openFeeReserveWei,recoveryFeeReserveWei,totalRequiredWei,totalReserveWei:totalRequiredWei,balanceWei,affordable:balanceWei>=totalRequiredWei,canAfford:balanceWei>=totalRequiredWei,workerAvailable:state.workerStatus.available===true,blockNumber:f.block.number});
  }
  async function readJob(id,recoveryOnly=false) {
    const jobId=uint(id,'Job ID');if(jobId===0n)throw Error('Choose a positive job ID');
    const j=normalizeJob(await contracts.executor.getJob(jobId));
    if(!same(j.modelId,d.modelId))throw Error('The job belongs to another analysis model');
    if(recoveryOnly)return {jobId,job:j,engineStatus:null,report:null,outputTokens:[],creditsWei:state.address?BigInt(await contracts.executor.credits(state.address)):0n};
    const engineStatus=normalizeStatus(await contracts.engine.status(j.requestId));
    if(!same(engineStatus.owner,d.contracts.executor.address)||engineStatus.promptLength!==j.promptLength||engineStatus.maxNewTokens!==j.maxNewTokens)throw Error('The job engine binding changed');
    let report=null,outputTokens=[];
    if(j.state===2){const bytes=await contracts.executor.reportOf(jobId);outputTokens=Array.from(await contracts.executor.outputTokensOf(jobId),Number);if(outputTokens.length<2||outputTokens.length>32||outputTokens.at(-1)!==2||outputTokens.slice(0,-1).some(x=>x<64||x>150))throw Error('The stored report has invalid model tokens');if(!same(eth.keccak256(eth.AbiCoder.defaultAbiCoder().encode(['uint16[]'],[outputTokens])),j.outputHash))throw Error('The stored output token hash does not match the job');const decoded=await contracts.codec.decode(outputTokens,false);if(!same(decoded,bytes))throw Error('The stored report differs from the model output');report=eth.toUtf8String(bytes);}
    const creditsWei=state.address?BigInt(await contracts.executor.credits(state.address)):0n;
    return {jobId,job:j,engineStatus,report,outputTokens,creditsWei};
  }
  async function refresh() {let recoveryOnly=false;try{await verify();}catch(error){await verifyRecovery();recoveryOnly=true;publish({verified:false,lastError:textError(error)});}if(state.jobId)publish(await readJob(state.jobId,recoveryOnly));else if(state.address)publish({creditsWei:BigInt(await contracts.executor.credits(state.address))});return clone(state);}
  async function loadJob(id) {invalidate();let recoveryOnly=false;try{await verify();}catch(error){await verifyRecovery();recoveryOnly=true;publish({verified:false,lastError:textError(error)});}const result=await readJob(id,recoveryOnly);publish(result);if(journal){journal.jobId=result.jobId;storageWrite();}return clone(state);}
  async function quoteAction({action,jobId=state.jobId,valueWei=0n}={}) {
    await identity();if(state.pending)throw Error('Resolve the pending wallet transaction first');invalidate();const generation=sequence;
    if(!['advance','finalize','cancel','refundCompleted','withdraw','topUp'].includes(action))throw Error('Unsupported analysis action');
    if(recoveryAction(action))await verifyRecovery();else await verify();const f=await fees();
    let j=null,s=null,id=null,args=[],value=uint(valueWei,'Top-up amount'),data,gasEstimate,gasLimit,contextHash=null;
    if(action!=='withdraw'){id=uint(jobId,'Job ID');const current=await readJob(id,recoveryAction(action));j=current.job;s=current.engineStatus;publish(current);if(['cancel','refundCompleted','topUp'].includes(action)&&!same(j.owner,state.address))throw Error('Only this job’s owner may perform that action');contextHash=eth.keccak256(eth.toUtf8Bytes(encode(actionContext(action,j,s))));args=[id];}
    if(action!=='topUp'&&value!==0n)throw Error('This action does not accept a deposit');
    if(action==='topUp'&&value===0n)throw Error('Choose a positive top-up amount');
    if(action==='topUp'&&BigInt(f.block.timestamp)>j.deadline)throw Error('This job expired. Cancel and refund it instead of adding funds.');
    if(action==='advance') {
      if(j.state!==1||s.done||s.cancelled)throw Error('This job has no pending inference work');
      if(BigInt(f.block.timestamp)>j.deadline||f.gasPriceWei>j.feeCeilingWeiPerGas||j.remaining<j.maxRewardPerBatchWei)throw Error('This job is paused by its deadline, fee ceiling or remaining budget');
      const plan=await planAnalysisAdvance({provider,executorAddress:d.contracts.executor.address,executorInterface:contracts.executor.interface,from:state.address,jobId:id,gasPriceWei:f.gasPriceWei,maxGas:f.cap});args=[id,128,plan.steps];data=plan.data;gasEstimate=plan.gasEstimate;gasLimit=plan.gasLimit;
    } else {data=contracts.executor.interface.encodeFunctionData(action,args);gasEstimate=BigInt(await provider.estimateGas({from:state.address,to:d.contracts.executor.address,data,value,gasPrice:f.gasPriceWei}));gasLimit=margin(gasEstimate,12_000);}
    if(gasLimit>f.cap)throw Error('This action exceeds the supported transaction cap');
    const ceiling=margin(f.gasPriceWei,12_500),feeReserveWei=gasLimit*ceiling;
    await identity();if(generation!==sequence)throw Error('The selected wallet or job changed. Calculate again.');
    const balanceWei=BigInt(await provider.getBalance(state.address));
    return retain({action,jobId:id,args,data,valueWei:value,gasEstimate,gasLimit,gasPriceWei:f.gasPriceWei,feeCeilingWeiPerGas:ceiling,feeReserveWei,totalRequiredWei:value+feeReserveWei,canAfford:balanceWei>=value+feeReserveWei,contextHash});
  }
  async function reconcile(hash=state.pending?.hash) {
    if(!journal?.pending)throw Error('There is no saved transaction to reconcile');
    const pending=journal.pending,originalJournal=clone(journal);if(!HASH.test(hash??''))throw Error('Supply the exact transaction hash from your wallet');
    if(pending.hash&&!same(pending.hash,hash))throw Error('The supplied hash differs from the saved transaction');
    const tx=await provider.getTransaction(hash);if(!tx)throw Error('This transaction is not available yet. Keep its saved record.');
    if(!same(pending.to,d.contracts.executor.address)||!same(tx.from,pending.owner)||!same(tx.to,pending.to)||tx.data.toLowerCase()!==pending.data.toLowerCase()||BigInt(tx.value)!==pending.valueWei||Number(tx.nonce)!==pending.nonce||BigInt(tx.chainId)!==BigInt(d.chainId)||BigInt(tx.gasLimit)!==pending.gasLimit||BigInt(tx.gasPrice??tx.maxFeePerGas??0)>pending.feeCeilingWeiPerGas)throw Error('The transaction does not match the saved wallet request');
    const receipt=await provider.getTransactionReceipt(hash);if(!receipt){pending.hash=hash;syncJournal();storageWrite();return {pending:true,hash};}
    const canonical=await provider.getBlock(receipt.blockNumber);if(!canonical||!same(canonical.hash,receipt.blockHash))throw Error('This receipt is not on the current canonical chain');
    if(Number(receipt.status)===1&&pending.action==='open') {
      const opened=receipt.logs.filter(log=>same(log.address,d.contracts.executor.address)).map(log=>{try{return contracts.executor.interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==='JobOpened'&&same(log.args.owner,pending.owner)&&same(log.args.target,pending.target)&&same(log.args.modelId,d.modelId)&&BigInt(log.args.fundedWei)===pending.valueWei);
      if(!opened)throw Error('The confirmed transaction has no matching analysis job');journal.jobId=BigInt(opened.args.jobId);
    }
    journal.receipts.push({hash,action:pending.action,jobId:journal.jobId,status:Number(receipt.status),gasUsed:BigInt(receipt.gasUsed),gasPrice:BigInt(receipt.gasPrice??tx.gasPrice??0),blockNumber:receipt.blockNumber,blockHash:receipt.blockHash});
    journal.pending=null;try{storageWrite();}catch(error){journal=originalJournal;journal.pending.hash=hash;syncJournal();throw Error('Transaction '+hash+' is confirmed, but its recovery record could not be updated. Reconcile this same hash again; do not submit another transaction.');}invalidate();syncJournal();await refresh();
    if(Number(receipt.status)!==1)throw Error('The transaction reverted. Its actual network fee remains charged.');
    if(pending.action==='open'||pending.action==='topUp')try{await triggerWorker(journal.jobId);}catch(error){publish({workerStatus:{available:false,status:'unavailable',message:textError(error)}});}
    return {pending:false,hash,jobId:journal.jobId,receipt};
  }
  async function execute(value) {
    const q=accepted(value);await identity();if(state.pending)throw Error('Resolve the pending wallet transaction first');if(recoveryAction(q.action))await verifyRecovery();else await verify();
    const f=await fees();if(f.gasPriceWei>q.feeCeilingWeiPerGas)throw Error('Gas price rose above the approved quote. Calculate again.');
    let submissionCeiling=q.feeCeilingWeiPerGas;
    if(q.action==='open'){const capture=await contracts.adapter.capture(q.target,{gasLimit:ANALYSIS_GAS_CAP});const [target,,codeHash]=eth.AbiCoder.defaultAbiCoder().decode(['address','uint256','bytes32'],capture.facts??capture[0]);if(!same(target,q.target)||!same(codeHash,q.targetCodeHash))throw Error('Target runtime changed. Calculate again.');await checkWorker();if(!state.workerStatus.available&&!dependencies.allowManualStart)throw Error('The continuation service is unavailable. No funding transaction was requested.');}
    else if(q.action!=='withdraw'){const current=await readJob(q.jobId,recoveryAction(q.action));const context=eth.keccak256(eth.toUtf8Bytes(encode(actionContext(q.action,current.job,current.engineStatus))));if(context!==q.contextHash)throw Error('This job advanced or changed. Calculate its action again.');if(['advance','finalize'].includes(q.action)){if(f.gasPriceWei>current.job.feeCeilingWeiPerGas)throw Error('The job gas-price ceiling has been reached');if(current.job.feeCeilingWeiPerGas<submissionCeiling)submissionCeiling=current.job.feeCeilingWeiPerGas;}if(q.action==='topUp'&&BigInt(f.block.timestamp)>current.job.deadline)throw Error('This job expired; adding funds will not resume it.');}
    const submissionGasPriceWei=margin(f.gasPriceWei,11_000)>submissionCeiling?submissionCeiling:margin(f.gasPriceWei,11_000);
    const latestEstimate=BigInt(await provider.estimateGas({from:state.address,to:q.to,data:q.data,value:q.valueWei,gasPrice:submissionGasPriceWei}));
    if(margin(latestEstimate,12_000)>q.gasLimit||q.gasLimit>f.cap)throw Error('The current gas estimate exceeds the approved reserve. Calculate again.');
    const needed=q.valueWei+q.gasLimit*q.feeCeilingWeiPerGas+(q.action==='open'?uint(q.recoveryFeeReserveWei,'Recovery fee reserve'):0n);
    await identity();if(q.expiresAt<=now())throw Error('This quote expired before submission. Calculate again.');
    const signer=await walletProvider.getSigner(state.address),nonce=await provider.getTransactionCount(state.address,'pending');
    if(BigInt(await provider.getBalance(state.address))<needed)throw Error('Your wallet does not cover this action and its approved fee reserves');
    await identity();accepted(q);if(state.pending||journal?.pending)throw Error('Another wallet transaction needs reconciliation first');
    const request={to:q.to,data:q.data,value:q.valueWei,gasLimit:q.gasLimit,gasPrice:submissionGasPriceWei,chainId:d.chainId,nonce};
    const previousPending=journal.pending;
    journal.pending={owner:state.address,to:q.to,data:q.data,valueWei:q.valueWei,gasLimit:q.gasLimit,feeCeilingWeiPerGas:q.feeCeilingWeiPerGas,nonce,chainId:d.chainId,action:q.action,jobId:q.jobId??null,target:q.target??null,hash:null,createdAt:now()};
    try{storageWrite();}catch(error){journal.pending=previousPending;syncJournal();try{storageWrite();}catch{}throw Error(textError(error)+' No wallet transaction was requested.');}
    syncJournal();invalidate();
    let sent;try{sent=await signer.sendTransaction(request);}catch(error){if(error?.code===4001||error?.code==='ACTION_REJECTED'||error?.info?.error?.code===4001){journal.pending=null;storageWrite();syncJournal();}throw error;}
    journal.pending.hash=sent.hash;syncJournal();try{storageWrite();}catch{throw Error('Your wallet sent '+sent.hash+', but browser recovery storage could not be updated. Reconcile this exact hash before doing anything else.');}
    const receipt=await provider.getTransactionReceipt(sent.hash);if(receipt)return reconcile(sent.hash);
    return {pending:true,hash:sent.hash};
  }
  const accountsChanged=()=>{invalidate();publish({connected:false});};
  ethereum?.on?.('accountsChanged',accountsChanged);ethereum?.on?.('chainChanged',accountsChanged);
  const ready=verify().catch(error=>{publish({verified:false,lastError:textError(error)});return false;});
  return {ready,get state(){return clone(state);},connect:()=>operation(connect),quote:value=>operation(()=>quote(value)),
    start:(q,{budgetWei}={})=>operation(()=>{if(q?.action!=='open')throw Error('This is not a funding quote');if(budgetWei!==undefined&&uint(budgetWei)!==q.escrowWei)throw Error('The approved funding budget changed. Calculate again.');return execute(q);}),
    loadJob:id=>operation(()=>loadJob(id)),refresh:()=>operation(refresh),quoteAction:value=>operation(()=>quoteAction(value)),execute:q=>operation(()=>execute(q)),reconcile:hash=>operation(()=>reconcile(hash)),
    checkWorker:()=>operation(checkWorker),resumeWorker:()=>operation(async()=>{if(!state.jobId)throw Error('Load a job first');await checkWorker();if(!state.workerStatus.available)throw Error('Continuation service unavailable');return triggerWorker(state.jobId);}),
    destroy(){destroyed=true;quotes.clear();ethereum?.removeListener?.('accountsChanged',accountsChanged);ethereum?.removeListener?.('chainChanged',accountsChanged);walletProvider?.destroy?.();if(!injectedProvider)provider.destroy?.();}};
}
