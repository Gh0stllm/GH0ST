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
function intelPanel(r){
  const panel=el('section',null,'intel');panel.append(el('h3','Deployer and previous launches'),el('p','Reading the creation receipt and explorer history…'));
  enrich(networks[r.network],r,rpc).then(({origin:o,token:t})=>{
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
function render(r){
  report.replaceChildren();idle.hidden=true;report.hidden=false;
  const bar=el('div',null,'strip');bar.append(el('span','02 / ANALYSIS'),el('span',networks[r.network].label.toUpperCase()));
  const body=el('div',null,'body'),link=el('a',r.address+' ↗','address break');link.href=r.explorer+'/address/'+r.address;link.target='_blank';link.rel='noreferrer';
  body.append(el('h2',r.name||'Contract report'),link);
  const counts=el('div',null,'counts');for(const label of ['Reproduced','Not reproduced','Untested']){
    const n=el('div');n.append(el('strong',r.rules.filter(x=>x.status===label).length),el('span',label));counts.append(n)}
  body.append(counts,el('p','Behavior at RH block '+r.block.toLocaleString()+'. Each result identifies the state and inputs used. Untested rules remain open.'));
  body.append(summaryPanel(r));
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
  body.append(intelPanel(r));
  body.append(el('h3','Deployment evidence'),facts([['RH chain ID',networks[r.network].chain],['Deployed code size',r.size.toLocaleString()+' bytes'],['Runtime hash · keccak256',r.hash],['Block hash',r.blockHash],['Explorer source',r.verified?'Verified runtime match':'Verified metadata unavailable'],['Implementation',r.proxy?r.proxy.kind+' · '+r.proxy.address:r.proxyError?'Resolution unavailable':'No standard proxy target found']]));
  if(r.proxy)body.append(facts([['Implementation code hash',r.logicHash]]));
  const op=el('details');op.append(el('summary','Bytecode observations'),el('p','Counts from ICP disassembly of '+(r.proxy?'implementation':'deployed')+' code. An opcode can be unreachable or used legitimately.'),facts(r.indicators.map(v=>[v.label,v.count])));
  body.append(op);report.append(bar,body);
}
async function analyze(){
  if(submit.disabled)return;submit.disabled=true;network.disabled=true;address.readOnly=true;$('#example').disabled=true;
  report.hidden=true;idle.hidden=false;
  try{const r=await scan(network.value,address.value,msg=>status.textContent=msg);render(r);status.textContent='';const url=new URL(location.href);url.search=new URLSearchParams({network:r.network,address:r.address});history.replaceState(null,'',url)}
  catch(e){status.textContent=e.message||'Analysis could not finish. Please retry.';}
  finally{submit.disabled=false;network.disabled=false;address.readOnly=false;$('#example').disabled=false}
}
form.addEventListener('submit',e=>{e.preventDefault();analyze()});
$('#example').onclick=()=>{address.value=networks[network.value].example;analyze()};
function reset(){report.hidden=true;idle.hidden=false;status.textContent='';history.replaceState(null,'',location.pathname)}
address.addEventListener('input',reset);network.addEventListener('change',reset);
const params=new URLSearchParams(location.search);
if(Object.hasOwn(networks,params.get('network')))network.value=params.get('network');
if(params.get('address')){address.value=params.get('address');analyze()}
