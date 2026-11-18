//! Read the exact pinned guest ROM and run its stack-pointer and Asyncify exports.
//!
//! `cargo run --offline --example rom_smoke -- CELL_DIR CONTROL_INDEX RUNTIME_INDEX`
//! `CELL_DIR` is the output of `partition_guest.py --output-dir`. The two index
//! files are the SIMD guest's outputs from `tools/inspect_instructions`.

mod support;

use std::{env, path::Path};
use support::{require_digest, FixtureHost, NativeKeccak, PinnedRom};

use gl3_stockfish_stylus::{
    checkpoint_tree::{Digest, Keccak, MAX_PAGES},
    compact_resume::CompactResume,
    interpreter::{rom_code::RomCode, Limits, Machine},
    memory::{PagedMemory, PAGE_SIZE},
    resume::Checkpoint,
    search::Cursor,
    witness_wire::{self, Archive, NodeInput, PageInput, WireError},
};

const LOGICAL_BYTES: u32 = 128 * 1024 * 1024;
const TREE_DEPTH: usize = (MAX_PAGES - 1).ilog2() as usize + 1;

const STACK_POINTER: u32 = 465;
const START_UNWIND: u32 = 1257;
const STOP_UNWIND: u32 = 1258;
const START_REWIND: u32 = 1259;
const STOP_REWIND: u32 = 1260;
const ASYNCIFY_STATE: u32 = 1261;
const INITIAL_STACK: u64 = 120_685_200;

struct SmokeArchive<'a>(&'a [u8]);

impl Archive for SmokeArchive<'_> {
    fn read(&mut self, offset: u32, output: &mut [u8]) -> Result<(), WireError> {
        let start = offset as usize;
        output.copy_from_slice(
            self.0
                .get(start..start + output.len())
                .ok_or(WireError::ArchiveUnavailable)?,
        );
        Ok(())
    }
}

fn page_proof(page: &[u8; PAGE_SIZE]) -> ([Digest; TREE_DEPTH], Digest) {
    let mut leaf = [0; PAGE_SIZE + 1];
    let mut zero = NativeKeccak.digest(&leaf);
    leaf[1..].copy_from_slice(page);
    let mut root = NativeKeccak.digest(&leaf);
    let mut siblings = [[0; 32]; TREE_DEPTH];
    for sibling in &mut siblings {
        *sibling = zero;
        let mut branch = [1; 65];
        branch[1..33].copy_from_slice(&root);
        branch[33..].copy_from_slice(&zero);
        root = NativeKeccak.digest(&branch);
        branch[1..33].copy_from_slice(&zero);
        zero = NativeKeccak.digest(&branch);
    }
    (siblings, root)
}

fn main() {
    let parameters: Vec<_> = env::args_os().skip(1).collect();
    assert_eq!(
        parameters.len(),
        3,
        "Pass CELL_DIR CONTROL_INDEX RUNTIME_INDEX"
    );
    require_digest(
        b"",
        "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );

    let rom = PinnedRom::load(
        Path::new(&parameters[0]),
        Path::new(&parameters[1]),
        Path::new(&parameters[2]),
    );
    let mut program = rom.program::<1, 8>();
    let mut globals = program.globals(None).unwrap();

    // Only one synthetic Asyncify header page is opened against this logical
    // memory image. No NNUE pages are loaded and no engine initializer runs.
    let mut page = [0; PAGE_SIZE];
    let pointer = 16u32;
    page[16..20].copy_from_slice(&32u32.to_le_bytes());
    page[20..24].copy_from_slice(&80u32.to_le_bytes());
    let (siblings, memory_root) = page_proof(&page);
    let prior = Checkpoint {
        engine_identity: NativeKeccak.digest(b"pinned Stockfish ROM"),
        job_identity: NativeKeccak.digest(b"native rom smoke only"),
        memory_root,
        cursor: Cursor {
            quanta: 0,
            observed_nodes: 0,
        },
        globals: [INITIAL_STACK, 0, 0],
        complete: false,
        memory_bytes: LOGICAL_BYTES,
    };
    let mut hash = NativeKeccak;
    let trusted = prior.commitment(&mut hash);
    let mut archive = page.to_vec();
    archive.extend_from_slice(&siblings[0]);
    let mut proof = Vec::from([NodeInput::Archive(PAGE_SIZE as u32)]);
    proof.extend(
        siblings
            .iter()
            .enumerate()
            .skip(1)
            .map(|(level, value)| NodeInput::Digest(level as u32, *value)),
    );
    let packet =
        witness_wire::encode_archived(&mut hash, &[(0, false, PageInput::Archive(0))], &proof, 100)
            .unwrap();
    let backend = CompactResume::open_archived(
        &mut hash,
        trusted,
        prior,
        &packet,
        100,
        1,
        0,
        SmokeArchive(&archive),
    )
    .unwrap();
    let memory = PagedMemory::<_, 1>::new(backend, u64::from(LOGICAL_BYTES)).unwrap();

    let limits = Limits {
        values: 32,
        locals: 32,
        calls: 8,
        blocks: 8,
    };
    let mut fuel = 1024;
    let mut machine = Machine::new(program, memory, &mut globals, limits);
    assert_eq!(
        machine.invoke(STACK_POINTER, &[], &mut fuel).unwrap(),
        &[u128::from(INITIAL_STACK)]
    );
    assert_eq!(
        machine.invoke(ASYNCIFY_STATE, &[], &mut fuel).unwrap(),
        &[0]
    );
    for (start, stop, state) in [
        (START_UNWIND, STOP_UNWIND, 1),
        (START_REWIND, STOP_REWIND, 2),
    ] {
        assert!(machine
            .invoke(start, &[u128::from(pointer)], &mut fuel)
            .unwrap()
            .is_empty());
        assert_eq!(
            machine.invoke(ASYNCIFY_STATE, &[], &mut fuel).unwrap(),
            &[state]
        );
        assert!(machine.invoke(stop, &[], &mut fuel).unwrap().is_empty());
        assert_eq!(
            machine.invoke(ASYNCIFY_STATE, &[], &mut fuel).unwrap(),
            &[0]
        );
    }
    drop(machine);
    assert_eq!(
        RomCode::<FixtureHost, 1, 8>::retained_globals(&globals).unwrap(),
        [INITIAL_STACK, 0, u64::from(pointer)]
    );
    println!("Pinned Stockfish ROM passed: stack={INITIAL_STACK}, Asyncify states=0,1,0,2,0, authenticated pages=1, packet bytes={}, guest instructions={}", packet.len(), 1024 - fuel);
}
