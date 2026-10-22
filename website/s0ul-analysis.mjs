import * as Ethers from './mint/vendor/ethers.js';

const CHAIN_ID = 4663;
const JOB_STATES = ['Unknown', 'Running', 'Completed', 'Rejected', 'Cancelled'];
const FAILURES = ['None', 'Engine cancelled', 'Invalid model output', 'Prompt changed', 'Output could not be decoded', 'Invalid report'];
const PHASES = ['Not started','Embedding','Attention normalization','Query projection','Key projection','Value projection','Query rotation','Key cache','Attention','Attention projection','Attention residual','Feed-forward up','Feed-forward down','Feed-forward residual','Final normalization','Output logits','Token selection','Done','Cancelled'];
const ACTIONS = Object.freeze({advance:'Continue one batch',finalize:'Finalize generated report',cancel:'Cancel job',refundCompleted:'Refund unused escrow',withdraw:'Withdraw credit',topUp:'Add worker funds'});
const uint = value => {if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('Amount must be an exact integer.');if(!['string','number','bigint'].includes(typeof value)||String(value).trim()==='')throw Error('Amount must be an exact integer.');const result=BigInt(value);if(result<0n)throw Error('Amount must not be negative.');return result;};
const amount = value => {try{return uint(value??0);}catch{return 0n;}};
const number = value => {const n=Number(value??0);return Number.isSafeInteger(n)?n:0;};
const same = (a,b) => typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const validAddress = value => /^0x[0-9a-fA-F]{40}$/.test(String(value));
const short = value => value?String(value).slice(0,6)+'…'+String(value).slice(-4):'Not connected';
const errorText = error => String(error?.shortMessage??error?.reason??error?.message??error??'The action could not be completed.').slice(0,700);
const json = value => JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2);

