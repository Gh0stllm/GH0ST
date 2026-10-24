from pathlib import Path
import hashlib,json,sys
p=Path(__file__).resolve().parent
combined='--combined' in sys.argv
source=(p/('../kernel/combined.sol' if combined else '../../selected/GRU2SIMDModel.sol')).resolve().read_text()
assert hashlib.sha256(source.encode()).hexdigest() in ['e7185cadb3feda3f8cffa01bdd1b6945ed911761603f8cae0668195c8fde0835','6ad99379adc5124e8fdc5c594008b51245e2ec663d3436317813de7f0374cbbf']
validation=source[source.index('  if(previous>8192',source.index(' function stepSampled')):source.index('  bytes memory row=',source.index(' function stepSampled'))]
s=source
s=s.replace(' error InvalidModel();error InvalidInput();', ''' error InvalidModel();error InvalidInput();
 struct Scratch {bytes row;bytes pr;bytes aux;bytes table;bytes buffer;bytes packedA;bytes packedB;bytes packedC;bytes cache;bytes out;bytes pb;bytes vocab;bytes sampleTable;uint256[128] weights;}
 function _scratch() private view returns(Scratch memory s){s.row=new bytes(5760);s.pr=new bytes(5760);s.aux=_read(coreCatalog,CORE_MATRICES,16128);s.table=SIGMOID_DELTA;s.buffer=new bytes(HEAD_STRIDE);s.packedA=new bytes(1248);s.packedB=new bytes(1248);s.packedC=new bytes(1248);s.cache=new bytes(152256);s.out=new bytes(1248);s.pb=new bytes(10);s.vocab=new bytes(32);s.sampleTable=EXP_Q32;}
''')
s=s.replace('function _prepare(int16[768] memory v,uint256 offset)private pure returns(bytes memory packedVector,int256 shiftedSum){packedVector=new bytes(1248);','function _prepareInto(int16[768] memory v,uint256 offset,bytes memory packedVector)private pure returns(int256 shiftedSum){')
s=s.replace('function _gru(int16[768] memory state,int32[6] memory features,bytes memory row,bytes memory pr,bytes memory aux,bytes memory table,bytes memory buffer,int16[768] memory next) private view {\n  address page=coreRowsPage;\n  bytes memory packedA=new bytes(1248);bytes memory packedB=new bytes(1248);bytes memory packedC=new bytes(1248);bytes memory cache=new bytes(152256);', '''function _gru(int16[768] memory state,int32[6] memory features,Scratch memory scratch,int16[768] memory next) private view {
  address page=coreRowsPage;
  bytes memory packedA=scratch.packedA;bytes memory packedB=scratch.packedB;bytes memory packedC=scratch.packedC;bytes memory cache=scratch.cache;
  bytes memory row=scratch.row;bytes memory pr=scratch.pr;bytes memory aux=scratch.aux;bytes memory table=scratch.table;bytes memory buffer=scratch.buffer;''')
