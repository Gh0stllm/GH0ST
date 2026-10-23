/* Public pool deposits. Every spending action needs a separate wallet confirmation. */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const state = {busy:false, quote:null, action:null, result:null};
const short = a => a ? a.slice(0,6)+'…'+a.slice(-4) : 'Your wallet';
const number = value => { const [w,f='']=String(value).split('.');if(w==='0'&&!/[1-9]/.test(f.slice(0,6))&&/[1-9]/.test(f))return '<0.000001';return w.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(f.slice(0,6).replace(/0+$/,'')?'.'+f.slice(0,6).replace(/0+$/,''):''); };
const client = GH0STLiquidityUIEngine.createClient({ethers:globalThis.ethers});
function error(e) {const node=$('lp-error'); node.hidden=!e;let message=e?.shortMessage||e?.message||'';if(/ACTION_REJECTED|user rejected/i.test(message)||e?.code==='ACTION_REJECTED')message='Request cancelled in your wallet.';if(/fetch|coalesce|network|timeout/i.test(message))message='The network is taking longer than expected. Try again shortly.';node.textContent=message.length>230?'The request could not be completed. Check your wallet and try again.':message;}
function render(){
 const q=state.quote;
 $('lp-amount').disabled=state.busy;$('lp-action').disabled=state.busy;
 $('lp-action').textContent=state.busy?'Please wait…':state.result?'Liquidity added':state.action?.kind==='pending'?'Check liquidity transaction':!client.account?'Connect wallet':!$('lp-amount').value.trim()?'Enter an ETH amount':!q?'Review deposit':state.action?.label||'Review deposit';
 if(state.result)$('lp-action').disabled=true;
 $('lp-ghost').textContent=q?number(q.amountGhostMax):'—';$('lp-details').hidden=!q;
 if(q){$('lp-used-eth').textContent=number(q.expectedEth)+' ETH';$('lp-used-ghost').textContent=number(q.expectedGhost)+' GH0ST';$('lp-owner').textContent=short(q.account);}
 if(client.account){$('wallet-label').textContent=short(client.account);}
}
function invalidate(){state.quote=null;state.action=null;state.result=null;error(null);render();}
async function run(fn){if(state.busy)return;state.busy=true;error(null);$('tab-swap').disabled=true;$('tab-liquidity').disabled=true;render();try{await fn();}catch(e){error(e);}finally{state.busy=false;$('tab-swap').disabled=false;$('tab-liquidity').disabled=false;render();}}
function balances(s){if(s.balances){$('lp-balance').textContent='Balance '+number(s.balances.eth);$('lp-ghost-balance').textContent='Balance '+number(s.balances.ghost);}}
async function resultView(result){
 if(result?.pending){$('lp-status').textContent='Transaction pending. Click again to check its receipt.';if(result.hash)$('lp-recovery-hash').value=result.hash;state.action={kind:'pending',label:'Check pending deposit'};return;}
 if(result?.minted){state.result=result.minted;$('lp-status').textContent='Liquidity confirmed. Position NFT #'+result.minted.tokenId+' belongs to your wallet.';document.dispatchEvent(new Event('h00k-liquidity-added'));return;}
 state.action=state.quote?await client.nextAction(state.quote):null;render();
}
async function action(){
 if(!client.account){const s=await client.connect();balances(s);if(globalThis.GH0STSwapUI)await GH0STSwapUI.syncWallet();try{state.action=await client.nextAction(null);}catch(_){}render();return;}
 if(state.action?.kind==='pending'){await resultView(await client.executeNext(state.quote));return;}
 if(state.action?.kind!=='pending' && state.quote && Date.now()-state.quote.createdAt>120000){state.quote=null;state.action=null;}
 if(!state.quote){state.quote=await client.quote({amountEth:$('lp-amount').value.trim(),slippageBps:50});state.action=await client.nextAction(state.quote);$('lp-status').textContent=state.quote.initialized?'Review both maximum amounts. Your full-range position is minted to your wallet.':'This first deposit initializes the pool at the existing GH0ST market price. Review both maximum amounts.';render();return;}
 await resultView(await client.executeNext(state.quote));
}
$('tab-swap').addEventListener('click',()=>{$('swap-form').hidden=false;$('liquidity-form').hidden=true;document.querySelector('.slippage-menu').hidden=false;$('tab-swap').classList.add('active');$('tab-liquidity').classList.remove('active');$('tab-swap').setAttribute('aria-selected','true');$('tab-liquidity').setAttribute('aria-selected','false');});
$('tab-liquidity').addEventListener('click',()=>{$('swap-form').hidden=true;$('liquidity-form').hidden=false;document.querySelector('.slippage-menu').hidden=true;$('tab-liquidity').classList.add('active');$('tab-swap').classList.remove('active');$('tab-liquidity').setAttribute('aria-selected','true');$('tab-swap').setAttribute('aria-selected','false');});
$('lp-recover').addEventListener('click',()=>run(async()=>{if(!client.account)balances(await client.connect());await resultView(await client.recoverPending($('lp-recovery-hash').value.trim()));}));
$('lp-amount').addEventListener('input',invalidate);$('lp-action').addEventListener('click',()=>run(action));
document.addEventListener('h00k-wallet-connected',()=>{if(!client.account&&!state.busy)run(async()=>{balances(await client.connect());try{state.action=await client.nextAction(null);}catch(_){}render();});});
if(globalThis.ethereum?.on){ethereum.on('accountsChanged',invalidate);ethereum.on('chainChanged',invalidate);}
render();
})();
