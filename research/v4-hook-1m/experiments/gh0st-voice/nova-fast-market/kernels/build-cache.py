from pathlib import Path
p=Path(__file__).parent
s=(p/'assembly-gru.sol').read_text()
s=s.replace('bytes memory packedC=new bytes(1120);','bytes memory packedC=new bytes(1120);bytes memory cache=new bytes(151488);')
a=s.index('   function dot(pg,off,weights,values,shiftedSum)->total {')
b=s.index('    total:=add(total',a)
s=s[:a]+'''   function dot(pg,off,entry,values,shiftedSum)->total {
    let index:=div(off,24000)
    let inside:=mod(off,24000)
    let data:=add(entry,32)
    if iszero(eq(mload(entry),add(index,1))) {
     extcodecopy(pg,0,add(1,mul(index,20)),20)
     let source:=shr(96,mload(0))
     extcodecopy(source,data,1,24000)
     mstore(entry,add(index,1))
    }
    if gt(add(inside,1184),24000) {
     extcodecopy(pg,0,add(1,mul(add(index,1),20)),20)
     let source:=shr(96,mload(0))
     extcodecopy(source,add(data,24000),1,sub(add(inside,1184),24000))
    }
    let weights:=add(data,inside)
'''+s[b:]
s=s.replace('   let w:=add(buffer,32)','   let w:=add(buffer,32)\n   let cacheData:=add(cache,32)')
s=s.replace('dot(page,mul(i,1184),w,a,sumA)','dot(page,mul(i,1184),cacheData,a,sumA)')
s=s.replace('dot(page,mul(add(384,i),1184),w,a,sumA)','dot(page,mul(add(384,i),1184),add(cacheData,25248),a,sumA)')
s=s.replace('dot(page,mul(add(768,i),1184),w,a,sumA)','dot(page,mul(add(768,i),1184),add(cacheData,50496),a,sumA)')
for row,n in [(1152,0),(1536,1),(1920,2),(2304,3),(2688,4),(3072,5)]:
 vector,total=('c','sumC') if row<2304 else ('b','sumB')
 s=s.replace(f'dot(page,mul(add({row},i),1184),w,{vector},{total})',f'dot(page,mul(add({row},i),1184),add(cacheData,{n*25248}),{vector},{total})')
(p/'assembly-cache.sol').write_text(s)
