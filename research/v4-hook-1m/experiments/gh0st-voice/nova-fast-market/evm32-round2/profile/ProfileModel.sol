// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract GRU2SIMDModel {
 uint16 public constant VOCABULARY=8192;uint256 public constant HIDDEN=768;uint256 public constant WIDTH=384;
 uint256 public constant SOURCE_MODEL_PARAMETERS=8175493;
 uint256 constant CHUNK=24000;uint256 constant PAGE=1024;
 uint256 public constant CORE_BYTES=4550400;uint256 public constant GROUP_BYTES=172032;uint256 public constant WORD_BYTES=11010048;
 uint256 public constant VOCABULARY_BYTES=262144;uint256 public constant FUSED_BYTES=47191680;uint256 public constant PUNCTUATION_BYTES=117440;
 uint256 constant CORE_STRIDE=1312;uint256 constant HEAD_STRIDE=1344;uint256 constant CORE_MATRICES=4534272;uint256 constant PUNCT_FOLD=88640;
 address public immutable coreCatalog;address public immutable groupCatalog;address public immutable wordCatalog;
 address public immutable vocabularyCatalog;address public immutable fusedCatalog;address public immutable punctuationCatalog;bytes32 public immutable modelHash;
 address private immutable coreRowsPage;address private immutable groupRowsPage;address private immutable wordRowsPage;address private immutable punctuationRowsPage;
 error InvalidModel();error InvalidInput();
 struct Scratch {uint256[8] phase;bytes row;bytes pr;bytes aux;bytes table;bytes buffer;bytes packedA;bytes packedB;bytes packedC;bytes cache;bytes out;bytes pb;bytes vocab;bytes sampleTable;uint256[128] weights;}
 function _scratch() private view returns(Scratch memory s){s.row=new bytes(5760);s.pr=new bytes(5760);s.aux=_read(coreCatalog,CORE_MATRICES,16128);s.table=SIGMOID_DELTA;s.buffer=new bytes(HEAD_STRIDE);s.packedA=new bytes(1248);s.packedB=new bytes(1248);s.packedC=new bytes(1248);s.cache=new bytes(152256);s.out=new bytes(1248);s.pb=new bytes(10);s.vocab=new bytes(32);s.sampleTable=EXP_Q32;}

 bytes private constant SIGMOID_DELTA=hex"02000210022002300240024f025f026e027d028c029b02a902b702c502d302e002ed02f903050311031c03270331033b0345034f03580360036803700378037f0386038d03930399039e03a403a903ae03b203b703bb03bf03c203c603c903cc03cf03d203d503d703da03dc03de03e003e203e403e503e703e803ea03eb03ec03ee03ef03f003f103f203f203f303f403f503f503f603f703f703f803f803f903f903fa03fa03fa03fb03fb03fb03fc03fc03fc03fc03fd03fd03fd03fd03fd03fd03fe03fe03fe03fe03fe03fe03fe03fe03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400040004000400020001f001e001d001c001b101a1019201830174016501570149013b012d01200113010700fb00ef00e400d900cf00c500bb00b100a800a00098009000880081007a0074006d00670062005c00570052004e004900450041003e003a003700340031002e002b00290026002400220020001e001c001b00190018001600150014001200110010000f000e000e000d000c000b000b000a00090009000800080007000700060006000600050005000500040004000400040003000300030003000300030002000200020002000200020002000200010001000100010001000100010001000100010001000100010001000100010001000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";bytes private constant EXP_Q32=hex"000000010000000000000000f07d5fde00000000e1eb512700000000d43b409600000000c75f7cf500000000bb4b297000000000aff230af00000000a54938ca000000009b4597e30000000091dd4986000000008906e49a0000000080b991ff0000000078ed03b00000000071996c78000000006ab778250000000064404430000000005e2d58d9000000005878a2b400000000531c6c92000000004e1359c900000000495860dd0000000044e6c66e0000000040ba1883000000003cce2a1600000000391f0ee50000000035a91785000000003268cdb5000000002f5af0e7000000002c7c72fc0000000029ca753900000000274245670000000024e15b200000000022a5554700000000208bf7a7000000001e9328b5000000001cb8ef77000000001afb718f000000001958f1570000000017cfcc2d00000000165e78cc00000000150385c10000000013bd97fb00000000128b697300000000116bc7e100000000105d9389000000000f5fbe23000000000e7149c2000000000d9147e0000000000cbed866000000000bf928d6000000000b3f736d000000000a90fe680000000009ed1b43000000000953260c0000000008c284c300000000083aa6ba0000000007bb04060000000007431cfc0000000006d279aa000000000668a962000000000605424d0000000005a7e0fb00000000055028020000000004fdbfa30000000004b0556e0000000004679bf20000000004234a710000000003e31c920000000003a6d22200000000036e2ed3000000000338f9fb000000000306fe630000000002d80a090000000002abedf60000000002827e0a00000000025b90d1000000000236ff5c000000000214a5150000000001f45fa00000000001d60eb40000000001b993fe00000000019ed301000000000185b0f900000000016e14c3000000000157e6c000000000014310c000000000012f7ded00000000011d1ab000000000010bd4a60000000000fb9a860000000000ec5c170000000000de0a170000000000d096330000000000c3f2f80000000000b813bf0000000000acecaa0000000000a272900000000000989af500000000008f5c03000000000086ac7800000000007e83a5000000000076d96100000000006fa5ff000000000068e24d000000000062878600000000005c8f4f000000000056f3af000000000051af0900000000004cbc1a00000000004815ed000000000043b7dc00000000003f9d8800000000003bc2d700000000003823ee000000000034bd2e0000000000318b2f00000000002e8ac000000000002bb8df00000000002912bb00000000002695ad0000000000243f370000000000220d0400000000001ffce100000000001e0cbd00000000001c3aa900000000001a84d2000000000018e981000000000017671d000000000015fc21000000000014a72300000000001366ce00000000001239e20000000000111f3100000000001015a100000000000f1c2700000000000e31cb00000000000d55a200000000000c86d000000000000bc48500000000000b0e0000000000000a628a000000000009c1780000000000092a270000000000089c02000000000008167900000000000799080000000000072330000000000006b47b0000000000064c7c000000000005eaca0000000000058f0400000000000538cc000000000004e7ce0000000000049bb8000000000004543f0000000000041119000000000003d20600000000000396c40000000000035f1a0000000000032acf000000000002f9af000000000002cb89000000000002a02f000000000002777500000000000251330000000000022d430000000000020b7f000000000001ebc8000000000001cdfc000000000001b1ff00000000000197b30000000000017f0000000000000167cb00000000000151ff0000000000013d840000000000012a480000000000011835000000000001073b000000000000f748000000000000e84d000000000000da3a000000000000cd01000000000000c095000000000000b4ea000000000000a9f40000000000009fa800000000000095fc0000000000008ce6000000000000845c0000000000007c5700000000000074cf0000000000006dbb000000000000671500000000000060d60000000000005af8000000000000557500000000000050480000000000004b6b00000000000046d9000000000000428e0000000000003e860000000000003abc000000000000372d00000000000033d500000000000030b10000000000002dbe0000000000002af9000000000000285e00000000000025ec00000000000023a000000000000021770000000000001f700000000000001d890000000000001bbf0000000000001a10000000000000187c0000000000001700000000000000159b000000000000144c000000000000131200000000000011ea00000000000010d40000000000000fcf0000000000000eda0000000000000df30000000000000d1b0000000000000c500000000000000b910000000000000add0000000000000a3500000000000009970000000000000902000000000000087600000000000007f3000000000000077800000000000007040000000000000697000000000000063100000000000005d10000000000000577000000000000052200000000000004d20000000000000487000000000000044100000000000003ff00000000000003c100000000000003870000000000000350000000000000031d00000000000002ed00000000000002bf0000000000000295000000000000026d00000000000002470000000000000224000000000000020300000000000001e3";
 constructor(address c,address g,address w,address v,address f,address p){if(block.chainid!=31337)revert InvalidModel();
  bytes32 a=_pin(c,CORE_BYTES);bytes32 d=_pin(g,GROUP_BYTES);bytes32 e=_pin(w,WORD_BYTES);bytes32 j=_pin(v,VOCABULARY_BYTES);bytes32 k=_pin(f,FUSED_BYTES);bytes32 l=_pin(p,PUNCTUATION_BYTES);
  coreCatalog=c;groupCatalog=g;wordCatalog=w;vocabularyCatalog=v;fusedCatalog=f;punctuationCatalog=p;
  // Every matrix group has fewer than 1024 pinned shards, so its first page is its only page.
  coreRowsPage=_entry(c,0);groupRowsPage=_entry(g,0);wordRowsPage=_entry(w,0);punctuationRowsPage=_entry(p,0);
  modelHash=keccak256(abi.encode("GH0ST_GRU2_SIMD10_BITS25_ACC5_H384_Q10_LOCAL_V1",a,d,e,j,k,l));}
 function _entry(address a,uint256 i)private view returns(address v){assembly("memory-safe"){extcodecopy(a,0,add(1,mul(i,20)),20)v:=shr(96,mload(0))}}
 function _source(address a,uint256 i)private view returns(address){return _entry(_entry(a,i/PAGE),i%PAGE);}
 function _pin(address a,uint256 total)private view returns(bytes32 h){uint256 n=(total+CHUNK-1)/CHUNK;uint256 pages=(n+PAGE-1)/PAGE;
  if(a.code.length!=1+pages*20)revert InvalidModel();for(uint256 p;p<pages;++p){uint256 m=n-p*PAGE;if(m>PAGE)m=PAGE;if(_entry(a,p).code.length!=1+m*20)revert InvalidModel();}
  for(uint256 i;i<n;++i){address t=_source(a,i);uint256 len=total-i*CHUNK;if(len>CHUNK)len=CHUNK;if(t.code.length!=len+1)revert InvalidModel();h=keccak256(abi.encode(h,t.codehash));}}
 function _readInto(address catalog,uint256 offset,uint256 length,bytes memory data)private view {
  // All callers use constructor-validated immutable catalogs and internally bounded offsets.
  // This is the same split-at-24000 operation as the scalar Solidity reader.
  assembly("memory-safe") {
   let destination:=add(data,32)
   let end:=add(destination,length)
   for {} lt(destination,end) {} {
    let index:=div(offset,24000)
    let inside:=mod(offset,24000)
    let take:=sub(24000,inside)
    if gt(take,sub(end,destination)) {take:=sub(end,destination)}
    extcodecopy(catalog,0,add(1,mul(div(index,1024),20)),20)
    let page:=shr(96,mload(0))
    extcodecopy(page,0,add(1,mul(mod(index,1024),20)),20)
    let source:=shr(96,mload(0))
    extcodecopy(source,destination,add(inside,1),take)
    destination:=add(destination,take)
    offset:=add(offset,take)
   }
  }
 }
 function _read(address a,uint256 off,uint256 len)private view returns(bytes memory d){d=new bytes(len);_readInto(a,off,len,d);}
 function _weight(bytes memory d,uint256 i)private pure returns(int256 x){assembly("memory-safe"){x:=signextend(1,shr(240,mload(add(add(d,32),mul(i,2)))))}}
 function _input(bytes memory d,uint256 i)private pure returns(int256 x){assembly("memory-safe"){x:=signextend(4,shr(216,mload(add(add(d,32),mul(i,5)))))}}
 function _prepareInto(int16[768] memory v,uint256 offset,bytes memory packedVector)private pure returns(int256 shiftedSum){
  assembly("memory-safe"){for{let group:=0}lt(group,39){group:=add(group,1)}{let packedValue:=0 for{let j:=0}lt(j,10){j:=add(j,1)}{let i:=add(mul(group,10),j) if lt(i,384){let value:=add(signextend(1,mload(add(v,shl(5,add(offset,i))))),1024) shiftedSum:=add(shiftedSum,value) packedValue:=or(packedValue,shl(mul(j,25),value))}}mstore(add(add(packedVector,32),mul(group,32)),packedValue)}}}
 function _dot(address page,uint256 row,uint256 stride,bytes memory buffer,bytes memory vector,int256 shiftedSum)private view returns(int256 sum){uint256 offset=row*stride;
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
{ let acc:=0
acc:=add(acc,mul(mload(add(values,0)),mload(add(weights,0))))
acc:=add(acc,mul(mload(add(values,32)),mload(add(weights,32))))
acc:=add(acc,mul(mload(add(values,64)),mload(add(weights,64))))
acc:=add(acc,mul(mload(add(values,96)),mload(add(weights,96))))
acc:=add(acc,mul(mload(add(values,128)),mload(add(weights,128))))
acc:=add(acc,mul(mload(add(values,160)),mload(add(weights,160))))
acc:=add(acc,mul(mload(add(values,192)),mload(add(weights,192))))
sum:=add(sum,and(shr(225,acc),0x1ffffff)) }
{ let acc:=0
acc:=add(acc,mul(mload(add(values,224)),mload(add(weights,224))))
acc:=add(acc,mul(mload(add(values,256)),mload(add(weights,256))))
acc:=add(acc,mul(mload(add(values,288)),mload(add(weights,288))))
acc:=add(acc,mul(mload(add(values,320)),mload(add(weights,320))))
acc:=add(acc,mul(mload(add(values,352)),mload(add(weights,352))))
acc:=add(acc,mul(mload(add(values,384)),mload(add(weights,384))))
acc:=add(acc,mul(mload(add(values,416)),mload(add(weights,416))))
acc:=add(acc,mul(mload(add(values,448)),mload(add(weights,448))))
sum:=add(sum,and(shr(225,acc),0x1ffffff)) }
{ let acc:=0
acc:=add(acc,mul(mload(add(values,480)),mload(add(weights,480))))
acc:=add(acc,mul(mload(add(values,512)),mload(add(weights,512))))
acc:=add(acc,mul(mload(add(values,544)),mload(add(weights,544))))
acc:=add(acc,mul(mload(add(values,576)),mload(add(weights,576))))
acc:=add(acc,mul(mload(add(values,608)),mload(add(weights,608))))
acc:=add(acc,mul(mload(add(values,640)),mload(add(weights,640))))
acc:=add(acc,mul(mload(add(values,672)),mload(add(weights,672))))
acc:=add(acc,mul(mload(add(values,704)),mload(add(weights,704))))
sum:=add(sum,and(shr(225,acc),0x1ffffff)) }
{ let acc:=0
acc:=add(acc,mul(mload(add(values,736)),mload(add(weights,736))))
acc:=add(acc,mul(mload(add(values,768)),mload(add(weights,768))))
acc:=add(acc,mul(mload(add(values,800)),mload(add(weights,800))))
acc:=add(acc,mul(mload(add(values,832)),mload(add(weights,832))))
acc:=add(acc,mul(mload(add(values,864)),mload(add(weights,864))))
acc:=add(acc,mul(mload(add(values,896)),mload(add(weights,896))))
acc:=add(acc,mul(mload(add(values,928)),mload(add(weights,928))))
sum:=add(sum,and(shr(225,acc),0x1ffffff)) }
{ let acc:=0
acc:=add(acc,mul(mload(add(values,960)),mload(add(weights,960))))
acc:=add(acc,mul(mload(add(values,992)),mload(add(weights,992))))
acc:=add(acc,mul(mload(add(values,1024)),mload(add(weights,1024))))
acc:=add(acc,mul(mload(add(values,1056)),mload(add(weights,1056))))
acc:=add(acc,mul(mload(add(values,1088)),mload(add(weights,1088))))
acc:=add(acc,mul(mload(add(values,1120)),mload(add(weights,1120))))
acc:=add(acc,mul(mload(add(values,1152)),mload(add(weights,1152))))
sum:=add(sum,and(shr(225,acc),0x1ffffff)) }
{ let acc:=0
acc:=add(acc,mul(mload(add(values,1184)),mload(add(weights,1184))))
acc:=add(acc,mul(mload(add(values,1216)),mload(add(weights,1216))))
sum:=add(sum,and(shr(225,acc),0x1ffffff)) }
   sum:=sub(sub(sum,mul(mload(add(weights,1280)),shiftedSum)),mul(1024,mload(add(weights,1248))))}}


 function _gru(int16[768] memory state,int32[6] memory features,Scratch memory scratch,int16[768] memory next) private view {
  address page=coreRowsPage;
  bytes memory packedA=scratch.packedA;bytes memory packedB=scratch.packedB;bytes memory packedC=scratch.packedC;bytes memory cache=scratch.cache;
  bytes memory row=scratch.row;bytes memory pr=scratch.pr;bytes memory aux=scratch.aux;bytes memory table=scratch.table;bytes memory buffer=scratch.buffer;
  assembly("memory-safe") {
   function prepare(v,off,d)->total {
    for {let g:=0}lt(g,38){g:=add(g,1)} {
     let packed:=0
     let base:=add(off,mul(g,10))
     {let value:=add(signextend(1,mload(add(v,mul(add(base,0),32)))),1024) total:=add(total,value) packed:=or(packed,shl(0,value))}
     {let value:=add(signextend(1,mload(add(v,mul(add(base,1),32)))),1024) total:=add(total,value) packed:=or(packed,shl(25,value))}
     {let value:=add(signextend(1,mload(add(v,mul(add(base,2),32)))),1024) total:=add(total,value) packed:=or(packed,shl(50,value))}
     {let value:=add(signextend(1,mload(add(v,mul(add(base,3),32)))),1024) total:=add(total,value) packed:=or(packed,shl(75,value))}
     {let value:=add(signextend(1,mload(add(v,mul(add(base,4),32)))),1024) total:=add(total,value) packed:=or(packed,shl(100,value))}
     {let value:=add(signextend(1,mload(add(v,mul(add(base,5),32)))),1024) total:=add(total,value) packed:=or(packed,shl(125,value))}
     {let value:=add(signextend(1,mload(add(v,mul(add(base,6),32)))),1024) total:=add(total,value) packed:=or(packed,shl(150,value))}
     {let value:=add(signextend(1,mload(add(v,mul(add(base,7),32)))),1024) total:=add(total,value) packed:=or(packed,shl(175,value))}
     {let value:=add(signextend(1,mload(add(v,mul(add(base,8),32)))),1024) total:=add(total,value) packed:=or(packed,shl(200,value))}
     {let value:=add(signextend(1,mload(add(v,mul(add(base,9),32)))),1024) total:=add(total,value) packed:=or(packed,shl(225,value))}
     mstore(add(d,mul(g,32)),packed)
    }
    let packed:=0
    {let value:=add(signextend(1,mload(add(v,mul(add(off,380),32)))),1024) total:=add(total,value) packed:=or(packed,shl(0,value))}
    {let value:=add(signextend(1,mload(add(v,mul(add(off,381),32)))),1024) total:=add(total,value) packed:=or(packed,shl(25,value))}
    {let value:=add(signextend(1,mload(add(v,mul(add(off,382),32)))),1024) total:=add(total,value) packed:=or(packed,shl(50,value))}
    {let value:=add(signextend(1,mload(add(v,mul(add(off,383),32)))),1024) total:=add(total,value) packed:=or(packed,shl(75,value))}
    mstore(add(d,1216),packed)
   }
   function input(d,i)->x {x:=signextend(4,shr(216,mload(add(d,mul(i,5)))))}
   function weight(d,i)->x {x:=signextend(1,shr(240,mload(add(d,mul(i,2)))))}
   function featureDot(d,i,f)->total {
    let ptr:=add(d,mul(i,12))
    total:=add(total,mul(signextend(1,shr(240,mload(add(ptr,0)))),signextend(3,mload(add(f,0)))))
    total:=add(total,mul(signextend(1,shr(240,mload(add(ptr,2)))),signextend(3,mload(add(f,32)))))
    total:=add(total,mul(signextend(1,shr(240,mload(add(ptr,4)))),signextend(3,mload(add(f,64)))))
    total:=add(total,mul(signextend(1,shr(240,mload(add(ptr,6)))),signextend(3,mload(add(f,96)))))
    total:=add(total,mul(signextend(1,shr(240,mload(add(ptr,8)))),signextend(3,mload(add(f,128)))))
    total:=add(total,mul(signextend(1,shr(240,mload(add(ptr,10)))),signextend(3,mload(add(f,160)))))
   }
   function sigmoid(x,t)->y {
    let a:=x
    let neg:=0
    if slt(x,0){a:=sub(0,x) neg:=514}
    let idx:=shr(6,add(a,32))
    if gt(idx,256){idx:=256}
    y:=shr(240,mload(add(t,add(neg,mul(idx,2)))))
   }
   function cell(xr,rr,xz,rz,xn,rn,old,t)->value {
    let r:=sigmoid(add(xr,rr),t)
    let z:=sigmoid(add(xz,rz),t)
    let n:=sub(mul(2,sigmoid(mul(2,add(xn,sdiv(mul(r,rn),1024))),t)),1024)
    value:=sdiv(add(mul(z,old),mul(sub(1024,z),n)),1024)
   }
   function dot(pg,off,entry,values,shiftedSum)->total {
    let index:=div(off,24000)
    let inside:=mod(off,24000)
    let data:=add(entry,32)
    if iszero(eq(mload(entry),add(index,1))) {
     extcodecopy(pg,0,add(1,mul(index,20)),20)
     let source:=shr(96,mload(0))
     extcodecopy(source,data,1,24000)
     mstore(entry,add(index,1))
    }
    if gt(add(inside,1312),24000) {
     extcodecopy(pg,0,add(1,mul(add(index,1),20)),20)
     let source:=shr(96,mload(0))
     extcodecopy(source,add(data,24000),1,sub(add(inside,1312),24000))
    }
    let weights:=add(data,inside)
{ let acc:=0
acc:=add(acc,mul(mload(add(values,0)),mload(add(weights,0))))
acc:=add(acc,mul(mload(add(values,32)),mload(add(weights,32))))
acc:=add(acc,mul(mload(add(values,64)),mload(add(weights,64))))
acc:=add(acc,mul(mload(add(values,96)),mload(add(weights,96))))
acc:=add(acc,mul(mload(add(values,128)),mload(add(weights,128))))
acc:=add(acc,mul(mload(add(values,160)),mload(add(weights,160))))
total:=add(total,and(shr(225,acc),0x1ffffff)) }
{ let acc:=0
acc:=add(acc,mul(mload(add(values,192)),mload(add(weights,192))))
acc:=add(acc,mul(mload(add(values,224)),mload(add(weights,224))))
acc:=add(acc,mul(mload(add(values,256)),mload(add(weights,256))))
acc:=add(acc,mul(mload(add(values,288)),mload(add(weights,288))))
acc:=add(acc,mul(mload(add(values,320)),mload(add(weights,320))))
acc:=add(acc,mul(mload(add(values,352)),mload(add(weights,352))))
total:=add(total,and(shr(225,acc),0x1ffffff)) }
{ let acc:=0
acc:=add(acc,mul(mload(add(values,384)),mload(add(weights,384))))
acc:=add(acc,mul(mload(add(values,416)),mload(add(weights,416))))
acc:=add(acc,mul(mload(add(values,448)),mload(add(weights,448))))
acc:=add(acc,mul(mload(add(values,480)),mload(add(weights,480))))
acc:=add(acc,mul(mload(add(values,512)),mload(add(weights,512))))
total:=add(total,and(shr(225,acc),0x1ffffff)) }
{ let acc:=0
acc:=add(acc,mul(mload(add(values,544)),mload(add(weights,544))))
acc:=add(acc,mul(mload(add(values,576)),mload(add(weights,576))))
acc:=add(acc,mul(mload(add(values,608)),mload(add(weights,608))))
acc:=add(acc,mul(mload(add(values,640)),mload(add(weights,640))))
acc:=add(acc,mul(mload(add(values,672)),mload(add(weights,672))))
acc:=add(acc,mul(mload(add(values,704)),mload(add(weights,704))))
total:=add(total,and(shr(225,acc),0x1ffffff)) }
{ let acc:=0
acc:=add(acc,mul(mload(add(values,736)),mload(add(weights,736))))
acc:=add(acc,mul(mload(add(values,768)),mload(add(weights,768))))
acc:=add(acc,mul(mload(add(values,800)),mload(add(weights,800))))
acc:=add(acc,mul(mload(add(values,832)),mload(add(weights,832))))
acc:=add(acc,mul(mload(add(values,864)),mload(add(weights,864))))
acc:=add(acc,mul(mload(add(values,896)),mload(add(weights,896))))
total:=add(total,and(shr(225,acc),0x1ffffff)) }
{ let acc:=0
acc:=add(acc,mul(mload(add(values,928)),mload(add(weights,928))))
acc:=add(acc,mul(mload(add(values,960)),mload(add(weights,960))))
acc:=add(acc,mul(mload(add(values,992)),mload(add(weights,992))))
acc:=add(acc,mul(mload(add(values,1024)),mload(add(weights,1024))))
acc:=add(acc,mul(mload(add(values,1056)),mload(add(weights,1056))))
acc:=add(acc,mul(mload(add(values,1088)),mload(add(weights,1088))))
total:=add(total,and(shr(225,acc),0x1ffffff)) }
{ let acc:=0
acc:=add(acc,mul(mload(add(values,1120)),mload(add(weights,1120))))
acc:=add(acc,mul(mload(add(values,1152)),mload(add(weights,1152))))
acc:=add(acc,mul(mload(add(values,1184)),mload(add(weights,1184))))
acc:=add(acc,mul(mload(add(values,1216)),mload(add(weights,1216))))
total:=add(total,and(shr(225,acc),0x1ffffff)) }
   total:=sub(sub(total,mul(mload(add(weights,1280)),shiftedSum)),mul(1024,mload(add(weights,1248))))
   }
   let a:=add(packedA,32)
   let b:=add(packedB,32)
   let c:=add(packedC,32)
   let sumA:=prepare(state,0,a)
   let sumB:=prepare(state,384,b)
   let w:=add(buffer,32)
   let cacheData:=add(cache,32)
   let rowData:=add(row,32)
   let punctData:=add(pr,32)
   let auxData:=add(aux,32)
   let t:=add(table,32)
   for {let i:=0}lt(i,384){i:=add(i,1)} {
    let xr:=sdiv(add(add(input(rowData,i),input(punctData,i)),featureDot(auxData,i,features)),1024)
    let xz:=sdiv(add(add(input(rowData,add(384,i)),input(punctData,add(384,i))),featureDot(auxData,add(384,i),features)),1024)
    let xn:=sdiv(add(add(input(rowData,add(768,i)),input(punctData,add(768,i))),featureDot(auxData,add(768,i),features)),1024)
    let rr:=sdiv(dot(page,mul(i,1312),cacheData,a,sumA),1024)
    let rz:=sdiv(dot(page,mul(add(384,i),1312),add(cacheData,25376),a,sumA),1024)
    let rn:=sdiv(dot(page,mul(add(768,i),1312),add(cacheData,50752),a,sumA),1024)
    let old:=signextend(1,mload(add(state,mul(i,32))))
    mstore(add(next,mul(i,32)),cell(xr,rr,xz,rz,xn,rn,old,t))
   }
   let sumC:=prepare(next,0,c)
   for {let i:=0}lt(i,384){i:=add(i,1)} {
    let xr:=sdiv(add(dot(page,mul(add(1152,i),1312),add(cacheData,0),c,sumC),mul(weight(auxData,add(6912,i)),1024)),1024)
    let xz:=sdiv(add(dot(page,mul(add(1536,i),1312),add(cacheData,25376),c,sumC),mul(weight(auxData,add(7296,i)),1024)),1024)
    let xn:=sdiv(add(dot(page,mul(add(1920,i),1312),add(cacheData,50752),c,sumC),mul(weight(auxData,add(7680,i)),1024)),1024)
    let rr:=sdiv(dot(page,mul(add(2304,i),1312),add(cacheData,76128),b,sumB),1024)
    let rz:=sdiv(dot(page,mul(add(2688,i),1312),add(cacheData,101504),b,sumB),1024)
    let rn:=sdiv(dot(page,mul(add(3072,i),1312),add(cacheData,126880),b,sumB),1024)
    let idx:=mul(add(i,384),32)
    let old:=signextend(1,mload(add(state,idx)))
    mstore(add(next,idx),cell(xr,rr,xz,rz,xn,rn,old,t))
   }
  }
 }
 function _headBias(bytes memory d)private pure returns(int256 v){assembly("memory-safe"){v:=mload(add(add(d,32),1312))}}
 function _dot6(bytes memory d,uint256 offset,int32[6] memory vector)private pure returns(int256 sum){assembly("memory-safe"){let ptr:=add(add(d,32),mul(offset,2))for{let i:=0}lt(i,6){i:=add(i,1)}{let w:=signextend(1,shr(240,mload(add(ptr,mul(i,2)))))sum:=add(sum,mul(w,signextend(3,mload(add(vector,mul(i,32))))))}}}
 function _sigmoid(int256 x,bytes memory d)private pure returns(int256 result){
  // x derives only from bounded int16 weights, bounded activations and int32 features.
  assembly("memory-safe") {
   let a:=x
   if slt(x,0) {a:=sub(0,x)}
   let index:=shr(6,add(a,32))
   if gt(index,256) {index:=256}
   let delta:=shr(240,mload(add(add(d,32),shl(1,index))))
   let value:=add(32768,delta)
   if slt(x,0) {value:=sub(32768,delta)}
   result:=shr(6,add(value,32))
  }
 }
 function _cell(int256 xr,int256 rr,int256 xz,int256 rz,int256 xn,int256 rn,int16 old,bytes memory table)private pure returns(int16 result){
  // Each gate lies in[0,1024], candidate/old in[-1024,1024]; no overflowing products.
  // sdiv preserves the reference's truncation toward zero at each original division.
  assembly("memory-safe") {
   function sigmoid(x,t)->y {
    let a:=x
    if slt(x,0) {a:=sub(0,x)}
    let index:=shr(6,add(a,32))
    if gt(index,256) {index:=256}
    let delta:=shr(240,mload(add(add(t,32),shl(1,index))))
    let value:=add(32768,delta)
    if slt(x,0) {value:=sub(32768,delta)}
    y:=shr(6,add(value,32))
   }
   let r:=sigmoid(add(xr,rr),table)
   let z:=sigmoid(add(xz,rz),table)
   let n:=sub(mul(2,sigmoid(mul(2,add(xn,sdiv(mul(r,rn),1024))),table)),1024)
   result:=sdiv(add(mul(z,signextend(1,old)),mul(sub(1024,z),n)),1024)
  }
 }
 function _sample(int256[197] memory scores,uint256 start,uint256 count,uint256 temperature,uint256 entropy,Scratch memory scratch) private pure returns(uint256 result) {
  bytes memory t=scratch.sampleTable;
  uint256[128] memory weights=scratch.weights;
  assembly("memory-safe") {
   let source:=add(scores,mul(start,32))
   let maximum:=mload(source)
   for {let i:=1}lt(i,count){i:=add(i,1)} {
    let value:=mload(add(source,mul(i,32)))
    if sgt(value,maximum) {maximum:=value}
   }
   let total:=0
   let dest:=weights
   for {let i:=0}lt(i,count){i:=add(i,1)} {
    let index:=div(add(div(mul(sub(maximum,mload(add(source,mul(i,32)))),1024),temperature),32),64)
    if gt(index,256){index:=256}
    let weight:=shr(192,mload(add(add(t,32),mul(index,8))))
    mstore(add(dest,mul(i,32)),weight)
    total:=add(total,weight)
   }
   let draw:=mod(entropy,total)
   result:=count
   for {let i:=0}lt(i,count){i:=add(i,1)} {
    let weight:=mload(add(dest,mul(i,32)))
    if lt(draw,weight){result:=i break}
    draw:=sub(draw,weight)
   }
  }
  if(result==count) revert InvalidInput();
 }
 function word(uint16 token)public view returns(bytes32 value,uint8 length){if(token>=8192)revert InvalidInput();bytes memory d=_read(vocabularyCatalog,uint256(token)*32,32);assembly("memory-safe"){value:=mload(add(d,32))}for(uint256 i;i<32&&value[i]!=0;++i){uint8 c=uint8(value[i]);if(!((c>=97&&c<=122)||(c==39&&i>0)))revert InvalidModel();length++;}if(length==0)revert InvalidModel();}
 function _validate(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,uint16 temperature) private pure {
  if(previous>8192||previousPunct>4||temperature<64||temperature>4096)revert InvalidInput();
  bool badInput;
  assembly("memory-safe") {
   for {let p:=state let e:=add(state,24576)} lt(p,e) {p:=add(p,32)} {
    let v:=signextend(1,mload(p))
    if or(slt(v,sub(0,1024)),sgt(v,1024)) {badInput:=1 break}
   }
   for {let p:=features let e:=add(features,192)} lt(p,e) {p:=add(p,32)} {
    let v:=signextend(3,mload(p))
    if or(slt(v,sub(0,4096)),sgt(v,4096)) {badInput:=1 break}
   }
  }
  if(badInput) revert InvalidInput();
 }
 function _step(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature,Scratch memory scratch,int16[768] memory next,int256[197] memory scores) private view returns(uint16 token,uint8 punct,string memory text,bool terminal){
  scratch.phase[0]=gasleft();_readInto(fusedCatalog,uint256(previous)*5760,5760,scratch.row);_readInto(punctuationCatalog,PUNCT_FOLD+uint256(previousPunct)*5760,5760,scratch.pr);
  scratch.phase[1]=gasleft();_gru(state,features,scratch,next);scratch.phase[2]=gasleft();
  bytes memory out=scratch.out;bytes memory buffer=scratch.buffer;int256 outSum=_prepareInto(next,384,out);
  for(uint256 i;i<128;++i){int256 value=_dot(groupRowsPage,i,HEAD_STRIDE,buffer,out,outSum);scores[i]=(value+_headBias(buffer)*1024)/1024;}
  scratch.phase[3]=gasleft();uint256 group=_sample(scores,0,128,temperature,uint256(keccak256(abi.encode(seed,wordIndex,uint256(0)))),scratch);
  scratch.phase[4]=gasleft();for(uint256 i;i<64;++i){int256 value=_dot(wordRowsPage,group*64+i,HEAD_STRIDE,buffer,out,outSum);scores[128+i]=(value+_headBias(buffer)*1024)/1024;}
  scratch.phase[5]=gasleft();token=uint16(group*64+_sample(scores,128,64,temperature,uint256(keccak256(abi.encode(seed,wordIndex,uint256(1)))),scratch));bytes memory pb=scratch.pb;_readInto(punctuationCatalog,6720+uint256(token)*10,10,pb);
  for(uint256 i;i<5;++i){int256 value=_dot(punctuationRowsPage,i,HEAD_STRIDE,buffer,out,outSum);scores[192+i]=(value+(_headBias(buffer)+_weight(pb,i))*1024)/1024;}
  scratch.phase[6]=gasleft();punct=uint8(_sample(scores,192,5,temperature,uint256(keccak256(abi.encode(seed,wordIndex,uint256(2)))),scratch));
  scratch.phase[7]=gasleft();bytes memory vocab=scratch.vocab;_readInto(vocabularyCatalog,uint256(token)*32,32,vocab);bytes32 v;assembly("memory-safe"){v:=mload(add(vocab,32))}uint8 size;
  for(uint256 i;i<32&&v[i]!=0;++i){uint8 c=uint8(v[i]);if(!((c>=97&&c<=122)||(c==39&&i>0)))revert InvalidModel();size++;}if(size==0)revert InvalidModel();
  bytes memory output=new bytes(uint256(size)+(punct==0?0:1));for(uint256 i;i<size;++i)output[i]=v[i];if(punct!=0)output[size]=punct==1?bytes1(","):punct==2?bytes1("."):punct==3?bytes1("!"):bytes1("?");return(token,punct,string(output),punct>=2);
 }
 function profile(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature)external view returns(uint256[8] memory phases,uint256 elapsed,string memory text){
 uint256 initial=gasleft();_validate(previous,previousPunct,state,features,temperature);Scratch memory scratch=_scratch();int16[768] memory next;int256[197] memory scores;(,,text,)=_step(previous,previousPunct,state,features,seed,wordIndex,temperature,scratch,next,scores);phases=scratch.phase;elapsed=initial-gasleft();
 }
 function stepSampled(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature)external view returns(uint16 token,uint8 punct,int16[768] memory next,int256[197] memory scores,string memory text,bool terminal){
  _validate(previous,previousPunct,state,features,temperature);Scratch memory scratch=_scratch();(token,punct,text,terminal)=_step(previous,previousPunct,state,features,seed,wordIndex,temperature,scratch,next,scores);
 }
 struct BatchResult {uint16[3] tokens;uint8[3] puncts;int16[768][3] states;int256[197][3] scores;string[3] texts;uint8 count;bool terminal;}
 function stepBatchChecked(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature,uint8 maxWords)external view returns(uint16[3] memory,uint8[3] memory,int16[768][3] memory,int256[197][3] memory,string[3] memory,uint8,bool){
  BatchResult memory r=_batchChecked(previous,previousPunct,state,features,seed,wordIndex,temperature,maxWords);
  return(r.tokens,r.puncts,r.states,r.scores,r.texts,r.count,r.terminal);
 }
 function _batchChecked(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature,uint8 maxWords)private view returns(BatchResult memory r){
  _validate(previous,previousPunct,state,features,temperature);if(maxWords==0||maxWords>3||wordIndex>type(uint256).max-(maxWords-1))revert InvalidInput();
  Scratch memory scratch=_scratch();
  for(uint8 i;i<maxWords;++i){(r.tokens[i],r.puncts[i],r.texts[i],r.terminal)=_step(previous,previousPunct,state,features,seed,wordIndex+i,temperature,scratch,r.states[i],r.scores[i]);previous=r.tokens[i];previousPunct=r.puncts[i];state=r.states[i];r.count=i+1;if(r.terminal)break;}
 }
}
