// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental ABI for exact portable-state parity. No clock, file or oracle.
#include "gl3vm.h"
#include <stdlib.h>
#include <string.h>

#define DENY(name, args) u32 w2c_wasi__snapshot__preview1_##name args { wasm_rt_trap(WASM_RT_TRAP_UNREACHABLE); return 0; }
DENY(clock_time_get, (struct w2c_wasi__snapshot__preview1* s, u32 a, u64 b, u32 c))
DENY(environ_get, (struct w2c_wasi__snapshot__preview1* s, u32 a, u32 b))
DENY(environ_sizes_get, (struct w2c_wasi__snapshot__preview1* s, u32 a, u32 b))
DENY(fd_close, (struct w2c_wasi__snapshot__preview1* s, u32 a))
DENY(fd_fdstat_get, (struct w2c_wasi__snapshot__preview1* s, u32 a, u32 b))
DENY(fd_fdstat_set_flags, (struct w2c_wasi__snapshot__preview1* s, u32 a, u32 b))
DENY(fd_prestat_dir_name, (struct w2c_wasi__snapshot__preview1* s, u32 a, u32 b, u32 c))
DENY(fd_prestat_get, (struct w2c_wasi__snapshot__preview1* s, u32 a, u32 b))
DENY(fd_read, (struct w2c_wasi__snapshot__preview1* s, u32 a, u32 b, u32 c, u32 d))
DENY(fd_seek, (struct w2c_wasi__snapshot__preview1* s, u32 a, u64 b, u32 c, u32 d))
DENY(fd_write, (struct w2c_wasi__snapshot__preview1* s, u32 a, u32 b, u32 c, u32 d))
DENY(path_open, (struct w2c_wasi__snapshot__preview1* s, u32 a, u32 b, u32 c, u32 d, u32 e, u64 f, u64 g, u32 h, u32 i))
void w2c_wasi__snapshot__preview1_proc_exit(struct w2c_wasi__snapshot__preview1* s, u32 a) { wasm_rt_trap(WASM_RT_TRAP_UNREACHABLE); }

void* gl3aot_create(void) {
  wasm_rt_init();
  w2c_gl3vm* v = calloc(1, sizeof(w2c_gl3vm));
  if (!v) {wasm_rt_trap(WASM_RT_TRAP_UNREACHABLE);return NULL;}
  wasm2c_gl3vm_instantiate(v, NULL);
  return v;
}
void gl3aot_destroy(w2c_gl3vm* v) { wasm2c_gl3vm_free(v); free(v); }
void* gl3aot_memory(w2c_gl3vm* v) { return v->w2c_memory.data; }
u32 gl3aot_memory_size(w2c_gl3vm* v) { return v->w2c_memory.size; }
void gl3aot_grow(w2c_gl3vm* v, u32 bytes) {
  if (bytes % 65536 || bytes > 768*1024*1024 || bytes < v->w2c_memory.size) wasm_rt_trap(WASM_RT_TRAP_UNREACHABLE);
  if (bytes > v->w2c_memory.size && wasm_rt_grow_memory(&v->w2c_memory, (bytes-v->w2c_memory.size)/65536) == UINT64_MAX) wasm_rt_trap(WASM_RT_TRAP_UNREACHABLE);
}
static u32* global(w2c_gl3vm* v, u32 which) {
  switch (which) {
    case 0: return w2c_gl3vm_gl3_global_0(v);
    case 98: return w2c_gl3vm_gl3_global_98(v);
    case 99: return w2c_gl3vm_gl3_global_99(v);
    default: wasm_rt_trap(WASM_RT_TRAP_UNREACHABLE); return 0;
  }
}
u32 gl3aot_global_get(w2c_gl3vm* v, u32 which) { return *global(v, which); }
void gl3aot_global_set(w2c_gl3vm* v, u32 which, u32 value) { *global(v, which) = value; }
u64 gl3aot_call(w2c_gl3vm* v, u32 op, u32 a, u32 b) {
  switch (op) {
    case 0: w2c_gl3vm_0x5Finitialize(v); return 0;
    case 1: return w2c_gl3vm_gl3_slice_init(v);
    case 2: return w2c_gl3vm_gl3_alloc(v, a);
    case 3: w2c_gl3vm_gl3_free(v, a); return 0;
    case 4: return w2c_gl3vm_gl3_slice_begin(v, a, b);
    case 5: return w2c_gl3vm_gl3_slice_advance(v);
    case 6: return w2c_gl3vm_gl3_slice_observed(v);
    case 7: return w2c_gl3vm_gl3_slice_actual(v);
    case 8: return w2c_gl3vm_gl3_slice_steps(v);
    case 9: return w2c_gl3vm_gl3_slice_depth(v);
    case 10: return w2c_gl3vm_gl3_slice_best(v);
    case 11: return w2c_gl3vm_gl3_slice_canonical(v);
    case 12: return w2c_gl3vm_gl3_slice_canonical_size(v);
    default: wasm_rt_trap(WASM_RT_TRAP_UNREACHABLE); return 0;
  }
}
