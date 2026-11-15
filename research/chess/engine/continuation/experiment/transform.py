from pathlib import Path
import icpp_binaryen as b
root=Path(__file__).resolve().parent
b.ffi.cdef('void BinaryenModuleRunPasses(BinaryenModuleRef,const char**,int); void BinaryenSetPassArgument(const char*,const char*); const char* BinaryenExportGetValue(BinaryenExportRef);')
with b.Module.load(root/'build/gh0st_stockfish19_asyncify.wasm') as m:
 remove=[]
 for i in range(m.num_exports):
  e=b.lib.BinaryenGetExportByIndex(m.ref,i)
  name=b.ffi.string(b.lib.BinaryenExportGetName(e)).decode()
  if name in ['gh0st_call_on_engine_stack','gh0st_async_begin','gh0st_async_advance']:
   remove.append(b.ffi.string(b.lib.BinaryenExportGetValue(e)).decode())
 print('excluded runtime',remove,flush=True)
 b.lib.BinaryenSetPassArgument(b'asyncify-removelist',','.join(remove).encode())
 b.lib.BinaryenSetPassArgument(b'asyncify-imports',b'__none__.__none__')
 n=b.ffi.new('char[]',b'asyncify');arr=b.ffi.new('char*[]',[n]);b.lib.BinaryenModuleRunPasses(m.ref,arr,1)
 assert m.validate();m.write(root/'engine.asyncify.wasm')
 print('asyncify bytes',(root/'engine.asyncify.wasm').stat().st_size,flush=True)
