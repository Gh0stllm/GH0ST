//! Diagnostic Wasmer linkage for the unchanged GL3 C companion.
//! This is host glue, not the WAVM interpreter or one-step verifier.
use eyre::Result;
use wasmer::{imports, Function, FunctionEnv, FunctionEnvMut, Instance, Module, RuntimeError, Store};
use crate::machine::WasmEnv;

fn memory(env: &FunctionEnvMut<'_, WasmEnv>) -> Result<wasmer::Memory, RuntimeError> {
    env.data().memory.clone().ok_or_else(|| RuntimeError::new("GL3 AOT caller: Go memory not attached"))
}
fn load8(env: FunctionEnvMut<'_, WasmEnv>, ptr: u32) -> Result<u32, RuntimeError> {
    let mem = memory(&env)?;
    let mut value = [0u8; 1];
    mem.view(&env).read(u64::from(ptr), &mut value)
        .map_err(|e| RuntimeError::new(format!("GL3 AOT load8 at {ptr:#x}: {e}")))?;
    Ok(u32::from(value[0]))
}
fn load32(env: FunctionEnvMut<'_, WasmEnv>, ptr: u32) -> Result<u32, RuntimeError> {
    let mem = memory(&env)?;
    let mut value = [0u8; 4];
    mem.view(&env).read(u64::from(ptr), &mut value)
        .map_err(|e| RuntimeError::new(format!("GL3 AOT load32 at {ptr:#x}: {e}")))?;
    Ok(u32::from_le_bytes(value))
}
fn store8(env: FunctionEnvMut<'_, WasmEnv>, ptr: u32, value: u32) -> Result<(), RuntimeError> {
    let mem = memory(&env)?;
    mem.view(&env).write(u64::from(ptr), &[value as u8])
        .map_err(|e| RuntimeError::new(format!("GL3 AOT store8 at {ptr:#x}: {e}")))
}
fn store32(env: FunctionEnvMut<'_, WasmEnv>, ptr: u32, value: u32) -> Result<(), RuntimeError> {
    let mem = memory(&env)?;
    mem.view(&env).write(u64::from(ptr), &value.to_le_bytes())
        .map_err(|e| RuntimeError::new(format!("GL3 AOT store32 at {ptr:#x}: {e}")))
}
pub fn link(store: &mut Store, env: &FunctionEnv<WasmEnv>, module: &Module, go_imports: &mut wasmer::Imports) -> Result<Instance> {
    let mut companion_imports = imports! { "env" => {
        "wavm_caller_load8" => Function::new_typed_with_env(store, env, load8),
        "wavm_caller_load32" => Function::new_typed_with_env(store, env, load32),
        "wavm_caller_store8" => Function::new_typed_with_env(store, env, store8),
        "wavm_caller_store32" => Function::new_typed_with_env(store, env, store32),
    }};
    // These are the pinned Nitro WASI implementations, with their own memory
    // environment. C libc iovecs must never be interpreted in Go's memory.
    let c_env = FunctionEnv::new(store, WasmEnv::default());
    companion_imports.register_namespace("wasi_snapshot_preview1", caller_env::wasip1_stub::host::exports(store, &c_env));
    let companion = Instance::new(store, module, &companion_imports)?;
    c_env.as_mut(store).memory = Some(companion.exports.get_memory("memory")?.clone());
    let execute = companion.exports.get_function("gl3aot__execute")?.clone();
    let mut ns = wasmer::Exports::new();
    ns.insert("execute", execute);
    go_imports.register_namespace("gl3aot", ns);
    Ok(companion)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasmer::{Engine, Memory, Pages};
    use wasmer_compiler_cranelift::Cranelift;
    const COMPANION: &str = r#"(module
      (import "env" "wavm_caller_load8" (func $l8 (param i32) (result i32)))
      (import "env" "wavm_caller_load32" (func $l32 (param i32) (result i32)))
      (import "env" "wavm_caller_store8" (func $s8 (param i32 i32)))
      (import "env" "wavm_caller_store32" (func $s32 (param i32 i32)))
      (import "wasi_snapshot_preview1" "fd_close" (func $close (param i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_seek" (func $seek (param i32 i64 i32 i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
      (memory (export "memory") 1) (data (i32.const 0) "\99")
      (export "read8" (func $l8)) (export "read32" (func $l32))
      (export "write8" (func $s8)) (export "write32" (func $s32))
      (export "fd_close" (func $close)) (export "fd_seek" (func $seek)) (export "fd_write" (func $write))
      (func (export "gl3aot__execute") (param i32 i32 i32 i32 i32 i32 i32) (result i64)
        local.get 5 i32.const 4 i32.add local.get 5 call $l32 call $s32
        local.get 5 i32.const 8 i32.add i32.const 426 call $s8
        local.get 5 call $l32 i64.extend_i32_u))"#;
    const GO: &str = r#"(module
      (import "gl3aot" "execute" (func $e (param i32 i32 i32 i32 i32 i32 i32) (result i64)))
      (memory (export "memory") 1 2) (data (i32.const 16) "\78\56\34\12")
      (func (export "run") (result i64)
        i32.const 3 i32.const 0 i32.const 0 i32.const 0 i32.const 0 i32.const 16 i32.const 4 call $e))"#;
    fn setup() -> (Store, FunctionEnv<WasmEnv>, Instance, Instance, Memory) {
        let engine = Engine::from(Cranelift::new());let mut store=Store::new(engine);
        let env=FunctionEnv::new(&mut store,WasmEnv::default());
        let cm=Module::new(&store,COMPANION).unwrap();let mut imports=wasmer::Imports::new();
        let companion=link(&mut store,&env,&cm,&mut imports).unwrap();
        let before=companion.exports.get_typed_function::<u32,u32>(&store,"read8").unwrap().call(&mut store,0).unwrap_err();
        assert!(before.to_string().contains("Go memory not attached"));
        let gm=Module::new(&store,GO).unwrap();let go=Instance::new(&mut store,&gm,&imports).unwrap();
        let mem=go.exports.get_memory("memory").unwrap().clone();env.as_mut(&mut store).memory=Some(mem.clone());
        (store,env,companion,go,mem)
    }
    #[test]
    fn gl3_cross_memory_abi_is_exact_and_separate() {
        let (mut store,_env,c,go,mem)=setup();let result=go.exports.get_typed_function::<(),u64>(&store,"run").unwrap().call(&mut store).unwrap();assert_eq!(result,0x12345678);
        let mut copied=[0u8;5];mem.view(&store).read(20,&mut copied).unwrap();assert_eq!(copied,[0x78,0x56,0x34,0x12,0xaa]);
        let mut own=[0u8;1];c.exports.get_memory("memory").unwrap().view(&store).read(0,&mut own).unwrap();assert_eq!(own,[0x99]);
        let byte=c.exports.get_typed_function::<u32,u32>(&store,"read8").unwrap().call(&mut store,16).unwrap();assert_eq!(byte,0x78);
        // Unaligned 32-bit accesses have wasm's little-endian byte semantics.
        c.exports.get_typed_function::<(u32,u32),()>(&store,"write32").unwrap().call(&mut store,31,0xaabbccdd).unwrap();
        assert_eq!(c.exports.get_typed_function::<u32,u32>(&store,"read32").unwrap().call(&mut store,31).unwrap(),0xaabbccdd);
    }
    #[test]
    fn gl3_cross_memory_bounds_growth_and_traps() {
        let (mut store,_env,c,_go,mem)=setup();
        let read=c.exports.get_typed_function::<u32,u32>(&store,"read32").unwrap();let write=c.exports.get_typed_function::<(u32,u32),()>(&store,"write32").unwrap();
        assert!(read.call(&mut store,u32::MAX).is_err());assert!(write.call(&mut store,65534,0xdeadbeef).is_err());
        let mut end=[1u8;2];mem.view(&store).read(65534,&mut end).unwrap();assert_eq!(end,[0,0],"failed store partially wrote memory");
        mem.grow(&mut store,Pages(1)).unwrap();write.call(&mut store,65536,0x87654321).unwrap();assert_eq!(read.call(&mut store,65536).unwrap(),0x87654321);
        assert!(write.call(&mut store,131070,0xdeadbeef).is_err());
        c.exports.get_typed_function::<(u32,u32),()>(&store,"write8").unwrap().call(&mut store,131071,0x1ff).unwrap();
        assert_eq!(c.exports.get_typed_function::<u32,u32>(&store,"read8").unwrap().call(&mut store,131071).unwrap(),255);
    }
    #[test]
    fn gl3_companion_wasi_uses_only_companion_memory() {
        let (mut store,_env,c,_go,go_mem)=setup();let c_mem=c.exports.get_memory("memory").unwrap();
        c_mem.view(&store).write(32,b"C-ABI").unwrap();c_mem.view(&store).write(64,&32u32.to_le_bytes()).unwrap();c_mem.view(&store).write(68,&5u32.to_le_bytes()).unwrap();
        let errno=c.exports.get_typed_function::<(u32,u32,u32,u32),u32>(&store,"fd_write").unwrap().call(&mut store,1,64,1,96).unwrap();assert_eq!(errno,0);
        let mut count=[0u8;4];c_mem.view(&store).read(96,&mut count).unwrap();assert_eq!(u32::from_le_bytes(count),5);
        go_mem.view(&store).read(96,&mut count).unwrap();assert_eq!(count,[0;4],"C WASI wrote the Go address space");
        assert_eq!(c.exports.get_typed_function::<u32,u32>(&store,"fd_close").unwrap().call(&mut store,1).unwrap(),8);
        assert_eq!(c.exports.get_typed_function::<(u32,u64,u32,u32),u32>(&store,"fd_seek").unwrap().call(&mut store,1,0,0,96).unwrap(),8);
    }
}
