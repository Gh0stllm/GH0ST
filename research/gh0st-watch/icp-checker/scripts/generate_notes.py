import json, pathlib, itertools,hashlib
from llama_cpp import Llama,LlamaGrammar
import argparse
args=argparse.ArgumentParser(description='Generate constrained, evidence-compatible fallback wording with the pinned Qwen GGUF.')
args.add_argument('model',type=pathlib.Path)
p=args.parse_args().model
frontend=pathlib.Path(__file__).resolve().parents[1]/'frontend'
with p.open('rb') as f: assert hashlib.file_digest(f,'sha256').hexdigest()=='aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223'
model=Llama(model_path=str(p),n_ctx=512,n_batch=64,n_threads=4,n_gpu_layers=0,verbose=False,seed=42)
nums=['No','One','Two','Three','Four','Five','Six']
cards={}
for hits in range(7):
 for unknown in range(7-hits):
  ran=6-unknown
  if hits:
   a=f"{nums[hits]} behavior{'s were' if hits!=1 else ' was'} reproduced."
   b=f"The tests reproduced {nums[hits].lower()} behavior{'s' if hits!=1 else ''}."
  elif ran:
   a="The completed checks did not reproduce a defect."
   b="None of the completed checks reproduced the target behavior."
  else:a="All six behaviors remain untested.";b="None of the six behavior checks could run."
  if unknown and ran:
   tail=f" {nums[unknown]} check{'s remain' if unknown!=1 else ' remains'} untested."
   a+=tail;b+=tail
  elif not unknown:
   a+=" All six checks ran.";b+=" All six checks completed."
  grammar=LlamaGrammar.from_string('root ::= '+json.dumps(a)+' | '+json.dumps(b),verbose=False)
  prompt=f"Six behavior checks: {hits} reproduced, {ran-hits} not reproduced, {unknown} untested. Explain coverage in plain English:"
  r=model.create_completion(prompt=prompt,grammar=grammar,temperature=0,max_tokens=50)
  v=r['choices'][0]['text'].strip();assert v in (a,b),v;cards[f'{hits}/{unknown}']=v
out=frontend/'coverage.json'
out.write_text(json.dumps(cards,indent=2)+'\n');print('Validated profiles',len(cards))

# The grammar only allows interpretations warranted by the corresponding outcome.
options={
'mint':[
 ["This call did not demonstrate an ordinary account minting seven units.","The account did not gain the seven units targeted by the mint test."],
 ["An ordinary test account could mint to itself. Check whether that permission is intended.","The caller created tokens for itself. Compare this behavior with the token's mint policy."]],
'underflow':[
 ["The burn attempt did not turn a zero balance into the largest possible token balance.","The zero-balance caller did not gain tokens through the tested arithmetic wrap."],
 ["Burning one from zero produced the largest possible balance. That is the arithmetic wrap the test targets.","The burn changed zero into the maximum unsigned balance, giving the tester a large recorded balance."]],
'withdraw':[
 ["The test did not demonstrate an extra payout from withdrawing again during the first withdrawal.","This reentry attempt did not reproduce a second payout against the same deposit."],
 ["The tester received more than it deposited after entering the withdrawal again.","The same deposit paid out twice during the simulated reentry."]],
'authorization':[
 ["The intermediary did not redirect the owner's payment in the tested call path.","The tested payment path did not demonstrate the intermediary receiving authority from the original caller."],
 ["Payment went through an intermediary under the owner's transaction. Review which caller the contract authorizes.","The intermediary could direct a payment when called by the owner. Check the authorization predicate."]],
'replay':[
 ["Submitting the same signed coupon twice did not demonstrate a second credit.","The repeated signature did not reproduce another credit in this test."],
 ["Reusing the same signed coupon credited the account again.","The account gained points a second time from an identical signature."]],
'token':[
 ["The test did not demonstrate an unbacked credit after a failed token transfer.","The false-return token did not reproduce the targeted credit without payment."],
 ["The deposit credited the caller even though the token moved nothing.","The recorded credit increased without the corresponding transfer of tokens."]]}
notes={}
for family,pair in options.items():
 notes[family]=[]
 for i,variants in enumerate(pair):
  g=LlamaGrammar.from_string('root ::= '+' | '.join(map(json.dumps,variants)),verbose=False)
  prompt=f'Solidity test: {family}. Reproduced: {bool(i)}. Explain the consequence of this observation:'
  text=model.create_completion(prompt=prompt,grammar=g,temperature=0,max_tokens=55)['choices'][0]['text'].strip()
  assert text in variants,text
  notes[family].append(text)
(frontend/'rule-notes.json').write_text(json.dumps(notes,indent=2)+'\n')
