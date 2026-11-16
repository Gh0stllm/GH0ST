"""Select real interpreter witnesses only after the full block matches its end."""
from pathlib import Path
import hashlib,importlib.util,json,re
HERE=Path(__file__).resolve().parent;CHESS=HERE.parent;OUT=HERE/'.cache/blocks'
spec=importlib.util.spec_from_file_location('proof_helpers',CHESS/'select_full_proofs.py');helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)

if __name__=='__main__':
 logfile=OUT/'prover.log';log=re.sub(r'\x1b\[[0-9;]*m','',logfile.read_text())
 assert 'End machine status: Finished' in log and 'Computed state matches the expected one' in log,'complete successful block replay is required'
 source=OUT/'input.json';input_data=json.loads(source.read_text());expected=input_data['ExpectedEndState']
 actual=re.search(r'End GlobalState:\s+BlockHash: (0x[0-9a-f]{64})\s+SendRoot: (0x[0-9a-f]{64})\s+Batch: (\d+)\s+PosInBatch: (\d+)',log)
 assert actual and actual.groups()==(expected['BlockHash'],expected['SendRoot'],str(expected['Batch']),str(expected['PosInBatch']))
 proofs=json.loads((OUT/'full-proofs.json').read_text());trace=re.findall(r'Generating proof\s+\d+\s+\(inst\s+(\d+)\) for ([^\n]+)',log)
 assert len(proofs)==len(trace)+1 and proofs[-1]['before']==proofs[-1]['after']
 manifest=json.loads((OUT/'proof-manifest.json').read_text()) if (OUT/'proof-manifest.json').exists() else {}
 module_root=manifest.get('moduleRoot',(CHESS/'.cache/machine-sliced/module-root.txt').read_text().strip())
 wasm=Path(manifest.get('canonicalReplayWasm',str(CHESS/'.cache/bin-sliced/replay.wasm')))
 if 'canonicalReplayWasmSHA256' in manifest:assert hashlib.sha256(wasm.read_bytes()).hexdigest()==manifest['canonicalReplayWasmSHA256']
 names=helpers.function_names(wasm);rows=[]
 for p,(step,opcode) in zip(proofs,trace):
  at=helpers.location(p['proof']);name=names.get(at['function'],'') if at['module']==8 else ''
  rows.append({**p,'step':step,'opcode':opcode,**at,'moduleName':'replay.wasm' if at['module']==8 else 'standard_library','functionName':name})
 selected=[]
 def choose(predicate,reason):
  row=next((r for r in rows if predicate(r)),None);assert row is not None,'missing '+reason
  selected.append({**row,'reason':reason})
 interpreter=lambda r:r['module']==8 and 'wazero/internal/engine/interpreter' in r['functionName']
 choose(interpreter,'embedded_wasm_interpreter_step')
 choose(lambda r:interpreter(r) and ('MemoryLoad' in r['opcode'] or 'MemoryStore' in r['opcode']),'embedded_wasm_interpreter_memory')
 choose(lambda r:interpreter(r) and ('IBinOp' in r['opcode'] or 'IRelOp' in r['opcode']),'embedded_wasm_interpreter_arithmetic')
 choose(lambda r:r['module']==8 and 'crypto/sha256' in r['functionName'],'authenticated_image_or_delta_hashing')
 last=int(trace[-1][0]);assert last+1000000000<1<<43,'OSP step envelope exceeded'
 selected.append({**proofs[-1],'step':str(last+1),'reason':'finished_self_transition_at_representative_nonzero_step'})
 (OUT/'selected-proofs.json').write_text(json.dumps(selected,indent=2)+'\n')
 st=logfile.stat();report={'passed':True,'scope':'Complete recorded engine-bearing first-operation block reaches the exact expected end under WAVM; this is not the entire24m-move WAVM run or a BoLD dispute','moduleRoot':module_root,'expectedEnd':expected,'allFourGlobalStateFieldsMatch':True,'completedWAVMStepRange':[last,last+1000000000],'exactFinalStepNotPrintedByUpstreamCLI':True,'approximateWallSeconds':st.st_mtime-getattr(st,'st_birthtime',st.st_ctime),'includesConcurrentLocalWork':True,'proofCount':len(proofs),'selectedWitnessCount':len(selected),'proofFileSHA256':hashlib.sha256((OUT/'full-proofs.json').read_bytes()).hexdigest(),'inputSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'interpreterWitnessesIdentifyVMImplementationNotIndividualStockfishFunction':True,'fullBoLDDisputeExecuted':False,'modelQualityReduced':False,'publicDeployment':False,'realSpend':0}
 (OUT/'wavm-replay.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
