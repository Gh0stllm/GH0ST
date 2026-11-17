// Standard C allocation ABI for the unchanged canonical Brotli C implementation.
// No inference, opcode, decompression or gas semantics are replaced.
use std::{alloc::{alloc,alloc_zeroed,dealloc,realloc as rust_realloc,Layout},ptr};
const ALIGN:usize=8;const HEADER:usize=8;
fn layout(n:usize)->Option<Layout>{Layout::from_size_align(n.checked_add(HEADER)?,ALIGN).ok()}
#[unsafe(no_mangle)]pub unsafe extern "C" fn malloc(n:usize)->*mut u8{if n==0{return ptr::null_mut();}let Some(l)=layout(n)else{return ptr::null_mut();};let p=unsafe{alloc(l)};if p.is_null(){return p;}unsafe{*(p as *mut usize)=n;p.add(HEADER)}}
#[unsafe(no_mangle)]pub unsafe extern "C" fn calloc(n:usize,size:usize)->*mut u8{let Some(bytes)=n.checked_mul(size)else{return ptr::null_mut();};if bytes==0{return ptr::null_mut();}let Some(l)=layout(bytes)else{return ptr::null_mut();};let p=unsafe{alloc_zeroed(l)};if p.is_null(){return p;}unsafe{*(p as *mut usize)=bytes;p.add(HEADER)}}
#[unsafe(no_mangle)]pub unsafe extern "C" fn free(p:*mut u8){if p.is_null(){return;}unsafe{let h=p.sub(HEADER);let n=*(h as *const usize);dealloc(h,layout(n).expect("valid owned allocation header"));}}
#[unsafe(no_mangle)]pub unsafe extern "C" fn realloc(p:*mut u8,n:usize)->*mut u8{if p.is_null(){return unsafe{malloc(n)};}if n==0{unsafe{free(p)};return ptr::null_mut();}let Some(_new)=layout(n)else{return ptr::null_mut();};unsafe{let h=p.sub(HEADER);let old=*(h as *const usize);let q=rust_realloc(h,layout(old).expect("valid owned allocation header"),n+HEADER);if q.is_null(){return q;}*(q as *mut usize)=n;q.add(HEADER)}}

// Canonical Brotli encoder aborts on allocation failure; a guest trap is fail-closed.
#[unsafe(no_mangle)]
pub extern "C" fn exit(status: i32) -> ! { panic!("canonical C runtime fatal exit: {status}") }
