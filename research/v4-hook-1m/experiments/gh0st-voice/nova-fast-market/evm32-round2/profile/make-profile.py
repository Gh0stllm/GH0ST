from pathlib import Path
p=Path(__file__).resolve().parent
s=(p.parents[1]/'evm32/batch/GRU2BatchCheckedModel.sol').read_text()
s=s.replace('struct Scratch {','struct Scratch {uint256[8] phase;')
s=s.replace('_readInto(fusedCatalog,uint256(previous)*5760','scratch.phase[0]=gasleft();_readInto(fusedCatalog,uint256(previous)*5760')
s=s.replace('_gru(state,features,scratch,next);','scratch.phase[1]=gasleft();_gru(state,features,scratch,next);scratch.phase[2]=gasleft();')
s=s.replace('uint256 group=_sample(scores,0,128','scratch.phase[3]=gasleft();uint256 group=_sample(scores,0,128')
s=s.replace('for(uint256 i;i<64;++i)','scratch.phase[4]=gasleft();for(uint256 i;i<64;++i)')
s=s.replace('token=uint16(group*64+','scratch.phase[5]=gasleft();token=uint16(group*64+')
s=s.replace('punct=uint8(_sample','scratch.phase[6]=gasleft();punct=uint8(_sample')
s=s.replace('bytes memory vocab=scratch.vocab;','scratch.phase[7]=gasleft();bytes memory vocab=scratch.vocab;')
start=s.index(' function stepSampled(')
s=s[:start]+''' function profile(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature)external view returns(uint256[8] memory phases,uint256 elapsed,string memory text){
 uint256 initial=gasleft();_validate(previous,previousPunct,state,features,temperature);Scratch memory scratch=_scratch();int16[768] memory next;int256[197] memory scores;(,,text,)=_step(previous,previousPunct,state,features,seed,wordIndex,temperature,scratch,next,scores);phases=scratch.phase;elapsed=initial-gasleft();
 }
'''+s[start:]
(p/'ProfileModel.sol').write_text(s)
