from pathlib import Path
import re,sys
p=Path(__file__).parent
name=sys.argv[1]
layout=p.parent/'layout'/name
base=(p/'assembly-unrolled.sol').read_text()
new=(layout/'GRU2SIMDModel.sol').read_text()
manifest=__import__('json').loads((layout/'manifest.json').read_text())
# All layout-level constants and domains come from the audited exporter.
for symbol in ['CORE_BYTES','GROUP_BYTES','WORD_BYTES','VOCABULARY_BYTES','FUSED_BYTES','PUNCTUATION_BYTES','CORE_STRIDE','HEAD_STRIDE','CORE_MATRICES','PUNCT_FOLD']:
 val=re.search(r'\b'+symbol+r'=(\d+)',new).group(1)
 base=re.sub(r'(\b'+symbol+r'=)\d+',lambda m:m.group(1)+val,base)
base=re.sub(r'"GH0ST_GRU2_[^"\n]+"',re.search(r'"GH0ST_GRU2_[^"\n]+"',new).group(0),base)
# Extract function boundaries by braces rather than formatting.
def function_span(source,name):
 a=source.index(' function '+name+'(')
 pos=source.index('{',a); depth=1; end=pos+1
 while depth:
  if source[end]=='{':depth+=1
  elif source[end]=='}':depth-=1
  end+=1
 return a,end
for fnname in ['_prepare','_dot','_headBias']:
 a,b=function_span(base,fnname);na,nb=function_span(new,fnname)
 base=base[:a]+new[na:nb]+base[b:]
na,nb=function_span(new,'_dot')
ndot=new[na:nb]
math=ndot[ndot.index('   sum:='):]
assert math.endswith('}}')
math=math[:-2]
math=re.sub(r'\bsum\b','total',math)
a=base.index('    total:=add(total',base.index('   function dot('))
b=base.index('\n   }\n   let a:=',a)
base=base[:a]+math+base[b:]
# Layout-specific GRU stride and stream cache size.
core=int(re.search(r'CORE_STRIDE=(\d+)',new).group(1))
head=int(re.search(r'HEAD_STRIDE=(\d+)',new).group(1))
base=base.replace('_read(punctuationCatalog,6080+',f'_read(punctuationCatalog,{5*head}+')
chunks=(core-64)//32
oldentry=25248;entry=32+24000+head
parta=base.index(' function _gru(');partb=base.index('\n function _headBias',parta)
gru=base[parta:partb]
gru=gru.replace('new bytes(1120)',f'new bytes({chunks*32})').replace('new bytes(151488)',f'new bytes({6*entry})')
# Only GRU dot literal1184 reflects CORE_STRIDE; normal head dot uses stride.
gru=re.sub(r'\b1184\b',str(core),gru)
# 1184 is also the 38th coefficient word offset; only stride arithmetic changes.
gru=gru.replace('mload(add(values,'+str(core)+'))','mload(add(values,1184))').replace('mload(add(weights,'+str(core)+'))','mload(add(weights,1184))')
for multiple in range(5,0,-1):gru=re.sub(r'\b'+str(multiple*oldentry)+r'\b',str(multiple*entry),gru)
# Generic prepare (same signed/shifted vector semantics as layout _prepare).
lanes=int(sys.argv[2])
radix=int(sys.argv[3])
signed='signed' in name
# Data format adapter is deliberately explicit; signed needs a separate path.
assert not signed
full=384//lanes;tail=384%lanes
body=['   function prepare(v,off,d)->total {',f'    for {{let g:=0}}lt(g,{full}){{g:=add(g,1)}} {{','     let packed:=0',f'     let base:=add(off,mul(g,{lanes}))']
for j in range(lanes):body.append(f'     {{let value:=add(signextend(1,mload(add(v,mul(add(base,{j}),32)))),1024) total:=add(total,value) packed:=or(packed,shl({j*radix},value))}}')
body+=['     mstore(add(d,mul(g,32)),packed)','    }']
if tail:
 body.append('    let packed:=0')
 for j in range(tail):body.append(f'    {{let value:=add(signextend(1,mload(add(v,mul(add(off,{full*lanes+j}),32)))),1024) total:=add(total,value) packed:=or(packed,shl({j*radix},value))}}')
 body.append(f'    mstore(add(d,{full*32}),packed)')
body+=['   }','']
a=gru.index('   function prepare(');b=gru.index('   function input(',a)
gru=gru[:a]+'\n'.join(body)+gru[b:]
base=base[:parta]+gru+base[partb:]
(p/('assembly-'+name+'.sol')).write_text(base)
