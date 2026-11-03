import {mountClaims} from './claims.js';
import {mountDiscovery} from './discover.js';
import {assess} from './assessment.js';
import {fetchMarket} from './market.js';
import {resolveInput} from './input.js';
import {scan,networks,rpc,qwenSummary} from './scan.js';
import {enrich} from './intelligence.js';
import coverage from './coverage.json';
import notes from './rule-notes.json';
const $=s=>document.querySelector(s);
const form=$('#form'),address=$('#address'),network=$('#network'),submit=$('#submit'),status=$('#status'),report=$('#report'),idle=$('#idle');
function el(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n}
function facts(items){const list=el('dl',null,'facts');for(const [key,value] of items){const pair=el('div');pair.append(el('dt',key),el('dd',String(value)));list.append(pair)}return list}
function external(label,url){const a=el('a',label+' ↗','address break');a.href=url;a.rel='noreferrer';a.target='_blank';return a;}
function summaryPanel(r){
  const panel=el('section',null,'note-panel');panel.append(el('h3','Qwen explanation'));
  const hits=r.rules.filter(x=>x.status==='Reproduced').length,untested=r.rules.filter(x=>x.status==='Untested');
  const line=el('p',coverage[hits+'/'+untested.length]);
  const source=el('small','Qwen3.5-2B · precomputed coverage wording','source');
  panel.append(line,source);
  for(const x of r.rules.filter(x=>x.status!=='Untested'))panel.append(el('p',x.title+' — '+notes[x.key][x.status==='Reproduced'?1:0]+' '+x.detail));
  const reasons=new Map();for(const x of untested){const list=reasons.get(x.detail)||[];list.push(x.title);reasons.set(x.detail,list);}
  for(const [why,names] of reasons)panel.append(el('p','Untested: '+names.join(', ')+'. '+why));
  qwenSummary(r).then(note=>{if(note&&panel.isConnected){line.textContent=note.text;source.textContent='Qwen3.5-2B · '+note.source;}}).catch(()=>{});
  return panel;
}
function intelPanel(r,lookup){
  const panel=el('section',null,'intel');panel.append(el('h3','Deployer and previous launches'),el('p','Reading the creation receipt and explorer history…'));
  lookup.then(({origin:o,token:t})=>{
    if(!panel.isConnected)return;
    panel.replaceChildren(el('h3','Deployer and previous launches'));
    if(o){
      panel.append(facts([['Creation block',o.block.toLocaleString()],['Deployment path',o.direct?'Direct contract creation':'Factory or internal creation · explorer attribution'],['Creating account',o.creator+' · '+o.creatorKind],['Transaction sender',o.wallet],['Sender balance at scan block',o.balance!==null?o.balance+' ETH':'Unavailable'],['Sender nonce at scan block',o.nonce??'Unavailable']]));
      panel.append(external('Creation receipt',r.explorer+'/tx/'+o.tx),document.createTextNode(' · '),external('Sender history',r.explorer+'/address/'+o.wallet));
      const h=o.history;panel.append(el('p','Prior activity reviewed: '+(h.direct??'unavailable')+' wallet transactions and '+(h.internal??'unavailable')+' creator traces (up to 50 each). Same-transaction siblings are excluded. Factory creations may belong to other users.'));
      if(h.items.length){const list=el('ul');for(const x of h.items){const li=el('li',null,'break');li.append(external(x.address,r.explorer+'/address/'+x.address),document.createTextNode(' · '+x.kind+' · '),external('block '+x.block.toLocaleString(),r.explorer+'/tx/'+x.tx));list.append(li);}panel.append(list)}
      else panel.append(el('p',h.direct===null&&h.internal===null?'Previous deployment history unavailable.':'No earlier creation was identified in the returned history.'));
    }else panel.append(el('p','Creation attribution unavailable. Previous deployments cannot be attributed to a wallet for this scan.'));
    if(r.erc20){
      panel.append(el('h3','ERC-20 coin checks'),facts([['Explorer holder count',t?.holders??'Unavailable'],['Explorer-listed top holders',t?.top? t.top+' across '+t.count+' accounts':'Unavailable'],['Deployment sender’s share',t?.walletShare??'Unavailable'],['Deployment sender’s token balance',t?.walletUnits??'Unavailable']]),el('p','Holder rankings are from the explorer at lookup time. Balances and supply are read at the scan block. Contract and pool accounts may be included.'));
      const b=o?.bundle;panel.append(el('h3','Launch and bundling'),el('p','Private bundle status: unknown. Public transfers alone cannot establish a private bundle or common wallet ownership.'));
      if(b?.transactions!=null){
        panel.append(facts([['Launch-block transfer transactions',b.transactions],['Distinct recipients',b.recipients],['Most recipients in one transaction',b.maxRecipients]]));
        if(b.tx)panel.append(external('Inspect distribution transaction',r.explorer+'/tx/'+b.tx));
      }else panel.append(el('p','Launch-block transfer evidence unavailable.'));
      if(b?.early){const e=b.early;panel.append(facts([['Early blocks examined',e.origin.toLocaleString()+' – '+e.end.toLocaleString()],['Transfer receipts sampled',e.checked+' of '+e.eligible],['Swap-linked transactions',e.matches],['Distinct swap transaction senders',e.wallets],['Most swap transactions in one block',e.max]]),el('p','A match requires a recognized swap event from an address involved in the token transfer. Same-block swaps are a public signal; relay membership is unknown.'));if(e.example)panel.append(external('Example swap receipt',r.explorer+'/tx/'+e.example));}
    }
  }).catch(()=>{if(panel.isConnected)panel.replaceChildren(el('h3','Deployer and token checks'),el('p','Chain or explorer evidence unavailable. Run the scan again.'));});
  return panel;
}
function contractPanel(r){
  const body=el('section');
  if(r.overview.fields.length)body.append(el('h3','Contract state'),facts(r.overview.fields));
  if(r.overview.controls.length){
    const panel=el('details'),methods=el('ul');for(const name of r.overview.controls)methods.append(el('li',name,'break'));
    panel.append(el('summary','Control methods in verified ABI ('+r.overview.controls.length+')'),el('p','These methods change contract state. Their names alone do not establish who can call them.'),methods);body.append(panel);
  }
  body.append(el('h3','Behavior checks'));
  for(const rule of r.rules){
    const row=el('details'),summary=el('summary',rule.title);summary.append(el('span',rule.status,'badge'+(rule.status==='Reproduced'?' hit':'')));
    row.open=rule.status==='Reproduced';row.append(summary,el('p',rule.detail));if(rule.evidence.length)row.append(facts([['Evidence source',rule.scope],...rule.evidence]));body.append(row);
  }
  body.append(el('h3','Deployment evidence'),facts([['RH chain ID',networks[r.network].chain],['Deployed code size',r.size.toLocaleString()+' bytes'],['Runtime hash · keccak256',r.hash],['Block hash',r.blockHash],['Explorer source',r.verified?'Verified runtime match':'Verified metadata unavailable'],['Implementation',r.proxy?r.proxy.kind+' · '+r.proxy.address:r.proxyError?'Resolution unavailable':'No standard proxy target found']]));
  if(r.proxy)body.append(facts([['Implementation code hash',r.logicHash]]));
  const op=el('details');op.append(el('summary','Bytecode observations'),el('p','Counts from ICP disassembly of '+(r.proxy?'implementation':'deployed')+' code. An opcode can be unreachable or used legitimately.'),facts(r.indicators.map(v=>[v.label,v.count])));
    body.append(op);return body;
}
function action(label,fn){
  const button=el('button',label,'utility');button.type='button';button.onclick=fn;return button;
}
const listKey='gh0st-watch:watchlist:v1';
function readSaved(){
  try{const saved=JSON.parse(localStorage.getItem(listKey)||'[]');return Array.isArray(saved)?saved.filter(x=>x&&Object.hasOwn(networks,x.network)&&/^0x[0-9a-f]{40}$/i.test(x.address)&&typeof x.name==='string').slice(0,80):[]}catch{return []}
}
function isSame(a,b){return a.network===b.network&&a.address.toLowerCase()===b.address.toLowerCase()}
function toggleSaved(coin){
  const list=readSaved(),has=list.some(x=>isSame(x,coin));
  try{
    if(!has&&list.length>=80)throw Error('Your watchlist is full. Remove one coin before adding another.');
    localStorage.setItem(listKey,JSON.stringify(has?list.filter(x=>!isSame(x,coin)):[coin,...list]));drawSaved();
  }catch(e){status.textContent=e.name==='Error'?e.message:'Watchlist storage is unavailable in this browser.'}
}
let activeCoin=null,saveButton=null;
function drawSaved(){
  const panel=$('#watchlist'),saved=readSaved();panel.replaceChildren(el('h2','Watchlist'));
  if(!saved.length)panel.append(el('p','Save a coin from its report to check it again here.'));
  for(const coin of saved){
    const row=el('div',null,'saved-row');row.append(action(coin.name+' · '+networks[coin.network].label,()=>openCoin(coin.address,coin.network)),el('code',coin.address.slice(0,8)+'…'+coin.address.slice(-6)),action('Remove',()=>toggleSaved(coin)));panel.append(row);
  }
  if(activeCoin&&saveButton){const has=saved.some(x=>isSame(x,activeCoin));saveButton.textContent=has?'★ Saved':'☆ Watch';saveButton.setAttribute('aria-pressed',String(has))}
}
window.addEventListener('storage',e=>{if(e.key===listKey)drawSaved()});
function marketPanel(market){
  const panel=el('section');panel.append(el('p','Looking up RH trading pools…'));
  market.then(m=>{
    panel.replaceChildren(el('h3','Market snapshot'));
    if(!m.available){panel.append(el('p',m.reason));return}
    const usd=v=>v==null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumSignificantDigits:5}).format(v);
    const pct=v=>v==null?'Unavailable':(v>0?'+':'')+v+'%';
    panel.append(el('p',m.baseSymbol+' / '+m.quoteSymbol+' · '+m.dex+' · deepest indexed base-token pool'),facts([['Spot price',usd(m.priceUsd)],['Pool liquidity',usd(m.liquidityUsd)],['24h volume',usd(m.volume24h)],['1h change',pct(m.change1h)],['24h change',pct(m.change24h)],['Buys / sells · 24h',(m.buys24h??'—')+' / '+(m.sells24h??'—')],['Market cap',usd(m.marketCap)],['Indexed base-token pools',m.poolCount]]),external('View pool on DexScreener',m.url),el('small','Retrieved '+new Date(m.asOf).toUTCString(),'source'));
    if(m.links.length){panel.append(el('h3','Project-listed links'),el('p','These links come from pool metadata. Anyone reviewing project identity should corroborate them independently.'));for(const l of m.links)panel.append(external(l.label,l.url),document.createTextNode(' '))}
  }).catch(()=>panel.replaceChildren(el('p','Market data unavailable.')));
  return panel;
}
function readPanel(r,intel,market,trace){
  const panel=el('section'),overview=el('div',null,'readout');
  function update(data){
    const read=assess(r,data);overview.replaceChildren(el('div','WATCH READ','eyebrow'),el('h3',read.title),el('p',read.description));
    const cards=el('div',null,'signal-cards');
    for(const item of read.items){const tile=el('div',null,'signal '+item.tone);tile.append(el('small',item.label),el('strong',item.value),el('p',item.detail));cards.append(tile)}overview.append(cards);
  }
  update();intel.then(update).catch(()=>update(null));
  const quote=el('div',null,'quote-strip');quote.textContent='Checking market data…';
  market.then(m=>{
    if(!m.available){quote.textContent=m.reason;return}
    const price=m.priceUsd==null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumSignificantDigits:5}).format(m.priceUsd);
    quote.replaceChildren(el('small','DEEPEST INDEXED POOL'),el('strong',m.baseSymbol+' / '+m.quoteSymbol),el('span',price),el('span','24h '+(m.change24h==null?'unavailable':(m.change24h>0?'+':'')+m.change24h+'%')));
  }).catch(()=>quote.textContent='Market data unavailable.');
  const log=el('details');log.append(el('summary','Scan trace'));const list=el('ol');
  for(const step of trace)list.append(el('li',step));log.append(list);
  panel.append(overview,quote,summaryPanel(r),log);return panel;
}
function render(r,trace){
  const symbol=r.overview.fields.find(([k])=>k==='Symbol')?.[1],name=r.overview.fields.find(([k])=>k==='Name')?.[1]||r.name||'RH contract';
  activeCoin={address:r.address,network:r.network,name:String(symbol||name).slice(0,90)};
  report.replaceChildren();report.hidden=false;
  const head=el('div',null,'strip');head.append(el('span','COIN REPORT'),el('span','RH '+networks[r.network].label.toUpperCase()+' / '+r.block.toLocaleString()));
  const body=el('div',null,'body'),hero=el('div',null,'token-head'),identity=el('div'),actions=el('div',null,'report-actions');
  identity.append(el('h2',name),external(r.address,r.explorer+'/address/'+r.address));
  const share=action('Copy scan link',async()=>{try{await navigator.clipboard.writeText(location.href);share.textContent='Copied'}catch{status.textContent='Copy the URL from your address bar to share this scan.'}});
  saveButton=action('☆ Watch',()=>toggleSaved(activeCoin));actions.append(saveButton,share);hero.append(identity,actions);body.append(hero);
  const intel=enrich(networks[r.network],r,rpc),market=fetchMarket(r.network,r.address);
  const claims=el('section');mountClaims(claims,r);
  const views=[['Overview',readPanel(r,intel,market,trace)],['Contract',contractPanel(r)],['Deployer & holders',intelPanel(r,intel)],['Market',marketPanel(market)],['Claims',claims]];
  const nav=el('div',null,'report-nav');nav.setAttribute('role','group');nav.setAttribute('aria-label','Report sections');
  function choose(index){
    views.forEach(([,panel],i)=>{panel.hidden=i!==index;nav.children[i].setAttribute('aria-pressed',String(i===index));});
  }
  views.forEach(([label,panel],i)=>{nav.append(action(label,()=>choose(i)));panel.classList.add('report-page')});
  body.append(nav,...views.map(x=>x[1]));report.append(head,body);choose(0);drawSaved();report.scrollIntoView({block:'start'});
}
async function analyze(){
  if(submit.disabled)return;submit.disabled=true;network.disabled=true;address.readOnly=true;$('#example').disabled=true;
  report.hidden=true;idle.hidden=false;
  const started=performance.now(),trace=[];
  const step=text=>{status.textContent=text;trace.push(((performance.now()-started)/1000).toFixed(1)+'s · '+text)};
  try{step('Resolving coin…');const input=await resolveInput(address.value,network.value);if(network.value!==input.network){network.value=input.network;refreshDiscovery()}address.value=input.address;const r=await scan(input.network,input.address,step);step('RH block hash rechecked. Behavior results ready.');render(r,trace);status.textContent='';const url=new URL(location.href);url.search=new URLSearchParams({network:r.network,address:r.address});history.replaceState(null,'',url)}
  catch(e){status.textContent=e.message||'Analysis could not finish. Please retry.';}
  finally{submit.disabled=false;network.disabled=false;address.readOnly=false;$('#example').disabled=false}
}
form.addEventListener('submit',e=>{e.preventDefault();analyze()});
$('#example').onclick=()=>{address.value=networks[network.value].example;analyze()};
function openCoin(contract,key){if(submit.disabled)return;const changed=network.value!==key;network.value=key;if(changed)refreshDiscovery();address.value=contract;analyze()}
function reset(){activeCoin=null;saveButton=null;report.hidden=true;idle.hidden=false;status.textContent='';history.replaceState(null,'',location.pathname)}
address.addEventListener('input',reset);network.addEventListener('change',()=>{reset();refreshDiscovery()});
const params=new URLSearchParams(location.search);
if(Object.hasOwn(networks,params.get('network')))network.value=params.get('network');
const refreshDiscovery=mountDiscovery($('#discovery'),{getNetwork:()=>network.value,onSelect:a=>openCoin(a,network.value)});drawSaved();
if(params.get('address')){address.value=params.get('address');analyze()}
