"""Full24m native vector path against published policy and portable state hashes."""
from pathlib import Path
import json,time,hashlib
from test_parity import Native,request,decode,FEN,REPO,CACHE,digest,NATIVE_LIBRARY
out=CACHE/'native-acceleration';out.mkdir(exist_ok=True)
engine=Native();started=time.monotonic();report={'passed':False,'scope':'Native vector implementation, unchanged full model/node policy','records':[],'scalarWasmSuiteComplete':False}
try:
 _,state=decode(engine.run(request(0,[],b'')));report['initialStateSHA256']=digest(state)
 assert state==(CACHE/'parity/initial-state.bin').read_bytes()
 prior=json.loads((REPO/'research/chess/benchmarks/results/retained24m-vs48m/48m-king-pawn.json').read_text());history=[]
 for old in prior['moves']:
  if old['side']=='White':history.append(old['uci']);continue
  start=time.monotonic();result,state=decode(engine.run(request(1,history,state)))
  expected={'bestmove':old['uci'],'actual_nodes':old['actual_nodes'],'depth':old['depth']};assert result==expected
  row={'decision':len(report['records'])+1,**result,'stateSHA256':digest(state),'seconds':time.monotonic()-start};report['records'].append(row);print(json.dumps(row),flush=True);history.append(result['bestmove'])
  (out/'progress.json').write_text(json.dumps(report,indent=2)+'\n')
  if len(report['records'])==4:break
 report['passed']=True
finally:
 report['seconds']=time.monotonic()-started;report['librarySHA256']=hashlib.sha256(NATIVE_LIBRARY.read_bytes()).hexdigest();report['staticLibrarySHA256']=hashlib.sha256((CACHE/'libgl3chess.a').read_bytes()).hexdigest()
 (out/'results.json').write_text(json.dumps(report,indent=2)+'\n')
