const VERTEX = `
precision mediump float;
attribute vec3 aPosition;
attribute float aSeed;
attribute float aRegion;
attribute float aKind;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uPointerOn;
uniform float uTime;
uniform float uRead;
uniform float uWrite;
uniform float uDpr;
uniform float uPointPass;
uniform float uScale;
uniform float uLift;
uniform float uPulse;
uniform float uPulseStrength;
varying vec3 vColor;
varying float vAlpha;
void main(){
  float aspect=uResolution.x/uResolution.y;
  vec3 p=aPosition;
  float breath=1.0+.008*sin(uTime*.53+aSeed*3.0);
  p*=breath;
  float ry=.13+uPointer.x*.17+sin(uTime*.055)*.07;
  float rx=-.10+uPointer.y*.07;
  p.xz=mat2(cos(ry),-sin(ry),sin(ry),cos(ry))*p.xz;
  p.yz=mat2(cos(rx),-sin(rx),sin(rx),cos(rx))*p.yz;
  float perspective=3.7/(4.6-p.z);
  vec2 projected=vec2(p.x/aspect,p.y)*perspective*uScale+vec2(0.,uLift);
  vec2 difference=(projected-uPointer)*vec2(aspect,1.);
  float focus=exp(-dot(difference,difference)*37.)*uPointerOn;
  projected+=normalize(difference+vec2(.0001))*focus*.014;
  float signal=mix(uRead,uWrite,step(.5,aRegion));
  float wave=pow(max(0.,sin(uTime*3.1-aSeed*42.+p.x*2.6)),15.)*signal;
  float traveling=pow(max(0.,sin(uTime*5.8-p.x*4.4-aSeed*8.)),13.)*signal;
  float ambient=pow(max(0.,sin(uTime*.9-aSeed*61.)),28.)*.17;
  float flare=wave*.85+focus*1.15+ambient;
  if(aKind>0.5&&aKind<1.5)flare=exp(-pow((aSeed-uPulse)/.065,2.))*uPulseStrength*2.0+focus*.45;
  vec3 readColor=vec3(.72,.83,.68);
  vec3 writeColor=vec3(.96,.62,.24);
  vColor=mix(readColor,writeColor,step(.5,aRegion));
  vColor=mix(vColor,vec3(1.,.94,.78),min(1.,flare*.8));
  float front=.38+.62*clamp((p.z+1.2)/2.2,0.,1.);
  vAlpha=(.9+flare*.4)*front;
  if(uPointPass<.5)vAlpha=(.095+flare*.43)*front;
  if(aKind>1.5&&aKind<2.5)vAlpha*=.25;
  if(aKind>2.5){vAlpha=1.0;vColor=mix(vec3(.906,.910,.859),vec3(.929,.725,.416),step(.5,aRegion));}
  if(aKind>.5&&aKind<1.5)vAlpha*=.42+signal*.75;
  gl_PointSize=(3.3+aSeed*.5+flare*1.5)*uDpr;
  if(aKind>.5&&aKind<1.5)gl_PointSize=(1.2+aSeed*.5+flare*3.1)*uDpr;
  if(aKind>1.5&&aKind<2.5)gl_PointSize=(.8+aSeed*.8)*uDpr;
  if(aKind>2.5)gl_PointSize=(4.5+aSeed*.5+focus*1.2)*uDpr;
  gl_Position=vec4(projected,0.,1.);
}`;
const FRAGMENT = `
precision mediump float;
uniform float uPointPass;
varying vec3 vColor;
varying float vAlpha;
void main(){
  float alpha=vAlpha;
  if(uPointPass>.5){
    float r=length(gl_PointCoord-vec2(.5))*2.;
    if(r>1.)discard;
    alpha*=1.0-smoothstep(.58,1.0,r);
  }
  gl_FragColor=vec4(vColor,alpha);
}`;

function seeded(seed = 88421) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
    n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n; return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}

