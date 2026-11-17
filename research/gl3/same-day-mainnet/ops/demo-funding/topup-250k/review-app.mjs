import {Wallet,Transaction,formatEther} from 'ethers';
import {OWNER,unsigned,validatePlan,validateSigned} from './policy.mjs';
const PLAN_SHA=__PLAN_SHA__,el=id=>document.getElementById(id),sleep=ms=>new Promise(r=>setTimeout(r,ms));
let plan,busy=false;
const status=s=>el('status').textContent=s;
async function request(route,body){const r=await fetch('./'+route,{cache:'no-store',credentials:'omit',redirect:'error',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.message||'Local review failed');return v;}
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
el('unlock').onclick=async event=>{
 if(!event.isTrusted||busy||!plan)return;if(!el('accept').checked)return status('Please review and accept this exact transfer first.');
 let password=el('password').value,wallet;if(!password)return status('Enter your password on this page.');busy=true;el('unlock').disabled=true;el('password').value='';
 try{
  const state=await request('status');if(state.state!=='ready')throw Error('A saved transfer already exists. Reconcile that transfer; do not sign again.');
  const encrypted=await request('keystore');const opening=Wallet.fromEncryptedJson(JSON.stringify(encrypted),password);password='';wallet=await opening;
  if(wallet.address!==OWNER)throw Error('This is not the reviewed funding wallet.');
  await request('consent',{planSHA:PLAN_SHA,accepted:true});const q=await request('quote',{planSHA:PLAN_SHA});
  const tx=unsigned(plan,q,PLAN_SHA);el('fee').textContent='Fresh quote: '+formatEther(q.estimatedFee)+' GH0ST estimated; '+formatEther(BigInt(q.gasLimit)*BigInt(q.gasPrice))+' GH0ST signed maximum.';status('Signing the single reviewed transfer…');await new Promise(requestAnimationFrame);
  const raw=await wallet.signTransaction(tx);validateSigned(Transaction.from(raw),plan,q,PLAN_SHA);wallet=undefined;
  await request('submit',{planSHA:PLAN_SHA,raw});status('Transfer submitted. Waiting for the canonical receipt…');
  for(;;){await sleep(2000);const s=await request('status');if(s.state==='confirmed'){status('Confirmed: the additional 250,000 GH0ST is credited to the dedicated demo wallet. No automatic top-ups.');el('hash').textContent=s.hash;return;}if(['failed','reconciliation-required'].includes(s.state))throw Error('Transfer needs reconciliation. Preserve this session and do not sign again.');}
 }catch(e){status(e.message+' No automatic retry will be sent.');}finally{password='';wallet=undefined;busy=false;}
};
(async()=>{if(location.protocol!=='http:'||location.hostname!=='127.0.0.1')throw Error('Use the local review page.');const r=await fetch('./plan',{cache:'no-store'}),bytes=await r.arrayBuffer();if(await sha(bytes)!==PLAN_SHA)throw Error('Review plan hash changed');plan=JSON.parse(new TextDecoder().decode(bytes));validatePlan(plan);el('destination').textContent=plan.to;el('unlock').disabled=false;status('Ready for your review and one local unlock.');})().catch(e=>status(e.message));
