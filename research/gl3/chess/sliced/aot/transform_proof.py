from pathlib import Path
import icpp_binaryen as b
HERE=Path(__file__).resolve().parent;CACHE=HERE/'.cache'
b.ffi.cdef('void BinaryenModuleRunPasses(BinaryenModuleRef,const char**,int); void BinaryenSetPassArgument(const char*,const char*); const char* BinaryenExportGetValue(BinaryenExportRef); uint32_t BinaryenModuleGetFeatures(BinaryenModuleRef); void BinaryenModuleSetFeatures(BinaryenModuleRef,uint32_t); uint32_t BinaryenFeatureBulkMemory(void);')
with b.Module.load(CACHE/'companion.raw.wasm') as m:
 remove=[]
 for i in range(m.num_exports):
  e=b.lib.BinaryenGetExportByIndex(m.ref,i)
  if b.ffi.string(b.lib.BinaryenExportGetName(e))==b'gl3aot__execute':remove.append(b.ffi.string(b.lib.BinaryenExportGetValue(e)).decode())
 assert len(remove)==1
 b.lib.BinaryenSetPassArgument(b'asyncify-removelist',','.join(remove).encode())
 b.lib.BinaryenSetPassArgument(b'asyncify-imports',b'__none__.__none__')
 for name in [b'asyncify']:
  n=b.ffi.new('char[]',name);passes=b.ffi.new('char*[]',[n]);b.lib.BinaryenModuleRunPasses(m.ref,passes,1)
 # Upstream WAVM requires MVP memory operations. The compiler disables bulk
 # operations; clear Binaryen's unused feature so it omits DataCount metadata.
 features=b.lib.BinaryenModuleGetFeatures(m.ref)
 b.lib.BinaryenModuleSetFeatures(m.ref,features & ~b.lib.BinaryenFeatureBulkMemory())
 assert m.validate();m.write(CACHE/'companion.wasm')
