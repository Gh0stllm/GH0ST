// A flat, interactive ASCII companion. This animation is decorative: changing
// its expression never changes the selected artwork, traits or mint transaction.
const COLORS = Object.freeze({ Cyan:'#00dce7', Emerald:'#36f5a2', Amber:'#ffbf47', Violet:'#b49aff', Ice:'#a0ddff', Rose:'#ff91c4', Lime:'#c4f66d', Cobalt:'#659dff', Pearl:'#d3e7f5' });
const EYES = Object.freeze({
  '0':['01110','10001','10001','10001','10001','10001','10001','01110'],
  'o':['00000','00000','01110','10001','10001','01110','00000','00000'],
  '-':['00000','00000','00000','11111','00000','00000','00000','00000'],
  'u':['00000','00000','10001','10001','10001','10001','01110','00000'],
  '^':['00000','00100','01010','10001','00000','00000','00000','00000'],
  'O':['11111','10001','10001','10001','10001','10001','10001','11111'],
  '=':['00000','00000','11111','00000','11111','00000','00000','00000'],
  'x':['00000','10001','01010','00100','01010','10001','00000','00000']
});
const EXPRESSIONS = Object.freeze([
  {name:'Awake',face:'[0_0]',mouth:'line'},
  {name:'Joy',face:'[^_^]',mouth:'smile'},
  {name:'Curious',face:'[o_0]',mouth:'curious'},
  {name:'Wink',face:'[0_-]',mouth:'smile'},
  {name:'Sleepy',face:'[u_u]',mouth:'small'},
  {name:'Surprised',face:'[O_O]',mouth:'round'},
  {name:'Glitch',face:'[x_x]',mouth:'line'}
]);
const FACE_NAMES = Object.freeze({'[0_0]':'Awake','[-_-]':'Focused','[o_0]':'Curious','[0_-]':'Wink','[-_0]':'Reverse wink','[u_u]':'Sleepy','[^_^]':'Joy','[O_O]':'Surprised','[0_o]':'Curious','[=_=]':'Pause','[x_x]':'Glitch'});
const WHITE='#f5f6fa';
const TAU=Math.PI*2;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const ease=(from,to,amount)=>from+(to-from)*amount;

