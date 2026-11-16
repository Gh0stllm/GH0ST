// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental WAVM bridge. Outer Asyncify unwinds a generated-C trap into an
// explicit error result; the inner engine's portable frames stay unchanged.
#include "adapter.c"
typedef struct { u32 pointer, end; } unwind_data;
static unsigned char unwind_stack[4*1024*1024];
static unwind_data unwind;
static u32 error_code;
extern void __wasm_call_ctors(void);
static int constructors_done;
extern void start_unwind(unwind_data*) __attribute__((import_module("asyncify"), import_name("start_unwind")));
extern void stop_unwind(void) __attribute__((import_module("asyncify"), import_name("stop_unwind")));
extern u32 proof_stack_pointer(void);
extern void proof_set_stack_pointer(u32);
extern u32 caller_load32(u32) __attribute__((import_module("env"), import_name("wavm_caller_load32")));
extern u32 caller_load8(u32) __attribute__((import_module("env"), import_name("wavm_caller_load8")));
extern void caller_store32(u32,u32) __attribute__((import_module("env"), import_name("wavm_caller_store32")));
extern void caller_store8(u32,u32) __attribute__((import_module("env"), import_name("wavm_caller_store8")));
void proof_trap(wasm_rt_trap_t code) {
  error_code = code;
  unwind.pointer = (u32)(uintptr_t)unwind_stack;
  unwind.end = unwind.pointer + sizeof(unwind_stack);
  start_unwind(&unwind);
  return;
}
static void check(int ok) { if (!ok) wasm_rt_trap(WASM_RT_TRAP_UNREACHABLE); }
static __attribute__((noinline)) u64 work(u32 op, u32 handle, u32 a, u32 b, u32 c, u32 ptr, u32 size) {
  w2c_gl3vm* v = (w2c_gl3vm*)(uintptr_t)handle;
  if (op == 0) return (u32)(uintptr_t)gl3aot_create();
  check(v != NULL);
  switch (op) {
    case 1: gl3aot_destroy(v); return 0;
    case 2: gl3aot_grow(v,a); return 0;
    case 3: case 4: {
      check((u64)a+size <= v->w2c_memory.size);
      unsigned char* bytes=v->w2c_memory.data+a;
      u32 i=0;
      if (op==3) {
        for (;i+4<=size;i+=4) {u32 x=caller_load32(ptr+i);memcpy(bytes+i,&x,4);}
        for (;i<size;i++) bytes[i]=caller_load8(ptr+i);
      } else {
        for (;i+4<=size;i+=4) {u32 x;memcpy(&x,bytes+i,4);caller_store32(ptr+i,x);}
        for (;i<size;i++) caller_store8(ptr+i,bytes[i]);
      }
      return 0;
    }
    case 5: return gl3aot_memory_size(v);
    case 6: return gl3aot_global_get(v,a);
    case 7: gl3aot_global_set(v,a,b); return 0;
    case 8: return gl3aot_call(v,a,b,c);
    default: wasm_rt_trap(WASM_RT_TRAP_UNREACHABLE); return 0;
  }
}
// This wrapper alone is excluded from outer Asyncify. Its callee unwinds into
// it on a trap. Discard the failed VM; never publish a partial engine result.
u64 gl3aot__execute(u32 op,u32 handle,u32 a,u32 b,u32 c,u32 ptr,u32 size) {
  if (!constructors_done) {constructors_done=1;__wasm_call_ctors();}
  error_code=0; u32 sp=proof_stack_pointer();
  u64 result=work(op,handle,a,b,c,ptr,size);
  if (error_code) {
    stop_unwind(); proof_set_stack_pointer(sp);
    wasm_rt_call_stack_depth=0;
    return ((u64)1<<63)|error_code;
  }
  return result;
}
