import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {GENESIS,NETWORK} from './core.mjs';
class Element {
 constructor(){this.children=[];this.attributes={};this.textContent='';this.dataset={};this.classList={values:new Set,add(n){this.values.add(n)},remove(n){this.values.delete(n)},toggle(n){if(this.values.has(n)){this.values.delete(n);return false}this.values.add(n);return true}}}
 append(...x){this.children.push(...x)} replaceChildren(...x){this.children=x} setAttribute(k,v){this.attributes[k]=String(v)} focus(){} showModal(){this.open=true} close(){this.open=false}
}
const nodes=new Map,steps=Array.from({length:4},(_,i)=>Object.assign(new Element,{dataset:{step:String(i)}}));
const docEvents={},winEvents={};
global.document={hidden:false,body:new Element,getElementById(id){if(!nodes.has(id))nodes.set(id,new Element);return nodes.get(id)},createElement:()=>new Element,querySelectorAll:q=>q==='[data-step]'?steps:[],addEventListener(n,f){docEvents[n]=f}};
global.window={addEventListener(n,f){winEvents[n]=f},dispatchEvent(){}};
Object.defineProperty(global,'navigator',{value:{clipboard:{async writeText(){}}},configurable:true});
let now=100000,poll,calls=0,mode='offline';Date.now=()=>now;
global.setTimeout=fn=>{if(fn.name==='pollHead')poll=fn;return 0};global.clearTimeout=()=>{};
const block=n=>({number:n,hash:GENESIS,timestamp:'0x1',transactions:[]});
global.fetch=async(url,opts)=>{calls++;assert.equal(url,NETWORK.rpcUrls[0]);if(mode==='offline')throw Error('simulated offline');const r=JSON.parse(opts.body);const result=r.method==='eth_chainId'?(mode==='wrong'?'0x1':NETWORK.chainId):r.method==='eth_gasPrice'?'0x9184e72a000':block(r.params[0]==='latest'?'0x5':r.params[0]);return {ok:true,json:async()=>({jsonrpc:'2.0',id:r.id,result})}};
await import('./app.mjs');for(let i=0;i<20;i++)await tick();
assert.equal(nodes.get('network-status').textContent,'LIVE DATA UNAVAILABLE');assert.equal(typeof poll,'function');
const initialCalls=calls;now+=1000;await poll();assert.equal(calls,initialCalls,'backoff must not repeatedly call RPC');
mode='ok';now+=15000;await poll();assert.equal(nodes.get('network-status').textContent,'MAINNET RESPONDING');assert.equal(nodes.get('latest-block').textContent,'5');
mode='wrong';now+=60001;await poll();assert.equal(nodes.get('network-status').textContent,'LIVE DATA UNAVAILABLE');assert.equal(nodes.get('latest-block').textContent,'—');assert.equal(nodes.get('recent-blocks').children.length,0);
mode='ok';now+=15000;await poll();assert.equal(nodes.get('network-status').textContent,'MAINNET RESPONDING');assert.equal(nodes.get('latest-block').textContent,'5');
console.log(JSON.stringify({passed:true,cases:5,calls,scope:'Actual frozen app module under an independent minimal DOM: first request offline, bounded retry backoff, recovery without visibility changes, periodic wrong-chain rejection, and subsequent re-verification recovery. Browser/GPU/layout not covered.'}));
