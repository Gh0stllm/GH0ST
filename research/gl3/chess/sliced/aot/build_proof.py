"""Build only the isolated proof-companion experiment, never a live node."""
from pathlib import Path
import concurrent.futures, hashlib, json, subprocess, time
from build import HERE, CACHE, REPO, VM_SHA, run, digest, toolchain
began=time.monotonic();src,_=toolchain()
sdk=REPO/'research/chess/engine/.cache/toolchain/wasi-sdk/wasi-sdk-25.0/bin'
obj=CACHE/'proof-objects';obj.mkdir(exist_ok=True)
include=CACHE/'proof-include';include.mkdir(exist_ok=True)
# No setjmp is executed in this profile: traps use the explicit outer Asyncify
# handler below. Keep compatibility types; make accidental jumps fatal.
(include/'setjmp.h').write_text('typedef unsigned int jmp_buf[1];\n#define sigsetjmp(a,b) (__builtin_trap(),0)\n#define siglongjmp(a,b) __builtin_trap()\n#define longjmp(a,b) __builtin_trap()\n')
runtime=include/'wasm-rt.h'
s=(src/'wasm2c/wasm-rt.h').read_text()
start=s.index('#ifdef WASM_RT_C11_AVAILABLE\n#define WASM_RT_THREAD_LOCAL')
end=s.index('\n/**',start)
s=s[:start]+'#define WASM_RT_THREAD_LOCAL\n'+s[end:]
s=s.replace('WASM_RT_NO_RETURN void wasm_rt_trap(wasm_rt_trap_t);','void wasm_rt_trap(wasm_rt_trap_t);')
runtime.write_text(s)
# Headers included with quotes resolve beside generated files first. Their
# gl3vm.h includes wasm-rt.h from this private include path.
flags=['-O2','-Wno-pass-failed','-D_WASI_EMULATED_MMAN','-std=c99','-mno-simd128','-mno-bulk-memory','-fno-strict-aliasing','-DWASM_RT_USE_MMAP=0','-DWASM_RT_MEMCHECK_BOUNDS_CHECK=1','-DWASM_RT_STACK_DEPTH_COUNT=1','-DWASM_RT_MAX_CALL_STACK_DEPTH=10000','-DWASM_RT_TRAP_HANDLER=proof_trap','-DSIMDE_NO_NATIVE','-fno-vectorize','-fno-slp-vectorize','-I'+str(include),'-I'+str(CACHE/'generated'),'-I'+str(src/'wasm2c'),'-I'+str(src/'third_party/simde'),'-I'+str(HERE)]
# Private copies are needed because quoted includes search the source folder.
private=CACHE/'proof-runtime';private.mkdir(exist_ok=True)
for p in (src/'wasm2c').glob('wasm-rt*'):
 if p.is_file(): (private/p.name).write_bytes(p.read_bytes())
(private/'wasm-rt.h').write_text(s)
p=private/'wasm-rt-impl.c';p.write_text(p.read_text().replace('  WASM_RT_TRAP_HANDLER(code);\n  wasm_rt_unreachable();','  WASM_RT_TRAP_HANDLER(code);\n  return;'))
files=sorted((CACHE/'generated').glob('gl3vm_*.c'))+[private/'wasm-rt-impl.c',private/'wasm-rt-mem-impl.c',HERE/'proof_adapter.c',HERE/'mvp_memory.c',HERE/'stack.s']
def compile(p):
 out=obj/(p.stem+'.o');run([sdk/'clang',*(['-c'] if p.suffix=='.s' else [*flags,*(['-fno-builtin'] if p.name=='mvp_memory.c' else []),'-c']),p,'-o',out]);return out
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:objects=list(pool.map(compile,files))
segments=CACHE/'proof-segments.S'
segments.write_text('\n'.join('.section .rodata.gh0st,"",@\n.balign 16\n.globl '+name+'\n'+name+':\n.incbin "'+str(CACHE/f'segment-{i}.bin')+'"\n.size '+name+', .-'+name for i,name in enumerate(['data_segment_data_w2c_gl3vm_d0','data_segment_data_w2c_gl3vm_d1']))+'\n')
run([sdk/'clang','-c',segments,'-o',obj/'segments.o']);objects.append(obj/'segments.o')
raw=CACHE/'companion.raw.wasm'
run([sdk/'clang','-mno-bulk-memory','-mexec-model=reactor',*objects,'-Wl,--export=gl3aot__execute',*[f'-Wl,--export={n}' for n in ['gl3aot_memory','gl3aot_memory_size','gl3aot_grow','gl3aot_global_get','gl3aot_global_set']],'-Wl,-z,stack-size=8388608','-Wl,--initial-memory=134217728','-Wl,--max-memory=2147483648','-Wl,--allow-undefined','-o',raw])
run([REPO/'research/chess/engine/.cache/venv/bin/python',HERE/'transform_proof.py'])
report={'scope':'experimental scalar WAVM companion build; errors/parity and complete block replay still require tests','engineModuleSHA256':VM_SHA,'artifactSHA256':digest(CACHE/'companion.wasm'),'artifactBytes':(CACHE/'companion.wasm').stat().st_size,'seconds':time.monotonic()-began,'publicDeployment':False,'realSpend':0}
(CACHE/'proof-build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
