// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract CachePackingProbe {
uint256 constant HIDDEN=128; uint256 constant INTERMEDIATE=341;
    struct Session {
        uint8 length;
        bool ended;
        uint64 epoch;
        bytes32 prefixHash;
        mapping(uint256 => uint256) kv;
    }
    struct Work {
        int32[] hidden;
        int32[] query;
        int32[] key;
        int32[] value;
        int32[] norm;
        int32[] qTemp;
        int32[] kTemp;
        int32[] vTemp;
        int32[] attention;
        int32[] projection;
        int32[] gate;
        int32[] up;
        int256[] scores;
        uint256[] probabilities;
    }

Session private state;
    function _newWork(uint256 length) private pure returns (Work memory w) {
        w.hidden = new int32[](length * HIDDEN);
        w.query = new int32[](length * HIDDEN);
        w.key = new int32[](length * 64);
        w.value = new int32[](length * 64);
        w.norm = new int32[](HIDDEN); w.qTemp = new int32[](HIDDEN);
        w.kTemp = new int32[](64); w.vTemp = new int32[](64);
        w.attention = new int32[](HIDDEN); w.projection = new int32[](HIDDEN);
        w.gate = new int32[](INTERMEDIATE); w.up = new int32[](INTERMEDIATE);
        w.scores = new int256[](length); w.probabilities = new uint256[](length);
    }

    function _loadPast(Session storage state, Work memory w, uint256 layer, uint256 position) private view {
        mapping(uint256 => uint256) storage cache = state.kv;
        assembly ("memory-safe") {
            let keys := add(mload(add(w, 64)), 32)
            let values := add(mload(add(w, 96)), 32)
            mstore(32, cache.slot)
            for { let past := 0 } lt(past, position) { past := add(past, 1) } {
                let base := add(shl(6, past), shl(4, layer))
                let destination := shl(11, past)
                for { let chunk := 0 } lt(chunk, 8) { chunk := add(chunk, 1) } {
                    mstore(0, add(base, chunk))
                    let keyWord := sload(keccak256(0, 64))
                    mstore(0, add(add(base, chunk), 8))
                    let valueWord := sload(keccak256(0, 64))
                    let at := add(destination, shl(8, chunk))
                    for { let lane := 0 } lt(lane, 8) { lane := add(lane, 1) } {
                        mstore(add(add(keys, at), shl(5, lane)), signextend(3, shr(shl(5, lane), keyWord)))
                        mstore(add(add(values, at), shl(5, lane)), signextend(3, shr(shl(5, lane), valueWord)))
                    }
                }
            }
        }
    }

    function _storeCurrent(Session storage state, Work memory w, uint256 layer, uint256 position) private {
        mapping(uint256 => uint256) storage cache = state.kv;
        assembly ("memory-safe") {
            let keys := add(add(mload(add(w, 64)), 32), shl(11, position))
            let values := add(add(mload(add(w, 96)), 32), shl(11, position))
            let base := add(shl(6, position), shl(4, layer))
            mstore(32, cache.slot)
            for { let chunk := 0 } lt(chunk, 8) { chunk := add(chunk, 1) } {
                let keyWord := 0
                let valueWord := 0
                let at := shl(8, chunk)
                for { let lane := 0 } lt(lane, 8) { lane := add(lane, 1) } {
                    keyWord := or(keyWord, shl(shl(5, lane), and(mload(add(add(keys, at), shl(5, lane))), 0xffffffff)))
                    valueWord := or(valueWord, shl(shl(5, lane), and(mload(add(add(values, at), shl(5, lane))), 0xffffffff)))
                }
                mstore(0, add(base, chunk))
                sstore(keccak256(0, 64), keyWord)
                mstore(0, add(add(base, chunk), 8))
                sstore(keccak256(0, 64), valueWord)
            }
        }
    }


function put(uint256 layer,uint256 position,int32[64] calldata keys,int32[64] calldata values) external {
 require(layer<4&&position<16);
 Work memory w=_newWork(position+1);
 for(uint256 i;i<64;i++){w.key[position*64+i]=keys[i];w.value[position*64+i]=values[i];}
 _storeCurrent(state,w,layer,position);
}
function get(uint256 layer,uint256 count) external view returns(int32[] memory keys,int32[] memory values){
 require(layer<4&&count<=16);
 Work memory w=_newWork(count);_loadPast(state,w,layer,count);return(w.key,w.value);
}
}
