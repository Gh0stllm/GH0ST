from pathlib import Path
import sys
import icpp_binaryen as b
HERE=Path(__file__).resolve().parent;CACHE=Path(sys.argv[1]) if len(sys.argv)>1 else HERE/'.cache'
b.ffi.cdef('void BinaryenModuleRunPasses(BinaryenModuleRef,const char**,int); void BinaryenSetPassArgument(const char*,const char*); const char* BinaryenExportGetValue(BinaryenExportRef); typedef struct BinaryenGlobal *BinaryenGlobalRef; BinaryenGlobalRef BinaryenGetGlobalByIndex(BinaryenModuleRef,uint32_t); const char* BinaryenGlobalGetName(BinaryenGlobalRef); bool BinaryenGlobalIsMutable(BinaryenGlobalRef); BinaryenExportRef BinaryenAddGlobalExport(BinaryenModuleRef,const char*,const char*);')
with b.Module.load(CACHE/'sliced.raw.wasm') as m:
 remove=[]
 for i in range(m.num_exports):
  e=b.lib.BinaryenGetExportByIndex(m.ref,i);name=b.ffi.string(b.lib.BinaryenExportGetName(e)).decode()
  if name in ['gh0st_call_on_engine_stack','gl3_slice_begin','gl3_slice_advance']:
   remove.append(b.ffi.string(b.lib.BinaryenExportGetValue(e)).decode())
 b.lib.BinaryenSetPassArgument(b'asyncify-removelist',','.join(remove).encode())
 b.lib.BinaryenSetPassArgument(b'asyncify-imports',b'__none__.__none__')
 n=b.ffi.new('char[]',b'asyncify');a=b.ffi.new('char*[]',[n]);b.lib.BinaryenModuleRunPasses(m.ref,a,1)
 for i in range(b.lib.BinaryenGetNumGlobals(m.ref)):
  g=b.lib.BinaryenGetGlobalByIndex(m.ref,i)
  if b.lib.BinaryenGlobalIsMutable(g):
   b.lib.BinaryenAddGlobalExport(m.ref,b.lib.BinaryenGlobalGetName(g),f'gl3_global_{i}'.encode())
 assert m.validate();m.write(CACHE/'sliced.wasm')
