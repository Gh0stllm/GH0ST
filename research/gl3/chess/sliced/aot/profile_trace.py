"""Summarize evenly spaced instruction witnesses after a complete replay.

Counts are sampled locations, not a wall-clock CPU profile or a new proof.
The complete frozen machine/root and exact expected end are required first.
"""
from pathlib import Path
from collections import Counter
import argparse,importlib.util,json,re
HERE=Path(__file__).resolve().parent;CHESS=HERE.parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--next',action='store_true');options=parser.parse_args()
OUT=HERE/'.cache'/('proof-next' if options.next else 'proof-first')
report=json.loads((OUT/'proof-run.json').read_text());assert report['completed'] and report['allFourGlobalStateFieldsMatch']
spec=importlib.util.spec_from_file_location('proof_helpers',CHESS/'select_full_proofs.py');helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)
names={10:helpers.function_names(OUT/'replay.wasm'),9:helpers.function_names(OUT/'gl3aot.wasm')}
proofs=json.loads((OUT/'full-proofs.json').read_text());log=re.sub(r'\x1b\[[0-9;]*m','',(OUT/'prover.log').read_text())
trace=re.findall(r'Generating proof\s+\d+\s+\(inst\s+(\d+)\) for ([^\n]+)',log);assert len(proofs)==len(trace)+1
functions=Counter();modules=Counter()
for p in proofs[:-1]:
 at=helpers.location(p['proof']);name=names.get(at['module'],{}).get(at['function'],'unnamed function '+str(at['function']))
 functions[(at['module'],name)]+=1;modules[at['module']]+=1
result={'scope':'uniform instruction-step samples; not CPU wall time, inference latency or proof of an individual search function','moduleRoot':report['moduleRoot'],'interval':report['interval'],'samples':len(trace),'moduleSamples':dict(modules),'functionSamples':[{'module':module,'function':name,'samples':count,'sampleFraction':count/len(trace)} for (module,name),count in functions.most_common(30)],'publicDeployment':False,'realSpend':0}
(OUT/'sampled-profile.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