export function buildCortex(compact = false) {
  const vertices=[],lines=[],random=seeded(),push=(x,y,z,region,kind=3,seed=random())=>{const v=[x,y,z,seed,region,kind];vertices.push(...v);return v;};
  const count=compact?18:26,levels=[1.28,0,-1.28],spacing=2/count;
  for(let layer=0;layer<3;layer++)for(let i=0;i<=count;i++)for(let j=0;j<=count;j++){
    const u=-1+i*spacing,v=-1+j*spacing,x=(u-v)*.78,y=(u+v)*.29;
    const hole=layer===0?Math.abs(x)<.5&&Math.abs(y)<.29:layer===1?Math.abs(x)<.36&&Math.abs(y)<.31:Math.abs(x)<.29&&Math.abs(y)<.39;
    if(!hole)push(x,y+levels[layer],(u+v)*.085,layer===0?1:0,0);
  }
  const lineDots=(x1,y1,x2,y2,level,region,step=.045)=>{const d=Math.hypot(x2-x1,y2-y1),n=Math.ceil(d/step);for(let k=0;k<=n;k++)push(x1+(x2-x1)*k/n,y1+(y2-y1)*k/n+level,.13,region,3)};
  // GH0ST's own bracket face occupies the upper plane.
  for(const side of[-1,1]){lineDots(side*.44,-.26,side*.44,.26,levels[0],0);lineDots(side*.44,.26,side*.26,.26,levels[0],0);lineDots(side*.44,-.26,side*.26,-.26,levels[0],0)}
  for(const x of[-.17,.17])for(const dx of[-.025,.025])for(const y of[-.02,.035,.09])push(x+dx,y+levels[0],.15,0);for(const x of[-.065,0,.065])push(x,-.15+levels[0],.15,0);
  // A dotted feather motif on Robinhood's middle plane.
  for(let x=-.34;x<=.35;x+=.035)for(let y=-.32;y<=.36;y+=.035){const a=(x+y)*.7071,b=(x-y)*.7071,w=.16*Math.sqrt(Math.max(0,1-((a-.025)/.40)**2));if(a>-.35&&a<.42&&Math.abs(b)<w&&!(b>0&&Math.sin(a*31+b*10)>.83))push(x,y,.14,1)}
  lineDots(-.28,-.29,.25,.29,0,1,.035);
  // Ethereum's two-part diamond on the lower plane.
  for(let x=-.27;x<=.27;x+=.037)for(let y=-.38;y<=.38;y+=.037){if(Math.abs(x)/.26+Math.abs(y)/.38<1&&!(y>-.04&&y<.025))push(x,y+levels[2],.14,1)}
  // Each rail point carries its own top-to-bottom path position, not a random clock.
  for(const side of[-1,1])for(let i=0;i<=120;i++){const t=i/120;push(side*(1.03+.025*Math.sin(t*Math.PI)),levels[0]-.10-t*(levels[0]-levels[2]-.10),.035,1,1,t)}
  return {points:new Float32Array(vertices),lines:new Float32Array(lines)};
}

function compile(gl,type,source){
  const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);throw Error('neural_shader_unavailable')}return shader;
}