export function initHero(canvas) {
  const ctx=canvas?.getContext?.('2d',{alpha:true});
  if(!ctx)return {setArtwork(){},pause(){},resume(){},destroy(){}};
  const doc=canvas.ownerDocument;
  const win=doc.defaultView||window;
  const motionQuery=win.matchMedia('(prefers-reduced-motion: reduce)');
  const pointerSurface=canvas.closest?.('.hero, [data-hero], #hero')||canvas.parentElement||canvas;
  let reduced=motionQuery.matches,manualPaused=false,visible=true,destroyed=false;
  let width=720,height=600,unit=1,dpr=1,raf=0,lastTime=0,lastDraw=0,clock=0,frame=0;
  let pointerActive=false,targetX=0,targetY=0,gazeX=0,gazeY=0;
  let blinkCount=0,blinkOpen=1,blinkStart=-1,nextBlinkAt=1.8,doubleBlinkPending=false;
  let clickCount=0,clickExpression=null,clickUntil=-1;
  let currentArt={id:71,face:'[0_0]',accent:'Cyan'};

  function baseExpression(){
    const face=FACE_NAMES[currentArt.face]?currentArt.face:'[0_0]';
    return {name:FACE_NAMES[face],face,mouth:face==='[^_^]'||face==='[0_-]'||face==='[-_0]'?'smile':face==='[O_O]'?'round':face==='[u_u]'?'small':face==='[o_0]'||face==='[0_o]'?'curious':'line'};
  }
  function shownExpression(){return clickExpression||baseExpression();}
  function active(){return !destroyed&&!manualPaused&&!reduced&&visible&&!doc.hidden;}
  function dot(x,y,r,color,alpha=1){
    ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
  }
  function draw(){
    if(destroyed)return;
    ctx.clearRect(0,0,width,height);
    const expression=shownExpression();
    const accent=COLORS[currentArt.accent]||COLORS.Cyan;
    const automatic=active();
    const breathing=automatic?Math.sin(clock*1.15)*.004:0;
    const idleSmile=automatic&&!clickExpression&&expression.mouth==='line'&&clock%11>7.6&&clock%11<9.8;
    const smile=expression.mouth==='smile'||idleSmile;
    // Only a small flat translation and breath; there is no perspective or 3D.
    const cx=width*.5+gazeX*unit*12;
    const cy=height*.47+gazeY*unit*8+(automatic?Math.sin(clock*.9)*unit*2.2:0);
    const s=unit*(1+breathing);
    const faceDot=(x,y,color=WHITE,r=10)=>dot(cx+(x-625.5)*s,cy+(y-599.5)*s,r*s,color);
    let dotCount=0;
    // The broad white brackets are drawn with the collection's original pitch.
    for(const xs of [[285,314,343],[908,937,966]]){
      for(const x of xs)for(const y of [440,759]){faceDot(x,y);dotCount++;}
      const x=xs[0]===285?xs[0]:xs[2];
      for(let row=1;row<11;row++){faceDot(x,440+29*row);dotCount++;}
    }
    function eye(glyph,x0,isRight){
      const centerX=x0+54;
      const centerY=599.5;
      const eyeX=gazeX*10;
      const eyeY=gazeY*7;
      const opening=blinkOpen;
      // At a full blink, render one crisp five-dot line rather than overlapping rows.
      if(opening<.08){for(let x=0;x<5;x++){faceDot(x0+x*27+eyeX,centerY+eyeY,accent);dotCount++;}return;}
      const rows=EYES[glyph]||EYES['0'];
      for(let y=0;y<rows.length;y++)for(let x=0;x<5;x++)if(rows[y][x]==='1'){
        const yy=centerY+(498+y*29-centerY)*opening+eyeY;
        faceDot(x0+x*27+eyeX,yy,accent);dotCount++;
      }
      // Small dot pupils make gaze readable without changing the ASCII eye outline.
      if((glyph==='0'||glyph==='O'||glyph==='o')&&opening>.65){
        const pupilX=centerX+gazeX*18;
        const pupilY=centerY+gazeY*20;
        faceDot(pupilX,pupilY,WHITE,6.4);
        dotCount++;
      }
      // A tiny asymmetric eye lift gives the curious expression a questioning look.
      if(expression.name==='Curious'&&isRight&&opening>.8){
        faceDot(centerX+gazeX*10,458+eyeY,accent,5.5);dotCount++;
      }
    }
    eye(expression.face[1],415,false);eye(expression.face[3],734,true);
    const mouthX=626+gazeX*5;
    const mouthY=gazeY*5;
    if(smile){
      // A visible U curve: raised corners, seven dots and a lower center.
      for(let i=0;i<7;i++){
        const x=-75+i*25;
        faceDot(mouthX+x,706+(1-(x/75)**2)*44+mouthY,WHITE,9.5);dotCount++;
      }
    }else if(expression.mouth==='round'){
      for(const [x,y] of [[-15,-27],[15,-27],[-30,-5],[30,-5],[-30,17],[30,17],[-15,39],[15,39]]){
        faceDot(mouthX+x,723+y+mouthY,WHITE,8.5);dotCount++;
      }
    }else if(expression.mouth==='small'){
      for(let i=0;i<3;i++){faceDot(mouthX-25+i*25,740+mouthY,WHITE,9);dotCount++;}
    }else{
      for(let i=0;i<5;i++){
        const y=expression.mouth==='curious'?742+(i-2)*-4:749;
        faceDot(mouthX-58+i*29,y+mouthY);dotCount++;
      }
    }
    // A restrained set of cyan cheek dots accompanies a smile, then disappears.
    if(smile){
      for(const cheekX of [379,850])for(let i=0;i<2;i++){
        faceDot(cheekX+i*21,683+gazeY*5,accent,5);dotCount++;
      }
    }
    ctx.globalAlpha=1;
    frame++;
    canvas.dataset.renderer='interactive-ascii-dot-matrix';
    canvas.dataset.expression=expression.name;
    canvas.dataset.blinkCount=String(blinkCount);
    canvas.dataset.blinkOpen=blinkOpen.toFixed(3);
    canvas.dataset.smile=String(smile);
    canvas.dataset.gazeX=gazeX.toFixed(3);
    canvas.dataset.gazeY=gazeY.toFixed(3);
    canvas.dataset.clickCount=String(clickCount);
    canvas.dataset.frame=String(frame);
    canvas.dataset.motion=reduced?'reduced':manualPaused?'paused':!visible||doc.hidden?'suspended':'active';
    canvas.dataset.artworkId=String(currentArt.id);
    canvas.dataset.face=expression.face;
    canvas.dataset.accent=currentArt.accent;
    canvas.dataset.dotCount=String(dotCount);
    canvas.dataset.pointerActive=String(pointerActive);
    canvas.dataset.canvasDpr=String(dpr);
    canvas.dataset.viewportVisible=String(visible);
    canvas.dataset.documentHidden=String(Boolean(doc.hidden));
  }
  function updateBlink(){
    if(blinkStart<0&&clock>=nextBlinkAt){
      blinkStart=clock;blinkCount++;doubleBlinkPending=blinkCount%5===0;
    }
    if(blinkStart<0){blinkOpen=1;return;}
    const t=clock-blinkStart;
    if(t<.075)blinkOpen=1-t/.075;
    else if(t<.115)blinkOpen=0;
    else if(t<.235)blinkOpen=(t-.115)/.12;
    else{
      blinkOpen=1;blinkStart=-1;
      nextBlinkAt=clock+(doubleBlinkPending?.14:2.7+(Math.sin(blinkCount*12.73)+1)*1.05);
      doubleBlinkPending=false;
    }
  }
  function tick(now){
    raf=0;if(!active())return;
    if(!lastTime)lastTime=now;
    const dt=Math.min((now-lastTime)/1000,.06);lastTime=now;clock+=dt;
    if(clickExpression&&clock>clickUntil){clickExpression=null;}
    const curiosity=!pointerActive&&Math.sin(clock*.37)>.86;
    const lookX=pointerActive?targetX:curiosity?Math.sin(clock*.9)*.34:0;
    const lookY=pointerActive?targetY:curiosity?-.11:0;
    const smoothing=1-Math.exp(-dt*6.5);
    gazeX=ease(gazeX,lookX,smoothing);gazeY=ease(gazeY,lookY,smoothing);
    updateBlink();
    if(now-lastDraw>=1000/30){draw();lastDraw=now;}
    raf=win.requestAnimationFrame(tick);
  }
  function sync(){
    if(active()){if(!raf){lastTime=0;raf=win.requestAnimationFrame(tick);}}
    else{if(raf)win.cancelAnimationFrame(raf);raf=0;draw();}
  }
  function resize(){
    const rect=canvas.getBoundingClientRect();width=rect.width||720;height=rect.height||600;
    dpr=Math.min(win.devicePixelRatio||1,1.8);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    unit=Math.min(width*.84/720,height*.65/340);
    draw();
  }
  function pointerMove(event){
    const rect=pointerSurface.getBoundingClientRect();pointerActive=true;
    targetX=clamp((event.clientX-rect.left)/Math.max(rect.width,1)*2-1,-1,1);
    targetY=clamp((event.clientY-rect.top)/Math.max(rect.height,1)*2-1,-1,1);
    if(reduced||manualPaused){gazeX=targetX*.7;gazeY=targetY*.7;draw();}
  }
  function pointerLeave(){
    pointerActive=false;targetX=0;targetY=0;
    if(reduced||manualPaused){gazeX=0;gazeY=0;draw();}
  }
  function changeExpression(){
    clickCount++;
    clickExpression=EXPRESSIONS[clickCount%EXPRESSIONS.length];
    clickUntil=clock+4.8;blinkStart=-1;blinkOpen=1;nextBlinkAt=clock+1.6;
    draw();sync();
  }
  function keydown(event){
    if(event.key==='Enter'||event.key===' '){event.preventDefault();changeExpression();}
  }
  function changeMotion(event){
    reduced=event.matches;blinkStart=-1;blinkOpen=1;nextBlinkAt=clock+1.8;sync();
  }
  function setArtwork(next={}){
    currentArt={...currentArt,...next};
    if(!FACE_NAMES[currentArt.face])currentArt.face='[0_0]';
    if(!COLORS[currentArt.accent])currentArt.accent='Cyan';
    currentArt.id=clamp(Number.parseInt(currentArt.id,10)||71,1,495);
    clickExpression=null;clickUntil=-1;
    canvas.setAttribute('aria-label',`Interactive dot-matrix GH0ST companion, ${FACE_NAMES[currentArt.face]}, ${currentArt.accent} eyes. Follows your cursor and blinks. Click, tap or press Enter to change its expression. The selected artwork stays the same.`);
    draw();sync();
  }
  const resizeObserver=typeof win.ResizeObserver==='function'?new win.ResizeObserver(resize):null;
  const intersectionObserver=typeof win.IntersectionObserver==='function'?new win.IntersectionObserver(entries=>{
    // Layout or scrolling can batch more than one observation. The newest
    // entry for this canvas wins, so an earlier offscreen result cannot strand it.
    for(const entry of entries)if(entry.target===canvas)visible=entry.isIntersecting;
    sync();
  },{rootMargin:'0px'}):null;
  resizeObserver?.observe(canvas);intersectionObserver?.observe(canvas);
  if(!resizeObserver)win.addEventListener('resize',resize);
  pointerSurface.addEventListener('pointermove',pointerMove,{passive:true});
  pointerSurface.addEventListener('pointerleave',pointerLeave,{passive:true});
  canvas.addEventListener('click',changeExpression);canvas.addEventListener('keydown',keydown);
  doc.addEventListener('visibilitychange',sync);motionQuery.addEventListener?.('change',changeMotion);
  resize();setArtwork(currentArt);sync();
  return {
    setArtwork,
    pause(){manualPaused=true;blinkStart=-1;blinkOpen=1;sync();},
    resume(){manualPaused=false;nextBlinkAt=clock+1.8;sync();},
    destroy(){
      destroyed=true;if(raf)win.cancelAnimationFrame(raf);raf=0;
      resizeObserver?.disconnect();intersectionObserver?.disconnect();win.removeEventListener('resize',resize);
      pointerSurface.removeEventListener('pointermove',pointerMove);pointerSurface.removeEventListener('pointerleave',pointerLeave);
      canvas.removeEventListener('click',changeExpression);canvas.removeEventListener('keydown',keydown);
      doc.removeEventListener('visibilitychange',sync);motionQuery.removeEventListener?.('change',changeMotion);
    }
  };
}
