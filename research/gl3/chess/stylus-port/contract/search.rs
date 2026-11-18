//! Single-move Stylus rehearsal. The constructor pins the exact program,
//! initialized checkpoint, archive directory and game history. Every advance
//! executes the guest, commits one head and emits recoverable page updates.

extern crate gl3_stockfish_stylus;

use gl3_stockfish_stylus::checkpoint_tree::{Digest, Keccak};
use gl3_stockfish_stylus::compact_resume::Replacement;
use gl3_stockfish_stylus::interpreter::{
    group::{run_archived_group, GroupRequest},
    rom_code::RomCode,
    Limits,
};
use gl3_stockfish_stylus::resume::Checkpoint;
use gl3_stockfish_stylus::rom::{
    Address, BytecodeRom, CodeHash, CodeHost, IndexedArchive, FUNCTION_INDEX_BYTES,
};
use gl3_stockfish_stylus::search::Decision;
use gl3_stockfish_stylus::transaction::{
    decode_advance, encode_header, CHECKPOINT_BYTES, CHECKPOINT_SLOT, CONFIG_SLOT,
};
use gl3_stockfish_stylus::witness_wire::TRANSACTION_BYTES;

const CODE_BYTES: u32 = 870_051;
const CONTROL_BYTES: u32 = 297_336;
const RUNTIME_BYTES: u32 = 1_764;
const JOURNAL_BYTES: usize = 12_288;
const TOPIC_BYTES: usize = 64;

#[link(wasm_import_module = "vm_hooks")]
unsafe extern "C" {
    fn read_args(dst: *mut u8);
    fn write_result(src: *const u8, len: u32);
    fn storage_load_bytes32(key: *const u8, out: *mut u8);
    fn storage_cache_bytes32(key: *const u8, value: *const u8);
    fn storage_flush_cache(clear: u32);
    fn account_codehash(address: *const u8, result: *mut u8);
    fn account_code_size(address: *const u8) -> u32;
    fn account_code(address: *const u8, offset: u32, size: u32, out: *mut u8) -> u32;
    fn native_keccak256(input: *const u8, size: u32, out: *mut u8);
    fn pay_for_memory_grow(pages: u32);
    fn emit_log(src: *const u8, len: u32, topics: u32);
    fn msg_value(out: *mut u8);
}

struct Host;

impl Keccak for Host {
    fn digest(&mut self, bytes: &[u8]) -> Digest {
        let mut hash = [0; 32];
        unsafe { native_keccak256(bytes.as_ptr(), bytes.len() as u32, hash.as_mut_ptr()) };
        hash
    }
}

impl CodeHost for Host {
    type Error = ();

    fn code_hash(&mut self, address: &Address) -> Result<CodeHash, Self::Error> {
        let mut hash = [0; 32];
        unsafe { account_codehash(address.as_ptr(), hash.as_mut_ptr()) };
        Ok(hash)
    }

    fn copy_code(&mut self, address: &Address, out: &mut [u8]) -> Result<usize, Self::Error> {
        let len = out.len() as u32;
        if unsafe { account_code_size(address.as_ptr()) } != len {
            return Err(());
        }
        Ok(unsafe { account_code(address.as_ptr(), 0, len, out.as_mut_ptr()) } as usize)
    }
}

fn load_slot(key: &Digest) -> Digest {
    let mut word = [0; 32];
    unsafe { storage_load_bytes32(key.as_ptr(), word.as_mut_ptr()) };
    word
}

fn log(bytes: &[u8]) {
    unsafe { emit_log(bytes.as_ptr(), bytes.len() as u32, 2) };
}

fn publish_pages(head: Digest, pages: &[Replacement]) {
    let mut buffer = [0; JOURNAL_BYTES];
    buffer[..32].copy_from_slice(&Host.digest(b"GL3StockfishCheckpointPagesV1"));
    buffer[32..64].copy_from_slice(&head);
    let mut used = TOPIC_BYTES;
    for page in pages {
        let frame = 7 + page.bytes.len();
        if used + frame > buffer.len() {
            log(&buffer[..used]);
            used = TOPIC_BYTES;
        }
        let dst = &mut buffer[used..used + frame];
        dst[..4].copy_from_slice(&page.index.to_be_bytes());
        dst[4] = page.mode as u8;
        dst[5..7].copy_from_slice(&(page.bytes.len() as u16).to_be_bytes());
        dst[7..].copy_from_slice(&page.bytes);
        used += frame;
    }
    if used > TOPIC_BYTES {
        log(&buffer[..used]);
    }
}

