// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
/// @notice Local arithmetic/gas prototype, compiled from GRU H224 source tensors.
contract AdaptiveGRUWordModel {
    uint16 public constant VOCABULARY = 8192;
    uint256 public constant SOURCE_MODEL_PARAMETERS = 4012992;
    uint256 public constant HIDDEN = 224;
    uint256 public constant CHUNK_BYTES = 24000;
    uint256 public constant CORE_BYTES = 309120;
    uint256 public constant GROUP_BYTES = 57600;
    uint256 public constant WORD_BYTES = 3686400;
    uint256 public constant VOCABULARY_BYTES = 262144;
    uint256 public constant FUSED_BYTES = 27528480;
    address public immutable coreCatalog;
    address public immutable groupCatalog;
    address public immutable wordCatalog;
    address public immutable vocabularyCatalog;
    address public immutable fusedCatalog;
    bytes32 public immutable modelHash;
    error InvalidModel(); error InvalidInput();
    bytes private constant SIGMOID_DELTA = hex"0000040007fd0bf70feb13d717b91b901f59231426bf2a582ddf315134ae37f63b273e404142442c46fd49b64c564edd514d53a355e2580a5a1a5c135df65fc4617c632064b0662d679768f06a376b6e6c956dac6eb56fb0709e717f7254731e73dc7490753a75da7672770177887807787f78f0795b79bf7a1e7a777acb7b1b7b657bab7bee7c2c7c667c9d7cd17d027d307d5b7d847daa7dce7df07e0f7e2d7e497e647e7d7e947eaa7ebf7ed27ee47ef57f057f147f237f307f3d7f487f547f5e7f687f717f7a7f827f897f917f977f9e7fa47fa97fae7fb37fb87fbc7fc07fc47fc87fcb7fce7fd17fd47fd77fd97fdc7fde7fe07fe27fe47fe57fe77fe97fea7feb7fed7fee7fef7ff07ff17ff27ff37ff37ff47ff57ff67ff67ff77ff77ff87ff87ff97ff97ffa7ffa7ffa7ffb7ffb7ffb7ffc7ffc7ffc7ffc7ffd7ffd7ffd7ffd7ffd7ffe7ffe7ffe7ffe7ffe7ffe7ffe7ffe7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff80008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000";
    constructor(address core_,address groups_,address words_,address vocab_,address fused_) {
        if (block.chainid != 31337) revert InvalidModel();
        bytes32 a=_pin(core_,CORE_BYTES);bytes32 b=_pin(groups_,GROUP_BYTES);bytes32 e=_pin(words_,WORD_BYTES);
        bytes32 c=_pin(vocab_,VOCABULARY_BYTES);bytes32 d=_pin(fused_,FUSED_BYTES);
        coreCatalog=core_;groupCatalog=groups_;wordCatalog=words_;vocabularyCatalog=vocab_;fusedCatalog=fused_;
        modelHash=keccak256(abi.encode("GH0ST_GRU_H224_ADAPTIVE_Q10_LOCAL_V1",a,b,e,c,d));
    }
    function _source(address catalog,uint256 index) private view returns(address source) {
        assembly ("memory-safe") { extcodecopy(catalog,0,add(1,mul(index,20)),20) source:=shr(96,mload(0)) }
    }
    function _pin(address catalog,uint256 total) private view returns(bytes32 commitment) {
        uint256 count=(total+CHUNK_BYTES-1)/CHUNK_BYTES;
        if(catalog.code.length!=1+count*20)revert InvalidModel();
        for(uint256 i;i<count;++i){address target=_source(catalog,i);uint256 n=total-i*CHUNK_BYTES;if(n>CHUNK_BYTES)n=CHUNK_BYTES;
            if(target.code.length!=n+1)revert InvalidModel();commitment=keccak256(abi.encode(commitment,target.codehash));}
    }
    function _read(address catalog,uint256 offset,uint256 length) private view returns(bytes memory data){
        data=new bytes(length);uint256 copied;
        while(copied<length){uint256 at=offset+copied;uint256 within=at%CHUNK_BYTES;uint256 take=CHUNK_BYTES-within;if(take>length-copied)take=length-copied;address source=_source(catalog,at/CHUNK_BYTES);
            assembly ("memory-safe") {extcodecopy(source,add(add(data,32),copied),add(within,1),take)}copied+=take;}
    }
    function _weight(bytes memory data, uint256 index) private pure returns (int256 value) {
        assembly ("memory-safe") { value := signextend(1, shr(240, mload(add(add(data, 32), shl(1, index))))) }
    }

    // Bounds follow from canonical int16 weights, hidden clamp and input checks.
    // Accumulators are below 2**40; arithmetic is intentionally signed int256.
    function _dotH(bytes memory data, uint256 offset, int16[224] memory vector) private pure returns (int256 sum) {
        assembly ("memory-safe") {
            let ptr := add(add(data, 32), shl(1, offset))
            for { let i := 0 } lt(i, 224) { i := add(i, 1) } {
                let w := signextend(1, shr(240, mload(add(ptr, shl(1, i)))))
                sum := add(sum, mul(w, signextend(1, mload(add(vector, shl(5, i))))))
            }
        }
    }

    function _dot6(bytes memory data, uint256 offset, int32[6] memory vector) private pure returns (int256 sum) {
        assembly ("memory-safe") {
            let ptr := add(add(data, 32), shl(1, offset))
            for { let i := 0 } lt(i, 6) { i := add(i, 1) } {
                let w := signextend(1, shr(240, mload(add(ptr, shl(1, i)))))
                sum := add(sum, mul(w, signextend(3, mload(add(vector, shl(5, i))))))
            }
        }
    }

    function word(uint16 token) public view returns (bytes32 value, uint8 length, bool terminal) {
        if (token >= VOCABULARY) revert InvalidInput();
        uint256 offset = uint256(token) * 32;
        bytes memory data = _read(vocabularyCatalog, offset, 32);
        assembly ("memory-safe") { value := mload(add(data, 32)) }
        for (uint256 i; i < 32 && value[i] != 0; ++i) {
            uint8 c = uint8(value[i]);
            bool punctuation = c == 46 || c == 33 || c == 63;
            if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c == 39 && i > 0) || (punctuation && i > 0))) revert InvalidModel();
            if (punctuation && i != 31 && value[i + 1] != 0) revert InvalidModel();
            length += 1;
            terminal = punctuation;
        }
        if (length == 0) revert InvalidModel();
    }

    function _probability(int256 score,bytes memory table,uint256 temperature) private pure returns(uint32){
        uint256 magnitude=uint256(score<0?-score:score);uint256 index=(magnitude*1024/temperature+32)/64;if(index>256)index=256;
        uint32 delta=(uint32(uint8(table[index*2]))<<8)|uint32(uint8(table[index*2+1]));return score>=0?32768+delta:32768-delta;
    }
    function _sigmoid(int256 score,bytes memory table) private pure returns(int256){return int256(uint256((_probability(score,table,1024)+32)/64));}
    function _input(bytes memory row,uint256 index)private pure returns(int256 value){assembly("memory-safe"){value:=signextend(4,shr(216,mload(add(add(row,32),mul(index,5)))))}}
    bytes private constant EXP_Q32 = hex"000000010000000000000000f07d5fde00000000e1eb512700000000d43b409600000000c75f7cf500000000bb4b297000000000aff230af00000000a54938ca000000009b4597e30000000091dd4986000000008906e49a0000000080b991ff0000000078ed03b00000000071996c78000000006ab778250000000064404430000000005e2d58d9000000005878a2b400000000531c6c92000000004e1359c900000000495860dd0000000044e6c66e0000000040ba1883000000003cce2a1600000000391f0ee50000000035a91785000000003268cdb5000000002f5af0e7000000002c7c72fc0000000029ca753900000000274245670000000024e15b200000000022a5554700000000208bf7a7000000001e9328b5000000001cb8ef77000000001afb718f000000001958f1570000000017cfcc2d00000000165e78cc00000000150385c10000000013bd97fb00000000128b697300000000116bc7e100000000105d9389000000000f5fbe23000000000e7149c2000000000d9147e0000000000cbed866000000000bf928d6000000000b3f736d000000000a90fe680000000009ed1b43000000000953260c0000000008c284c300000000083aa6ba0000000007bb04060000000007431cfc0000000006d279aa000000000668a962000000000605424d0000000005a7e0fb00000000055028020000000004fdbfa30000000004b0556e0000000004679bf20000000004234a710000000003e31c920000000003a6d22200000000036e2ed3000000000338f9fb000000000306fe630000000002d80a090000000002abedf60000000002827e0a00000000025b90d1000000000236ff5c000000000214a5150000000001f45fa00000000001d60eb40000000001b993fe00000000019ed301000000000185b0f900000000016e14c3000000000157e6c000000000014310c000000000012f7ded00000000011d1ab000000000010bd4a60000000000fb9a860000000000ec5c170000000000de0a170000000000d096330000000000c3f2f80000000000b813bf0000000000acecaa0000000000a272900000000000989af500000000008f5c03000000000086ac7800000000007e83a5000000000076d96100000000006fa5ff000000000068e24d000000000062878600000000005c8f4f000000000056f3af000000000051af0900000000004cbc1a00000000004815ed000000000043b7dc00000000003f9d8800000000003bc2d700000000003823ee000000000034bd2e0000000000318b2f00000000002e8ac000000000002bb8df00000000002912bb00000000002695ad0000000000243f370000000000220d0400000000001ffce100000000001e0cbd00000000001c3aa900000000001a84d2000000000018e981000000000017671d000000000015fc21000000000014a72300000000001366ce00000000001239e20000000000111f3100000000001015a100000000000f1c2700000000000e31cb00000000000d55a200000000000c86d000000000000bc48500000000000b0e0000000000000a628a000000000009c1780000000000092a270000000000089c02000000000008167900000000000799080000000000072330000000000006b47b0000000000064c7c000000000005eaca0000000000058f0400000000000538cc000000000004e7ce0000000000049bb8000000000004543f0000000000041119000000000003d20600000000000396c40000000000035f1a0000000000032acf000000000002f9af000000000002cb89000000000002a02f000000000002777500000000000251330000000000022d430000000000020b7f000000000001ebc8000000000001cdfc000000000001b1ff00000000000197b30000000000017f0000000000000167cb00000000000151ff0000000000013d840000000000012a480000000000011835000000000001073b000000000000f748000000000000e84d000000000000da3a000000000000cd01000000000000c095000000000000b4ea000000000000a9f40000000000009fa800000000000095fc0000000000008ce6000000000000845c0000000000007c5700000000000074cf0000000000006dbb000000000000671500000000000060d60000000000005af8000000000000557500000000000050480000000000004b6b00000000000046d9000000000000428e0000000000003e860000000000003abc000000000000372d00000000000033d500000000000030b10000000000002dbe0000000000002af9000000000000285e00000000000025ec00000000000023a000000000000021770000000000001f700000000000001d890000000000001bbf0000000000001a10000000000000187c0000000000001700000000000000159b000000000000144c000000000000131200000000000011ea00000000000010d40000000000000fcf0000000000000eda0000000000000df30000000000000d1b0000000000000c500000000000000b910000000000000add0000000000000a3500000000000009970000000000000902000000000000087600000000000007f3000000000000077800000000000007040000000000000697000000000000063100000000000005d10000000000000577000000000000052200000000000004d20000000000000487000000000000044100000000000003ff00000000000003c100000000000003870000000000000350000000000000031d00000000000002ed00000000000002bf0000000000000295000000000000026d00000000000002470000000000000224000000000000020300000000000001e3";
    function _sample(int256[192] memory scores,uint256 start,uint256 count,uint256 temperature,uint256 entropy)private pure returns(uint256){
        int256 maximum=scores[start];for(uint256 i=1;i<count;++i)if(scores[start+i]>maximum)maximum=scores[start+i];
        bytes memory table=EXP_Q32;uint256[] memory weights=new uint256[](count);uint256 total;
        for(uint256 i;i<count;++i){uint256 scaled=uint256(maximum-scores[start+i])*1024/temperature;uint256 index=(scaled+32)/64;if(index>256)index=256;
            uint256 weight;assembly("memory-safe"){weight:=shr(192,mload(add(add(table,32),mul(index,8))))}weights[i]=weight;total+=weight;}
        uint256 draw=entropy%total;for(uint256 i;i<count;++i){if(draw<weights[i])return i;draw-=weights[i];}revert InvalidInput();
    }
    function stepSampled(uint16 previous,int16[224] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature)
        external view returns(uint16 token,int16[224] memory next,int256[192] memory scores,string memory text,bool terminal){
        if(previous>8192||temperature<64||temperature>4096)revert InvalidInput();
        for(uint256 i;i<224;++i)if(state[i]<-1024||state[i]>1024)revert InvalidInput();
        for(uint256 i;i<6;++i)if(features[i]<-4096||features[i]>4096)revert InvalidInput();
        bytes memory core=_read(coreCatalog,0,CORE_BYTES);bytes memory inputRow=_read(fusedCatalog,uint256(previous)*672*5,672*5);bytes memory table=SIGMOID_DELTA;
        for(uint256 i;i<224;++i){
            int256 xr=(_input(inputRow,i)+_dot6(core,150528+i*6,features))/1024;
            int256 rr=_dotH(core,i*224,state)/1024;
            int256 xz=(_input(inputRow,224+i)+_dot6(core,150528+(224+i)*6,features))/1024;
            int256 rz=_dotH(core,(224+i)*224,state)/1024;
            int256 xn=(_input(inputRow,448+i)+_dot6(core,150528+(448+i)*6,features))/1024;
            int256 rn=_dotH(core,(448+i)*224,state)/1024;
            int256 reset=_sigmoid(xr+rr,table);int256 update=_sigmoid(xz+rz,table);
            int256 candidate=2*_sigmoid(2*(xn+reset*rn/1024),table)-1024;
            next[i]=int16((update*int256(state[i])+(1024-update)*candidate)/1024);
        }
        bytes memory groups=_read(groupCatalog,0,GROUP_BYTES);
        for(uint256 i;i<128;++i)scores[i]=(_dotH(groups,i*225,next)+_weight(groups,i*225+224)*1024)/1024;
        uint256 group=_sample(scores,0,128,temperature,uint256(keccak256(abi.encode(seed,wordIndex,uint256(0)))));
        bytes memory words=_read(wordCatalog,group*64*450,64*450);
        for(uint256 i;i<64;++i)scores[128+i]=(_dotH(words,i*225,next)+_weight(words,i*225+224)*1024)/1024;
        uint256 within=_sample(scores,128,64,temperature,uint256(keccak256(abi.encode(seed,wordIndex,uint256(1)))));
        token=uint16(group*64+within);(bytes32 value,uint8 size,bool ended)=word(token);bytes memory output=new bytes(size);for(uint256 i;i<size;++i)output[i]=value[i];return(token,next,scores,string(output),ended);
    }
}
