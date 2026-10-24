// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract GRU2SIMDModel {
 uint16 public constant VOCABULARY=8192;uint256 public constant HIDDEN=768;uint256 public constant WIDTH=384;
 uint256 public constant SOURCE_MODEL_PARAMETERS=8175493;
 uint256 constant CHUNK=24000;uint256 constant PAGE=1024;
 uint256 public constant CORE_BYTES=4108032;uint256 public constant GROUP_BYTES=155648;uint256 public constant WORD_BYTES=9961472;
 uint256 public constant VOCABULARY_BYTES=262144;uint256 public constant FUSED_BYTES=47191680;uint256 public constant PUNCTUATION_BYTES=116800;
 uint256 constant CORE_STRIDE=1184;uint256 constant HEAD_STRIDE=1216;uint256 constant CORE_MATRICES=4091904;uint256 constant PUNCT_FOLD=88000;
 address public immutable coreCatalog;address public immutable groupCatalog;address public immutable wordCatalog;
 address public immutable vocabularyCatalog;address public immutable fusedCatalog;address public immutable punctuationCatalog;bytes32 public immutable modelHash;
 address private immutable coreRowsPage;address private immutable groupRowsPage;address private immutable wordRowsPage;address private immutable punctuationRowsPage;
 error InvalidModel();error InvalidInput();
 bytes private constant SIGMOID_DELTA=hex"0000040007fd0bf70feb13d717b91b901f59231426bf2a582ddf315134ae37f63b273e404142442c46fd49b64c564edd514d53a355e2580a5a1a5c135df65fc4617c632064b0662d679768f06a376b6e6c956dac6eb56fb0709e717f7254731e73dc7490753a75da7672770177887807787f78f0795b79bf7a1e7a777acb7b1b7b657bab7bee7c2c7c667c9d7cd17d027d307d5b7d847daa7dce7df07e0f7e2d7e497e647e7d7e947eaa7ebf7ed27ee47ef57f057f147f237f307f3d7f487f547f5e7f687f717f7a7f827f897f917f977f9e7fa47fa97fae7fb37fb87fbc7fc07fc47fc87fcb7fce7fd17fd47fd77fd97fdc7fde7fe07fe27fe47fe57fe77fe97fea7feb7fed7fee7fef7ff07ff17ff27ff37ff37ff47ff57ff67ff67ff77ff77ff87ff87ff97ff97ffa7ffa7ffa7ffb7ffb7ffb7ffc7ffc7ffc7ffc7ffd7ffd7ffd7ffd7ffd7ffe7ffe7ffe7ffe7ffe7ffe7ffe7ffe7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff80008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000";bytes private constant EXP_Q32=hex"000000010000000000000000f07d5fde00000000e1eb512700000000d43b409600000000c75f7cf500000000bb4b297000000000aff230af00000000a54938ca000000009b4597e30000000091dd4986000000008906e49a0000000080b991ff0000000078ed03b00000000071996c78000000006ab778250000000064404430000000005e2d58d9000000005878a2b400000000531c6c92000000004e1359c900000000495860dd0000000044e6c66e0000000040ba1883000000003cce2a1600000000391f0ee50000000035a91785000000003268cdb5000000002f5af0e7000000002c7c72fc0000000029ca753900000000274245670000000024e15b200000000022a5554700000000208bf7a7000000001e9328b5000000001cb8ef77000000001afb718f000000001958f1570000000017cfcc2d00000000165e78cc00000000150385c10000000013bd97fb00000000128b697300000000116bc7e100000000105d9389000000000f5fbe23000000000e7149c2000000000d9147e0000000000cbed866000000000bf928d6000000000b3f736d000000000a90fe680000000009ed1b43000000000953260c0000000008c284c300000000083aa6ba0000000007bb04060000000007431cfc0000000006d279aa000000000668a962000000000605424d0000000005a7e0fb00000000055028020000000004fdbfa30000000004b0556e0000000004679bf20000000004234a710000000003e31c920000000003a6d22200000000036e2ed3000000000338f9fb000000000306fe630000000002d80a090000000002abedf60000000002827e0a00000000025b90d1000000000236ff5c000000000214a5150000000001f45fa00000000001d60eb40000000001b993fe00000000019ed301000000000185b0f900000000016e14c3000000000157e6c000000000014310c000000000012f7ded00000000011d1ab000000000010bd4a60000000000fb9a860000000000ec5c170000000000de0a170000000000d096330000000000c3f2f80000000000b813bf0000000000acecaa0000000000a272900000000000989af500000000008f5c03000000000086ac7800000000007e83a5000000000076d96100000000006fa5ff000000000068e24d000000000062878600000000005c8f4f000000000056f3af000000000051af0900000000004cbc1a00000000004815ed000000000043b7dc00000000003f9d8800000000003bc2d700000000003823ee000000000034bd2e0000000000318b2f00000000002e8ac000000000002bb8df00000000002912bb00000000002695ad0000000000243f370000000000220d0400000000001ffce100000000001e0cbd00000000001c3aa900000000001a84d2000000000018e981000000000017671d000000000015fc21000000000014a72300000000001366ce00000000001239e20000000000111f3100000000001015a100000000000f1c2700000000000e31cb00000000000d55a200000000000c86d000000000000bc48500000000000b0e0000000000000a628a000000000009c1780000000000092a270000000000089c02000000000008167900000000000799080000000000072330000000000006b47b0000000000064c7c000000000005eaca0000000000058f0400000000000538cc000000000004e7ce0000000000049bb8000000000004543f0000000000041119000000000003d20600000000000396c40000000000035f1a0000000000032acf000000000002f9af000000000002cb89000000000002a02f000000000002777500000000000251330000000000022d430000000000020b7f000000000001ebc8000000000001cdfc000000000001b1ff00000000000197b30000000000017f0000000000000167cb00000000000151ff0000000000013d840000000000012a480000000000011835000000000001073b000000000000f748000000000000e84d000000000000da3a000000000000cd01000000000000c095000000000000b4ea000000000000a9f40000000000009fa800000000000095fc0000000000008ce6000000000000845c0000000000007c5700000000000074cf0000000000006dbb000000000000671500000000000060d60000000000005af8000000000000557500000000000050480000000000004b6b00000000000046d9000000000000428e0000000000003e860000000000003abc000000000000372d00000000000033d500000000000030b10000000000002dbe0000000000002af9000000000000285e00000000000025ec00000000000023a000000000000021770000000000001f700000000000001d890000000000001bbf0000000000001a10000000000000187c0000000000001700000000000000159b000000000000144c000000000000131200000000000011ea00000000000010d40000000000000fcf0000000000000eda0000000000000df30000000000000d1b0000000000000c500000000000000b910000000000000add0000000000000a3500000000000009970000000000000902000000000000087600000000000007f3000000000000077800000000000007040000000000000697000000000000063100000000000005d10000000000000577000000000000052200000000000004d20000000000000487000000000000044100000000000003ff00000000000003c100000000000003870000000000000350000000000000031d00000000000002ed00000000000002bf0000000000000295000000000000026d00000000000002470000000000000224000000000000020300000000000001e3";
 constructor(address c,address g,address w,address v,address f,address p){if(block.chainid!=31337)revert InvalidModel();
  bytes32 a=_pin(c,CORE_BYTES);bytes32 d=_pin(g,GROUP_BYTES);bytes32 e=_pin(w,WORD_BYTES);bytes32 j=_pin(v,VOCABULARY_BYTES);bytes32 k=_pin(f,FUSED_BYTES);bytes32 l=_pin(p,PUNCTUATION_BYTES);
  coreCatalog=c;groupCatalog=g;wordCatalog=w;vocabularyCatalog=v;fusedCatalog=f;punctuationCatalog=p;
  // Every matrix group has fewer than 1024 pinned shards, so its first page is its only page.
  coreRowsPage=_entry(c,0);groupRowsPage=_entry(g,0);wordRowsPage=_entry(w,0);punctuationRowsPage=_entry(p,0);
  modelHash=keccak256(abi.encode("GH0ST_GRU2_SIMD11_H384_Q10_LOCAL_V1",a,d,e,j,k,l));}
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
 function _prepare(int16[768] memory v,uint256 offset)private pure returns(bytes memory packedVector,int256 shiftedSum){packedVector=new bytes(1120);
  assembly("memory-safe"){for{let group:=0}lt(group,35){group:=add(group,1)}{let packedValue:=0 for{let j:=0}lt(j,11){j:=add(j,1)}{let i:=add(mul(group,11),j) if lt(i,384){let value:=add(signextend(1,mload(add(v,shl(5,add(offset,i))))),1024) shiftedSum:=add(shiftedSum,value) packedValue:=or(packedValue,shl(mul(j,23),value))}}mstore(add(add(packedVector,32),mul(group,32)),packedValue)}}}
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
   sum:=add(sum,and(shr(230,mul(mload(add(values,0)),mload(add(weights,0)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,32)),mload(add(weights,32)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,64)),mload(add(weights,64)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,96)),mload(add(weights,96)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,128)),mload(add(weights,128)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,160)),mload(add(weights,160)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,192)),mload(add(weights,192)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,224)),mload(add(weights,224)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,256)),mload(add(weights,256)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,288)),mload(add(weights,288)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,320)),mload(add(weights,320)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,352)),mload(add(weights,352)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,384)),mload(add(weights,384)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,416)),mload(add(weights,416)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,448)),mload(add(weights,448)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,480)),mload(add(weights,480)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,512)),mload(add(weights,512)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,544)),mload(add(weights,544)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,576)),mload(add(weights,576)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,608)),mload(add(weights,608)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,640)),mload(add(weights,640)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,672)),mload(add(weights,672)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,704)),mload(add(weights,704)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,736)),mload(add(weights,736)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,768)),mload(add(weights,768)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,800)),mload(add(weights,800)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,832)),mload(add(weights,832)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,864)),mload(add(weights,864)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,896)),mload(add(weights,896)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,928)),mload(add(weights,928)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,960)),mload(add(weights,960)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,992)),mload(add(weights,992)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,1024)),mload(add(weights,1024)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,1056)),mload(add(weights,1056)))),0x7fffff))
