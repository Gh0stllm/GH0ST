import{GLYPHS,asciiPolicy,frameRows,canAnimate}from'./ascii-policy.mjs';
export function bootAscii(canvas){
 const status=document.getElementById('renderer-state'),ctx=canvas?.getContext?.('2d',{alpha:true});
 if(!ctx){if(canvas)canvas.dataset.renderer='ascii-static';status.textContent='ASCII / STATIC ARCHITECTURE';return{fallback:true,dispose(){}}}
 const media=window.matchMedia?.('(prefers-reduced-motion: reduce)')||{matches:false,addEventListener(){},removeEventListener(){}};let paused=document.body.classList.contains('paused'),visible=true,raf=0,lastTime=0,elapsed=0,lastPaint=0,mode=0,width=0,height=0,cols=0,rows=0,cw=0,lh=0,frame=0,disposed=false;let policy;
 const colors=['#81796b','#c9c4b8','#eac18a','#fff8e7'];
 function label(){canvas.dataset.motion=media.matches?'reduced':paused?'paused':'animated';status.textContent=media.matches?'ASCII / REDUCED MOTION':paused?'ASCII / PAUSED':'ASCII / ANIMATED'}
 function paint(){if(disposed||document.hidden||!visible)return;ctx.clearRect(0,0,width,height);const data=frameRows(cols,rows,elapsed,mode),left=(width-cols*cw)/2,top=Math.max(55,(height-rows*lh)/2);for(let r=0;r<data.length;r++)for(let k=0;k<4;k++)if(data[r][k].trim()){ctx.fillStyle=colors[k];ctx.fillText(data[r][k],left,top+r*lh)}canvas.dataset.renderer='ascii-canvas';canvas.dataset.glyphs=GLYPHS;canvas.dataset.frame=String(++frame);document.body.classList.add('has-ascii');label()}
 function tick(now){raf=0;if(!canAnimate({hidden:document.hidden,visible,paused,reduced:media.matches})||disposed)return;const delta=lastTime?Math.min((now-lastTime)/1000,.1):0;lastTime=now;elapsed+=delta;if(now-lastPaint>=1000/policy.maxFPS){paint();lastPaint=now}raf=requestAnimationFrame(tick)}
 function schedule(){if(!raf&&canAnimate({hidden:document.hidden,visible,paused,reduced:media.matches})&&!disposed){lastTime=0;raf=requestAnimationFrame(tick)}}
 function stop(){cancelAnimationFrame(raf);raf=0;lastTime=0}
 function resize(){if(disposed)return;const box=canvas.getBoundingClientRect();width=box.width;height=box.height;visible=box.bottom>0&&box.top<innerHeight;if(width<1||height<1)return;policy=asciiPolicy(width,devicePixelRatio,media.matches);canvas.width=Math.round(width*policy.pixelRatio);canvas.height=Math.round(height*policy.pixelRatio);ctx.setTransform(policy.pixelRatio,0,0,policy.pixelRatio,0,0);ctx.font='600 '+policy.fontSize+'px Mono, monospace';ctx.textBaseline='top';cw=ctx.measureText('M').width;lh=policy.fontSize*policy.lineScale;cols=Math.max(35,Math.min(policy.maxColumns,Math.floor(width/cw)));rows=Math.max(12,Math.floor((height-100)/lh));paint();schedule()}
 function onMotion(e){paused=Boolean(e.detail);stop();paint();schedule()}
 function onStep(e){mode=Number(e.detail)||0;paint()}
 function onVisibility(){stop();if(!document.hidden){paint();schedule()}}
 function onPreference(){stop();label();paint();schedule()}
 function onScroll(){const r=canvas.getBoundingClientRect();const next=r.bottom>0&&r.top<innerHeight;if(next!==visible){visible=next;stop();if(visible){paint();schedule()}}}
 window.addEventListener('resize',resize,{passive:true});window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('gl3:motion',onMotion);window.addEventListener('gl3:step',onStep);document.addEventListener('visibilitychange',onVisibility);media.addEventListener('change',onPreference);document.fonts?.ready.then(resize).catch(()=>{});resize();
 return{fallback:false,dispose(){disposed=true;stop();window.removeEventListener('resize',resize);window.removeEventListener('scroll',onScroll);window.removeEventListener('gl3:motion',onMotion);window.removeEventListener('gl3:step',onStep);document.removeEventListener('visibilitychange',onVisibility);media.removeEventListener('change',onPreference)}}
}
