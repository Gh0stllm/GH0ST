from pathlib import Path
p=Path(__file__).parent
s=(p/'assembly-b25x10a5.sol').read_text()
a=s.index('   function dot('); b=s.index('   let a:=',a)
old=s[a:b]
loader=old[:old.index('   total:=')]
loader=loader.replace('function dot(pg,off,entry,values,shiftedSum)->total','function loadWeights(pg,off,entry)->weights').replace('    let weights:=add(data,inside)','    weights:=add(data,inside)')+'   }\n'
triple=['   function dot3(pg,off,entry,values,shiftedSum)->r,z,n {',
 '    let wr:=loadWeights(pg,off,entry)',
 '    let wz:=loadWeights(pg,add(off,503808),add(entry,25376))',
 '    let wn:=loadWeights(pg,add(off,1007616),add(entry,50752))']
for begin in range(0,39,5):
 triple+=['    {','     let ar:=0 let az:=0 let an:=0']
 for chunk in range(begin,min(begin+5,39)):
  off=chunk*32
  triple.append(f'     {{let v:=mload(add(values,{off})) ar:=add(ar,mul(v,mload(add(wr,{off})))) az:=add(az,mul(v,mload(add(wz,{off})))) an:=add(an,mul(v,mload(add(wn,{off}))))}}')
 triple+=['     r:=add(r,and(shr(225,ar),0x1ffffff))','     z:=add(z,and(shr(225,az),0x1ffffff))','     n:=add(n,and(shr(225,an),0x1ffffff))','    }']
for result,w in [('r','wr'),('z','wz'),('n','wn')]:triple.append(f'    {result}:=sub(sub({result},mul(mload(add({w},1280)),shiftedSum)),mul(1024,mload(add({w},1248))))')
triple+=['   }','']
s=s[:a]+loader+'\n'.join(triple)+s[b:]
a=s.index('    let rr:=sdiv(dot(',s.index(' function _gru('));b=s.index('    let old:=',a)
s=s[:a]+'''    let rr,rz,rn:=dot3(page,mul(i,1312),cacheData,a,sumA)
    rr:=sdiv(rr,1024) rz:=sdiv(rz,1024) rn:=sdiv(rn,1024)
'''+s[b:]
a=s.index('    let xr:=sdiv(add(dot(',s.index(' function _gru('));b=s.index('    let idx:=',a)
s=s[:a]+'''    let xr,xz,xn:=dot3(page,mul(add(1152,i),1312),cacheData,c,sumC)
    xr:=sdiv(add(xr,mul(weight(auxData,add(6912,i)),1024)),1024)
    xz:=sdiv(add(xz,mul(weight(auxData,add(7296,i)),1024)),1024)
    xn:=sdiv(add(xn,mul(weight(auxData,add(7680,i)),1024)),1024)
    let rr,rz,rn:=dot3(page,mul(add(2304,i),1312),add(cacheData,76128),b,sumB)
    rr:=sdiv(rr,1024) rz:=sdiv(rz,1024) rn:=sdiv(rn,1024)
'''+s[b:]
(p/'assembly-triple.sol').write_text(s)
