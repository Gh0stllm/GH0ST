"""Freeze passing local results for the second Solidity optimization pass."""
import gzip
import hashlib
import json
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
load = lambda p: json.loads((HERE / p).read_text())
run = load('final-local-test/text-results.json')
replay = load('final-local-test/independent-reference.json')
packed = load('model/packed-results.json')
security = load('decoder/packed-tuned-headroom/sentence-security.json')
before = json.loads((ROOT/'evm32/final-local-test/text-results.json').read_text())
assert run['status'] == replay['status'] == security['status'] == 'PASS'
assert packed['status'] == 'PASS_EXACT_PACKED_PARITY'
assert all(c['passed'] for c in run['checks']) and all(c['passed'] for c in security['checks'])
gas = [int(r['gasUsed']) for r in run['swaps']]
old_gas = [int(r['gasUsed']) for r in before['swaps']]
assert max(gas) < 32_000_000 and run['transaction_gas_ceiling'] == 32_000_000
same_words = [r['text'] for r in run['swaps']] == [r['text'] for r in before['swaps']]
same_features = [r['features'] for r in run['swaps']] == [r['features'] for r in before['swaps']]
same_states = [r['after']['hidden'] for r in run['swaps']] == [r['after']['hidden'] for r in before['swaps']]
result = {
 'status':'PASS_LOCAL_SOLIDITY_32M_SECOND_OPTIMIZATION',
 'scope':'UNFORKED_LOCAL_ONLY', 'mainnet_actions':0,
 'model_parameters':8175493,
 'checkpoint_sha256':'904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3',
 'weights_or_precision_changed':False, 'stylus_or_wasm_used':False,
 'gpu_available':False, 'numerical_checks_device':'CPU',
 'swaps':len(gas), 'words':sum(r['wordCount'] for r in run['swaps']),
 'completed_sentences':sum(r['terminal'] for r in run['swaps']),
 'new_words_per_successful_swap':[min(r['wordCount'] for r in run['swaps']),max(r['wordCount'] for r in run['swaps'])],
 'gas':{'min':min(gas),'max':max(gas),'mean':statistics.mean(gas)},
 'previous_gas':{'min':min(old_gas),'max':max(old_gas),'mean':statistics.mean(old_gas)},
 'mean_gas_reduction_percent':100*(1-statistics.mean(gas)/statistics.mean(old_gas)),
 'same_text_as_previous_run':same_words,'same_features_as_previous_run':same_features,'same_hidden_states_as_previous_run':same_states,
 'independent_replay':{k:v for k,v in replay.items() if k not in ('rows','words')},
 'packed_parity_cases':len(packed['batchTests']),
 'real_pool_checks':len(run['checks']), 'mock_pool_security_checks':len(security['checks']),
 'stopping_policy':'One to three new neural words per successful swap; stop at natural terminal punctuation or the preflight-selected word cap, then continue the same state on the next swap.',
 'limits':{'transaction_gas':32000000,'model_call_gas':26000000,'decoder_call_gas':800000,'callback_reserve':2000000},
 'protocol':{'payload_bytes':7089,'abi_return_bytes':7168,'magic':'0x4e563031','slot_bytes':2361},
 'selected':{'model':'model/GRU2PackedModel.sol','hook':'decoder/NovaPackedBatchTextHookTuned.sol','export':'profile/signed'},
 'ten_swaps_per_second_demonstrated':False,
 'sources':{},'reports':{},
}
oracle = load('decoder/oracle-results.json')
assert oracle['status'] == 'PASS'
result['decoder_oracle_cases'] = len(oracle['checks'])
result['test_harnesses'] = {
 p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
 for p in ['evm32/test-text.mjs','evm32/verify-text.py']
}
for p in ['model/GRU2PackedModel.sol','model/build.py','model/packed-methods.inc','decoder/NovaPackedBatchTextHookTuned.sol','compute/signed-combined-initial.sol','profile/signed-packing.py','profile/align-core.py']:
 result['sources'][p]=hashlib.sha256((HERE/p).read_bytes()).hexdigest()
for p in ['final-local-test/text-results.json','final-local-test/independent-reference.json','model/packed-results.json','decoder/packed-tuned-headroom/sentence-security.json','decoder/oracle-results.json','decoder/representation-proof.json','compute/RESULTS.json','profile/signed-data-audit.json','profile/signed-proof.json','profile/manifest-metadata-verified.json','profile/manifest-artifacts-verified.json']:
 data=(HERE/p).read_bytes();entry={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
 if len(data)>50000:
  zipped=gzip.compress(data,mtime=0);Path(str(HERE/p)+'.gz').write_bytes(zipped)
  entry.update(published_as=p+'.gz',gzip_sha256=hashlib.sha256(zipped).hexdigest())
 result['reports'][p]=entry
(HERE/'RESULTS.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['status','swaps','words','gas','mean_gas_reduction_percent']}))
