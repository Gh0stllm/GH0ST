"""Executes the compiled Stylus ABI in Wasmtime with a minimal explicit host.
This is a local host simulation, not Nitro activation, ink metering or a proof.
"""
import hashlib,json,importlib.metadata
from pathlib import Path
import wasmtime
ROOT=Path(__file__).resolve().parents[1]
wasm=(ROOT/'target/wasm32-unknown-unknown/release/gh0st_stylus_kernel.wasm').read_bytes()
config=wasmtime.Config();config.wasm_simd=False;config.wasm_relaxed_simd=False
engine=wasmtime.Engine(config);module=wasmtime.Module(engine,wasm)
ALLOWED={'read_args','write_result','storage_flush_cache','pay_for_memory_grow','msg_reentrant','msg_value'}
assert all(i.module=='vm_hooks' and i.name in ALLOWED for i in module.imports)
records=[]
for case in json.loads((ROOT/'evidence/abi-cases.json').read_text()):
 store=wasmtime.Store(engine); linker=wasmtime.Linker(engine); output=[]
 calldata=bytes.fromhex(case['calldata'][2:])
 def callback(name,results):
  def call(caller,*args):
   memory=caller.get('memory')
   if name=='read_args': memory.write(caller,calldata,args[0])
   elif name=='write_result': output.append(bytes(memory.read(caller,args[0],args[0]+args[1])))
   elif name=='msg_value': memory.write(caller,bytes(32),args[0])
   elif name in {'storage_flush_cache','pay_for_memory_grow','msg_reentrant'}: pass
   else: raise AssertionError('unexpected host call')
   return 0 if results else None
  return call
 for item in module.imports:
  linker.define(store,item.module,item.name,wasmtime.Func(store,item.type,callback(item.name,len(item.type.results)),access_caller=True))
 instance=linker.instantiate(store,module)
 status=instance.exports(store)['user_entrypoint'](store,len(calldata))
 data=b''.join(output)
 if case['revert']: assert status!=0,case['name']
 else:
  assert status==0,case['name']
  assert '0x'+data.hex()==case['expected'],case['name']
 records.append({'name':case['name'],'passed':True,'entrypointStatus':status,'returnOrRevertHex':data.hex()})
memory_type=next(e.type for e in module.exports if e.name=='memory')
report={'initialMemoryPages':memory_type.limits.min,'maximumMemoryPages':memory_type.limits.max,'initialMemoryWithin128Pages':memory_type.limits.min<=128,'wasmtimePythonVersion':importlib.metadata.version('wasmtime'),'scope':'Compiled real Stylus-SDK ABI executed in local Wasmtime with explicit simulated vm_hooks; no Nitro activation, gas metering, deployment or proof','sdk':'0.10.10','rust':'1.99.1','wasmBytes':len(wasm),'wasmSHA256':hashlib.sha256(wasm).hexdigest(),'under256KiBUncompressed':len(wasm)<256*1024,'under96KiBEvenBeforeCompression':len(wasm)<96*1024,'simdDisabledAndModuleValidated':True,'imports':[i.name for i in module.imports],'passed':len(records),'records':records,'nitroActivationTested':False,'stylusGasMeasured':False,'fraudProofTested':False,'fullLLMTested':False,'financialActions':False}
(ROOT/'evidence/wasm-abi.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='records'},indent=2))
