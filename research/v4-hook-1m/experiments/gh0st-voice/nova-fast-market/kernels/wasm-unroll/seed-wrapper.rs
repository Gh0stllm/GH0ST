// Fixed-seed benchmark entrypoint for an isolated official Stylus meter.
// This is not a production ABI or an on-chain catalog configuration.
#[cfg(any(feature="meter-entrypoint",feature="meter-seed-entrypoint"))]
#[link(wasm_import_module="vm_hooks")]
extern "C" {
 fn pay_for_memory_grow(pages:u16);
 fn write_result(data:*const u8,length:usize);
 fn msg_reentrant()->u32;
}
#[cfg(feature="meter-entrypoint")]
#[no_mangle] pub unsafe extern "C" fn user_entrypoint(args_len:u32)->u32 {
 if args_len!=0 || msg_reentrant()!=0 {return 1;}
 pay_for_memory_grow(0);
 reset(42,512,0,0,0,0,1024,1024);
 let count=sentence(32);
 if count==0 {return 1;}
 write_result(RESULT.as_ptr().cast::<u8>(),count as usize*4);
 0
}


#[cfg(all(feature="meter-entrypoint",feature="meter-seed-entrypoint"))]
compile_error!("Choose only one benchmark entrypoint feature");
#[cfg(feature="meter-seed-entrypoint")]
#[link(wasm_import_module="vm_hooks")]
extern "C" { fn read_args(dest:*mut u8); }
// Exactly four calldata bytes encode a big-endian u32 seed. Numerical benchmark only.
#[cfg(feature="meter-seed-entrypoint")]
#[no_mangle] pub unsafe extern "C" fn user_entrypoint(args_len:u32)->u32 {
 if args_len!=4 || msg_reentrant()!=0 {return 1;}
 pay_for_memory_grow(0);
 let mut packet=[0u8;4];read_args(packet.as_mut_ptr());
 reset(u32::from_be_bytes(packet),512,0,0,0,0,1024,1024);
 let count=sentence(32);if count==0{return 1;}
 write_result(RESULT.as_ptr().cast::<u8>(),count as usize*4);0
}
