// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract LayoutProof {
struct BatchGeneration {uint16[3] tokens;uint8[3] puncts;int16[768][3] states;int256[197][3] scores;string[3] texts;uint8 count;bool terminal;}
function probe(bytes memory raw)external pure returns(bytes32){BatchGeneration memory generated;        assembly ("memory-safe") {
            generated := mload(0x40)
            mstore(0x40,add(generated,512))
            let data:=add(raw,32)
            let statePointers:=add(generated,224)
            let scorePointers:=add(generated,320)
            let textPointers:=add(generated,416)
            mstore(generated,data)
            mstore(add(generated,32),add(data,96))
            mstore(add(generated,64),statePointers)
            mstore(add(generated,96),scorePointers)
            mstore(add(generated,128),textPointers)
            mstore(add(generated,160),mload(add(data,92864)))
            mstore(add(generated,192),mload(add(data,92896)))
            let textData:=add(data,mload(add(data,92832)))
            for {let i:=0} lt(i,3) {i:=add(i,1)} {
                mstore(add(statePointers,mul(i,32)),add(add(data,192),mul(i,24576)))
                mstore(add(scorePointers,mul(i,32)),add(add(data,73920),mul(i,6304)))
                mstore(add(textPointers,mul(i,32)),add(textData,mload(add(textData,mul(i,32)))))
            }
        }
return keccak256(abi.encode(generated.tokens,generated.puncts,generated.states,generated.scores,generated.texts,generated.count,generated.terminal));}}