export const GLYPHS=' .:-=+*#@';
export function asciiPolicy(width,dpr=1,reduced=false){return{fontSize:width<400?8.1:width<760?8.8:11.2,lineScale:1.32,pixelRatio:Math.min(Math.max(Number(dpr)||1,1),1.5),maxFPS:width<760?18:24,maxColumns:180,reduced:Boolean(reduced)}}
export function canAnimate({hidden,visible,paused,reduced}){return!hidden&&visible&&!paused&&!reduced}
const RH=['####..#...#','#...#.#...#','#...#.#...#','####..#####','#.#...#...#','#..#..#...#','#...#.#...#'];
export function frameRows(cols,rows,time=0,mode=0){
 const output=[],small=cols<90,cx=Math.round(cols*(small?.76:.77)),fh=Math.max(11,Math.round(rows*.75)),cy=Math.ceil(fh/2)+1,fw=Math.min(Math.floor(cols*.47),Math.round(fh*2.1)),hw=fw/2,hh=fh/2;
 const terraces=[[.16,.86,.16,.13],[.45,.74,.19,.14],[.77,.62,.21,.16]],rhLeft=Math.round(cols*.45)-5,rhTop=Math.round(rows*.43)-3;
 for(let r=0;r<rows;r++){
  const layers=['','','',''];
  for(let c=0;c<cols;c++){
   const x=c/(cols-1),y=r/(rows-1),dx=c-cx,dy=r-cy;let char=' ',color=0;
   for(let i=0;i<3;i++){
    const[a,b,rx,ry]=terraces[i],q=((x-a)/rx)**4+((y-b)/ry)**2;
    if(q<=1){char=q>.7?'#':'=+*#@'[(c+r+i+Math.floor(time*1.3))%5];color=i===2?2:1}
   }
   // A narrow packet stream connects the terraces. Its phase always wraps positively.
   if(x>.12&&x<.77){const t=(x-.12)/.65,curve=.75-.45*(t*t*(3-2*t));if(Math.abs(y-curve)<.018){const moving=((x*40-time*.8)%9+9)%9;char=moving<1.6?'>':moving<3?'+':'-';color=moving<1.6?2:1}}
   // Ethereum's two-part diamond is drawn from literal ASCII cells, not an image.
   const ex=(x-.16)/.064,ey=(y-.53)/.18;
   if(Math.abs(ex)+Math.abs(ey)<=1){char=Math.abs(ey)<.13?' ':ex<0?'#':'@';color=3}
   // RH is an original block-letter node rather than the brand's feather logo.
   const rc=c-rhLeft,rr=r-rhTop;
   if(rc>=-1&&rc<=11&&rr>=-1&&rr<=7){char=' ';color=0;if(rc>=0&&rc<11&&rr>=0&&rr<7&&RH[rr][rc]==='#'){char='@';color=3}}
   // Large GH0ST bracket-face, with a clean interior and bright, distinct eyes.
   const faceInside=Math.abs(dx)<hw-1&&Math.abs(dy)<hh-1;
   if(faceInside){char=' ';color=0}
   const vertical=Math.abs(Math.abs(dx)-hw)<1&&Math.abs(dy)<=hh,cap=Math.abs(Math.abs(dy)-hh)<.8&&Math.abs(dx)>hw-fw*.23&&Math.abs(dx)<=hw;
   if(vertical||cap){char=(c+r+Math.floor(time*.6))%3===0?'@':'#';color=2}
   const eye=Math.abs(Math.abs(dx)-fw*.19)<1.25&&Math.abs(dy+fh*.08)<1.6;
   if(eye){char='@';color=3}
   if(Math.abs(dy-fh*.25)<.55&&Math.abs(dx)<fw*.12){char='_';color=3}
   if(mode===1&&color===1&&x>.55)color=2;
   for(let k=0;k<4;k++)layers[k]+=k===color?char:' ';
  }
  output.push(layers);
 }
 return output;
}
