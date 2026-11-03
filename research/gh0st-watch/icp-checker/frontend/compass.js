// Radial factor selector. Each spoke's length shows the observed fraction of its own weight.
const ns='http://www.w3.org/2000/svg';
function svg(tag,attrs,text){
  const node=document.createElementNS(ns,tag);
  for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));
  if(text!=null)node.textContent=text;
  return node;
}
export function compass(measured){
  const section=document.createElement('section');section.className='compass';
  const art=svg('svg',{viewBox:'0 0 300 230','aria-label':'Evidence compass. Choose a numbered spoke to inspect a factor.'});
  const center=[150,116],point=(a,r)=>[center[0]+Math.cos(a)*r,center[1]+Math.sin(a)*r];
  for(const r of [25,52,77])art.append(svg('circle',{cx:center[0],cy:center[1],r,fill:'none',stroke:'#61513b','stroke-dasharray':r===52?'2 4':'none'}));
  const description=document.createElement('div'),head=document.createElement('h3'),name=document.createElement('strong'),body=document.createElement('p'),key=document.createElement('small');
  head.textContent='Evidence compass';key.textContent='SELECT A SPOKE';description.append(key,head,name,body);
  const groups=[];
  function show(index){
    const f=measured.factors[index];
    name.textContent=String(index+1).padStart(2,'0')+' / '+f.name;
    body.textContent=f.observation+' · '+f.detail;
    groups.forEach((item,i)=>{item.setAttribute('aria-pressed',String(i===index));});
  }
  measured.factors.forEach((f,i)=>{
    const angle=-Math.PI/2+i*2*Math.PI/measured.factors.length;
    const [x,y]=point(angle,77),[lx,ly]=point(angle,96),[vx,vy]=point(angle,10+67*(f.points??0)/f.weight);
    const g=svg('g',{tabindex:0,role:'button','aria-label':'Inspect '+f.name});groups.push(g);
    g.append(svg('line',{x1:150,y1:116,x2:x,y2:y,stroke:'#8b7961','stroke-dasharray':f.points==null?'3 4':'none'}));
    if(f.points!==null)g.append(svg('line',{x1:150,y1:116,x2:vx,y2:vy,stroke:'#e3b577','stroke-width':4}));
    g.append(svg('circle',{cx:lx,cy:ly,r:12,fill:'#1a1916',stroke:'#9f8560'}),svg('text',{x:lx,y:ly+3,'text-anchor':'middle',fill:'#ead3ae','font-size':9},String(i+1).padStart(2,'0')));
    g.onclick=()=>show(i);g.onfocus=()=>show(i);g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();show(i)}};
    art.append(g);
  });
  art.append(svg('circle',{cx:150,cy:116,r:4,fill:'#efcf9c'}));
  section.append(art,description);show(0);return section;
}