export function createNeuralScene(canvas, stage, { reducedMotion = false, onAnchors = () => {} } = {}) {
  const gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,powerPreference:'high-performance',preserveDrawingBuffer:false});
  if(!gl)return fallbackScene(canvas,stage,reducedMotion);
  const program=gl.createProgram();gl.attachShader(program,compile(gl,gl.VERTEX_SHADER,VERTEX));
  gl.attachShader(program,compile(gl,gl.FRAGMENT_SHADER,FRAGMENT));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);return {kind:'unavailable',pulse(){},clearPulse(){},setActivity(){},setPaused(){},destroy(){}}}
  gl.useProgram(program);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.disable(gl.DEPTH_TEST);
  const geometry=buildCortex(stage.clientWidth<760), buffers={};
  for(const key of ['points','lines']){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,geometry[key],gl.STATIC_DRAW);buffers[key]=b;}
  const locations=Object.fromEntries(['uResolution','uPointer','uPointerOn','uTime','uRead','uWrite','uDpr','uPointPass','uScale','uLift','uPulse','uPulseStrength'].map(k=>[k,gl.getUniformLocation(program,k)]));
  const attrs=[['aPosition',3,0],['aSeed',1,12],['aRegion',1,16],['aKind',1,20]].map(([name,size,offset])=>({location:gl.getAttribLocation(program,name),size,offset}));
  let paused=reducedMotion,visible=true,documentVisible=!document.hidden,frame=0,time=0,last=0,w=1,h=1,dpr=1;
  let pulseAt=-100,pulseDuration=1,pulseStrength=0,pointerTarget=0;
  let read=0,write=0,readTarget=0,writeTarget=0,mouse=[0,0],smooth=[0,0],pointer=0;
  const resize=()=>{const r=canvas.getBoundingClientRect();w=Math.max(1,r.width);h=Math.max(1,r.height);dpr=Math.min(devicePixelRatio||1,1.5);
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);gl.viewport(0,0,canvas.width,canvas.height);const mobile=w<760,scale=mobile?.64*Math.min(1,w/h/.95):.60;onAnchors([1.28,0,-1.28].map(y=>{const py=y*Math.cos(-.10),pz=-y*Math.sin(-.10);return(1-(py*3.7/(4.6-pz)*scale+.05))*h/2}));if(paused)draw(performance.now());};
  const bind=(key)=>{gl.bindBuffer(gl.ARRAY_BUFFER,buffers[key]);for(const a of attrs){gl.enableVertexAttribArray(a.location);gl.vertexAttribPointer(a.location,a.size,gl.FLOAT,false,24,a.offset);}};
  function draw(stamp){
    frame=0;if(!visible||!documentVisible)return;
    const delta=last?Math.min(50,stamp-last):16;last=stamp;if(!paused)time+=delta*.001;
    smooth[0]+=(mouse[0]-smooth[0])*.055;smooth[1]+=(mouse[1]-smooth[1])*.055;
    read+=(readTarget-read)*.065;write+=(writeTarget-write)*.065;pointer+=(pointerTarget-pointer)*.085;
    gl.clearColor(8./255.,9./255.,8./255.,1.);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);
    gl.uniform2f(locations.uResolution,w,h);gl.uniform2f(locations.uPointer,smooth[0],smooth[1]);
    gl.uniform1f(locations.uPointerOn,pointer);gl.uniform1f(locations.uTime,time);
    gl.uniform1f(locations.uPulse,Math.min(1.2,Math.max(0,(time-pulseAt)/pulseDuration)));gl.uniform1f(locations.uPulseStrength,time-pulseAt>pulseDuration+0.2?0:pulseStrength);
    gl.uniform1f(locations.uRead,paused?0:read);gl.uniform1f(locations.uWrite,paused?0:write);gl.uniform1f(locations.uDpr,dpr);
    const mobile=w<760;gl.uniform1f(locations.uScale,mobile?.64*Math.min(1,w/h/.95):.60);gl.uniform1f(locations.uLift,mobile?.05:.05);
    gl.uniform1f(locations.uPointPass,0);bind('lines');gl.drawArrays(gl.LINES,0,geometry.lines.length/6);
    gl.uniform1f(locations.uPointPass,1);bind('points');gl.drawArrays(gl.POINTS,0,geometry.points.length/6);
    if(!paused)frame=requestAnimationFrame(draw);
  }
  const wake=()=>{if(!frame&&visible&&documentVisible)frame=requestAnimationFrame(draw);};
  const move=e=>{if(e.pointerType==='touch')return;const r=canvas.getBoundingClientRect();mouse=[(e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2];pointerTarget=1;wake();};
  const leave=()=>{mouse=[0,0];pointerTarget=0;wake();};
  stage.addEventListener('pointermove',move,{passive:true});stage.addEventListener('pointerleave',leave,{passive:true});
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  const visibilityObserver=new IntersectionObserver(rows=>{visible=rows[0].isIntersecting;if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}else wake();},{rootMargin:'150px'});visibilityObserver.observe(canvas);
  const onVisibility=()=>{documentVisible=!document.hidden;last=0;if(!documentVisible&&frame){cancelAnimationFrame(frame);frame=0;}else wake();};document.addEventListener('visibilitychange',onVisibility);
  resize();wake();
  return {kind:'webgl',pulse(seconds=1){if(paused||!visible||!documentVisible)return;pulseAt=time;pulseDuration=Math.min(1.6,Math.max(.55,seconds));pulseStrength=1;wake();},clearPulse(){pulseStrength=0;wake();},setActivity({reading=0,writing=0}={}){readTarget=Math.min(1,Math.max(0,reading));writeTarget=Math.min(1,Math.max(0,writing));wake();},
    setPaused(value){paused=!!value;if(paused)pulseStrength=0;if(frame){cancelAnimationFrame(frame);frame=0;}wake();},
    destroy(){if(frame)cancelAnimationFrame(frame);observer.disconnect();visibilityObserver.disconnect();stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerleave',leave);document.removeEventListener('visibilitychange',onVisibility);for(const b of Object.values(buffers))gl.deleteBuffer(b);gl.deleteProgram(program);}};
}

function fallbackScene(canvas,stage,reducedMotion){
  const ctx=canvas.getContext('2d');if(!ctx)return {kind:'unavailable',pulse(){},clearPulse(){},setActivity(){},setPaused(){},destroy(){}};
  const mesh=buildCortex(true);let paused=reducedMotion,frame=0,t=0,read=0,write=0;
  function draw(){const r=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,1.5);if(canvas.width!==Math.round(r.width*d)||canvas.height!==Math.round(r.height*d)){canvas.width=r.width*d;canvas.height=r.height*d;}ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,r.width,r.height);
    const scale=Math.min(r.width*.27,r.height*.22),cy=r.width<760?r.height*.27:r.height*.45;
    for(let i=0;i<mesh.points.length;i+=6){const x=mesh.points[i],y=mesh.points[i+1],z=mesh.points[i+2],region=mesh.points[i+4],a=.22+Math.max(read,write)*.35*Math.max(0,Math.sin(t-x*3));ctx.fillStyle=region>.5?`rgba(237,185,106,${a})`:`rgba(200,212,189,${a})`;ctx.beginPath();ctx.arc(r.width*.5+x*scale,cy-y*scale,.75+z*.16,0,7);ctx.fill();}}
  draw();return {kind:'canvas',pulse(){},clearPulse(){},setActivity(a){read=a.reading||0;write=a.writing||0;},setPaused(v){paused=v;cancelAnimationFrame(frame);draw();},destroy(){cancelAnimationFrame(frame);}};
}