fn publish_head(
    before: Digest,
    after: Digest,
    head: &Checkpoint,
    decision: Option<Decision>,
    pages: usize,
    instructions: u64,
) {
    let mut event = [0; TOPIC_BYTES + 64 + CHECKPOINT_BYTES + 1 + 5 + 8 + 4 + 4 + 8];
    event[..32].copy_from_slice(&Host.digest(b"GL3StockfishCheckpointHeadV1"));
    event[32..64].copy_from_slice(&head.job_identity);
    event[64..96].copy_from_slice(&before);
    event[96..128].copy_from_slice(&after);
    event[128..200].copy_from_slice(&encode_header(head));
    if let Some(result) = decision {
        event[200] = 1;
        event[201..206].copy_from_slice(&result.best_move);
        event[206..214].copy_from_slice(&result.actual_nodes.to_be_bytes());
        event[214..218].copy_from_slice(&result.depth.to_be_bytes());
    }
    event[218..222].copy_from_slice(&(pages as u32).to_be_bytes());
    event[222..230].copy_from_slice(&instructions.to_be_bytes());
    log(&event);
}

fn advance(input: &[u8]) -> Result<Digest, u8> {
    let config_commitment = load_slot(&CONFIG_SLOT);
    let before = load_slot(&CHECKPOINT_SLOT);
    let input = decode_advance(&mut Host, input, config_commitment, before).map_err(|_| 1u8)?;
    let core = input.config.core_shards();
    let directory: Vec<_> = input.config.directory_shards().collect();
    let rom = |entries, bytes| BytecodeRom::<_, 1>::new(Host, entries, bytes).map_err(|_| 2u8);
    let code = RomCode::<_, 1, 256>::new(
        rom(&core[..36], CODE_BYTES)?,
        rom(&core[36..37], FUNCTION_INDEX_BYTES)?,
        rom(&core[37..50], CONTROL_BYTES)?,
        rom(&core[50..], RUNTIME_BYTES)?,
    )
    .map_err(|_| 2u8)?;
    let directory =
        BytecodeRom::<_, 1>::new(Host, &directory, input.config.archive_directory_bytes)
            .map_err(|_| 2u8)?;
    let archive = IndexedArchive::<_, 2>::new(Host, directory, input.config.archive_bytes)
        .map_err(|_| 2u8)?;
    let request = GroupRequest {
        trusted_checkpoint: before,
        prior: input.prior,
        expected_start: input.prior.cursor.quanta,
        opening_history: (input.prior.cursor.quanta == 0).then_some(input.config.history),
        max_witness_pages: TRANSACTION_BYTES / 6,
        interpreter_limits: Limits {
            values: 32_768,
            locals: 32_768,
            calls: 4_096,
            blocks: 16_384,
        },
        instruction_budget: u64::MAX,
    };
    // Nitro meters the Wasm instructions and memory independently of the
    // profiling counters. Out-of-gas anywhere reverts the entire transaction.
    let (out, pages) = run_archived_group::<_, _, 1, 256, 16>(
        code,
        &mut Host,
        request,
        input.witness,
        input.witness.len(),
        2 * 1024 * 1024,
        archive,
    )
    .map_err(|_| 3u8)?;
    let after = out.checkpoint.commitment(&mut Host);
    publish_pages(after, &pages);
    publish_head(
        before,
        after,
        &out.checkpoint,
        out.step.decision,
        pages.len(),
        out.instructions,
    );
    unsafe {
        storage_cache_bytes32(CHECKPOINT_SLOT.as_ptr(), after.as_ptr());
        storage_flush_cache(0);
    }
    Ok(after)
}

#[no_mangle]
pub extern "C" fn user_entrypoint(len: u32) -> u32 {
    if len as usize >= TRANSACTION_BYTES {
        return 1;
    }
    let mut value = [0u8; 32];
    unsafe { msg_value(value.as_mut_ptr()) };
    if value != [0; 32] {
        return 1;
    }
    let mut args = vec![0; len as usize];
    unsafe {
        pay_for_memory_grow(0);
        read_args(args.as_mut_ptr());
    }
    match advance(&args) {
        Ok(head) => {
            unsafe { write_result(head.as_ptr(), head.len() as u32) };
            0
        }
        Err(phase) => {
            unsafe { write_result(&phase, 1) };
            1
        }
    }
}
