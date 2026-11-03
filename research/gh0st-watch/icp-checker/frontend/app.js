import {scoreReport,mountScore} from './score.js';
import {mountBundles} from './bundles.js';
import {mountTimeMachine} from './time-machine.js';
import {compass} from './compass.js';
import {mountClaims} from './claims.js';
import {mountDiscovery} from './discover.js';
import {assess} from './assessment.js';
import {fetchMarket} from './market.js';
import {resolveInput} from './input.js';
import {isPlatformToken} from './platform-token.js';
import {createRecentScans, RECENTS_KEY} from './recent-scans.js';
import {scan,networks,rpc,qwenSummary} from './scan.js';
import {enrich} from './intelligence.js';
import coverage from './coverage.json';
import notes from './rule-notes.json';
const $=s=>document.querySelector(s);
const form=$('#form'),address=$('#address'),network=$('#network'),submit=$('#submit'),status=$('#status'),report=$('#report'),idle=$('#idle');
function el(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n}
function facts(items){const list=el('dl',null,'facts');for(const [key,value] of items){const pair=el('div');pair.append(el('dt',key),el('dd',String(value)));list.append(pair)}return list}
function external(label,url){
  let target;try{target=new URL(url)}catch{}
  if(!target||!['http:','https:'].includes(target.protocol)||target.username||target.password)return el('span',label,'break');
  const a=el('a',label+' ↗','address break');a.href=target.href;a.rel='noreferrer';a.target='_blank';return a;
}
function summaryPanel(r,explanation){
  const panel=el('section',null,'note-panel');panel.append(el('h3','Qwen explanation'));
  const hits=r.rules.filter(x=>x.status==='Reproduced').length,untested=r.rules.filter(x=>x.status==='Untested');
  const line=el('p',coverage[hits+'/'+untested.length]);
  const source=el('small','Qwen3.5-2B · precomputed coverage wording','source');
  panel.append(line,source);
  for(const x of r.rules.filter(x=>x.status!=='Untested'))panel.append(el('p',x.title+' — '+notes[x.key][x.status==='Reproduced'?1:0]+' '+x.detail));
  const reasons=new Map();for(const x of untested){const list=reasons.get(x.detail)||[];list.push(x.title);reasons.set(x.detail,list);}
  for(const [why,names] of reasons)panel.append(el('p','Untested: '+names.join(', ')+'. '+why));
  explanation.then(note=>{if(note&&panel.isConnected){line.textContent=note.text;source.textContent='Qwen3.5-2B · '+note.source;}}).catch(()=>{});
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
const recentScans=createRecentScans();
function drawRecent(){
  const panel=$('#recent-list'),entries=recentScans.list();
  panel.replaceChildren();
  if(!entries.length){panel.append(el('li','Coins you open will appear here.','recent-empty'));return}
  for(const entry of entries){
    const row=el('li'),button=action('',()=>openCoin(entry.address,entry.network));
    button.className='recent-item';
    button.title=entry.address;
    button.append(el('strong',entry.name),el('span','RH '+networks[entry.network].label+' · '+entry.address.slice(0,8)+'…'+entry.address.slice(-6)),
      el('small',entry.report?'Scanned '+new Date(entry.scannedAt).toLocaleString():'Platform token'));
    row.append(button);panel.append(row);
  }
}
window.addEventListener('storage',e=>{if(!e.key||e.key===listKey)drawSaved();if(!e.key||e.key===RECENTS_KEY)drawRecent()});
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
function readPanel(r,intel,market,trace,explanation){
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
  panel.append(overview,quote,summaryPanel(r,explanation),log);return panel;
}
function reportHeader(coin,title,label,context){
  activeCoin=coin;
  report.replaceChildren();report.hidden=false;
  const head=el('div',null,'strip');head.append(el('span',label),el('span',context));
  const body=el('div',null,'body'),hero=el('div',null,'token-head'),identity=el('div'),actions=el('div',null,'report-actions');
  identity.append(el('h2',title),external(coin.address,networks[coin.network].explorer+'/address/'+coin.address));
  const share=action('Copy scan link',async()=>{try{await navigator.clipboard.writeText(location.href);share.textContent='Copied'}catch{status.textContent='Copy the URL from your address bar to share this scan.'}});
  saveButton=action('☆ Watch',()=>toggleSaved(activeCoin));actions.append(saveButton,share);hero.append(identity,actions);body.append(hero);
  report.append(head,body);drawSaved();
  return body;
}
function showPlatformToken(input){
  reportHeader({...input,name:'GH0ST'},'We own and trust this token.','GH0ST · PLATFORM TOKEN','ROBINHOOD MAINNET');
  const url=new URL(location.href);url.hash='';url.search=new URLSearchParams(input);
  history.replaceState(null,'',url);idle.hidden=true;report.scrollIntoView({block:'start'});
}
function identityOf(r){
  const symbol=r.overview.fields.find(([k])=>k==='Symbol')?.[1],name=r.overview.fields.find(([k])=>k==='Name')?.[1]||r.name||'RH contract';
  return {name,coin:{address:r.address,network:r.network,name:String(symbol||name).slice(0,90)}};
}
const pendingDetails=new Map();
function reportDetails(r,entry,reused){
  const key=r.network+'/'+r.address.toLowerCase();
  const pending=pendingDetails.get(key);
  if(reused){
    if(pending && pending.scannedAt===entry.scannedAt && pending.blockHash===r.blockHash)return pending.sources;
    const saved=entry.details||{};
    return {
      intel:Promise.resolve(saved.intel??null),
      market:Promise.resolve(saved.market??{available:false,reason:'Market data was unavailable in this saved scan.'}),
      note:Promise.resolve(saved.note??null),
    };
  }
  function capture(field,promise,fallback){
    return promise.catch(()=>fallback).then(value=>{
      if(entry)recentScans.attach(r.network,r.address,r.blockHash,{[field]:value},entry.scannedAt);
      return value;
    });
  }
  const sources={
    intel:capture('intel',enrich(networks[r.network],r,rpc),null),
    market:capture('market',fetchMarket(r.network,r.address),{available:false,reason:'Market data unavailable.'}),
    note:capture('note',qwenSummary(r),null),
  };
  const generation={sources,scannedAt:entry?.scannedAt,blockHash:r.blockHash};
  pendingDetails.set(key,generation);
  Promise.allSettled(Object.values(sources)).then(()=>{if(pendingDetails.get(key)===generation)pendingDetails.delete(key)});
  return sources;
}
function render(r,trace,initialView,entry,reused){
  const {name,coin}=identityOf(r);
  const body=reportHeader(coin,name,'COIN REPORT','RH '+networks[r.network].label.toUpperCase()+' / '+r.block.toLocaleString());
  const scanBar=el('div',null,'scan-origin');
  const scannedAt=entry?.scannedAt??Date.now();
  scanBar.append(el('span',(reused?'Saved scan':'Scanned')+' · '+new Date(scannedAt).toLocaleString()+' · Block '+r.block.toLocaleString()),
    action('Scan again',()=>analyze(new URL(location.href).searchParams.get('view'),true)));
  body.append(scanBar);
  const {intel,market,note}=reportDetails(r,entry,reused);
  const claims=el('section');mountClaims(claims,r);
  const score=el('section'),bundles=el('section'),timeline=el('section');
  const brief=readPanel(r,intel,market,trace,note),scorePreview=el('div',null,'score-preview');
  scorePreview.textContent='Reading evidence for the concern index…';brief.prepend(scorePreview);
  score.append(el('p','Calculating the measured score and coverage…'));
  bundles.append(el('p','Inspecting launch receipts…'));
  function showInstruments(data){
    mountScore(score,r,data);
    const measured=scoreReport(r,data);
    score.prepend(compass(measured));
    mountBundles(bundles,r,data);
    const caption=el('div');caption.append(el('div','CONCERN INDEX','eyebrow'),el('p',measured.coverage+'% of the rubric measured · higher means more observed concern'));
    scorePreview.replaceChildren(el('strong',measured.score==null?'—':measured.score+' / 100'),caption,action('Explore score →',()=>choose(1)));
  }
  intel.then(showInstruments,()=>showInstruments(null));
  mountTimeMachine(timeline,r,intel,{observed:scannedAt,reused});
  const views=[['Overview',brief],['Score',score],['Bundles',bundles],['Time machine',timeline],['Contract',contractPanel(r)],['Deployer & holders',intelPanel(r,intel)],['Market',marketPanel(market)],['Claims',claims]];
  const nav=el('div',null,'report-nav');nav.setAttribute('role','group');nav.setAttribute('aria-label','Report sections');
  function choose(index){
    const url=new URL(location.href);url.hash='';url.search=new URLSearchParams({network:r.network,address:r.address});
    if(index>0)url.searchParams.set('view',views[index][0]);history.replaceState(null,'',url);

    views.forEach(([,panel],i)=>{panel.hidden=i!==index;nav.children[i].setAttribute('aria-pressed',String(i===index));});
  }
  views.forEach(([label,panel],i)=>{nav.append(action(label,()=>choose(i)));panel.classList.add('report-page')});
  body.append(nav,...views.map(x=>x[1]));choose(Math.max(0,views.findIndex(([label])=>label===initialView)));report.scrollIntoView({block:'start'});
}
async function analyze(initialView,force=false){
  if(submit.disabled)return;submit.disabled=true;network.disabled=true;address.readOnly=true;$('#example').disabled=true;
  if(!force)report.hidden=true;idle.hidden=false;
  const started=performance.now(),trace=[];
  const step=text=>{status.textContent=text;trace.push(((performance.now()-started)/1000).toFixed(1)+'s · '+text)};
  try{
    step('Resolving coin…');
    const input=await resolveInput(address.value,network.value);
    if(network.value!==input.network){network.value=input.network;refreshDiscovery()}
    address.value=input.address;
    if(isPlatformToken(input.network,input.address)){
      showPlatformToken(input);
      if(!recentScans.touch(input.network,input.address))recentScans.save({...input,name:'GH0ST',report:null,trace:[]});
    }else{
      async function openReport(){
        const existing=recentScans.get(input.network,input.address);
        if(existing?.report && !force){
          recentScans.touch(input.network,input.address);
          render(existing.report,existing.trace,initialView,existing,true);
          return;
        }
        const r=await scan(input.network,input.address,step);
        step('RH block hash rechecked. Behavior results ready.');
        const entry=recentScans.save({...identityOf(r).coin,report:r,trace});
        render(r,trace,initialView,entry,false);
      }
      if(navigator.locks)await navigator.locks.request('gh0st-watch:scan:'+input.network+':'+input.address.toLowerCase(),openReport);
      else await openReport();
    }
    drawRecent();
    status.textContent='';
  }
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
const refreshDiscovery=mountDiscovery($('#discovery'),{getNetwork:()=>network.value,onSelect:a=>openCoin(a,network.value)});drawSaved();drawRecent();
for(const button of document.querySelectorAll('[data-instrument]')){
  button.onclick=()=>{if(!address.value.trim())address.value=networks[network.value].example;analyze(button.dataset.instrument)};
}
if(params.get('address')){address.value=params.get('address');analyze(params.get('view'))}
