import {Wallet,formatEther} from 'ethers';
import {OWNER,validatePlan,validateQuotedAction,validateSignedEnvelope} from './policy.mjs';
const PLAN_SHA=__GL3_CHILD_PLAN_SHA256__,el=id=>document.getElementById(id),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=x=>{if(!x)throw Error('This review does not match the prepared setup.');};
async function request(route,body){const r=await fetch('./'+route,{cache:'no-store',credentials:'omit',redirect:'error',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.message||'Local check failed.');return v;}
async function sha(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
let plan,busy=false;const status=t=>el('status').textContent=t;
el('unlock').onclick=async event=>{
 if(!event.isTrusted||busy||!plan)return;if(!el('accept').checked)return status('Review and accept the exact funding and seven setup changes first.');
 let password=el('password').value,wallet;if(!password)return status('Enter the wallet password here.');busy=true;el('unlock').disabled=true;el('password').value='';
 try{
  const encrypted=await request('keystore');const opening=Wallet.fromEncryptedJson(JSON.stringify(encrypted),password);password='';wallet=await opening;check(wallet.address===OWNER);
  await request('consent',{planSHA256:PLAN_SHA,accepted:true});
  for(;;){
   let state=await request('status');if(state.state==='reconciliation-required')throw Error('A saved send is unresolved. Keep this page and journal; do not sign again.');
   if(state.state==='confirmed'){status('Transaction confirmed. Checking the next stage…');}
   const q=await request('quote',{planSHA256:PLAN_SHA});
   if(q.waiting){status(q.message);await sleep(2500);continue;}
   if(q.complete){status('All 9 transactions are confirmed. Final fee, treasury and renounced-owner checks passed. Public activation is a separate step.');wallet=undefined;return;}
   const unsigned=validateQuotedAction(plan,q,PLAN_SHA);const symbol=unsigned.chainId===4663n?' ETH':' GH0ST',feeText='Estimated '+formatEther(q.estimatedFeeUnits)+symbol+' · signed maximum '+formatEther(q.maxCostUnits)+symbol;const feeLine=document.createElement('p');feeLine.textContent=(q.index+1)+'/9 · '+feeText;el('fees').append(feeLine);status('Signing '+(q.index+1)+'/9: '+plan.actions[q.index].label+' · '+feeText);await new Promise(requestAnimationFrame);
   const raw=await wallet.signTransaction(unsigned);const {Transaction}=await import('ethers');validateSignedEnvelope(Transaction.from(raw),q);
   // Never resubmit after an unknown HTTP response. The local durable journal is authoritative.
   await request('submit',{planSHA256:PLAN_SHA,raw});status('Sent '+(q.index+1)+'/9. Waiting for its canonical receipt…');
   for(;;){await sleep(2000);state=await request('status');if(state.state==='confirmed'||state.state==='ready')break;if(state.state==='reconciliation-required')throw Error('Send is unresolved. Stop and reconcile saved hash. No retry was sent.');}
  }
 }catch(e){status(e.message+' Keep the local journal before restarting.');}finally{password='';wallet=undefined;busy=false;}
};
async function init(){check(location.protocol==='http:'&&location.hostname==='127.0.0.1');const r=await fetch('./plan',{cache:'no-store',credentials:'omit',redirect:'error'});const bytes=await r.arrayBuffer();check(await sha(bytes)===PLAN_SHA);plan=JSON.parse(new TextDecoder().decode(bytes));validatePlan(plan);el('summary').textContent='Deposit exactly 1,000,000 GH0ST. Fresh market gas for every signature, with no aggregate fee ceiling. Estimated and maximum transaction fees are shown as each quote arrives. No automatic top-ups. Chain 4663001.';for(const a of plan.actions){const p=document.createElement('p');p.textContent=(a.index+1)+'. '+a.label+' (nonce '+a.nonce+')';el('actions').append(p);}el('unlock').disabled=false;status('Ready for one unlock. Each transaction will use a fresh quote immediately before its signature.');}
init().catch(e=>status(e.message));
