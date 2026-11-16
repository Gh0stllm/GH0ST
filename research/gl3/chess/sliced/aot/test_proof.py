"""Exact resumptions and recoverable traps in the scalar proof companion.

This Wasmtime gate is not a WAVM or Solidity proof. It must pass before the
experimental companion can be wired into an isolated replay-machine variant.
"""
from pathlib import Path
import ctypes, hashlib, json, time
import wasmtime
HERE=Path(__file__).resolve().parent;CACHE=HERE/'.cache'
engine=wasmtime.Engine();host=bytearray(8192)
def instantiate(p,bridge=False):
 s=wasmtime.Store(engine);s.set_limits(memory_size=1536*1024*1024);m=wasmtime.Module.from_file(engine,str(p));linker=wasmtime.Linker(engine)
 for imp in m.imports:
  def invoke(*args,name=imp.name):
   if not bridge:raise RuntimeError('forbidden host '+name)
   if name=='wavm_caller_load32':
    assert 0<=args[0]<=len(host)-4;return int.from_bytes(host[args[0]:args[0]+4],'little')
   if name=='wavm_caller_load8':return host[args[0]]
   if name=='wavm_caller_store32':host[args[0]:args[0]+4]=(args[1]&0xffffffff).to_bytes(4,'little');return
   if name=='wavm_caller_store8':host[args[0]]=args[1]&255;return
   raise RuntimeError('forbidden proof host '+name)
  linker.define_func(imp.module,imp.name,imp.type,invoke)
 return s,linker.instantiate(s,m).exports(s)
def pointer(s,x):return ctypes.cast(x['memory'].data_ptr(s),ctypes.c_void_p).value
ps,px=instantiate(CACHE/'companion.wasm',True)
def api(op,h=0,a=0,b=0,c=0,ptr=0,n=0):return px['gl3aot__execute'](ps,op,h,a,b,c,ptr,n)&((1<<64)-1)
def call(h,op,a=0,b=0):
 r=api(8,h,op,a,b);assert r<1<<63,('unexpected engine trap',op,r);return r
def new():
 h=api(0);assert 0<h<1<<32;call(h,0);assert call(h,1)==1;return h
def grow(h,n):px['gl3aot_grow'](ps,h,n)
def address(h):return pointer(ps,px)+px['gl3aot_memory'](ps,h)
def restore(s,x):
 h=api(0);n=x['memory'].data_len(s);grow(h,n);ctypes.memmove(address(h),pointer(s,x),n)
 for i in [0,98,99]:px['gl3aot_global_set'](ps,h,i,x['gl3_global_'+str(i)].value(s))
 return h
memcmp=ctypes.CDLL(None).memcmp;memcmp.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t]
def compare(s,x,h):
 n=x['memory'].data_len(s);assert px['gl3aot_memory_size'](ps,h)==n
 for i in [0,98,99]:assert px['gl3aot_global_get'](ps,h,i)==x['gl3_global_'+str(i)].value(s)
 assert memcmp(address(h),pointer(s,x),n)==0,'proof companion portable state mismatch'
 return hashlib.sha256((ctypes.c_ubyte*n).from_address(address(h))).hexdigest()
started=time.monotonic();negative=[]
h=new()
for name,op,a,b,c in [('unknown operation',99,0,0,0),('unknown global',6,77,0,0),('oversize copy',3,0xffffffff,0,0),('advance before begin',8,5,0,0)]:
 print('checking error:',name,flush=True)
 r=api(op,h,a,b,c,0,4 if op==3 else 0);assert r>>63==1,(name,r)
 assert api(5,h)==466157568,'trap left bridge unusable'
 negative.append(name)
api(1,h)
# An illegal chess move must be an engine error, not a fatal machine trap.
h=new();p=call(h,2,4);host[:4]=b'e2e5';assert api(3,h,p,ptr=0,n=4)==0
r=api(8,h,4,p,4);assert r>>63==1,r;negative.append('illegal history is recoverable');api(1,h)

s,x=instantiate(HERE.parent/'runtime/.cache/sliced.wasm');x['_initialize'](s);assert x['gl3_slice_init'](s)==1
h=new();compare(s,x,h);api(1,h)
p=x['gl3_alloc'](s,4);x['memory'].write(s,b'e2e4',p);pending=x['gl3_slice_begin'](s,p,4);x['gl3_free'](s,p)
rows=[]
for target in [4,4000,9850]:
 while pending and x['gl3_slice_steps'](s)<target:pending=x['gl3_slice_advance'](s)
 assert x['gl3_slice_steps'](s)==target
 h=restore(s,x);at=time.monotonic();count=0
 while pending and count<4:
  pending=x['gl3_slice_advance'](s);assert call(h,5)==pending;count+=1
 sha=compare(s,x,h)
 row={'startingStep':target,'steps':count,'allBytesAndGlobalsMatch':True,'memoryBytes':x['memory'].data_len(s),'memorySHA256':sha,'seconds':time.monotonic()-at}
 rows.append(row);print(json.dumps(row),flush=True);api(1,h)
assert not pending
report={'scope':'Wasmtime execution of scalar AOT proof companion; exact resumed VM images and recoverable errors; not WAVM/OSP/block proof','passed':True,'checkpoints':rows,'negativeChecks':negative,'artifactSHA256':hashlib.sha256((CACHE/'companion.wasm').read_bytes()).hexdigest(),'seconds':time.monotonic()-started,'publicDeployment':False,'realSpend':0}
(CACHE/'proof-parity.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
