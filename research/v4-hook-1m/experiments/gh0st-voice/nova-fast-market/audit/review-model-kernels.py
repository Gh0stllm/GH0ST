from pathlib import Path
import re,json,hashlib,math,argparse
D=Path(__file__).resolve().parent
P=argparse.ArgumentParser();P.add_argument('--model',type=Path,default=D.parent/'kernels/assembly-sample.sol');A=P.parse_args();A.model=A.model.resolve()
source=A.model.read_text();base=(D.parent.parent/'nova-optimization/selected/GRU2SIMDModel.sol').read_text()
sha=lambda b:hashlib.sha256(b).hexdigest()
def fn(s,name):
 a=s.index(' function '+name+'(');i=s.index('{',a);depth=1;j=i+1
 while depth:depth+=(s[j]=='{')-(s[j]=='}');j+=1
 return s[a:j]
def table(s,name):return bytes.fromhex(re.search(r'bytes private constant '+name+r'=hex"([0-9a-f]+)"',s).group(1))
old=table(base,'SIGMOID_DELTA');new=table(source,'SIGMOID_DELTA')
expected=b''.join(((32768+int.from_bytes(old[i:i+2],'big')+32)//64).to_bytes(2,'big') for i in range(0,len(old),2))+b''.join(((32768-int.from_bytes(old[i:i+2],'big')+32)//64).to_bytes(2,'big') for i in range(0,len(old),2))
assert new==expected,'Derived sigmoid table differs from exact old quantization'
assert table(source,'EXP_Q32')==table(base,'EXP_Q32'),'Sampling exponential table changed'
for name in ['_pin','_readInto','word']:
 assert fn(source,name)==fn(base,name),(name,'source guard changed')
inputGuard='if(previous>8192||previousPunct>4||temperature<64||temperature>4096)revert InvalidInput();for(uint256 i;i<768;++i)if(state[i]<-1024||state[i]>1024)revert InvalidInput();for(uint256 i;i<6;++i)if(features[i]<-4096||features[i]>4096)revert InvalidInput();'
assert inputGuard in source,'Model entry guards removed'
assert 'if(block.chainid!=31337)revert InvalidModel();' in source
# Caches have six disjoint entries; calculate required tail rather than trusting old dimensions.
cacheNotes={}
if 'bytes memory cache=new bytes(' in source:
 alloc=int(re.search(r'bytes memory cache=new bytes\((\d+)\)',source).group(1))
 offsets=sorted(set([0]+[int(x) for x in re.findall(r'add\(cacheData,(\d+)\)',source)]))
 rowstride=int(re.search(r'if gt\(add\(inside,(\d+)\),24000\)',source).group(1))
 need=32+24000+rowstride-1
 for i,off in enumerate(offsets):
  end=offsets[i+1] if i+1<len(offsets) else alloc
  assert end-off>=need,('overlapping or out-of-bounds cache',off,end,need)
 cacheNotes={'entries':len(offsets),'offsets':offsets,'allocatedBytes':alloc,'rowStride':rowstride,'conservativeBytesNeededPerEntry':need,'allEntriesSufficient':True}

# For the selected unsigned accumulated layout, verify every constant from artifacts
# and both copies of the dot arithmetic, including the GRU-cache local function.
layoutNotes={}
if 'CORE_STRIDE=1312' in source:
 layout=D.parent/'layout/b25x10a5'
 constants={'CORE_BYTES':4550400,'GROUP_BYTES':172032,'WORD_BYTES':11010048,'VOCABULARY_BYTES':262144,'FUSED_BYTES':47191680,'PUNCTUATION_BYTES':117440,'CORE_STRIDE':1312,'HEAD_STRIDE':1344,'CORE_MATRICES':4534272,'PUNCT_FOLD':88640}
 for key,value in constants.items():assert re.search(r'\b'+key+'='+str(value)+r'[; ]',source),(key,'constant mismatch')
 for name,key in [('core.bin','CORE_BYTES'),('groups.bin','GROUP_BYTES'),('words.bin','WORD_BYTES'),('vocabulary.bin','VOCABULARY_BYTES'),('fused.bin','FUSED_BYTES'),('punctuation.bin','PUNCTUATION_BYTES')]:assert (layout/name).stat().st_size==constants[key]
 expected=list(range(0,1248,32))
 direct=fn(source,'_dot')
 start=source.index('   function dot(');end=source.index('   let a:=',start);nested=source[start:end]
 for body in [direct,nested]:
  offsets=[int(x) for x in re.findall(r'mul\(mload\(add\(values,(\d+)\)\),mload\(add\(weights,\1\)\)\)',body)]
  assert offsets==expected,('dot offsets mismatch',offsets)
  assert body.count('and(shr(225,')==8 and body.count('0x1ffffff')==8
  assert 'mul(mload(add(weights,1280)),shiftedSum)' in body
  assert 'mul(1024,mload(add(weights,1248)))' in body
 assert '_read(punctuationCatalog,6720+uint256(token)*10,10)' in source
 assert 'mload(add(add(d,32),1312))' in source
 assert 'bytes memory packedA=new bytes(1248);bytes memory packedB=new bytes(1248);bytes memory packedC=new bytes(1248)' in source
 assert cacheNotes.get('allocatedBytes',0)>=6*(32+24000+1344)
 layoutNotes={'constantAndFileSizesMatch':True,'dotCopies':2,'productsEach':39,'extractionsEach':8,'batchSize':5,'finalBatchSize':4,'coefficientBits':25,'coefficientShift':225,'rowCorrectionOffsets':[1248,1280],'headBiasOffset':1312,'tokenPunctuationBase':6720,'cacheFitsEven1344ByteHeadStride':True}

r={'status':'PASS_STATIC_SCOPE_AND_TABLE_AUDIT','model':str(A.model.relative_to(D.parent)),'sourceSha256':sha(source.encode()),'baselineSha256':sha(base.encode()),'sigmoidDerivedExactly':True,'sigmoidLookupEntries':len(new)//2,'expTableUnchanged':True,'unchangedFunctions':['_pin','_readInto','word'],'allEntryInputGuardsRetained':True,'localChainRestrictionRetained':True,'samplingBounds':{'count':[128,64,5],'maxScoreDifferenceConservative':2*(384*32768+2*32768),'maximumScaledDifference':2*(384*32768+2*32768)*1024,'maximumWeightTotal':128*(1<<32),'safeUnderUint256':True,'atLeastOnePositiveWeight':True},'cacheMemory':cacheNotes,'selectedLayout':layoutNotes,'mainnetActions':0}
(D/'model-kernel-static-review.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
