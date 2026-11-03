// The timeline records real, successful local scans. It does not invent past RH state.
const STORE = 'gh0st-watch:evidence-history:v1';
const RULES = [
  ['mint','Mint'], ['underflow','Underflow'], ['withdraw','Reentry'],
  ['authorization','Origin payment'], ['replay','Replay'], ['token','Transfer credit'],
];
const LABELS = ['Not reproduced','Reproduced','Untested'];
const GROUP_SIZE = 12, MAX_GROUPS = 24;
const addressRE = /^0x[0-9a-f]{40}$/i, hashRE = /^0x[0-9a-f]{64}$/i;
const sameCoin = (a,b) => a.network === b.network && a.address === b.address;
const known = value => value !== null && value !== undefined;
const safeText = v => typeof v === 'string' ? v.slice(0,200) : null;
const hash = v => hashRE.test(v) ? v.toLowerCase() : null;
const address = v => addressRE.test(v) ? v.toLowerCase() : null;
function fraction(v) {
  if (typeof v !== 'string' || !/^\d{1,3}(?:\.\d+)?%$/.test(v)) return null;
  const n = Number(v.slice(0,-1));
  return n >= 0 && n <= 100 ? n : null;
}

export function evidenceSnapshot(report, intel, observed = Date.now()) {
  if (!report || !['mainnet','testnet'].includes(report.network) || !address(report.address)
      || !hash(report.blockHash) || !hash(report.hash) || !Number.isSafeInteger(report.block) || report.block < 0) return null;
  const fields = new Map(report.overview?.fields || []);
  const risks = new Map((report.rules || []).map(rule => [rule.key,rule.status]));
  const count = intel?.token?.count, top = fraction(intel?.token?.top);
  return {
    network:report.network, address:address(report.address), block:report.block, blockHash:hash(report.blockHash), observed,
    code:hash(report.hash), implementation:report.proxyError ? null : report.proxy ? address(report.proxy.address) : 'No standard proxy identified',
    logic:report.proxyError ? null : hash(report.logicHash), owner:address(fields.get('Owner getter')),
    paused:['True','False'].includes(fields.get('Paused getter')) ? fields.get('Paused getter') : null,
    controlMethods:report.verified && Array.isArray(report.overview?.controls) ? [...new Set(report.overview.controls.map(safeText).filter(Boolean))].sort().slice(0,128) : null,
    top:known(top) && Number.isInteger(count) && count > 0 && count <= 10 ? top : null,
    topCount:known(top) && Number.isInteger(count) && count > 0 && count <= 10 ? count : null,
    rules:RULES.map(([key])=> LABELS.includes(risks.get(key)) ? risks.get(key) : null),
  };
}

function valid(s) {
  return s && ['mainnet','testnet'].includes(s.network) && address(s.address)===s.address && !!s.address &&
    !!hash(s.blockHash) && !!hash(s.code) && Number.isSafeInteger(s.block) && s.block>=0 && Number.isSafeInteger(s.observed) &&
    Array.isArray(s.rules) && s.rules.length===RULES.length && s.rules.every(x=>x===null||LABELS.includes(x)) &&
    (s.controlMethods===null || Array.isArray(s.controlMethods)&&s.controlMethods.length<=128&&s.controlMethods.every(x=>typeof x==='string'&&x.length<=200));
}

