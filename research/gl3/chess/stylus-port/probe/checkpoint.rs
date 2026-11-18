//! Private Stylus gas probe for publishing chunked checkpoint data.
//! Input is a 4-byte big-endian payload length, the expected prior root and
//! a 32-byte seed. Output is a 32-byte root, 8-byte journal gas and 4-byte
//! chunk count. This exercises host accounting, not Stockfish or page proofs.

#![no_std]

use core::panic::PanicInfo;

const REQUEST_BYTES: usize = 4 + 32 + 32;
const CHUNK_BYTES: usize = 4096;
const TOPIC_BYTES: usize = 3 * 32;
const MAX_PAYLOAD: usize = 3_800_000;
const ROOT_SLOT: [u8; 32] = [0x6a; 32];
const EVENT_DOMAIN: &[u8] = b"GH0ST private checkpoint gas probe v1";

#[link(wasm_import_module = "vm_hooks")]
unsafe extern "C" {
    fn read_args(dest: *mut u8);
    fn write_result(src: *const u8, len: u32);
    fn storage_load_bytes32(key: *const u8, dest: *mut u8);
    fn storage_cache_bytes32(key: *const u8, value: *const u8);
    fn storage_flush_cache(clear: u32);
    fn emit_log(src: *const u8, bytes: u32, topics: u32);
    fn native_keccak256(input: *const u8, len: u32, output: *mut u8);
    fn evm_gas_left() -> u64;
}

#[panic_handler]
fn panic(_: &PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[no_mangle]
pub extern "C" fn user_entrypoint(arg_len: u32) -> u32 {
    if arg_len as usize != REQUEST_BYTES {
        return 1;
    }
    let mut request = [0; REQUEST_BYTES];
    // All host pointers below refer to fixed-size buffers in linear memory.
    unsafe { read_args(request.as_mut_ptr()) };
    let size = u32::from_be_bytes(request[..4].try_into().unwrap()) as usize;
    if size == 0 || size > MAX_PAYLOAD {
        return 1;
    }

    let mut prior = [0; 32];
    unsafe { storage_load_bytes32(ROOT_SLOT.as_ptr(), prior.as_mut_ptr()) };
    if prior != request[4..36] {
        return 1;
    }

    let mut log = [0; TOPIC_BYTES + CHUNK_BYTES];
    unsafe {
        native_keccak256(
            EVENT_DOMAIN.as_ptr(),
            EVENT_DOMAIN.len() as u32,
            log.as_mut_ptr(),
        );
        native_keccak256(request.as_ptr(), arg_len, log[32..64].as_mut_ptr());
    }
    for word in log[TOPIC_BYTES..].chunks_exact_mut(32) {
        word.copy_from_slice(&request[36..]);
    }

    let start_gas = unsafe { evm_gas_left() };
    let chunks = size.div_ceil(CHUNK_BYTES);
    for chunk in 0..chunks {
        log[92..96].copy_from_slice(&(chunk as u32).to_be_bytes());
        let bytes = core::cmp::min(CHUNK_BYTES, size - CHUNK_BYTES * chunk);
        unsafe { emit_log(log.as_ptr(), (TOPIC_BYTES + bytes) as u32, 3) };
    }
    let journal_gas = start_gas.saturating_sub(unsafe { evm_gas_left() });
    let root = &log[32..64];
    unsafe {
        storage_cache_bytes32(ROOT_SLOT.as_ptr(), root.as_ptr());
        storage_flush_cache(0);
    }

    let mut response = [0; 44];
    response[..32].copy_from_slice(root);
    response[32..40].copy_from_slice(&journal_gas.to_be_bytes());
    response[40..].copy_from_slice(&(chunks as u32).to_be_bytes());
    unsafe { write_result(response.as_ptr(), response.len() as u32) };
    0
}
