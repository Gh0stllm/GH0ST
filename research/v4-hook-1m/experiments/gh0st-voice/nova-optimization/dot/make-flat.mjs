// Derive an exact local optimization of the SIMD11 candidate. No deployment.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const dir=path.dirname(fileURLToPath(import.meta.url));
let s=fs.readFileSync(path.join(dir,'simd11-unroll35.sol'),'utf8');
const fields=' address private immutable coreRowsPage;address private immutable groupRowsPage;address private immutable wordRowsPage;address private immutable punctuationRowsPage;\n';
s=s.replace(' error InvalidModel();',fields+' error InvalidModel();');
s=s.replace('  coreCatalog=c;groupCatalog=g;wordCatalog=w;vocabularyCatalog=v;fusedCatalog=f;punctuationCatalog=p;',
'  coreCatalog=c;groupCatalog=g;wordCatalog=w;vocabularyCatalog=v;fusedCatalog=f;punctuationCatalog=p;\n'+
'  // Every matrix group has fewer than 1024 pinned shards, so its first page is its only page.\n'+
'  coreRowsPage=_entry(c,0);groupRowsPage=_entry(g,0);wordRowsPage=_entry(w,0);punctuationRowsPage=_entry(p,0);');
for(const [name,page]of [['coreCatalog','coreRowsPage'],['groupCatalog','groupRowsPage'],['wordCatalog','wordRowsPage'],['punctuationCatalog','punctuationRowsPage']])s=s.replaceAll('_dot('+name+',','_dot('+page+',');
const begin=s.indexOf(' function _dot('),end=s.indexOf('\n function _headBias',begin);
assert(begin>0&&end>begin);
const terms=Array.from({length:35},(_,i)=>`sum:=add(sum,and(shr(230,mul(mload(add(values,${i*32})),mload(add(weights,${i*32})))),0x7fffff))`).join('\n');
const fn=` function _dot(address page,uint256 row,uint256 stride,bytes memory buffer,bytes memory vector,int256 shiftedSum)private view returns(int256 sum){uint256 offset=row*stride;
  assembly("memory-safe"){
   let weights:=add(buffer,32) let values:=add(vector,32)
   let destination:=weights let end:=add(weights,stride)
   for {} lt(destination,end) {} {
    let inside:=mod(offset,24000)
    let take:=sub(24000,inside)
    if gt(take,sub(end,destination)) {take:=sub(end,destination)}
    extcodecopy(page,0,add(1,mul(div(offset,24000),20)),20)
    let source:=shr(96,mload(0))
    extcodecopy(source,destination,add(inside,1),take)
    destination:=add(destination,take) offset:=add(offset,take)
   }
   ${terms}
   sum:=sub(sub(sum,mul(mload(add(weights,1152)),shiftedSum)),mul(1024,mload(add(weights,1120))))}}
`;
s=s.slice(0,begin)+fn+s.slice(end);
fs.writeFileSync(path.join(dir,'simd11-flat.sol'),s);