export function parseAnalysisETH(value) {
  const text=String(value).trim();if(!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text))throw Error('Enter a positive ETH amount with up to 18 decimal places.');
  const [whole,fraction='']=text.split('.');const wei=BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'));
  if(wei<=0n)throw Error('Enter an amount greater than zero.');return wei;
}
export function formatAnalysisETH(value) {
  const wei=uint(value),fraction=(wei%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');
  return `${wei/10n**18n}${fraction?'.'+fraction:''}`;
}
export function analysisQuoteMatches(quote,{address,chainId,target,jobId,now=Date.now(),action}={}) {
  if(!quote||!same(quote.owner,address)||number(chainId)!==CHAIN_ID||number(quote.chainId)!==CHAIN_ID||!Number.isFinite(Number(quote.expiresAt))||Number(quote.expiresAt)<=now)return false;
  if(target!==undefined&&!same(quote.target,target))return false;
  if(action!==undefined&&quote.action!==action)return false;
  if(jobId!==undefined&&jobId!==null&&String(quote.jobId)!==String(jobId))return false;
  return true;
}
function fundingTerms(quote){
  const escrowWei=uint(quote.escrowWei??quote.budgetWei),openFeeReserveWei=uint(quote.openFeeReserveWei),totalRequiredWei=uint(quote.totalRequiredWei??quote.totalReserveWei??escrowWei+openFeeReserveWei);
  if(escrowWei===0n||openFeeReserveWei===0n||totalRequiredWei<escrowWei+openFeeReserveWei+uint(quote.recoveryFeeReserveWei??0))throw Error('The funding quote is incomplete or its total reserve is inconsistent.');
  return{escrowWei,openFeeReserveWei,totalRequiredWei};
}

export function mountS0ULAnalysis(root,options={}) {
  if(!root||root.dataset.s0ulAnalysisMounted)return null;
  root.dataset.s0ulAnalysisMounted='true';
  const doc=root.ownerDocument,win=doc.defaultView??globalThis.window,now=options.now??Date.now;
  const deployment=options.deployment??null;
  root.innerHTML=`<section class="analysis-shell" aria-labelledby="analysis-title">
    <header class="analysis-heading"><p class="analysis-eyebrow">S0UL / Reporting model</p><h2 id="analysis-title">On-chain observation report</h2><p>Fund one job. Follow the model’s generation on Robinhood Chain.</p><p class="analysis-small">Limited model · 14 on-chain signals captured when the job opens. Outputs can be wrong.</p><details class="analysis-details analysis-limits"><summary>What this model can do</summary><p>A limited, separately trained model reads 14 on-chain signals and generates a short observation. It can be incorrect. It does not establish identity, contract safety, value or future performance.</p></details></header>
    <div class="analysis-wallet"><span id="analysis-network">Robinhood Chain · 4663</span><button id="analysis-connect" class="analysis-button" type="button">Connect wallet</button></div>
    <div id="analysis-notice" class="analysis-notice" role="status" aria-live="polite">Loading the reporting contract…</div>
    <div class="analysis-start"><label class="analysis-field">Address<input id="analysis-target" spellcheck="false" autocomplete="off" placeholder="0x…" disabled></label><button id="analysis-calculate" class="analysis-button" type="button" disabled>Calculate gas</button><p class="analysis-small">Calculating is read-only. Nothing is funded or sent until you approve.</p></div>
    <section id="analysis-funding" class="analysis-funding" aria-label="Review funding" hidden><h3>Review the funding</h3><dl class="analysis-facts"><div><dt>Estimated prepaid budget</dt><dd id="analysis-escrow">—</dd></div><div><dt>Start transaction fee reserve</dt><dd id="analysis-open-fee">—</dd></div><div><dt>Total wallet reserve</dt><dd id="analysis-total">—</dd></div></dl><p id="analysis-quote-status" class="analysis-small"></p><p class="analysis-small">Estimated prepaid budget. If gas prices or work exceed this estimate, the job pauses and you can review a top-up. The estimate includes a reserve; unused funds are refundable. Starting gas is paid separately.</p><details class="analysis-details"><summary>Gas and worker details</summary><dl id="analysis-quote-details" class="analysis-facts"></dl></details><label class="analysis-consent"><input id="analysis-funding-consent" type="checkbox" disabled><span>I approve this escrow deposit and the start transaction fee reserve.</span></label><button id="analysis-start" class="analysis-button analysis-primary" type="button" disabled>Fund and start report</button></section>
    <section id="analysis-job" class="analysis-job" aria-labelledby="analysis-job-title" hidden><div class="analysis-section-head"><h3 id="analysis-job-title">On-chain progress</h3><span id="analysis-job-state" class="analysis-tag"></span></div><dl class="analysis-facts"><div><dt>Job</dt><dd id="analysis-job-id">—</dd></div><div><dt>Address</dt><dd id="analysis-job-target">—</dd></div><div><dt>Model phase</dt><dd id="analysis-phase">—</dd></div><div><dt>Generated tokens</dt><dd id="analysis-generated">—</dd></div><div><dt>Worker escrow remaining</dt><dd id="analysis-remaining">—</dd></div><div><dt>Credited to workers</dt><dd id="analysis-paid">—</dd></div></dl><p id="analysis-worker-status" class="analysis-small"></p><div class="analysis-report"><span class="analysis-eyebrow">Actual generated report</span><p id="analysis-report" aria-live="polite">No completed report yet.</p></div><div class="analysis-row"><button id="analysis-refresh" class="analysis-button" type="button">Refresh status</button><button id="analysis-resume-worker" class="analysis-button" type="button" hidden>Resume worker</button><button id="analysis-cancel" class="analysis-button" type="button" hidden>Cancel job</button><button id="analysis-refund" class="analysis-button" type="button" hidden>Refund unused escrow</button></div><p id="analysis-owner-note" class="analysis-small"></p><details class="analysis-details"><summary>Manual wallet fallback</summary><p class="analysis-small">If the worker service pauses, you may continue one batch with your wallet. This needs another wallet confirmation and upfront gas; the executor credits bounded reimbursement from the job escrow. Nothing loops automatically.</p><div class="analysis-row"><button id="analysis-advance" class="analysis-button" type="button" disabled>Continue one batch</button><button id="analysis-finalize" class="analysis-button" type="button" disabled>Finalize generated report</button></div><label class="analysis-field">Extra worker escrow (ETH)<input id="analysis-topup-amount" inputmode="decimal" autocomplete="off" placeholder="0.01"></label><button id="analysis-topup" class="analysis-button" type="button" disabled>Review additional funds</button></details><details class="analysis-details"><summary>On-chain evidence</summary><pre id="analysis-evidence"></pre></details></section>
    <section id="analysis-credit" class="analysis-credit" hidden><div><h3>Withdrawable credit</h3><strong id="analysis-credit-amount">—</strong><p class="analysis-small">Refunding moves unused escrow to your credit. Withdrawing transfers that credit to your wallet and costs gas.</p></div><button id="analysis-withdraw" class="analysis-button" type="button" disabled>Withdraw credit</button></section>
    <section id="analysis-action-review" class="analysis-funding" aria-label="Review wallet action" hidden><h3 id="analysis-action-title"></h3><dl class="analysis-facts"><div><dt>Transaction value</dt><dd id="analysis-action-value">—</dd></div><div><dt>Network fee reserve</dt><dd id="analysis-action-fee">—</dd></div></dl><p id="analysis-action-expiry" class="analysis-small"></p><label class="analysis-consent"><input id="analysis-action-consent" type="checkbox" disabled><span>I approve this action, its value and its network fee reserve.</span></label><button id="analysis-action-send" class="analysis-button analysis-primary" type="button" disabled>Confirm in wallet</button></section>
    <section id="analysis-recovery" class="analysis-recovery" hidden><h3>Check the submitted transaction</h3><p class="analysis-small">A wallet request is unresolved. Check its exact transaction hash before another send. Do not submit it again.</p><label class="analysis-field">Transaction hash<input id="analysis-recovery-hash" spellcheck="false" autocomplete="off" placeholder="0x…"></label><button id="analysis-reconcile" class="analysis-button" type="button" disabled>Check transaction</button></section>
    <details class="analysis-details analysis-resume"><summary>Resume an existing report</summary><div class="analysis-resume-row"><label class="analysis-field">Job ID<input id="analysis-resume-id" inputmode="numeric" autocomplete="off" placeholder="Job ID"></label><button id="analysis-load" class="analysis-button" type="button" disabled>Load report</button></div><p class="analysis-small">Reports and job IDs are public. Only the owner can cancel a job or refund its unused escrow.</p></details>
    <p class="analysis-small analysis-footnote">Facts, inference and the generated report stay on-chain. A worker must send continuation transactions; funding does not make the blockchain run a job by itself. Gas can be spent even when the model output is rejected.</p>
  </section>`;
  const el=id=>root.querySelector('#analysis-'+id);
  const controls=Object.fromEntries(['connect','target','calculate','funding-consent','start','refresh','resume-worker','cancel','refund','advance','finalize','topup-amount','topup','withdraw','action-consent','action-send','recovery-hash','reconcile','resume-id','load'].map(id=>[id,el(id)]));
  const listeners=[];
  let client=null,state={verified:false,connected:false,busy:false},fundingQuote=null,actionQuote=null,selectedAction=null,operating=false,destroyed=false,error='',message='',lastIdentity='',lastJob='',timer=null;
  const blocked=()=>Boolean(state.pending||state.ambiguous||state.recoveryFault);
  const connected=()=>Boolean(state.connected&&state.address&&number(state.chainId)===CHAIN_ID);
  const job=()=>state.job??null;
  const jobId=()=>state.jobId??job()?.id??null;
  const owns=()=>connected()&&same(job()?.owner,state.address);
  const running=()=>number(job()?.state)===1;
  const idle=()=>!operating&&!state.busy;
  function freshFunding(){try{fundingTerms(fundingQuote);return state.verified&&connected()&&fundingQuote.canAfford!==false&&fundingQuote.affordable!==false&&fundingQuote.workerAvailable!==false&&analysisQuoteMatches(fundingQuote,{address:state.address,chainId:state.chainId,target:controls.target.value.trim(),now:now()});}catch{return false;}}
  function freshAction(){return connected()&&actionQuote?.canAfford!==false&&analysisQuoteMatches(actionQuote,{address:state.address,chainId:state.chainId,jobId:selectedAction==='withdraw'?undefined:jobId(),action:selectedAction,now:now()})&&amount(actionQuote.feeReserveWei)>0n;}
  function notice(text,isError=false){message=text;error=isError?text:'';el('notice').textContent=text;el('notice').dataset.error=String(isError);}
  function invalidate(){fundingQuote=null;actionQuote=null;selectedAction=null;controls['funding-consent'].checked=false;controls['action-consent'].checked=false;client?.invalidateQuote?.();render();}
  function rows(node,entries){node.replaceChildren();for(const[label,value]of entries){const row=doc.createElement('div'),dt=doc.createElement('dt'),dd=doc.createElement('dd');dt.textContent=label;dd.textContent=String(value);row.append(dt,dd);node.append(row);}}
  function receive(next){
    if(destroyed)return;
    state={...state,...next};const identity=`${state.connected}:${state.address??''}:${state.chainId??''}`,currentJob=`${jobId()??''}:${job()?.state??''}`;
    if(lastIdentity&&identity!==lastIdentity){fundingQuote=null;actionQuote=null;selectedAction=null;controls['funding-consent'].checked=false;controls['action-consent'].checked=false;}
    if(lastJob&&currentJob!==lastJob){actionQuote=null;selectedAction=null;controls['action-consent'].checked=false;}
    lastIdentity=identity;lastJob=currentJob;render();
  }
  function workerMessage(){
    const worker=state.workerStatus??state.worker;
    const status=typeof worker==='string'?worker:worker?.status;
    if(!running())return number(job()?.state)===2?'Generation completed on-chain.':number(job()?.state)===3?'The model output was rejected. No replacement report has been invented.':'';
    if(!state.engineStatus?.done&&!state.engineStatus?.cancelled&&amount(job()?.remaining)<amount(job()?.maxRewardPerBatchWei))return 'Worker escrow is below the next batch reserve. Review additional funds to resume, or cancel and refund the unused balance.';
    if(status==='submitted')return 'The worker service accepted the continuation request. Progress below comes from the chain; you can leave and resume with this job ID.';
    if(worker?.available===true||['online','running','ready','active','available'].includes(status))return 'Worker service is available. Progress below comes from the chain; you can leave and resume with this job ID.';
    if(['paused','offline','unavailable','error'].includes(status))return 'The worker service is paused or unavailable. Your job and remaining escrow stay on-chain; you can return later, use manual continuation, or cancel.';
    return 'Automatic continuation has not been confirmed. Refresh to check on-chain progress; manual continuation is available if the service pauses.';
  }
  function actualReport(){
    if(number(job()?.state)!==2)return number(job()?.state)===3?`No accepted report. ${FAILURES[number(job()?.failure)]??'The output was rejected'}.`:number(job()?.state)===4?'Job cancelled. No report was completed.':'No completed report yet.';
    if(typeof state.report!=='string'||!state.report)return 'The completed report has not been read yet. Refresh status.';
    try{return /^0x(?:[0-9a-fA-F]{2})*$/.test(state.report)?Ethers.toUtf8String(state.report):state.report;}catch{return 'The stored report bytes could not be decoded. See the on-chain evidence.';}
  }
  function render(){
    if(destroyed)return;
    const ready=Boolean(state.verified),available=ready&&idle(),readable=Boolean(client)&&idle(),recoverable=readable&&connected(),hasJob=jobId()!==null&&job()!==null&&state.pending?.action!=='open',pending=blocked();
    controls.connect.disabled=!deployment||!client||!idle();controls.connect.textContent=connected()?short(state.address):'Connect wallet';
    el('network').textContent=connected()?`Robinhood Chain · ${short(state.address)}`:'Robinhood Chain · 4663';
    controls.target.disabled=!available||running();controls.calculate.disabled=!available||!connected()||pending||running();
    controls.calculate.textContent=operating?'Working…':'Calculate gas';
    controls.start.disabled=!available||pending||!freshFunding()||!controls['funding-consent'].checked;
    controls['funding-consent'].disabled=!freshFunding()||!idle()||pending;
    el('funding').hidden=!fundingQuote;
    if(fundingQuote){
      const escrow=amount(fundingQuote.escrowWei??fundingQuote.budgetWei),openFee=amount(fundingQuote.openFeeReserveWei),total=amount(fundingQuote.totalRequiredWei??fundingQuote.totalReserveWei??escrow+openFee);
      el('escrow').textContent=formatAnalysisETH(escrow)+' ETH';el('open-fee').textContent=formatAnalysisETH(openFee)+' ETH';el('total').textContent=formatAnalysisETH(total)+' ETH';
      el('quote-status').textContent=fundingQuote.canAfford===false||fundingQuote.affordable===false?'This wallet does not cover the escrow and starting fee reserve.':fundingQuote.workerAvailable===false?'The continuation service is unavailable. Funding is disabled until it is ready.':freshFunding()?`Funding quote expires in ${Math.max(0,Math.ceil((Number(fundingQuote.expiresAt)-now())/1000))}s.`:'Quote expired or the wallet/address changed. Calculate gas again.';
      rows(el('quote-details'),[['Output token budget',fundingQuote.maxNewTokens??32],['Continuation steps',fundingQuote.logicalCalls??fundingQuote.totalLogicalCalls??'See the quoted worker budget'],['Per-batch reward cap',formatAnalysisETH(amount(fundingQuote.maxRewardPerBatchWei))+' ETH'],['Worker gas-price ceiling',String(fundingQuote.feeCeilingWeiPerGas??'—')+' wei/gas'],['Optional recovery fee reserve',formatAnalysisETH(amount(fundingQuote.recoveryFeeReserveWei))+' ETH · kept in your wallet, not deposited']]);
    }
    el('job').hidden=!hasJob;
    if(hasJob){
      el('job-id').textContent=String(jobId());el('job-target').textContent=job().target??'—';el('job-state').textContent=JOB_STATES[number(job().state)]??'Unknown';
      el('phase').textContent=state.engineStatus?.phase===undefined?'Awaiting chain status':PHASES[number(state.engineStatus.phase)]??'Unknown chain phase';
      el('generated').textContent=state.engineStatus?.generated===undefined?'Awaiting chain status':`${number(state.engineStatus.generated)} / ${number(job().maxNewTokens)||32} maximum`;
      el('remaining').textContent=formatAnalysisETH(amount(job().remaining))+' ETH';el('paid').textContent=formatAnalysisETH(amount(job().totalPaid))+' ETH';
      el('worker-status').textContent=workerMessage();el('report').textContent=actualReport();
      el('owner-note').textContent=owns()?'Cancelling or refunding credits unused escrow to you. Withdraw that credit separately.':'This is a public job. Owner-only funding controls require its owner’s wallet.';
      el('evidence').textContent=json({jobId:jobId(),job:job(),engineStatus:state.engineStatus??null,actualOutputTokens:state.outputTokens??[],storedReport:state.report??null});
    }
    controls.refresh.disabled=!readable||!hasJob;
    controls['resume-worker'].hidden=!running();controls['resume-worker'].disabled=!available||pending||!client?.resumeWorker;
    controls.cancel.hidden=!owns()||![1,3].includes(number(job()?.state));controls.cancel.disabled=!recoverable||pending;
    controls.refund.hidden=!owns()||![2,3,4].includes(number(job()?.state))||amount(job()?.remaining)===0n;controls.refund.disabled=!recoverable||pending;
    controls.advance.disabled=!available||!connected()||pending||!running()||Boolean(state.engineStatus?.done)||Boolean(state.engineStatus?.cancelled);
    controls.finalize.disabled=!available||!connected()||pending||!running()||!state.engineStatus?.done&&!state.engineStatus?.cancelled;
    controls.topup.disabled=!available||pending||!owns()||!running();controls['topup-amount'].disabled=controls.topup.disabled;
    const credit=amount(state.creditsWei);el('credit').hidden=credit===0n||!connected();el('credit-amount').textContent=formatAnalysisETH(credit)+' ETH';controls.withdraw.disabled=!recoverable||pending||credit===0n;
    el('action-review').hidden=!actionQuote;
    if(actionQuote){el('action-title').textContent=ACTIONS[selectedAction]??'Review action';el('action-value').textContent=formatAnalysisETH(amount(actionQuote.valueWei))+' ETH';el('action-fee').textContent=formatAnalysisETH(amount(actionQuote.feeReserveWei))+' ETH';el('action-expiry').textContent=actionQuote.canAfford===false?'This wallet does not cover the action value and network fee reserve.':freshAction()?`Quote expires in ${Math.max(0,Math.ceil((Number(actionQuote.expiresAt)-now())/1000))}s.`:'This action quote expired or its wallet/job changed. Review it again.';}
    controls['action-consent'].disabled=!idle()||pending||!freshAction();controls['action-send'].disabled=!(selectedAction&&['cancel','refundCompleted','withdraw'].includes(selectedAction)?recoverable:available)||pending||!freshAction()||!controls['action-consent'].checked;
    el('recovery').hidden=!pending;if(state.pending?.hash)controls['recovery-hash'].value=state.pending.hash;controls.reconcile.disabled=!idle()||!connected();
    controls.load.disabled=!readable;controls['resume-id'].disabled=!readable;
    if(!message)notice(!deployment?'Reporting deployment is not available yet. No wallet transaction can be requested.':!ready?'Verifying reporting contracts…':!connected()?'Connect your wallet, enter an address, then calculate the gas and worker escrow.':'Enter an address and calculate its report funding.');
  }
  async function operation(fn){
    if(!idle()||destroyed)return;operating=true;error='';render();
    try{await fn();if(client?.state)receive(client.state);}
    catch(problem){notice(errorText(problem),true);}
    finally{operating=false;render();}
  }
  async function calculate(){
    invalidate();const target=controls.target.value.trim();if(!validAddress(target))throw Error('Enter a valid 0x address.');
    if(!connected())throw Error('Connect your wallet before reviewing a funding quote.');
    const q=await client.quote({target,maxNewTokens:32});
    if(!analysisQuoteMatches(q,{address:state.address,chainId:state.chainId,target:controls.target.value.trim(),now:now()}))throw Error('The wallet or address changed during the quote. Calculate gas again.');
    fundingTerms(q);
    fundingQuote=q;controls['funding-consent'].checked=false;notice('Review the prepaid worker escrow and separate starting fee.');
  }
  async function start(){
    if(!freshFunding()||!controls['funding-consent'].checked||blocked())throw Error('Review a fresh funding quote and approve it first.');
    const accepted=fundingQuote,budgetWei=uint(accepted.escrowWei??accepted.budgetWei);fundingQuote=null;controls['funding-consent'].checked=false;
    notice('Confirm one escrow-funding transaction in your wallet.');const result=await client.start(accepted,{budgetWei});
    notice(result?.pending?'Funding transaction submitted. Its saved hash is checked automatically; continuation starts after confirmation.':'Funding confirmed. Follow actual on-chain generation below; no wallet continuation loop was started.');
  }
  async function reviewAction(action){
    if(!Object.hasOwn(ACTIONS,action))throw Error('Unsupported report action.');
    if(!connected()||blocked())throw Error('Connect the correct wallet and resolve any submitted transaction first.');
    if(['advance','finalize','topUp'].includes(action)&&!state.verified)throw Error('Reporting dependencies do not match their pins. Cancel or refund this job instead.');
    if(['cancel','refundCompleted','topUp'].includes(action)&&!owns())throw Error('Only this job’s owner can request that action.');
    if(action==='withdraw'&&amount(state.creditsWei)===0n)throw Error('This wallet has no withdrawable credit.');
    if(['advance','finalize','topUp'].includes(action)&&!running())throw Error('This job is not running.');
    if(action==='advance'&&(state.engineStatus?.done||state.engineStatus?.cancelled))throw Error('Generation has stopped; review finalization instead.');
    if(action==='finalize'&&!state.engineStatus?.done&&!state.engineStatus?.cancelled)throw Error('Generation is not ready to finalize.');
    actionQuote=null;controls['action-consent'].checked=false;selectedAction=action;
    const options={action,jobId:jobId()};if(action==='topUp')options.valueWei=parseAnalysisETH(controls['topup-amount'].value);
    const q=await client.quoteAction(options);
    if(!analysisQuoteMatches(q,{address:state.address,chainId:state.chainId,jobId:action==='withdraw'?undefined:jobId(),action,now:now()}))throw Error('The wallet or job changed. Review this action again.');
    actionQuote=q;notice('Review this single wallet action and its fee reserve.');
  }
  async function execute(){if(!freshAction()||!controls['action-consent'].checked||blocked())throw Error('Review a fresh action quote and approve it first.');const accepted=actionQuote;actionQuote=null;controls['action-consent'].checked=false;await client.execute(accepted);notice('Wallet action submitted. The chain status will show its confirmed result.');}
  function listen(node,type,fn){node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));}
  listen(controls.connect,'click',()=>operation(async()=>{await client.connect();notice('Wallet connected. Calculate a funding quote before approving a report.');}));
  listen(controls.target,'input',()=>{invalidate();notice('Address changed. Calculate a fresh funding quote.');});
  listen(controls.calculate,'click',()=>operation(calculate));listen(controls.start,'click',()=>operation(start));
  listen(controls['funding-consent'],'change',render);listen(controls['action-consent'],'change',render);
  listen(controls['topup-amount'],'input',()=>{actionQuote=null;controls['action-consent'].checked=false;render();});
  listen(controls.refresh,'click',()=>operation(async()=>{await client.refresh();notice('Read the current job state from the chain.');}));
  listen(controls['resume-worker'],'click',()=>operation(async()=>{if(!client.resumeWorker)throw Error('The worker service is not available.');await client.resumeWorker();notice('Requested continuation of this funded job. On-chain progress is checked separately.');}));
  for(const [control,action]of [['advance','advance'],['finalize','finalize'],['cancel','cancel'],['refund','refundCompleted'],['withdraw','withdraw'],['topup','topUp']])listen(controls[control],'click',()=>operation(()=>reviewAction(action)));
  listen(controls['action-send'],'click',()=>operation(execute));
  listen(controls.reconcile,'click',()=>operation(async()=>{await client.reconcile(controls['recovery-hash'].value.trim());notice('Checked the exact transaction against the saved intent.');}));
  listen(controls.load,'click',()=>operation(async()=>{invalidate();const id=controls['resume-id'].value.trim();if(!/^[1-9]\d*$/.test(id))throw Error('Enter a positive job ID.');await client.loadJob(BigInt(id));notice('Read the saved on-chain job.');}));
  async function initialize(){
    if(!deployment){render();return;}
    const create=options.createClient??(await import('./s0ul-analysis-client.mjs')).createS0ULAnalysisClient;
    client=await create({deployment,ethereum:options.ethereum??win?.ethereum,onUpdate:receive,storage:options.storage,eth:options.eth??Ethers,provider:options.provider});
    if(client.ready)await client.ready;else if(client.initialize)await client.initialize();
    receive(client.state??{});notice(state.verified?'Connect your wallet, enter an address, then calculate the gas and worker escrow.':'Reporting contract verification is incomplete.');
  }
  const ready=operation(initialize);
  timer=(options.setInterval??globalThis.setInterval)(()=>{if(destroyed)return;render();if(!client||!idle())return;if(state.pending?.hash&&connected())return operation(async()=>{await client.reconcile(state.pending.hash);});if(jobId()!==null&&!blocked())return operation(async()=>{await client.refresh();});},options.pollIntervalMs??10_000);
  return {ready,get state(){return{...state,fundingQuote,actionQuote,selectedAction,error};},destroy(){destroyed=true;(options.clearInterval??globalThis.clearInterval)(timer);listeners.forEach(remove=>remove());client?.destroy?.();root.removeAttribute('data-s0ul-analysis-mounted');}};
}

export async function loadS0ULAnalysisDeployment(root,{fetch:fetcher=globalThis.fetch}={}){
  const doc=root.ownerDocument,inline=doc.getElementById('s0ul-analysis-config');if(inline)return JSON.parse(inline.textContent||'null');
  const origin=doc.defaultView?.location?.origin??globalThis.location?.origin;if(!origin||!fetcher)return null;
  const url=new URL(root.dataset.deploymentSrc??'/s0ul-analysis-deployment.json',origin);if(url.origin!==origin)throw Error('Reporting configuration must be served by this site.');
  const response=await fetcher(url.href,{cache:'no-store'});if(response.status===404)return null;if(!response.ok)throw Error('The reporting deployment configuration is unavailable.');return response.json();
}
if(typeof document!=='undefined'){
  const root=document.getElementById('s0ul-analysis-root');if(root)loadS0ULAnalysisDeployment(root).then(deployment=>mountS0ULAnalysis(root,{deployment})).catch(()=>mountS0ULAnalysis(root,{deployment:null}));
}
