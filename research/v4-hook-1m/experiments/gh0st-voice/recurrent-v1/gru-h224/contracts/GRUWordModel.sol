// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
/// @notice Local arithmetic/gas prototype, compiled from GRU H224 source tensors.
contract GRUWordModel {
    uint16 public constant VOCABULARY = 8192;
    uint256 public constant SOURCE_MODEL_PARAMETERS = 3983967;
    uint256 public constant HIDDEN = 224;
    uint256 public constant CHUNK_BYTES = 24000;
    uint256 public constant CORE_BYTES = 309120;
    uint256 public constant NODE_BYTES = 3685950;
    uint256 public constant VOCABULARY_BYTES = 262144;
    uint256 public constant FUSED_BYTES = 27528480;
    address public immutable coreCatalog;
    address public immutable nodeCatalog;
    address public immutable vocabularyCatalog;
    address public immutable fusedCatalog;
    bytes32 public immutable modelHash;
    error InvalidModel(); error InvalidInput();
    bytes private constant SIGMOID_DELTA = hex"0000040007fd0bf70feb13d717b91b901f59231426bf2a582ddf315134ae37f63b273e404142442c46fd49b64c564edd514d53a355e2580a5a1a5c135df65fc4617c632064b0662d679768f06a376b6e6c956dac6eb56fb0709e717f7254731e73dc7490753a75da7672770177887807787f78f0795b79bf7a1e7a777acb7b1b7b657bab7bee7c2c7c667c9d7cd17d027d307d5b7d847daa7dce7df07e0f7e2d7e497e647e7d7e947eaa7ebf7ed27ee47ef57f057f147f237f307f3d7f487f547f5e7f687f717f7a7f827f897f917f977f9e7fa47fa97fae7fb37fb87fbc7fc07fc47fc87fcb7fce7fd17fd47fd77fd97fdc7fde7fe07fe27fe47fe57fe77fe97fea7feb7fed7fee7fef7ff07ff17ff27ff37ff37ff47ff57ff67ff67ff77ff77ff87ff87ff97ff97ffa7ffa7ffa7ffb7ffb7ffb7ffc7ffc7ffc7ffc7ffd7ffd7ffd7ffd7ffd7ffe7ffe7ffe7ffe7ffe7ffe7ffe7ffe7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff7fff80008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000800080008000";
    constructor(address core_,address nodes_,address vocab_,address fused_) {
        if (block.chainid != 31337) revert InvalidModel();
        bytes32 a=_pin(core_,CORE_BYTES);bytes32 b=_pin(nodes_,NODE_BYTES);
        bytes32 c=_pin(vocab_,VOCABULARY_BYTES);bytes32 d=_pin(fused_,FUSED_BYTES);
        coreCatalog=core_;nodeCatalog=nodes_;vocabularyCatalog=vocab_;fusedCatalog=fused_;
        modelHash=keccak256(abi.encode("GH0ST_GRU_H224_FUSED_Q10_LOCAL_V1",a,b,c,d));
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
    function stepSampled(uint16 previous,int16[224] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature)
        external view returns(uint16 token,int16[224] memory next,int256[13] memory scores,string memory text,bool terminal){
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
        uint256 entropy=uint256(keccak256(abi.encode(seed,wordIndex)));uint256 node;
        for(uint256 depth;depth<13;++depth){bytes memory c=_read(nodeCatalog,node*450,450);int256 score=(_dotH(c,0,next)+_weight(c,224)*1024)/1024;scores[depth]=score;
            bool right=uint16(entropy>>(16*depth))<_probability(score,table,temperature);node=node*2+1+(right?1:0);}
        token=uint16(node-8191);(bytes32 value,uint8 size,bool ended)=word(token);bytes memory output=new bytes(size);for(uint256 i;i<size;++i)output[i]=value[i];return(token,next,scores,string(output),ended);
    }
}
