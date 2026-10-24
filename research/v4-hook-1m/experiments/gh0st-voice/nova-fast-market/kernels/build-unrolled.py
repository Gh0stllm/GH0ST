from pathlib import Path
p=Path(__file__).parent
s=(p/'assembly-sample.sol').read_text()
a=s.index('   function featureDot(')
b=s.index('   function sigmoid(',a)
s=s[:a]+'''   function featureDot(d,i,f)->total {
    let ptr:=add(d,mul(i,12))
'''+ '\n'.join(f'    total:=add(total,mul(signextend(1,shr(240,mload(add(ptr,{j*2})))),signextend(3,mload(add(f,{j*32})))))' for j in range(6))+'\n   }\n'+s[b:]
a=s.index('   function prepare(')
b=s.index('   function input(',a)
inner=[]
for j in range(11):
 inner.append(f'     {{let value:=add(signextend(1,mload(add(v,mul(add(base,{j}),32)))),1024) total:=add(total,value) packed:=or(packed,shl({j*23},value))}}')
last=[]
for j in range(10):
 last.append(f'    {{let value:=add(signextend(1,mload(add(v,mul(add(off,{374+j}),32)))),1024) total:=add(total,value) packed:=or(packed,shl({j*23},value))}}')
s=s[:a]+'''   function prepare(v,off,d)->total {
    for {let g:=0}lt(g,34){g:=add(g,1)} {
     let packed:=0
     let base:=add(off,mul(g,11))
'''+ '\n'.join(inner)+'''\n     mstore(add(d,mul(g,32)),packed)
    }
    let packed:=0
'''+ '\n'.join(last)+'''\n    mstore(add(d,1088),packed)
   }
'''+s[b:]
(p/'assembly-unrolled.sol').write_text(s)
