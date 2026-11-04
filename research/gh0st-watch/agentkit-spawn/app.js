import {listKeys,newKey,identityFor,renameKey,exportBackup,importBackup} from './keys.js';
import {principal,registry,unwrap} from './registry.js';
import {buildConfig,roles,toolNames} from './config.mjs';

const by=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const action=(text,fn)=>{const b=node('button',text,'outline');b.type='button';b.onclick=fn;return b;};
const link=(text,href)=>{const a=node('a',text);a.href=href;return a;};
const pretty=s=>s[0].toUpperCase()+s.slice(1);
const time=value=>new Date(Number(value)).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const targetUrl=id=>'/agentkit/spawn/?'+new URLSearchParams({id});
const watchUrl=a=>'/watcher/?'+new URLSearchParams({network:'mainnet',address:a});
let id=null,project=null,keys=[],creatingKey=null,publicAPI=null,locked=false;
const api=()=>publicAPI??=registry().catch(e=>{publicAPI=null;throw e;});
function notice(text){by('status').textContent=text;by('status').hidden=!text;}
function message(error){
  const m=String(error?.message||'Please try again.');
  if(/replica|IC0|repl[iy]|certificate|fetch|request failed|gateway|timeout/i.test(m)&&m.length>200)return 'The ICP request could not be confirmed. Refresh this profile before trying again.';
  return m.length>240?m.slice(0,240)+'…':m;
}
async function work(pending,fn){
  if(locked)return;
  locked=true;for(const el of document.querySelectorAll('#publish,#run,#edit,#refresh,#cancel-edit'))el.disabled=true;
  notice(pending);
  try{await fn();}
  catch(e){notice(message(e));by('status').scrollIntoView({block:'nearest'});}
  finally{locked=false;for(const el of document.querySelectorAll('#publish,#edit,#refresh,#cancel-edit'))el.disabled=false;by('run').disabled=!by('run-address').value;}
}
const hasKey=()=>keys.some(k=>k.id===id);
function drawKeys(){
  const host=by('keys');host.replaceChildren();
  if(!keys.length){host.append(node('p','No owner keys saved on this device.','hint'));return;}
  for(const k of keys){
    const r=node('div',null,'key-row');const open=link(k.label||'Open agent',targetUrl(k.id));
    r.append(open,node('small',k.id.slice(0,9)+'…'+k.id.slice(-3),'hint'),action('Export backup',()=>work('Preparing encrypted backup…',async()=>{
      const payload=await exportBackup(k.id,by('passphrase').value);
      const url=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:'application/json'}));
      const a=link('Download backup',url);a.download='gh0st-owner-'+k.id.slice(0,8)+'.json';document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);by('passphrase').value='';
      notice('Encrypted owner backup exported. Keep the file and passphrase separately.');
    })));host.append(r);
  }
}
async function readKeys(){
  try{keys=await listKeys();drawKeys();}
  catch{keys=[];by('keys').replaceChildren(node('p','Owner storage is unavailable in this browser. Public profiles can still be read.','hint'));}
}
function formFrom(config){
  by('agent-name').value=config.name;by('watch').value=config.addresses.join('\n');by('cap').value=config.daily_cap;
  for(const input of document.querySelectorAll('[name="persona"]'))input.checked=input.value===config.personality;
  for(const input of document.querySelectorAll('[name="tool"]'))input.checked=config.tools.includes(input.value);
}
function drawActivity(){
  const panel=by('feed');panel.replaceChildren();
  if(!project.activity.length){panel.append(node('p','No activity yet. The owner can choose a watched contract and run the agent.','sheet'));return;}
  for(const item of project.activity){
    const card=node('article',null,'feed-entry'),head=node('div',null,'feedhead');
    const stamp=node('time',time(item.at));stamp.dateTime=new Date(Number(item.at)).toISOString();
    head.append(node('span','Run '+item.id+' / '+({complete:'Completed',platform:'Platform token',unavailable:'Report unavailable'}[item.status]||item.status)),stamp);
    const lines=node('ul');for(const line of item.lines)lines.append(node('li',line));
    const source=node('p',null,'source');source.textContent=(item.source_at.length?'Source snapshot '+time(item.source_at[0])+' · ':'')+'Fee '+item.fee+' GH0ST';
    card.append(head,lines,source,link(item.status==='unavailable'?'Open contract in Watcher ↗':'View watched contract ↗',watchUrl(item.address)));
    if(item.source_block.length)card.append(link('Block '+item.source_block[0].toLocaleString()+' ↗','https://robinhoodchain.blockscout.com/block/'+item.source_block[0]));
    panel.append(card);
  }
}
function drawProject(){
  by('builder').hidden=true;by('profile').hidden=false;by('activity').hidden=false;
  const c=project.config;
  by('hero-title').replaceChildren(document.createTextNode('Agent '),node('em','profile.'));
  by('hero-copy').textContent='View this agent’s configuration and the observations its owner has published on ICP.';
  by('role-label').textContent=pretty(c.personality).toUpperCase()+' / GH0ST AGENT';
  by('profile-name').textContent=c.name;by('role-copy').textContent=roles[c.personality];
  const dl=by('profile-data');dl.replaceChildren();
  for(const [label,value] of [['Enabled tools',c.tools.map(t=>toolNames[t]).join(' · ')],['Daily spending cap',c.daily_cap.toLocaleString()+' GH0ST'],['Per-run fee','0 GH0ST'],['Created',time(project.created_at)]]){
    const pair=node('div');pair.append(node('dt',label),node('dd',value));dl.append(pair);
  }
  const links=by('contracts');links.replaceChildren(node('p','Watched contracts · Robinhood mainnet','hint'));
  const sel=by('run-address');const selected=sel.value;
  sel.replaceChildren(new Option('Select a contract…',''));
  for(const a of c.addresses){links.append(link(a+' ↗',watchUrl(a)));sel.append(new Option(a,a));}
  if(c.addresses.includes(selected))sel.value=selected;
  by('run').disabled=!sel.value||locked;by('owner-actions').hidden=!hasKey();drawActivity();
  document.title=c.name+' · GH0ST AgentKit';
}
async function loadProfile(){
  notice('Reading the agent registry on ICP…');const [p]=await (await api()).spawn_get(principal(id));
  if(!p){
    if(!hasKey()){notice('No published agent was found for this profile.');return;}
    creatingKey={id,identity:await identityFor(id)};
    by('builder').hidden=false;by('agent-name').value=keys.find(k=>k.id===id).label;
    notice('Your owner key is saved. Complete the blueprint to publish this agent.');return;
  }
  project=p;drawProject();notice('');
}
by('config').onsubmit=e=>{
  e.preventDefault();work(project?'Saving your agent on ICP…':'Creating your agent on ICP…',async()=>{
    const c=buildConfig(by('agent-name').value,document.querySelector('[name="persona"]:checked')?.value,by('watch').value,
      Array.from(document.querySelectorAll('[name="tool"]:checked'),n=>n.value),by('cap').value);
    let identity;
    if(project){identity=await identityFor(id);}
    else{
      if(!creatingKey){creatingKey=await newKey(c.name);await readKeys();}
      id=creatingKey.id;identity=creatingKey.identity;history.replaceState(null,'',targetUrl(id));
    }
    const p=unwrap(await (await registry(identity)).spawn_save(c));
    if(p.owner.toText()!==id)throw Error('The returned profile does not match this owner key.');
    project=p;drawProject();await renameKey(id,c.name).catch(()=>{});await readKeys();
    notice('Agent saved. You can share its profile or choose a contract to run.');by('profile').scrollIntoView({block:'start'});
  });
};
by('edit').onclick=()=>{if(!project||!hasKey())return;formFrom(project.config);by('form-title').textContent='Edit your agent';by('form-caption').textContent='03 / AGENT BLUEPRINT';by('publish').textContent='Save changes ↗';by('cancel-edit').hidden=false;by('builder').hidden=false;by('builder').scrollIntoView({block:'start'});};
by('cancel-edit').onclick=()=>{by('builder').hidden=true;by('profile').scrollIntoView({block:'start'});};
by('run-address').onchange=e=>{by('run').disabled=!e.target.value||locked;};
by('run').onclick=()=>work('Reading the selected report and publishing the agent’s observation…',async()=>{
  const a=by('run-address').value;
  if(!project||!project.config.addresses.includes(a)||!hasKey())throw Error('Choose one of your agent’s watched contracts.');
  const item=unwrap(await (await registry(await identityFor(id))).spawn_run(a));
  project={...project,activity:[item,...project.activity.filter(x=>x.id!==item.id)]};drawActivity();
  notice(item.status==='unavailable'?'No usable saved report was found. Open the Watcher link in this entry to inspect the contract.':'Activity published on ICP.');
  by('activity').scrollIntoView({block:'start'});
});
by('refresh').onclick=()=>work('Refreshing the public feed…',loadProfile);
by('share').onclick=async()=>{const url=new URL(targetUrl(id),location.origin).href;try{await navigator.clipboard.writeText(url);notice('Public profile link copied.');}catch{notice('Share this public profile: '+url);}};
by('key-file').onchange=e=>{const file=e.target.files[0];if(!file)return;
  work('Unlocking backup on this device…',async()=>{
    const imported=await importBackup(file,by('passphrase').value);by('passphrase').value='';await readKeys();
    if(imported.id===id){await loadProfile();}
    if(project)drawProject();
    notice('Owner key imported. Open its profile under your agents and backups.');
  });e.target.value='';
};
async function start(){
  const requested=new URLSearchParams(location.search).get('id');
  if(requested!==null)by('builder').hidden=true;
  await readKeys();
  if(requested===null)return;
  try{id=principal(requested).toText();await loadProfile();}catch(e){notice(message(e));}
}
start();
