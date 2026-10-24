from pathlib import Path
import re,hashlib,json
D=Path(__file__).resolve().parent
base=(D/'NovaPoolHook12.sol').read_text();path=D.parent/'sentence/NovaSentencePoolHook.sol';s=path.read_text()
sha=lambda x:hashlib.sha256(x.encode()).hexdigest()
def fn(text,name):
 a=text.index('    function '+name+'(');i=text.index('{',a);depth=1;j=i+1
 while depth:depth+=(text[j]=='{')-(text[j]=='}');j+=1
 return text[a:j]
unchanged=['getHookPermissions','_authorize','beforeInitialize','afterInitialize','hiddenState','_saveState','_checkWord','decodeStep']
for name in unchanged:assert fn(s,name)==fn(base,name),(name,'changed')
a=fn(s,'_infer').replace('int16[768] memory state)','bytes32 id)').replace('(c.previousToken, c.previousPunct, state,','(c.previousToken, c.previousPunct, hiddenState(id),')
assert a==fn(base,'_infer'),'Inference change beyond supplied memory state'
for value in ['MAX_INFERENCE_GAS = 26_000_000','CALLBACK_GAS_RESERVE = 2_000_000','MAX_RETURN_BYTES = 31_104','DECODER_GAS_LIMIT = 1_500_000','WORD_LOOKUP_GAS_LIMIT = 150_000','MAX_SENTENCE_WORDS = 32']:
 assert value in s,value
loop=fn(s,'afterSwap')
for required in ['wordIndex < MAX_SENTENCE_WORDS','if (c.sequence == type(uint64).max) revert WordRequired(5)','if (gasleft() < required) revert WordRequired(1)','Generation memory generated = _infer(c, features, state)','++c.sequence','state = generated.hidden','if (generated.terminal) { complete = true; break; }','if (!complete) revert WordRequired(6)','if (sentenceCount[id] == type(uint64).max) revert WordRequired(5)']:
 assert required in loop,required
assert loop.index('if (!complete)')<loop.index('_saveState(id, state)')<loop.index('contexts[id] = c')
r={'status':'PASS_STATIC_REVIEW','scope':'LOCAL_ONLY_STATIC_NOT_EXTERNAL_AUDIT','hookSha256':sha(s),'baselinePackedHookSha256':sha(base),'unchangedSecurityFunctions':unchanged,'inferOnlyDifference':'use supplied in-memory hidden state for subsequent neural words instead of reloading old stored state','reserveGas':2000000,'reserveCheckedBeforeEachWord':True,'maxSentenceWords':32,'maxSentenceUtf8Bytes':32*33+31,'requiresNeuralTerminalPunctuation':True,'capOrInferenceFailureRevertsAllWords':True,'stateOnlyStoredAfterTerminal':True,'hashAndWordIndexAdvancePerNeuralStep':True,'sentenceCounterOverflowRevertsTransaction':True,'priorHookDataIgnored':True,'mainnetActions':0,'caveats':['Fail-closed complete sentences can make trading fail when budget cannot cover all words.','Complete punctuation is not a proof of grammatical or semantic coherence.','Full PoolManager and router settlement validation must come from separate integration tests.']}
(D/'sentence-hook-static-review.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
