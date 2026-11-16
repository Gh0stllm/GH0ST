"""Exact full-policy search, including destruction/recreation at a suspended frame."""
from pathlib import Path
import ctypes,gc,hashlib,json,struct,time
import wasmtime
HERE=Path(__file__).resolve().parent;CACHE=HERE/'.cache'
engine=wasmtime.Engine();module=wasmtime.Module.from_file(engine,str(CACHE/'sliced.wasm'))
calls={}
def instantiate():
 store=wasmtime.Store(engine);store.set_limits(memory_size=2*1024**3);linker=wasmtime.Linker(engine)
 for imp in module.imports:
  def deny(caller,*args,key=imp.module+'.'+imp.name):
   calls[key]=calls.get(key,0)+1
   raise RuntimeError('external host operation forbidden: '+key)
  linker.define_func(imp.module,imp.name,imp.type,deny,access_caller=True)
 instance=linker.instantiate(store,module);return store,instance.exports(store)
def snapshot(store,x):
 memory=bytes(x['memory'].read(store));globals={n:e.value(store) for n,e in x.items() if n.startswith('gl3_global_')}
 return memory,globals
def restore(image):
 store,x=instantiate();memory,globals=image;m=x['memory'];pages=(len(memory)-m.data_len(store))//65536
 if pages:m.grow(store,pages)
 m.write(store,memory)
 for n,v in globals.items():x[n].set_value(store,v)
 return store,x
def export_state(store,x):
 p=x['gl3_slice_canonical'](store);n=x['gl3_slice_canonical_size'](store)
 return bytes(x['memory'].read(store,p,p+n))
def quantile(a,p):return sorted(a)[min(len(a)-1,int(len(a)*p))]
report={'scope':'Portable continuation parity; not yet on-chain slice/cadence or OSP proof','complete':False,'fixedNodes':24000000,'HashMiB':128,'quantum':2048,'records':[],'hostCalls':calls}
store,x=instantiate();start=time.monotonic();x['_initialize'](store);assert x['gl3_slice_init'](store)==1
report['initializationSeconds']=time.monotonic()-start
initial=export_state(store,x);assert hashlib.sha256(initial).hexdigest()=='f564264708088b7408cc2485e0fd2c81c0bf8566cb5f55f1db59e7cd5c132064'
history=[]
for number,human in enumerate(['e2e4','g1f3']):
 history.append(human);raw=' '.join(history).encode();p=x['gl3_alloc'](store,len(raw));x['memory'].write(store,raw,p)
 times=[];begin=time.monotonic();t=begin;pending=x['gl3_slice_begin'](store,p,len(raw));times.append(time.monotonic()-t)
 restarts=[];count=1
 while pending:
  if count in [1,4000,8000]:
   t=time.monotonic();image=snapshot(store,x);before=x['gl3_slice_observed'](store);store.close();del x;gc.collect();store,x=restore(image);assert x['gl3_slice_observed'](store)==before
   restarts.append({'afterSlice':count,'memoryBytes':len(image[0]),'memorySHA256':hashlib.sha256(image[0]).hexdigest(),'globals':image[1],'seconds':time.monotonic()-t});del image
  t=time.monotonic();pending=x['gl3_slice_advance'](store);times.append(time.monotonic()-t);count+=1
  if count%1000==0:print(json.dumps({'decision':number+1,'slices':count,'observed':x['gl3_slice_observed'](store),'elapsed':time.monotonic()-begin}),flush=True)
  assert count<13000
 ptr=x['gl3_slice_best'](store);move=bytes(x['memory'].read(store,ptr,ptr+8)).split(b'\0')[0].decode()
 state=export_state(store,x);sha=hashlib.sha256(state).hexdigest();want=['5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6','b06a3f26b0b276c0109fb1888fa32727714ada8abb00cbec8f857bec8308068b'][number]
 row={'decision':number+1,'history':list(history),'move':move,'nodes':x['gl3_slice_actual'](store),'depth':x['gl3_slice_depth'](store),'checkpointSHA256':sha,'exactCheckpointMatch':sha==want,'slices':count,'seconds':time.monotonic()-begin,'sliceSeconds':{'p50':quantile(times,.5),'p95':quantile(times,.95),'p99':quantile(times,.99),'max':max(times)},'freshInstanceRestores':restarts}
 report['records'].append(row);(CACHE/'portable-results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(row),flush=True)
 assert sha==want and x['gl3_slice_actual'](store)>=24000000
 history.append(move);x['gl3_free'](store,p)
report['complete']=True;(CACHE/'portable-results.json').write_text(json.dumps(report,indent=2)+'\n')
