"""Full24m native/Wasm parity with fresh engine instances and retained state."""
from pathlib import Path
import ctypes,gc,hashlib,json,struct,time,platform
import wasmtime
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[3];CACHE=HERE/'.cache';OUT=CACHE/'parity';OUT.mkdir(exist_ok=True)
NATIVE_LIBRARY=CACHE/('libgl3chess-neon.dylib' if platform.system()=='Darwin' else 'libgl3chess-sse41.so')
FEN='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
def digest(b):return hashlib.sha256(b).hexdigest()
def request(op,moves,state):
 f=FEN.encode();m=' '.join(moves).encode();return struct.pack('<IIII',op,len(f),len(m),len(state))+f+m+state

def decode(b):
 status,nodes,depth,nm,ns=struct.unpack('<IQIII',b[:24]);assert status==0 and len(b)==24+nm+ns
 return {'bestmove':b[24:24+nm].decode(),'actual_nodes':nodes,'depth':depth},bytes(b[24+nm:])

class Native:
 def __init__(self,library=None):
  self.lib=ctypes.CDLL(str(library or NATIVE_LIBRARY));self.lib.gl3_execute.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.POINTER(ctypes.c_void_p)];self.lib.gl3_execute.restype=ctypes.c_uint32;self.lib.gl3_free.argtypes=[ctypes.c_void_p]
 def run(self,raw):
  p=ctypes.c_void_p();buf=ctypes.create_string_buffer(raw);n=self.lib.gl3_execute(buf,len(raw),ctypes.byref(p));assert n,'native engine rejected request'
  try:return ctypes.string_at(p,n)
  finally:self.lib.gl3_free(p)

class Wasm:
 def __init__(self):
  self.engine=wasmtime.Engine();self.module=wasmtime.Module.from_file(self.engine,str(CACHE/'gl3chess.wasm'));self.calls={}
 def run(self,raw):
  store=wasmtime.Store(self.engine);store.set_limits(memory_size=2*1024**3);linker=wasmtime.Linker(self.engine)
  def callback(module,name):
   def call(caller,*args):
    key=module+'.'+name;self.calls[key]=self.calls.get(key,0)+1
    if module=='wasi_snapshot_preview1' and name in ['environ_sizes_get','args_sizes_get']:
     memory=caller.get('memory');memory.write(caller,b'\0'*4,args[0]);memory.write(caller,b'\0'*4,args[1]);return 0
    if module=='wasi_snapshot_preview1' and name in ['environ_get','args_get']:return 0
    raise RuntimeError('Forbidden external operation: '+key)
   return call
  for imp in self.module.imports:
   assert isinstance(imp.type,wasmtime.FuncType),(imp.module,imp.name)
   linker.define_func(imp.module,imp.name,imp.type,callback(imp.module,imp.name),access_caller=True)
  instance=linker.instantiate(store,self.module);ex=instance.exports(store)
  if '_initialize' in ex:ex['_initialize'](store)
  else:ex['__wasm_call_ctors'](store)
  mem=ex['memory'];ip=ex['gl3_alloc'](store,len(raw));pp=ex['gl3_alloc'](store,4);assert ip and pp
  mem.write(store,raw,ip);n=ex['gl3_execute'](store,ip,len(raw),pp);assert n,'Wasm engine rejected request'
  op=struct.unpack('<I',mem.read(store,pp,pp+4))[0];result=bytes(mem.read(store,op,op+n))
  ex['gl3_free'](store,op);ex['gl3_free'](store,ip);ex['gl3_free'](store,pp)
  store.close();gc.collect();return result

if __name__=='__main__':
 report={'scope':'Full engine native and direct scalar Wasm library; not yet GL3 transaction/replay/fraud proof','passed':False,'nodesPerDecision':24000000,'HashMiB':128,'records':[],'freshWasmInstanceEveryCall':True}
 native=Native();wasm=Wasm();started=time.monotonic()
 try:
  a,ns=decode(native.run(request(0,[],b'')));b,ws=decode(wasm.run(request(0,[],b'')));assert a==b
  report['initialStateBytes']=len(ns);report['initialNativeSHA256']=digest(ns);report['initialWasmSHA256']=digest(ws);assert ns==ws,'initial retained state differs'
  (OUT/'initial-state.bin').write_bytes(ns)
  prior=json.loads((REPO/'research/chess/benchmarks/results/retained24m-vs48m/48m-king-pawn.json').read_text());history=[];count=0
  for old in prior['moves']:
   if old['side']=='White':history.append(old['uci']);continue
   began=time.monotonic();a,nnext=decode(native.run(request(1,history,ns)));native_seconds=time.monotonic()-began
   began=time.monotonic();b,wnext=decode(wasm.run(request(1,history,ws)));wasm_seconds=time.monotonic()-began
   expected={'bestmove':old['uci'],'actual_nodes':old['actual_nodes'],'depth':old['depth']}
   row={'decision':count+1,'history':list(history),'native':a,'wasm':b,'reference':expected,'nativeSeconds':native_seconds,'wasmSeconds':wasm_seconds,'stateBytes':len(nnext),'nativeStateSHA256':digest(nnext),'wasmStateSHA256':digest(wnext)}
   report['records'].append(row);(OUT/'progress.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(row),flush=True)
   assert a==b==expected,'full24m move/nodes/depth differs';assert nnext==wnext,'future-affecting retained state differs'
   ns,ws=nnext,wnext;history.append(a['bestmove']);count+=1
   (OUT/'state.bin').write_bytes(ns)
   if count==4:break
  report['passed']=True;report['complete24mDecisionsCompared']=count;report['allCanonicalStatesMatch']=True
 finally:
  report['hostImportCalls']=wasm.calls;report['seconds']=time.monotonic()-started
  (OUT/'results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'passed':report['passed'],'completeDecisions':len(report['records']),'seconds':report['seconds']}),flush=True)
