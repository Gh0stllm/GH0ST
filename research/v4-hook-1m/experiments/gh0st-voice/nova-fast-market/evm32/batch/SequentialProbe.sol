// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
interface IWordModel {
 function stepSampled(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature)external view returns(uint16 token,uint8 punct,int16[768] memory next,int256[197] memory scores,string memory text,bool terminal);
}
/// Benchmark only: same transaction calls preserve account warmth but use separate model call frames.
contract SequentialProbe {
 function sequential(address model,uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature,uint8 maxWords)external view returns(uint16[3] memory tokens,uint8[3] memory puncts,int16[768] memory finalState,int256[197][3] memory scores,string[3] memory texts,uint8 count,bool terminal){
  require(maxWords>0&&maxWords<=3);require(wordIndex<=type(uint256).max-(maxWords-1));
  for(uint8 i;i<maxWords;++i){(tokens[i],puncts[i],finalState,scores[i],texts[i],terminal)=IWordModel(model).stepSampled(previous,previousPunct,state,features,seed,wordIndex+i,temperature);previous=tokens[i];previousPunct=puncts[i];state=finalState;count=i+1;if(terminal)break;}
 }
}
