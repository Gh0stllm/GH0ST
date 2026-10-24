from pathlib import Path
p=Path(__file__).parent
s=(p/'baseline.sol').read_text()
start=s.index('  (bytes memory old1,int256 sum1)=_prepare(state,0);')
end=s.index('  (bytes memory out,int256 outSum)=_prepare(next,384);',start)
s=s[:start]+'  _gru(state,features,row,pr,aux,table,buffer,next);\n'+s[end:]
dots='\n'.join(f'    total:=add(total,and(shr(230,mul(mload(add(values,{i*32})),mload(add(weights,{i*32})))),0x7fffff))' for i in range(35))
func='''
 function _gru(int16[768] memory state,int32[6] memory features,bytes memory row,bytes memory pr,bytes memory aux,bytes memory table,bytes memory buffer,int16[768] memory next) private view {
  address page=coreRowsPage;
  bytes memory packedA=new bytes(1120);bytes memory packedB=new bytes(1120);bytes memory packedC=new bytes(1120);
  assembly("memory-safe") {
   function prepare(v,off,d)->total {
    for {let g:=0}lt(g,35){g:=add(g,1)} {
     let packed:=0
     for {let j:=0}lt(j,11){j:=add(j,1)} {
      let i:=add(mul(g,11),j)
      if lt(i,384) {
       let value:=add(signextend(1,mload(add(v,mul(add(off,i),32)))),1024)
       total:=add(total,value)
       packed:=or(packed,shl(mul(j,23),value))
      }
     }
     mstore(add(d,mul(g,32)),packed)
    }
   }
   function input(d,i)->x {x:=signextend(4,shr(216,mload(add(d,mul(i,5)))))}
   function weight(d,i)->x {x:=signextend(1,shr(240,mload(add(d,mul(i,2)))))}
   function featureDot(d,i,f)->total {
    let ptr:=add(d,mul(i,12))
    for {let j:=0}lt(j,6){j:=add(j,1)} {
     let w:=signextend(1,shr(240,mload(add(ptr,mul(j,2)))))
     total:=add(total,mul(w,signextend(3,mload(add(f,mul(j,32))))))
    }
   }
   function sigmoid(x,t)->y {
    let a:=x
    if slt(x,0){a:=sub(0,x)}
    let idx:=shr(6,add(a,32))
    if gt(idx,256){idx:=256}
    let delta:=shr(240,mload(add(t,mul(idx,2))))
    let value:=add(32768,delta)
    if slt(x,0){value:=sub(32768,delta)}
    y:=shr(6,add(value,32))
   }
   function cell(xr,rr,xz,rz,xn,rn,old,t)->value {
    let r:=sigmoid(add(xr,rr),t)
    let z:=sigmoid(add(xz,rz),t)
    let n:=sub(mul(2,sigmoid(mul(2,add(xn,sdiv(mul(r,rn),1024))),t)),1024)
    value:=sdiv(add(mul(z,old),mul(sub(1024,z),n)),1024)
   }
   function dot(pg,off,weights,values,shiftedSum)->total {
    let dst:=weights
    let end:=add(weights,1184)
    for {}lt(dst,end){} {
     let inside:=mod(off,24000)
     let take:=sub(24000,inside)
     if gt(take,sub(end,dst)){take:=sub(end,dst)}
     extcodecopy(pg,0,add(1,mul(div(off,24000),20)),20)
     let source:=shr(96,mload(0))
     extcodecopy(source,dst,add(inside,1),take)
     dst:=add(dst,take) off:=add(off,take)
    }
DOTS
    total:=sub(sub(total,mul(mload(add(weights,1152)),shiftedSum)),mul(1024,mload(add(weights,1120))))
   }
   let a:=add(packedA,32)
   let b:=add(packedB,32)
   let c:=add(packedC,32)
   let sumA:=prepare(state,0,a)
   let sumB:=prepare(state,384,b)
   let w:=add(buffer,32)
   let rowData:=add(row,32)
   let punctData:=add(pr,32)
   let auxData:=add(aux,32)
   let t:=add(table,32)
   for {let i:=0}lt(i,384){i:=add(i,1)} {
    let xr:=sdiv(add(add(input(rowData,i),input(punctData,i)),featureDot(auxData,i,features)),1024)
    let xz:=sdiv(add(add(input(rowData,add(384,i)),input(punctData,add(384,i))),featureDot(auxData,add(384,i),features)),1024)
    let xn:=sdiv(add(add(input(rowData,add(768,i)),input(punctData,add(768,i))),featureDot(auxData,add(768,i),features)),1024)
    let rr:=sdiv(dot(page,mul(i,1184),w,a,sumA),1024)
    let rz:=sdiv(dot(page,mul(add(384,i),1184),w,a,sumA),1024)
    let rn:=sdiv(dot(page,mul(add(768,i),1184),w,a,sumA),1024)
    let old:=signextend(1,mload(add(state,mul(i,32))))
    mstore(add(next,mul(i,32)),cell(xr,rr,xz,rz,xn,rn,old,t))
   }
   let sumC:=prepare(next,0,c)
   for {let i:=0}lt(i,384){i:=add(i,1)} {
    let xr:=sdiv(add(dot(page,mul(add(1152,i),1184),w,c,sumC),mul(weight(auxData,add(6912,i)),1024)),1024)
    let xz:=sdiv(add(dot(page,mul(add(1536,i),1184),w,c,sumC),mul(weight(auxData,add(7296,i)),1024)),1024)
    let xn:=sdiv(add(dot(page,mul(add(1920,i),1184),w,c,sumC),mul(weight(auxData,add(7680,i)),1024)),1024)
    let rr:=sdiv(dot(page,mul(add(2304,i),1184),w,b,sumB),1024)
    let rz:=sdiv(dot(page,mul(add(2688,i),1184),w,b,sumB),1024)
    let rn:=sdiv(dot(page,mul(add(3072,i),1184),w,b,sumB),1024)
    let idx:=mul(add(i,384),32)
    let old:=signextend(1,mload(add(state,idx)))
    mstore(add(next,idx),cell(xr,rr,xz,rz,xn,rn,old,t))
   }
  }
 }
'''.replace('DOTS',dots)
s=s[:s.index(' function _headBias')]+func+s[s.index(' function _headBias'):]
(p/'assembly-gru.sol').write_text(s)
