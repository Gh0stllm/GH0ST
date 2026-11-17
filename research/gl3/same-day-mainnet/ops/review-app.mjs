import {Transaction, Wallet, getAddress, Interface, parseEther, formatEther} from 'ethers';
import {validateReviewPlan,validateSponsorPlan} from './review-core.mjs';
// Injected by the Runpod build from the exact reviewed source files.
const REVIEW_SHA=__GL3_PLAN_SHA256__, TERMS_SHA=__GL3_TERMS_SHA256__;
const OWNER='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
const POSTER='0x52cc715ef517CE1933142d2168B43F8fdc54b7c5';
const VALIDATOR='0x0F2a3E06D0B6379a68DFe4a6E636C8e9EDdEf5ad';
const TOKEN='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const ABI=new Interface(['function transfer(address to,uint256 amount)']);
const el=id=>document.getElementById(id);
const match=x=>{if(!x)throw Error('The deployment differs from this exact review.');};
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
async function request(route,options={}){
 let r;try{r=await fetch('./'+route,{cache:'no-store',credentials:'omit',redirect:'error',...options});}catch{throw Error('The local review is unavailable. Check the latest signing page.');}
 if(!r.ok){const v=await r.json().catch(()=>({}));throw Error(v.message||'The local review check failed.');}return r;
}
let plan,actions,expiry,busy=false,submitted=false;
function enabled(x){el('password').disabled=!x;el('unlock').disabled=!x;}
function show(s){el('status').textContent=s.message;if(s.hashes?.length){el('hashes').replaceChildren(...s.hashes.map(h=>{const p=document.createElement('p');p.textContent=h;return p;}));}}
const terminal=new Set(['confirmed','uncertain','failed','expired']);
async function follow(){try{const s=await(await request('status')).json();show(s);if(terminal.has(s.state))return;}catch(e){el('status').textContent=e.message+' Check the saved status before retrying.';}setTimeout(follow,3000);}
function checkConsent(){return ['terms-accept','security-accept','budget-accept'].every(id=>el(id).checked)&&el('operator').value.trim().length>=2;}
el('unlock').onclick=async event=>{
 if(!event.isTrusted||busy||submitted||!plan)return;
 if(!checkConsent()){el('status').textContent='Review and accept the terms, security model and exact funding first.';return;}
 if(!el('password').value){el('status').textContent='Enter the wallet password on this page.';return;}
 if(Date.now()>=expiry){enabled(false);el('status').textContent='This review expired. No signature was sent.';return;}
 busy=true;enabled(false);let password=el('password').value;el('password').value='';
 try{
  const encrypted=await(await request('keystore')).text();el('status').textContent='Unlocking the cold wallet in this tab…';
  const opening=Wallet.fromEncryptedJson(encrypted,password);password='';let wallet;
  try{wallet=await opening;}catch{throw Error('The wallet could not be unlocked. Check its password.');}
  match(wallet.address===OWNER);const raws=[];
  for(let i=0;i<actions.length;i++){
   const raw=await wallet.signTransaction(actions[i]);const signed=Transaction.from(raw);
   match(signed.from===OWNER&&signed.unsignedHash===plan.actions[i].unsignedHash);raws.push(raw);
  }
  wallet=undefined;submitted=true;
  const consent={operator:el('operator').value.trim(),termsAccepted:true,securityAccepted:true,budgetAccepted:true};
  try{await request('submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raws,consent,planSHA256:REVIEW_SHA,termsSHA256:TERMS_SHA})});}
  catch{el('status').textContent='Submission response is unknown. Checking the saved deployment status.';}
  void follow();
 }catch(e){el('status').textContent=e.message;if(!submitted&&Date.now()<expiry)enabled(true);}
 finally{password='';busy=false;}
};
async function init(){
 match(location.protocol==='http:'&&location.hostname==='127.0.0.1');
 const [r,s]=await Promise.all([request('plan'),request('status').then(r=>r.json())]);
 const bytes=await r.arrayBuffer();match(await sha(bytes)===REVIEW_SHA&&s.planSHA256===REVIEW_SHA&&s.termsSHA256===TERMS_SHA);
 plan=JSON.parse(new TextDecoder().decode(bytes));expiry=s.expiresAt;
 match(Number.isSafeInteger(expiry));
 const sponsorMode=plan.schema==='gh0st.gl3.cold-sponsor-plan.v1';
 const checked=sponsorMode?validateSponsorPlan(plan,'0x1E0a95665dc872899eb89018455ef44B27108FCd'):validateReviewPlan(plan);
 if(sponsorMode)match(await sha(new TextEncoder().encode(plan.delegatedPlanJSON))===plan.delegatedPlanSHA256);
 actions=checked.actions.map(a=>a.tx);const fee=checked.totalFee,value=checked.totalValue;
 el('owner').textContent=OWNER;el('plan-hash').textContent=REVIEW_SHA;el('terms-hash').textContent=TERMS_SHA;
 el('max-debit').textContent=formatEther(fee+value)+' ETH';
 el('max-fees').textContent=formatEther(fee)+' ETH';
 for(const a of plan.actions){const tr=document.createElement('tr');for(const v of [a.index+1,a.label,a.transaction.nonce,a.postconditions.createdAddress||a.transaction.to,a.unsignedHash]){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}el('actions').append(tr);}
 if(sponsorMode){const d=JSON.parse(plan.delegatedPlanJSON);el('delegated').textContent='Separate signer '+plan.deployer+' may execute '+d.actions.length+' exact deployment transactions; plan SHA-256 '+plan.delegatedPlanSHA256+'. Unused temporary deployment funds return to the cold wallet. It receives no GH0ST and no admin authority.';}
 show(s);enabled(s.state==='ready'&&Date.now()<expiry);if(s.state!=='ready')void follow();
}
enabled(false);init().catch(e=>{el('status').textContent=e.message;enabled(false);});
