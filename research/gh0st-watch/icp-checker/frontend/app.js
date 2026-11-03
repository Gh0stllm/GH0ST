import {scan,networks} from './scan.js';
const $=s=>document.querySelector(s);
const form=$('#form'),address=$('#address'),network=$('#network'),submit=$('#submit'),status=$('#status'),report=$('#report'),idle=$('#idle');
function el(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n}
function facts(items){const list=el('dl',null,'facts');for(const [key,value] of items){const pair=el('div');pair.append(el('dt',key),el('dd',String(value)));list.append(pair)}return list}
function render(r){
  report.replaceChildren();idle.hidden=true;report.hidden=false;
  const bar=el('div',null,'strip');bar.append(el('span','02 / ANALYSIS'),el('span',networks[r.network].label.toUpperCase()));
  const body=el('div',null,'body'),link=el('a',r.address+' ↗','address break');link.href=r.explorer+'/address/'+r.address;link.target='_blank';link.rel='noreferrer';
  body.append(el('h2',r.name||'Contract report'),link);
  const counts=el('div',null,'counts');for(const label of ['Reproduced','Not reproduced','Untested']){
    const n=el('div');n.append(el('strong',r.rules.filter(x=>x.status===label).length),el('span',label));counts.append(n)}
  body.append(counts,el('p','Behavior at RH block '+r.block.toLocaleString()+'. Each result identifies the state and inputs used. Untested rules remain open.'));
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
