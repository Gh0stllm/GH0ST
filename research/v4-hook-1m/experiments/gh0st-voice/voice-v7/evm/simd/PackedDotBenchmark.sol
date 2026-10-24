// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice LOCAL ONLY microbenchmark. Data code is supplied by a checked harness.
contract PackedDotBenchmark {
    uint256 constant CHUNK=24000;
    event BenchResult(bytes32 resultHash);
    constructor(){require(block.chainid==31337);}

    function _read(address catalog,uint256 offset,uint256 length,bytes memory buffer)private view {
        uint256 copied;
        while(copied<length){
            uint256 at=offset+copied;uint256 within=at%CHUNK;uint256 take=CHUNK-within;
            if(take>length-copied)take=length-copied;
            address source;uint256 slot=at/CHUNK;
            assembly("memory-safe"){extcodecopy(catalog,0,add(1,mul(slot,20)),20)source:=shr(96,mload(0))}
            assembly("memory-safe"){extcodecopy(source,add(add(buffer,32),copied),add(within,1),take)}
            copied+=take;
        }
    }

    function scalar(address catalog,uint256 rows,int16[] memory vector)external returns(bytes32 resultHash){
        uint256 dim=vector.length;require(dim==128||dim==256||dim==512);require(rows>0&&rows<=10000);
        for(uint256 i;i<dim;++i)require(vector[i]>=-1024&&vector[i]<=1024);
        bytes memory buffer=new bytes(dim*2);int256[] memory output=new int256[](rows);
        for(uint256 row;row<rows;++row){
            _read(catalog,row*dim*2,dim*2,buffer);int256 sum;
            assembly("memory-safe"){
                let weights:=add(buffer,32)let values:=add(vector,32)
                for{let i:=0}lt(i,dim){i:=add(i,1)}{
                    let w:=signextend(1,shr(240,mload(add(weights,shl(1,i)))))
                    sum:=add(sum,mul(w,signextend(1,mload(add(values,shl(5,i))))))
                }
                mstore(add(add(output,32),shl(5,row)),sum)
            }
        }
        assembly("memory-safe"){resultHash:=keccak256(add(output,32),mul(rows,32))}
        emit BenchResult(resultHash);
    }

    function packed(address catalog,uint256 rows,int16[] memory vector)external returns(bytes32 resultHash){
        uint256 dim=vector.length;require(dim==128||dim==256||dim==512);require(rows>0&&rows<=10000);
        bytes memory packedVector=new bytes(dim*8);int256 shiftedSum;
        for(uint256 i;i<dim;i+=4){
            for(uint256 j;j<4;++j)require(vector[i+j]>=-1024&&vector[i+j]<=1024);
            uint256 a0=uint256(int256(vector[i])+1024);uint256 a1=uint256(int256(vector[i+1])+1024);
            uint256 a2=uint256(int256(vector[i+2])+1024);uint256 a3=uint256(int256(vector[i+3])+1024);
            shiftedSum+=int256(a0+a1+a2+a3);uint256 word=a0|(a1<<64)|(a2<<128)|(a3<<192);
            assembly("memory-safe"){mstore(add(add(packedVector,32),mul(i,8)),word)}
        }
        uint256 rowBytes=dim*8+32;bytes memory buffer=new bytes(rowBytes);int256[] memory output=new int256[](rows);
        for(uint256 row;row<rows;++row){
            _read(catalog,row*rowBytes,rowBytes,buffer);int256 sum;
            assembly("memory-safe"){
                let weights:=add(buffer,32)let values:=add(packedVector,32)let end:=mul(dim,8)
                for{let at:=0}lt(at,end){at:=add(at,128)}{
                    sum:=add(sum,shr(192,mul(mload(add(values,at)),mload(add(weights,at)))))
                    sum:=add(sum,shr(192,mul(mload(add(values,add(at,32))),mload(add(weights,add(at,32))))))
                    sum:=add(sum,shr(192,mul(mload(add(values,add(at,64))),mload(add(weights,add(at,64))))))
                    sum:=add(sum,shr(192,mul(mload(add(values,add(at,96))),mload(add(weights,add(at,96))))))
                }
                sum:=sub(sub(sum,mul(32768,shiftedSum)),mul(1024,mload(add(weights,end))))
                mstore(add(add(output,32),shl(5,row)),sum)
            }
        }
        assembly("memory-safe"){resultHash:=keccak256(add(output,32),mul(rows,32))}
        emit BenchResult(resultHash);
    }
}
