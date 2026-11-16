"""Select actual scalar-companion/runtime steps only after a complete replay."""
from pathlib import Path
import argparse,hashlib,importlib.util,json,re
HERE=Path(__file__).resolve().parent;CHESS=HERE.parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--next',action='store_true');options=parser.parse_args()
OUT=HERE/'.cache'/('proof-next' if options.next else 'proof-first')
spec=importlib.util.spec_from_file_location('proof_helpers',CHESS/'select_full_proofs.py');helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)
report=json.loads((OUT/'proof-run.json').read_text());assert report['completed'] and report['allFourGlobalStateFieldsMatch']
manifest=json.loads((OUT/'proof-manifest.json').read_text());log=re.sub(r'\x1b\[[0-9;]*m','',(OUT/'prover.log').read_text())
assert 'End machine status: Finished' in log and 'Computed state matches the expected one' in log
proofs=json.loads((OUT/'full-proofs.json').read_text());trace=re.findall(r'Generating proof\s+\d+\s+\(inst\s+(\d+)\) for ([^\n]+)',log)
assert len(proofs)==len(trace)+1 and proofs[-1]['before']==proofs[-1]['after']
assert hashlib.sha256((OUT/'replay.wasm').read_bytes()).hexdigest()==manifest['canonicalReplayWasmSHA256']
assert hashlib.sha256((OUT/'gl3aot.wasm').read_bytes()).hexdigest()==manifest['companionSHA256']
names={10:helpers.function_names(OUT/'replay.wasm'),9:helpers.function_names(OUT/'gl3aot.wasm')}
rows=[]
for p,(step,opcode) in zip(proofs,trace):
 at=helpers.location(p['proof']);mod=at['module'];rows.append({**p,**at,'step':step,'opcode':opcode,'moduleName':{10:'replay.wasm',9:'gl3aot.wasm'}.get(mod,'standard_library'),'functionName':names.get(mod,{}).get(at['function'],'')})
selected=[]
def choose(test,label):
 r=next((r for r in rows if test(r) and all(r['step']!=p['step'] for p in selected)),None);assert r is not None,'missing '+label;selected.append({**r,'reason':label})
choose(lambda r:r['module']==9,'scalar_companion_execution')
choose(lambda r:r['module']==9 and ('MemoryLoad' in r['opcode'] or 'MemoryStore' in r['opcode']),'scalar_companion_memory')
choose(lambda r:r['module']==9 and ('IBinOp' in r['opcode'] or 'IRelOp' in r['opcode']),'scalar_companion_integer_arithmetic')
choose(lambda r:r['module']==10 and 'sha256' in r['functionName'].lower(),'runtime_authenticated_state_hashing')
last=int(trace[-1][0]);assert last+manifest['interval']<1<<43
selected.append({**proofs[-1],'step':str(last+1),'reason':'finished_self_transition_nonzero_step'})
(OUT/'selected-proofs.json').write_text(json.dumps(selected,indent=2)+'\n')
report.update(proofCount=len(proofs),selectedWitnessCount=len(selected),completedWAVMStepRange=[last,last+manifest['interval']],exactLastStepNotPrintedByUpstreamCLI=True,fullBoLDDisputeExecuted=False,entire24mWAVMMoveExecuted=False,proofFileSHA256=hashlib.sha256((OUT/'full-proofs.json').read_bytes()).hexdigest(),witnessScope='compiled scalar companion/runtime instructions; individual Stockfish search functions are not inferred from unnamed translated frames')
(OUT/'wavm-replay.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
