import assert from 'node:assert/strict';
import {bootLayers} from './layer-controller.mjs';
let rect={width:320,height:500},reloads=0,raf=0;const frames=new Set,win=new Map,doc=new Map,arc=[];
const context=track=>({setTransform(){},clearRect(){},beginPath(){},fill(){},arc(...x){if(track)arc.push({radius:x[2],color:this.fillStyle})}});
const mainCtx=context(false),fallbackCtx=context(true),labels=Array.from({length:3},()=>({style:{}}));
const element=()=>({dataset:{},style:{},setAttribute(k,v){this[k]=v},getBoundingClientRect:()=>rect});
const canvas=Object.assign(element(),{getContext:k=>k==='2d'?mainCtx:null,addEventListener(){},removeEventListener(){}});
const fallback=Object.assign(element(),{hidden:true,getContext:k=>k==='2d'?fallbackCtx:null});
const ids=new Map([['layer-fallback',fallback],['motion-toggle',element()],['renderer-state',element()]]);
global.document={hidden:false,getElementById:id=>{if(!ids.has(id))ids.set(id,element());return ids.get(id)},querySelectorAll:()=>labels,body:{classList:{add(){}}},addEventListener:(n,f)=>doc.set(n,f),removeEventListener:(n)=>doc.delete(n)};
global.window={addEventListener:(n,f)=>win.set(n,f),removeEventListener:(n)=>win.delete(n)};
global.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});global.devicePixelRatio=1;
global.requestAnimationFrame=()=>{frames.add(++raf);return raf};global.cancelAnimationFrame=id=>frames.delete(id);global.location={reload(){reloads++}};
const controller=bootLayers(canvas,{clientWidth:320});assert.equal(canvas.dataset.renderer,'static');assert.equal(fallback.hidden,false);assert.equal(canvas.style.visibility,'hidden');assert.equal(ids.get('motion-toggle').disabled,true);assert.equal(frames.size,0,'temporary animated fallback must be destroyed');
for(const width of [320,390,1280]){rect={width,height:width<760?500:570};win.get('resize')();const scale=Math.min(width*.27,rect.height*.25);const expected=[1.28,0,-1.28].map(y=>rect.height*.5-y*scale-8);for(let i=0;i<3;i++)assert.ok(Math.abs(parseFloat(labels[i].style.top)-expected[i])<1e-8);assert.ok(expected[0]<expected[1]&&expected[1]<expected[2]);}
assert.ok(arc.some(x=>x.radius===2.25&&x.color==='rgba(231,232,219,1)'));assert.ok(arc.some(x=>x.radius===2.25&&x.color==='rgba(237,185,106,1)'));assert.ok(arc.some(x=>x.radius===1.75));assert.ok(arc.some(x=>x.radius===.7));
win.get('pageshow')({persisted:false});assert.equal(reloads,0);win.get('pageshow')({persisted:true});assert.equal(reloads,1);
controller.destroy();assert.equal(win.has('resize'),false);assert.equal(frames.size,0);
console.log(JSON.stringify({passed:true,cases:7,scope:'Actual controller non-WebGL path: separate static canvas, disabled motion, no leftover animation, aligned labels at320/390/1280, distinct solid paper/amber emblem cores and grid/rail sizes, persisted pageshow reload, cleanup. This is a mocked Canvas2D API/source-path test, not a browser screenshot or GPU rendering test.'}));
