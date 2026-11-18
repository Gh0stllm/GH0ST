//! Size probe for the linked Stockfish instruction interpreter. A private
//! fixture supplies the authorized ROM digest in storage and may call only
//! the two zero-argument guest getters. Guest linear memory is inaccessible.

#![no_std]

extern crate gl3_stockfish_stylus;

use core::alloc::{GlobalAlloc, Layout};
use core::arch::wasm32::{memory_grow, memory_size};
use core::panic::PanicInfo;
use core::ptr::{addr_of, null_mut};
use core::sync::atomic::{AtomicUsize, Ordering::Relaxed};

use gl3_stockfish_stylus::interpreter::rom_code::RomCode;
use gl3_stockfish_stylus::interpreter::{GuestMemory, Limits, Machine};
use gl3_stockfish_stylus::rom::{
    Address, BytecodeRom, CodeHash, CodeHost, Shard, FUNCTION_INDEX_BYTES,
};

const SHARDS: usize = 51;
const RECORD_BYTES: usize = 20 + 32;
const REQUEST_BYTES: usize = 4 + SHARDS * RECORD_BYTES;
const AUTHORIZED_MANIFEST_SLOT: [u8; 32] = [0x6b; 32];
const CODE_BYTES: u32 = 870_051;
const CONTROL_BYTES: u32 = 297_336;
const RUNTIME_BYTES: u32 = 1_764;
const WASM_PAGE: usize = 65_536;

#[link(wasm_import_module = "vm_hooks")]
unsafe extern "C" {
    fn read_args(dest: *mut u8);
    fn write_result(src: *const u8, len: usize);
    fn account_codehash(address: *const u8, out: *mut u8);
    fn account_code_size(address: *const u8) -> usize;
    fn account_code(address: *const u8, offset: usize, size: usize, out: *mut u8) -> usize;
    fn storage_load_bytes32(key: *const u8, out: *mut u8);
    fn native_keccak256(input: *const u8, len: usize, out: *mut u8);
    fn pay_for_memory_grow(pages: u16);
}

unsafe extern "C" {
    static __heap_base: u8;
}

struct Bump(AtomicUsize);

// Stock Stylus and this offline probe use one execution thread. Allocations
// occupy disjoint aligned spans of the probe's own linear memory.
unsafe impl GlobalAlloc for Bump {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let align = layout.align();
        let base = addr_of!(__heap_base) as usize;
        let Some(padded) = self.0.load(Relaxed).max(base).checked_add(align - 1) else {
            return null_mut();
        };
        let start = padded & !(align - 1);
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        let missing = end.div_ceil(WASM_PAGE).saturating_sub(memory_size::<0>());
        if missing > 0 && memory_grow::<0>(missing) == usize::MAX {
            return null_mut();
        }
        self.0.store(end, Relaxed);
        start as *mut u8
    }

    unsafe fn dealloc(&self, _: *mut u8, _: Layout) {}
}

#[global_allocator]
static ALLOCATOR: Bump = Bump(AtomicUsize::new(0));

#[panic_handler]
fn panic(_: &PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

struct Host;

impl CodeHost for Host {
    type Error = ();

    fn code_hash(&mut self, address: &Address) -> Result<CodeHash, Self::Error> {
        let mut hash = [0; 32];
        unsafe { account_codehash(address.as_ptr(), hash.as_mut_ptr()) };
        Ok(hash)
    }

    fn copy_code(&mut self, address: &Address, out: &mut [u8]) -> Result<usize, Self::Error> {
        if unsafe { account_code_size(address.as_ptr()) } != out.len() {
            return Err(());
        }
        Ok(unsafe { account_code(address.as_ptr(), 0, out.len(), out.as_mut_ptr()) })
    }
}

struct NoGuestMemory;

impl GuestMemory for NoGuestMemory {
    type Error = ();

    fn read(&mut self, _: u32, _: &mut [u8]) -> Result<(), Self::Error> {
        Err(())
    }
    fn write(&mut self, _: u32, _: &[u8]) -> Result<(), Self::Error> {
        Err(())
    }
    fn size(&self) -> u32 {
        0
    }
    fn grow(&mut self, _: u32) -> Option<u32> {
        None
    }
    fn copy(&mut self, _: u32, _: u32, _: u32) -> Result<(), Self::Error> {
        Err(())
    }
    fn fill(&mut self, _: u32, _: u8, _: u32) -> Result<(), Self::Error> {
        Err(())
    }
}

type Rom<'a> = BytecodeRom<'a, Host, 1>;

fn execute(function: u32, shards: &[Shard; SHARDS]) -> Result<u32, ()> {
    let mut code = RomCode::<_, 1, 16>::new(
        Rom::new(Host, &shards[..36], CODE_BYTES).map_err(|_| ())?,
        Rom::new(Host, &shards[36..37], FUNCTION_INDEX_BYTES).map_err(|_| ())?,
        Rom::new(Host, &shards[37..50], CONTROL_BYTES).map_err(|_| ())?,
        Rom::new(Host, &shards[50..], RUNTIME_BYTES).map_err(|_| ())?,
    )
    .map_err(|_| ())?;
    let mut globals = code.globals(None).map_err(|_| ())?;
    let limits = Limits {
        values: 64,
        locals: 64,
        calls: 16,
        blocks: 64,
    };
    let mut machine = Machine::new(code, NoGuestMemory, &mut globals, limits);
    let mut fuel = 64;
    match machine.invoke(function, &[], &mut fuel).map_err(|_| ())? {
        &[value] => u32::try_from(value).map_err(|_| ()),
        _ => Err(()),
    }
}

#[no_mangle]
pub extern "C" fn user_entrypoint(arg_len: u32) -> u32 {
    if arg_len as usize != REQUEST_BYTES {
        return 1;
    }
    let mut args = [0; REQUEST_BYTES];
    // This hook declares memory growth support. Nitro meters actual growth.
    unsafe {
        pay_for_memory_grow(0);
        read_args(args.as_mut_ptr());
    }
    let function = u32::from_be_bytes(args[..4].try_into().unwrap());
    if !matches!(function, 465 | 1261) {
        return 1;
    }

    let manifest = &args[4..];
    let mut authorized = [0; 32];
    let mut provided = [0; 32];
    unsafe {
        storage_load_bytes32(AUTHORIZED_MANIFEST_SLOT.as_ptr(), authorized.as_mut_ptr());
        native_keccak256(manifest.as_ptr(), manifest.len(), provided.as_mut_ptr());
    }
    if authorized == [0; 32] || authorized != provided {
        return 1;
    }

    let mut shards = [Shard {
        address: [0; 20],
        code_hash: [0; 32],
    }; SHARDS];
    for (entry, record) in shards.iter_mut().zip(manifest.chunks_exact(RECORD_BYTES)) {
        entry.address.copy_from_slice(&record[..20]);
        entry.code_hash.copy_from_slice(&record[20..]);
    }
    let Ok(value) = execute(function, &shards) else {
        return 1;
    };
    let result = value.to_be_bytes();
    unsafe { write_result(result.as_ptr(), result.len()) };
    0
}
