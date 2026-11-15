import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {AuthClient} from '@icp-sdk/auth/client';
import {Principal} from '@icp-sdk/core/principal';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
class Element{
  constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.disabled=false;this.value='';this.files=[];this.listeners={};this.style={};this.classList={set:new Set(),toggle:(c,on)=>{if(on)this.classList.set.add(c);else this.classList.set.delete(c);}};}
  addEventListener(type,fn){this.listeners[type]=fn;}
  closest(){return this;}
  click(){return this.onclick?.();}
}
const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
globalThis.document={getElementById:id=>{assert.ok(elements.has(id),`Missing element ${id}`);return elements.get(id);},createElement:()=>new Element('download')};
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});globalThis.localStorage={m:new Map(),getItem(k){return this.m.get(k)||null;},setItem(k,v){this.m.set(k,String(v));},removeItem(k){this.m.delete(k);}};
let fetched=[];globalThis.fetch=async url=>{fetched.push(url);const path=url==='./vault-artifact.json'?'../evm/artifacts.json':url;return{ok:true,json:async()=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'))};};
AuthClient.prototype.getIdentity=async()=>({getPrincipal:()=>Principal.anonymous()});AuthClient.prototype.getPrincipal=()=>Principal.anonymous();AuthClient.prototype.subscribe=()=>()=>{};
globalThis.setInterval=()=>0;
await import('./app.mjs');await new Promise(r=>setTimeout(r,50));
const $=id=>elements.get(id);
assert.equal(($('board').innerHTML.match(/role="gridcell"/g)||[]).length,64);
assert.equal($('approve-entry').disabled,true);assert.equal($('enter-game').disabled,true);
assert.equal($('stage-tag').textContent,'Paid entries closed');assert.deepEqual(fetched.sort(),['./public-config.json','./vault-artifact.json']);
assert.ok($('opponent-detail').textContent.includes('calibration pending'));
await $('local-demo').click();assert.equal($('stage-tag').textContent,'Local rules board');assert.equal($('engine-clock').innerHTML,'LOCAL ONLY');assert.match($('notice').textContent,/No engine, onchain execution, entry fee, or prize/);
const select=square=>$('board').listeners.click({target:{closest:()=>({dataset:{square}})}});
select('e2');await new Promise(r=>setTimeout(r,0));assert.match($('board').innerHTML,/e4, Empty, legal destination/);
select('e4');await new Promise(r=>setTimeout(r,0));assert.equal($('move-count').textContent,'1 PLY');assert.match($('move-history').innerHTML,/e4/);assert.equal($('turn-status').textContent,'Local only · no fees or prize');
select('e7');select('e5');await new Promise(r=>setTimeout(r,0));assert.equal($('move-count').textContent,'2 PLY');assert.equal($('approve-entry').disabled,true);assert.equal($('enter-game').disabled,true);
await $('reset-demo').click();assert.equal($('move-count').textContent,'0 PLY');await $('exit-demo').click();assert.equal($('stage-tag').textContent,'Paid entries closed');
await $('verify-release').click();assert.match($('notice').textContent,/Paid entries are closed/);assert.deepEqual(fetched.sort(),['./public-config.json','./vault-artifact.json']);
console.log(JSON.stringify({passed:true,boardSquares:64,stagingFeeActionsDisabled:true,localDemoBothSides:true,stagingExternalNetworkCalls:0,liveEngineNeverFaked:true},null,2));
