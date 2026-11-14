// Exercise the actual browser bundle with a minimal DOM and real training core.
// The worker transport is simulated; no browser automation or external service is used.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { trainModel } from '../training/core.mjs';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const elements=new Map(),downloads=[],storage=new Map();let features=[];
class Element{
  constructor(id=''){this.id=id;this.value='';this.textContent='';this.disabled=false;this.dataset={};this.listeners={};this.children=[];this.max=100;this._html='';this.style={};const values=new Set();this.classList={values,add:(...v)=>v.forEach(x=>values.add(x)),remove:(...v)=>v.forEach(x=>values.delete(x)),contains:v=>values.has(v),toggle:(v,on)=>{if(on===undefined)on=!values.has(v);on?values.add(v):values.delete(v);return on}};}
  set innerHTML(value){this._html=value;if(this.id==='sliders'){features=[...value.matchAll(/<input id="feature-(\d+)"[^>]*value="([^"]+)"/g)].map(m=>{const e=element(`feature-${m[1]}`);e.dataset.feature=m[1];e.value=m[2];return e});}}
  get innerHTML(){return this._html;}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)}
  async fire(type,event={}){for(const fn of this.listeners[type]||[])await fn({target:this,preventDefault(){},...event})}
  async click(){if(this.download){downloads.push(this);return}assert.equal(this.disabled,false,`${this.id} disabled: ${element('notice').textContent}`);await this.fire('click')}
  append(child){this.children.push(child)}replaceChildren(...children){this.children=children}remove(){}scrollIntoView(){}
}
function element(id){if(!elements.has(id)){const e=new Element(id),tag=[...html.matchAll(/<[a-z][^>]*\bid="([^"]+)"[^>]*>/g)].find(m=>m[1]===id)?.[0]||'';const value=tag.match(/\bvalue="([^"]*)"/);if(value)e.value=value[1];const classes=tag.match(/\bclass="([^"]*)"/);if(classes)e.classList.add(...classes[1].split(' '));elements.set(id,e);}return elements.get(id)}
const traceButtons=['logits','hidden','normalizedQ8'].map(name=>{const e=new Element();e.dataset.trace=name;return e});
const downloadButtons=['model','csv','test','source','artifact'].map(name=>{const e=new Element();e.dataset.download=name;return e});
globalThis.document={getElementById:element,createElement:()=>new Element(),body:element('body'),querySelectorAll:s=>s==='[data-feature]'?features:s==='[data-trace]'?traceButtons:s==='[data-download]'?downloadButtons:s.includes('#sliders input')?[...features,element('reset-inputs'),...downloadButtons]:[]};
globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
const nativeFetch=globalThis.fetch;let requests=0;
globalThis.fetch=async url=>{requests++;assert.ok(String(url).startsWith('./'),'Training attempted an external request');return new Response(readFileSync(new URL('./dist/forge/'+String(url).slice(2),import.meta.url)),{status:200})};
globalThis.Worker=class{
  constructor(){this.stopped=false;this.cancelled=false;}
  terminate(){this.stopped=true;}
  postMessage(message){if(message.type==='cancel'){this.cancelled=true;return}const requestId=message.requestId;trainModel(message.dataset,message.options,{shouldCancel:()=>this.cancelled,onProgress:progress=>{if(!this.stopped)this.onmessage?.({data:{type:'progress',requestId,progress}})}}).then(result=>{if(!this.stopped)this.onmessage?.({data:{type:'result',requestId,result}})}).catch(error=>{if(!this.stopped)this.onmessage?.({data:{type:error.name==='TrainingCancelledError'?'cancelled':'error',requestId,error:{name:error.name,message:error.message}}})});}
};
const wait=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>15000)throw new Error(`Timed out: ${element('notice').textContent}`);await new Promise(r=>setTimeout(r,10))}};
try{
  await import(`./dist/forge/app.js?local-dom=${Date.now()}`);await wait(()=>element('load-example').listeners.click);
  element('hidden-size').value='8';element('epochs').value='100';
  await wait(()=>!element('load-example').disabled);
  await element('load-example').click();assert.match(element('dataset-shape').textContent,/360 rows.*4 inputs/);assert.equal(element('train-button').disabled,false);assert.equal(element('deploy-button').disabled,true);
  await element('train-button').click();await wait(()=>!element('results').classList.contains('hidden'));
  assert.match(element('metrics').innerHTML,/HELD-OUT ACCURACY/);assert.match(element('metrics').innerHTML,/MAJORITY BASELINE/);assert.match(element('metrics').innerHTML,/SINGLE-RULE BASELINE/);assert.match(element('confusion').innerHTML,/attack.*patrol.*retreat/);
  assert.match(element('result-meta').textContent,/measured in this run/);assert.ok(['attack','patrol','retreat'].includes(element('prediction').textContent));assert.equal(features.length,4);
  features[0].value='1';await features[0].fire('input');assert.equal(element('feature-value-0').textContent,'1');assert.equal(element('prediction-origin').textContent,'Browser preview');assert.equal(element('deploy-button').disabled,true);
  await downloadButtons.find(e=>e.dataset.download==='test').click();assert.equal(downloads.length,1);assert.equal(downloads[0].download,'forge-replay.mjs');const replay=await nativeFetch(downloads[0].href).then(r=>r.text());await import('data:text/javascript;base64,'+Buffer.from(replay).toString('base64'));
  assert.equal(requests,2,'only contract source and artifact loaded during private training');assert.ok(storage.get('gh0st-forge-model-v1'));
  const saved=JSON.parse(storage.get('gh0st-forge-model-v1'));
  element('model-upload').files=[{size:100,text:async()=>JSON.stringify(saved)}];await element('model-upload').fire('change');
  assert.equal(element('results').classList.contains('hidden'),true,'imported metrics cannot masquerade as a current run');assert.match(element('notice').textContent,/have not been rerun/);assert.equal(element('train-button').disabled,true);
  await element('load-example').click();await element('train-button').click();await element('cancel-training').click();await wait(()=>element('training-state').textContent==='Stopped');assert.equal(element('results').classList.contains('hidden'),true);assert.equal(element('deploy-button').disabled,true);
  element('csv-upload').files=[{name:'invalid.csv',size:24,text:async()=> 'x,label\nNaN,a\nInfinity,b'}];await element('csv-upload').fire('change');assert.equal(element('train-button').disabled,true);assert.match(element('notice').textContent,/finite number/);
  const report={simulation:true,publicTransactions:0,checks:['production bundle loads generated NPC data','real worker training core measures held-out results and both baselines','confusion matrix rendered from measured result','sliders update exact browser trace','deployment disabled without wallet/live estimate','downloaded independent integer replay executes successfully','training makes no external data requests','imported model report stays unmeasured','training cancellation exports no model','invalid nonfinite CSV disables training']};writeFileSync(new URL('./app-test-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{globalThis.fetch=nativeFetch;}