export function saveObservation(history, current) {
  const rows = history.filter(valid);
  if (!valid(current)) return rows;
  const match = rows.find(s=>sameCoin(s,current) && s.block===current.block);
  if (match && match.observed > current.observed) return rows;
  const reorg = match && match.blockHash !== current.blockHash;
  // If enrichment failed on a repeat observation at the exact same block,
  // retain the prior pin's holder share instead of erasing it.
  if (match && !reorg && !known(current.top) && known(match.top)) {
    current={...current,top:match.top,topCount:match.topCount};
  }
  const keep = rows.filter(s=>!sameCoin(s,current) || (reorg ? s.block < current.block : s.block !== current.block));
  const groups = new Map();
  for (const s of [current,...keep].sort((a,b)=>b.observed-a.observed)) {
    const key = s.network+'/'+s.address;
    if (!groups.has(key)) {
      if (groups.size >= MAX_GROUPS) continue;
      groups.set(key,[]);
    }
    groups.get(key).push(s);
  }
  return Array.from(groups.values()).flatMap(g=>g.sort((a,b)=>b.block-a.block).slice(0,GROUP_SIZE));
}
const blockLabel = n => '#'+n.toLocaleString('en-US');
const stateName = state => state || 'Unavailable';
const tested = s => s.rules.filter(v=>v===LABELS[0]||v===LABELS[1]).length;
function compare(label,before,after) {
  const unavailable=!known(before)||!known(after);
  return {label, before:known(before)?String(before):'Unavailable',after:known(after)?String(after):'Unavailable',
    status:unavailable?'gap':before===after?'same':'changed'};
}
export function compareEvidence(a,b) {
  if (!sameCoin(a,b) || a.block>=b.block) throw Error('Select an earlier block for the same contract.');
  const rows=[compare('Runtime code hash',a.code,b.code),compare('Implementation target',a.implementation,b.implementation),
    compare('Logic code hash',a.logic,b.logic),compare('Owner getter',a.owner,b.owner),compare('Paused getter',a.paused,b.paused)];
  const controls=s=>s.controlMethods===null?null:s.controlMethods.join(', ')||'None listed';
  rows.push(compare('Verified control methods',controls(a),controls(b)));
  const share=s=>known(s.top)?s.top.toFixed(2)+'% / '+s.topCount+' accounts':null;
  const holder=compare('Listed holder share',share(a),share(b));
  if (known(a.top)&&known(b.top)) {
    if(a.topCount!==b.topCount) holder.status='gap';
    else holder.delta=(b.top-a.top).toFixed(2)+' percentage points';
  }
  rows.push(holder,compare('Rules exercised',tested(a)+'/6',tested(b)+'/6'));
  RULES.forEach(([,title],i)=>{
    const row=compare(title,a.rules[i],b.rules[i]);
    if(row.status==='changed'&&(a.rules[i]===LABELS[2]||b.rules[i]===LABELS[2]))row.coverage=true;
    rows.push(row);
  });
  return rows;
}
function node(tag,text,cls) {
  const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;
}
const tone = status => ({'Reproduced':'hit','Not reproduced':'clear','Untested':'unknown'})[status] || 'unknown';
const mark = status => ({'Reproduced':'!','Not reproduced':'○','Untested':'–'})[status] || '?';
function track(panel, a, b) {
  const chart=node('div',null,'tm-chart');
  const toggle=node('button','Earlier'),current=node('button','Current');
  toggle.type=current.type='button';const controls=node('div',null,'tm-toggle');
  controls.append(toggle,current);const grid=node('div',null,'tm-bars');grid.setAttribute('role','list');
  const readout=node('p',null,'tm-readout');readout.setAttribute('aria-live','polite');
  let shown=b, picked=0;
  function redraw(){
    toggle.setAttribute('aria-pressed',String(shown===a));current.setAttribute('aria-pressed',String(shown===b));
    grid.replaceChildren();
    RULES.forEach(([,title],i)=>{
      const box=node('div',null,'tm-rule');box.setAttribute('role','listitem');
      const btn=node('button',null,'tm-selectrule');btn.type='button';btn.setAttribute('aria-pressed',String(i===picked));
      btn.setAttribute('aria-label',title+' · '+stateName(a.rules[i])+' to '+stateName(b.rules[i]));
      for(const s of [a,b]){const flag=node('span',mark(s.rules[i]),'tm-dot '+tone(s.rules[i])+(shown===s?' tm-focus':''));flag.setAttribute('aria-hidden','true');btn.append(flag);}
      btn.append(node('small',title));btn.onclick=()=>{picked=i;redraw();grid.children[i].querySelector('button').focus()};box.append(btn);grid.append(box);
    });
    readout.textContent=RULES[picked][1]+' at '+blockLabel(shown.block)+' · '+stateName(shown.rules[picked]);
  }
  toggle.onclick=()=>{shown=a;redraw()};current.onclick=()=>{shown=b;redraw()};
  chart.append(controls,node('p','Upper row: earlier scan. Lower row: current scan. Select a rule to inspect it.','tm-help'),grid,readout);
  panel.append(chart);redraw();
}
function render(container,current,history,saved) {
  const previous=history.filter(s=>sameCoin(s,current)&&s.block < current.block).sort((a,b)=>b.block-a.block);
  const title=node('h3','Evidence time machine'),desc=node('p','Compare observations from this browser for the same RH address. Each scan is tied to its block and code fingerprint.');
  const header=node('div',null,'tm-head');header.append(node('span','OBSERVATION ARCHIVE','eyebrow'),title,desc);
  const panel=node('div',null,'tm-shell');container.replaceChildren(panel);panel.append(header);
  if(!saved)panel.append(node('p','Browser storage is unavailable. This snapshot will last for this session.','tm-help'));
  if(!previous.length) {
    const baseline=node('div',null,'tm-baseline');baseline.append(node('b','Baseline · '+blockLabel(current.block)),node('p','Scan this address again after a new block to compare code, control state, holders and check outcomes.'));
    panel.append(baseline);return;
  }
  const label=node('label','Compare with '),select=node('select');label.className='tm-choose';
  for(const s of previous){const opt=node('option',blockLabel(s.block)+' · '+new Date(s.observed).toLocaleString());opt.value=String(s.block);select.append(opt)}
  label.append(select);panel.append(label);const view=node('div');panel.append(view);
  function draw(){
    const prior=previous.find(s=>s.block===Number(select.value));if(!prior)return;
    const rows=compareEvidence(prior,current);view.replaceChildren();
    const hits=rows.filter(x=>x.status==='changed').length,gaps=rows.filter(x=>x.status==='gap').length;
    view.append(node('h4',blockLabel(prior.block)+' → '+blockLabel(current.block)),node('p',hits+' changed observations · '+gaps+' unavailable or incomparable. A coverage change can reflect different test inputs or source availability.'));
    track(view,prior,current);
    const display=node('div',null,'tm-rows');
    const filters=node('div',null,'tm-filters');let active='all';const buttons=[];
    function drawRows(){
      buttons.forEach(([k,btn])=>btn.setAttribute('aria-pressed',String(k===active)));
      display.replaceChildren();
      const visible=rows.filter(row=>active==='all'||row.status===active);
      if(!visible.length)display.append(node('p','No observations in this view.'));
      for(const row of visible){
        const d=node('details');const sum=node('summary',row.label);
        sum.append(node('small',row.coverage?'Coverage changed':({gap:'Unavailable / incomparable',changed:'Changed',same:'Unchanged'})[row.status],'tm-badge'));d.append(sum);
        d.append(node('p','Earlier · '+row.before,'break'),node('p','Current · '+row.after,'break'));
        if(row.delta)d.append(node('p','Difference · '+row.delta));display.append(d);
      }
    }
    for(const [k,name] of [['all','All'],['changed','Changes'],['gap','Gaps']]){
      const btn=node('button',name);btn.type='button';btn.onclick=()=>{active=k;drawRows()};filters.append(btn);buttons.push([k,btn]);
    }
    view.append(filters,display,node('p','Holder shares use the explorer-listed accounts at each scan. Different account counts are marked incomparable. Up to 12 snapshots for each of 24 contracts are kept in this browser.','tm-help'));
    drawRows();
  }
  select.onchange=draw;draw();
}
let memoryHistory=[];
export function mountTimeMachine(container, r, intel) {
  const observed=Date.now();const draw=data=>{
    const current=evidenceSnapshot(r,data,observed);
    if(!current){container.replaceChildren(node('p','A confirmed contract scan is needed to create a timeline.'));return;}
    let history=memoryHistory,saved=false;
    try {const stored=JSON.parse(localStorage.getItem(STORE)||'[]');if(Array.isArray(stored))history=stored;}catch{}
    history=saveObservation(history,current);memoryHistory=history;
    try{localStorage.setItem(STORE,JSON.stringify(history));saved=true;}catch{}
    const snapshot=history.find(s=>sameCoin(s,current)&&s.block===current.block&&s.blockHash===current.blockHash);
    render(container,snapshot||current,history,saved);
  };
  draw(null);
  Promise.resolve(intel).then(data=>{if(data)draw(data)}).catch(()=>{});
}
