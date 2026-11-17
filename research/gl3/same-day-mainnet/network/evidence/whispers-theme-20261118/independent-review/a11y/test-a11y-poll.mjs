import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {setImmediate as tick} from 'node:timers/promises';import {GENESIS,NETWORK} from './core.mjs';
class Element{
 constructor(){this.children=[];this.attributes={};this._text='';this.writes=0;this.dataset={};this.classList={values:new Set,add(n){this.values.add(n)},remove(n){this.values.delete(n)},toggle(n){if(this.values.has(n)){this.values.delete(n);return false}this.values.add(n);return true}}}
 get textContent(){return this._text}set textContent(v){this.writes++;this._text=v}
 append(...x){this.children.push(...x)}replaceChildren(...x){this.children=x}setAttribute(k,v){this.attributes[k]=String(v)}focus(){}showModal(){}close(){}
}
const nodes=new Map,steps=Array.from({length:4},(_,i)=>Object.assign(new Element,{dataset:{step:String(i)}}));const get=id=>{if(!nodes.has(id))nodes.set(id,new Element);return nodes.get(id)};
global.document={hidden:false,body:new Element,getElementById:get,createElement:()=>new Element,querySelectorAll:q=>q==='[data-step]'?steps:[],addEventListener(){}};
global.window={addEventListener(){},dispatchEvent(){}};Object.defineProperty(global,'navigator',{value:{clipboard:{async writeText(){}}},configurable:true});
let now=100000,poll,calls=0,mode='offline',gasFail=false;Date.now=()=>now;global.setTimeout=fn=>{if(fn.name==='pollHead')poll=fn;return 0};global.clearTimeout=()=>{};
const block=n=>({number:n,hash:GENESIS,timestamp:'0x1',transactions:[]});
global.fetch=async(url,opts)=>{calls++;assert.equal(url,NETWORK.rpcUrls[0]);const r=JSON.parse(opts.body);if(mode==='offline')throw Error('simulated offline');if(gasFail&&r.method==='eth_gasPrice')throw Error('simulated gas quote offline');const result=r.method==='eth_chainId'?(mode==='wrong'?'0x1':NETWORK.chainId):r.method==='eth_gasPrice'?'0x9184e72a000':block(r.params[0]==='latest'?'0x5':r.params[0]);return{ok:true,json:async()=>({jsonrpc:'2.0',id:r.id,result})}};
await import('./app.mjs');for(let i=0;i<20;i++)await tick();
assert.equal(get('network-status').textContent,'LIVE DATA UNAVAILABLE');assert.equal(get('network-announcer').writes,1);assert.equal(get('toast').writes,1);
const firstCalls=calls;now+=1000;await poll();assert.equal(calls,firstCalls);
now+=15000;await poll();assert.equal(get('network-announcer').writes,1,'repeated offline category must stay quiet');assert.equal(get('toast').writes,1,'automatic retry toast must stay quiet');
mode='ok';now+=15000;await poll();assert.equal(get('network-status').textContent,'MAINNET RESPONDING');assert.equal(get('network-announcer').writes,2);
now+=1500;await poll();assert.equal(get('network-announcer').writes,2,'ordinary head polling must stay quiet');
gasFail=true;now+=30001;await poll();assert.equal(get('network-status').textContent,'MAINNET RESPONDING');assert.equal(get('network-announcer').writes,2);assert.equal(get('gas-price').textContent,'—');assert.match(get('gas-price').attributes['aria-label'],/unavailable/i);
now+=30001;await poll();assert.equal(get('network-announcer').writes,2,'gas-only outage must not emit verified/unavailable on repeated due retries');assert.equal(get('gas-price').textContent,'—');
gasFail=false;now+=30001;await poll();assert.equal(get('network-status').textContent,'MAINNET RESPONDING');assert.equal(get('network-announcer').writes,2);assert.equal(get('gas-price').textContent,'0.00001');
mode='wrong';now+=60001;await poll();assert.equal(get('latest-block').textContent,'—');assert.equal(get('network-announcer').writes,3);assert.match(get('network-announcer').textContent,/identity mismatch/i);
mode='ok';now+=15000;await poll();assert.equal(get('network-status').textContent,'MAINNET RESPONDING');assert.equal(get('network-announcer').writes,4);
const html=await readFile('index.html','utf8');for(const pattern of [/<div\b[^>]*\bclass="brain-state"[^>]*>/,/<div\b[^>]*\bid="recent-blocks"[^>]*>/]){const tag=html.match(pattern)?.[0];assert.ok(tag);assert.doesNotMatch(tag,/aria-live/i)}const announcer=html.match(/<div\b[^>]*\bid="network-announcer"[^>]*>/)?.[0];assert.match(announcer,/role="status"/);assert.match(announcer,/aria-live="polite"/);assert.match(announcer,/aria-atomic="true"/);
console.log(JSON.stringify({passed:true,cases:11,calls,announcementWrites:get('network-announcer').writes,scope:'Actual app under independent minimal DOM: retry/backoff/recovery, quiet duplicate heads and outage retries, no verified/unavailable flap during repeated gas-only failures, wrong-chain failclosed and recovery, quiet data-region markup plus dedicated atomic connection status. No actual screen-reader or browser/GPU coverage.'}));
