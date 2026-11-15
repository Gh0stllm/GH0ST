from pathlib import Path
import hashlib,json,time,subprocess
import wasmtime
root=Path(__file__).resolve().parents[2];p=root/'.cache/asyncify-engine'
engine=wasmtime.Engine();module=wasmtime.Module.from_file(engine,str(p/'engine.asyncify.wasm'));store=wasmtime.Store(engine)
imports=[]
def trap(caller,ptr,n):raise RuntimeError(bytes(caller.get('memory').read(caller,ptr,ptr+n)).decode(errors='replace'))
for item in module.imports:
 n=len(item.type.results)
 if item.module=='ic0' and item.name=='trap':imports.append(wasmtime.Func(store,item.type,trap,access_caller=True))
 else:imports.append(wasmtime.Func(store,item.type,lambda *args,n=n: None if n==0 else (0 if n==1 else [0]*n)))
x=wasmtime.Instance(store,module,imports);ex=x.exports(store);memory=ex['memory']
report={'scope':'raw local Wasmtime execution of actual full-NNUE Stockfish Wasm; not ICP canister execution','artifact_sha256':hashlib.sha256((p/'engine.asyncify.wasm').read_bytes()).hexdigest(),'cases':[]}
for budget,every,position in [(100000,2000,0),(1000000,20000,0),(1000000,20000,1),(1000000,20000,2)]:
 start=time.monotonic();pending=ex['gh0st_async_begin'](store,budget,every,position);steps=1
 while pending:
  pending=ex['gh0st_async_advance'](store);steps+=1
  assert steps<2000
 ptr=ex['gh0st_async_best'](store);best=bytes(memory.read(store,ptr,ptr+8)).split(b'\0')[0].decode()
 result={'budget':budget,'quantum':every,'case_id':position,'code':ex['gh0st_async_code'](store),'bestmove':best,'actual_nodes':ex['gh0st_async_nodes'](store),'depth':ex['gh0st_async_depth'](store),'steps':steps,'seconds':time.monotonic()-start}
 fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';moves='e2e4' if position==1 else ''
 if position==2:fen='r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'
 native=subprocess.run([str(root/'.cache/native_probe'),fen,str(budget),'128',moves],capture_output=True,text=True,check=True,timeout=120)
 ref=json.loads(native.stdout.strip().splitlines()[-1]);result['native']=ref
 result['exact_match']=all(result[k]==ref[k] for k in ['bestmove','actual_nodes','depth'])
 report['cases'].append(result);print(json.dumps(result),flush=True)
 (p/'wasmtime-evidence.json').write_text(json.dumps(report,indent=2)+'\n')
 assert result['exact_match'] and result['code']==0
report['completed']=True;(p/'wasmtime-evidence.json').write_text(json.dumps(report,indent=2)+'\n')