s=s.replace('function _sample(int256[197] memory scores,uint256 start,uint256 count,uint256 temperature,uint256 entropy) private pure returns(uint256 result) {\n  bytes memory t=EXP_Q32;\n  uint256[] memory weights=new uint256[](count);', 'function _sample(int256[197] memory scores,uint256 start,uint256 count,uint256 temperature,uint256 entropy,Scratch memory scratch) private pure returns(uint256 result) {\n  bytes memory t=scratch.sampleTable;\n  uint256[128] memory weights=scratch.weights;')
s=s.replace('let dest:=add(weights,32)','let dest:=weights')
start=s.index(' function stepSampled(')
s=s[:start]+''' function _validate(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,uint16 temperature) private pure {
  if(previous>8192||previousPunct>4||temperature<64||temperature>4096)revert InvalidInput();for(uint256 i;i<768;++i)if(state[i]<-1024||state[i]>1024)revert InvalidInput();for(uint256 i;i<6;++i)if(features[i]<-4096||features[i]>4096)revert InvalidInput();
 }
 function _step(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature,Scratch memory scratch,int16[768] memory next,int256[197] memory scores) private view returns(uint16 token,uint8 punct,string memory text,bool terminal){
  _readInto(fusedCatalog,uint256(previous)*5760,5760,scratch.row);_readInto(punctuationCatalog,PUNCT_FOLD+uint256(previousPunct)*5760,5760,scratch.pr);
  _gru(state,features,scratch,next);
  bytes memory out=scratch.out;bytes memory buffer=scratch.buffer;int256 outSum=_prepareInto(next,384,out);
  for(uint256 i;i<128;++i){int256 value=_dot(groupRowsPage,i,HEAD_STRIDE,buffer,out,outSum);scores[i]=(value+_headBias(buffer)*1024)/1024;}
  uint256 group=_sample(scores,0,128,temperature,uint256(keccak256(abi.encode(seed,wordIndex,uint256(0)))),scratch);
  for(uint256 i;i<64;++i){int256 value=_dot(wordRowsPage,group*64+i,HEAD_STRIDE,buffer,out,outSum);scores[128+i]=(value+_headBias(buffer)*1024)/1024;}
  token=uint16(group*64+_sample(scores,128,64,temperature,uint256(keccak256(abi.encode(seed,wordIndex,uint256(1)))),scratch));bytes memory pb=scratch.pb;_readInto(punctuationCatalog,6720+uint256(token)*10,10,pb);
  for(uint256 i;i<5;++i){int256 value=_dot(punctuationRowsPage,i,HEAD_STRIDE,buffer,out,outSum);scores[192+i]=(value+(_headBias(buffer)+_weight(pb,i))*1024)/1024;}
  punct=uint8(_sample(scores,192,5,temperature,uint256(keccak256(abi.encode(seed,wordIndex,uint256(2)))),scratch));
  bytes memory vocab=scratch.vocab;_readInto(vocabularyCatalog,uint256(token)*32,32,vocab);bytes32 v;assembly("memory-safe"){v:=mload(add(vocab,32))}uint8 size;
  for(uint256 i;i<32&&v[i]!=0;++i){uint8 c=uint8(v[i]);if(!((c>=97&&c<=122)||(c==39&&i>0)))revert InvalidModel();size++;}if(size==0)revert InvalidModel();
  bytes memory output=new bytes(uint256(size)+(punct==0?0:1));for(uint256 i;i<size;++i)output[i]=v[i];if(punct!=0)output[size]=punct==1?bytes1(","):punct==2?bytes1("."):punct==3?bytes1("!"):bytes1("?");return(token,punct,string(output),punct>=2);
 }
 function stepSampled(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature)external view returns(uint16 token,uint8 punct,int16[768] memory next,int256[197] memory scores,string memory text,bool terminal){
  _validate(previous,previousPunct,state,features,temperature);Scratch memory scratch=_scratch();(token,punct,text,terminal)=_step(previous,previousPunct,state,features,seed,wordIndex,temperature,scratch,next,scores);
 }
 function stepBatch(uint16 previous,uint8 previousPunct,int16[768] memory state,int32[6] memory features,bytes32 seed,uint256 wordIndex,uint16 temperature,uint8 maxWords)external view returns(uint16[3] memory tokens,uint8[3] memory puncts,int16[768] memory finalState,int256[197][3] memory scores,string[3] memory texts,uint8 count,bool terminal){
  _validate(previous,previousPunct,state,features,temperature);if(maxWords==0||maxWords>3||wordIndex>type(uint256).max-(maxWords-1))revert InvalidInput();
  Scratch memory scratch=_scratch();int16[768] memory next;
  for(uint8 i;i<maxWords;++i){(tokens[i],puncts[i],texts[i],terminal)=_step(previous,previousPunct,state,features,seed,wordIndex+i,temperature,scratch,next,scores[i]);previous=tokens[i];previousPunct=puncts[i];int16[768] memory old=state;state=next;next=old;count=i+1;if(terminal)break;}
  finalState=state;
 }
}
'''
if combined:
 s=s[:s.index(' function stepBatch(')]+'}\n'
 old=s[s.index('  if(previous>8192',s.index(' function _validate')):s.index(' }\n function _step',s.index(' function _validate'))]
 s=s.replace(old,validation)
 s=s[:-2]+''' struct BatchResult {uint16[3] tokens;uint8[3] puncts;int16[768][3] states;int256[197][3] scores;string[3] texts;uint8 count;bool terminal;}
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
'''
(p/('GRU2BatchCheckedModel.sol' if combined else 'GRU2BatchModel.sol')).write_text(s)
print(json.dumps({'source_sha256':hashlib.sha256(s.encode()).hexdigest(),'bytes':len(s)}))
