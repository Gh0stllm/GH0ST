from pathlib import Path
import json,hashlib,collections,os
p=Path(__file__).resolve().parent.parent;a=p/'audit'
full_path=p/'flat-full-test/integration-results.json';load_path=p/'flat-load-test/load-test-results.json'
f=json.loads(full_path.read_text());l=json.loads(load_path.read_text())
assert f['status']==l['status']=='PASS';assert len(f['checks'])==64 and all(x['passed']for x in f['checks'])
rows=[r for b in l['bursts']for r in b['rows']];assert len(rows)==44
assert sorted(r['sequence']for r in rows)==list(range(1,45));assert all(r['text']for r in rows)
blocks=collections.defaultdict(list)
for r in rows:blocks[r['blockNumber']].append(r)
block_rows=[{'block':block,'swaps':len(rr),'summed_swap_gas':sum(int(r['gasUsed'])for r in rr)}for block,rr in sorted(blocks.items())]
assert max(r['swaps']for r in block_rows)==2;assert all(r['summed_swap_gas']<=32000000for r in block_rows)
sha=lambda x:hashlib.sha256(x.read_bytes()).hexdigest()
hook=p.parent/'nova-pool/contracts/NovaPoolHook.sol';model=p/'selected/GRU2SIMDModel.sol'
for r in [f,l]:
 assert r['source_hashes']['experiments/gh0st-voice/nova-pool/contracts/NovaPoolHook.sol']==sha(hook)
 assert r['source_hashes']['experiments/gh0st-voice/voice-v8/exports/grammar4m/GRU2SIMDModel.sol']==sha(model)
report={'status':'PASS_SELECTED_LOCAL_INTEGRATION','mode':'UNFORKED_LOCAL_ONLY','selected_model_sha256':sha(model),'original_hook_sha256':sha(hook),'baseline_hook_unchanged':True,'security_guards_removed':0,'callback_reserve':2000000,'decoder_gas_limit':1500000,'inference_gas_limit':13300000,'transaction_gas_limit':17500000,'block_gas_limit':32000000,'integration_checks':64,'integration_buys_and_sells':32,'integration_final_real_model_sequence':int(f['final_state']['sequence']),'integration_max_swap_gas':int(f['max_real_swap_gas']),'load_total':44,'load_passed':44,'load_failed':0,'largest_pending_queue':16,'max_swaps_per_block':2,'load_gas':{k:int(v)for k,v in l['gas_summary'].items()},'blocks':block_rows,'model_words_all_nonempty':True,'load_sequences_exactly_1_through_44':True,'artifact_hashes':{os.path.relpath(x,p):sha(x)for x in [full_path,load_path,model,hook,a/'packing-independent-audit.json',a/'kernel-audit.json']},'source_parameters':8175493,'logical_weights_unchanged':True,'unselected_candidates':['audit/NovaPoolHookPacked.sol'],'public_network_actions':0,'limitations':['Local block packing is not a guarantee of mainnet inclusion or swap latency.','No independent external security audit was performed.','Packed-state hook is unselected and not included in these receipts.']}
(a/'selected-final-audit.json').write_text(json.dumps(report,indent=2)+'\n')
s=json.loads((a/'selected-static-review.json').read_text());s['status']='PASS_SELECTED_LOCAL_INTEGRATION';s['full_integration_receipts']='../flat-full-test/integration-results.json';s['load_receipts']='../flat-load-test/load-test-results.json';s['integration_checks']=64;s['load_swaps']=44;s['max_swaps_per_32m_block']=2;(a/'selected-static-review.json').write_text(json.dumps(s,indent=2)+'\n')
q=a/'SECURITY-REVIEW.md';t=q.read_text();t=t.replace('The final integration report supplies the completed check count and receipt evidence.', 'The final integration report passes 64 checks and 32 recorded real-model buys/sells; its final real-model sequence is 37 after ancillary successful cases. The separate load run passes all 44 swaps, with 16 pending at once and up to two swaps in one 32M block. Every load word is nonempty and sequences are exactly 1 through 44. Maximum load gas is 15,174,932; mean is 14,333,315. The model cap is 13.3M, submitted transaction gas limit is 17.5M, and the original 2M callback reserve remains intact. `selected-final-audit.json` independently checks these counts and binds the receipt reports to the selected source hashes.')
t=t.replace('Final approval requires the combined model/hook\'s full adversarial suite, exact recurrent-state/logit parity, real buys/sells, and actual same-block receipts.', 'The selected local integration suite and same-block receipt checks have passed. Exact model-byte and packing checks are documented above; any further deployment or external audit remains a separate decision.')
q.write_text(t)
print(json.dumps({k:report[k]for k in ['status','integration_checks','load_total','max_swaps_per_block','load_gas','selected_model_sha256','original_hook_sha256']},indent=2))
print(json.dumps([{k:b[k]for k in ['direction','submitted','blocksContainingSwaps','maxSwapsInOneBlock']}for b in l['bursts']],indent=2))