sum:=add(sum,and(shr(230,mul(mload(add(values,1088)),mload(add(weights,1088)))),0x7fffff))
   sum:=sub(sub(sum,mul(mload(add(weights,1152)),shiftedSum)),mul(1024,mload(add(weights,1120))))}}


 function _gru(int16[768] memory state,int32[6] memory features,bytes memory row,bytes memory pr,bytes memory aux,bytes memory table,bytes memory buffer,int16[768] memory next) private view {
  address page=coreRowsPage;
  bytes memory packedA=new bytes(1120);bytes memory packedB=new bytes(1120);bytes memory packedC=new bytes(1120);bytes memory cache=new bytes(151488);
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
    if gt(add(inside,1184),24000) {
     extcodecopy(pg,0,add(1,mul(add(index,1),20)),20)
     let source:=shr(96,mload(0))
     extcodecopy(source,add(data,24000),1,sub(add(inside,1184),24000))
    }
    let weights:=add(data,inside)
    total:=add(total,and(shr(230,mul(mload(add(values,0)),mload(add(weights,0)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,32)),mload(add(weights,32)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,64)),mload(add(weights,64)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,96)),mload(add(weights,96)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,128)),mload(add(weights,128)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,160)),mload(add(weights,160)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,192)),mload(add(weights,192)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,224)),mload(add(weights,224)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,256)),mload(add(weights,256)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,288)),mload(add(weights,288)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,320)),mload(add(weights,320)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,352)),mload(add(weights,352)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,384)),mload(add(weights,384)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,416)),mload(add(weights,416)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,448)),mload(add(weights,448)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,480)),mload(add(weights,480)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,512)),mload(add(weights,512)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,544)),mload(add(weights,544)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,576)),mload(add(weights,576)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,608)),mload(add(weights,608)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,640)),mload(add(weights,640)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,672)),mload(add(weights,672)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,704)),mload(add(weights,704)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,736)),mload(add(weights,736)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,768)),mload(add(weights,768)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,800)),mload(add(weights,800)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,832)),mload(add(weights,832)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,864)),mload(add(weights,864)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,896)),mload(add(weights,896)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,928)),mload(add(weights,928)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,960)),mload(add(weights,960)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,992)),mload(add(weights,992)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,1024)),mload(add(weights,1024)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,1056)),mload(add(weights,1056)))),0x7fffff))
    total:=add(total,and(shr(230,mul(mload(add(values,1088)),mload(add(weights,1088)))),0x7fffff))
    total:=sub(sub(total,mul(mload(add(weights,1152)),shiftedSum)),mul(1024,mload(add(weights,1120))))
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
    let rr:=sdiv(dot(page,mul(i,1184),cacheData,a,sumA),1024)
    let rz:=sdiv(dot(page,mul(add(384,i),1184),add(cacheData,25248),a,sumA),1024)
    let rn:=sdiv(dot(page,mul(add(768,i),1184),add(cacheData,50496),a,sumA),1024)
    let old:=signextend(1,mload(add(state,mul(i,32))))
    mstore(add(next,mul(i,32)),cell(xr,rr,xz,rz,xn,rn,old,t))
   }
   let sumC:=prepare(next,0,c)
   for {let i:=0}lt(i,384){i:=add(i,1)} {
    let xr:=sdiv(add(dot(page,mul(add(1152,i),1184),add(cacheData,0),c,sumC),mul(weight(auxData,add(6912,i)),1024)),1024)
    let xz:=sdiv(add(dot(page,mul(add(1536,i),1184),add(cacheData,25248),c,sumC),mul(weight(auxData,add(7296,i)),1024)),1024)
    let xn:=sdiv(add(dot(page,mul(add(1920,i),1184),add(cacheData,50496),c,sumC),mul(weight(auxData,add(7680,i)),1024)),1024)
    let rr:=sdiv(dot(page,mul(add(2304,i),1184),add(cacheData,75744),b,sumB),1024)
    let rz:=sdiv(dot(page,mul(add(2688,i),1184),add(cacheData,100992),b,sumB),1024)
    let rn:=sdiv(dot(page,mul(add(3072,i),1184),add(cacheData,126240),b,sumB),1024)
    let idx:=mul(add(i,384),32)
    let old:=signextend(1,mload(add(state,idx)))
    mstore(add(next,idx),cell(xr,rr,xz,rz,xn,rn,old,t))
   }
  }
 }
 function _headBias(bytes memory d)private pure returns(int256 v){assembly("memory-safe"){v:=mload(add(add(d,32),1184))}}
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
 function _sample(int256[197] memory scores,uint256 start,uint256 count,uint256 temperature,uint256 entropy)private pure returns(uint256){int256 maximum=scores[start];for(uint256 i=1;i<count;++i)if(scores[start+i]>maximum)maximum=scores[start+i];bytes memory t=EXP_Q32;uint256[] memory weights=new uint256[](count);uint256 total;
  for(uint256 i;i<count;++i){uint256 at=(uint256(maximum-scores[start+i])*1024/temperature+32)/64;if(at>256)at=256;uint256 w;assembly("memory-safe"){w:=shr(192,mload(add(add(t,32),mul(at,8))))}weights[i]=w;total+=w;}
  uint256 draw=entropy%total;for(uint256 i;i<count;++i){if(draw<weights[i])return i;draw-=weights[i];}revert InvalidInput();}
 function word(uint16 token)public view returns(bytes32 value,uint8 length){if(token>=8192)revert InvalidInput();bytes memory d=_read(vocabularyCatalog,uint256(token)*32,32);assembly("memory-safe"){value:=mload(add(d,32))}for(uint256 i;i<32&&value[i]!=0;++i){uint8 c=uint8(value[i]);if(!((c>=97&&c<=122)||(c==39&&i>0)))revert InvalidModel();length++;}if(length==0)revert InvalidModel();}
 function stepSampled(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature)external view returns(uint16 token,uint8 punct,int16[768] memory next,int256[197] memory scores,string memory text,bool terminal){
  if(previous>8192||previousPunct>4||temperature<64||temperature>4096)revert InvalidInput();for(uint256 i;i<768;++i)if(state[i]<-1024||state[i]>1024)revert InvalidInput();for(uint256 i;i<6;++i)if(features[i]<-4096||features[i]>4096)revert InvalidInput();
  bytes memory row=_read(fusedCatalog,uint256(previous)*5760,5760);bytes memory pr=_read(punctuationCatalog,PUNCT_FOLD+uint256(previousPunct)*5760,5760);bytes memory aux=_read(coreCatalog,CORE_MATRICES,16128);bytes memory table=SIGMOID_DELTA;bytes memory buffer=new bytes(HEAD_STRIDE);
  _gru(state,features,row,pr,aux,table,buffer,next);
  (bytes memory out,int256 outSum)=_prepare(next,384);
  for(uint256 i;i<128;++i){int256 value=_dot(groupRowsPage,i,HEAD_STRIDE,buffer,out,outSum);scores[i]=(value+_headBias(buffer)*1024)/1024;}
  uint256 group=_sample(scores,0,128,temperature,uint256(keccak256(abi.encode(seed,wordIndex,uint256(0)))));
  for(uint256 i;i<64;++i){int256 value=_dot(wordRowsPage,group*64+i,HEAD_STRIDE,buffer,out,outSum);scores[128+i]=(value+_headBias(buffer)*1024)/1024;}
  token=uint16(group*64+_sample(scores,128,64,temperature,uint256(keccak256(abi.encode(seed,wordIndex,uint256(1))))));bytes memory pb=_read(punctuationCatalog,6080+uint256(token)*10,10);
  for(uint256 i;i<5;++i){int256 value=_dot(punctuationRowsPage,i,HEAD_STRIDE,buffer,out,outSum);scores[192+i]=(value+(_headBias(buffer)+_weight(pb,i))*1024)/1024;}
  punct=uint8(_sample(scores,192,5,temperature,uint256(keccak256(abi.encode(seed,wordIndex,uint256(2))))));(bytes32 v,uint8 size)=word(token);bytes memory output=new bytes(uint256(size)+(punct==0?0:1));for(uint256 i;i<size;++i)output[i]=v[i];if(punct!=0)output[size]=punct==1?bytes1(","):punct==2?bytes1("."):punct==3?bytes1("!"):bytes1("?");return(token,punct,next,scores,string(output),punct>=2);
 }
}
