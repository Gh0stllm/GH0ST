//! Read the exact pinned guest ROM and run its stack-pointer and Asyncify exports.
//!
//! `cargo run --offline --example rom_smoke -- CELL_DIR CONTROL_INDEX RUNTIME_INDEX`
//! `CELL_DIR` is the output of `partition_guest.py --output-dir`. The two index
//! files are the SIMD guest's outputs from `tools/inspect_instructions`.

use std::{env, fs, path::Path, rc::Rc};

use gl3_stockfish_stylus::{
    checkpoint_tree::{Digest, Keccak, MAX_PAGES},
    compact_resume::CompactResume,
    interpreter::{rom_code::RomCode, Limits, Machine},
    memory::{PagedMemory, PAGE_SIZE},
    resume::Checkpoint,
    rom::{Address, BytecodeRom, CodeHash, CodeHost, Shard, PAYLOAD_BYTES},
    search::Cursor,
    witness_wire::{self, Archive, NodeInput, PageInput, WireError},
};

const CODE: &str = "0f1dc6066d456a17b90b7879558902957e049ff4dc6d39b6de4c90b0fa6ad052";
const FUNCTIONS: &str = "6164b8d04c06a9a6f6f6768dd04e888006901826eae651c2f7b221b55a811e36";
const CONTROLS: &str = "a88fb0e84ef51a8e0b06921c9e60439c124f7781de0540436e19a3e406e0ae8c";
const RUNTIME: &str = "850650446679bb26d5abae9798a33fabe2190c7549211f4f86f5f56cc2eb7d2b";
const LOGICAL_BYTES: u32 = 128 * 1024 * 1024;
const TREE_DEPTH: usize = (MAX_PAGES - 1).ilog2() as usize + 1;

const STACK_POINTER: u32 = 465;
const START_UNWIND: u32 = 1257;
const STOP_UNWIND: u32 = 1258;
const START_REWIND: u32 = 1259;
const STOP_REWIND: u32 = 1260;
const ASYNCIFY_STATE: u32 = 1261;
const INITIAL_STACK: u64 = 120_685_200;

// Test-only implementation of Ethereum's Keccak-256. A stock Stylus
// wrapper would use the host Keccak call instead.
struct NativeKeccak;

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

impl Keccak for NativeKeccak {
    fn digest(&mut self, bytes: &[u8]) -> Digest {
        use tiny_keccak::{Hasher, Keccak};
        let mut output = [0; 32];
        let mut hash = Keccak::v256();
        hash.update(bytes);
        hash.finalize(&mut output);
        output
    }
}

fn require_digest(bytes: &[u8], expected: &str) {
    let actual: String = NativeKeccak
        .digest(bytes)
        .iter()
        .map(|n| format!("{n:02x}"))
        .collect();
    assert_eq!(actual, expected, "Pinned ROM bytes changed");
}

#[derive(Clone)]
struct FixtureHost(Rc<Vec<Vec<u8>>>);

impl FixtureHost {
    fn cell(&self, address: &Address) -> Result<&[u8], &'static str> {
        if address[..16] != [0; 16] {
            return Err("Unknown fixture address");
        }
        let index = u32::from_be_bytes(address[16..].try_into().unwrap());
        self.0
            .get(index as usize)
            .map(Vec::as_slice)
            .ok_or("Missing fixture address")
    }
}

impl CodeHost for FixtureHost {
    type Error = &'static str;

    fn code_hash(&mut self, address: &Address) -> Result<CodeHash, Self::Error> {
        Ok(NativeKeccak.digest(self.cell(address)?))
    }

    fn copy_code(&mut self, address: &Address, out: &mut [u8]) -> Result<usize, Self::Error> {
        let cell = self.cell(address)?;
        let count = out.len().min(cell.len());
        out[..count].copy_from_slice(&cell[..count]);
        Ok(cell.len())
    }
}

fn encoded_cells(directory: &Path, prefix: &str, count: usize) -> Vec<Vec<u8>> {
    (0..count)
        .map(|index| fs::read(directory.join(format!("{prefix}-{index:04}.bin"))).unwrap())
        .collect()
}

fn raw_to_cells(bytes: &[u8]) -> Vec<Vec<u8>> {
    bytes
        .chunks(PAYLOAD_BYTES)
        .map(|payload| {
            let mut cell = Vec::with_capacity(payload.len() + 1);
            cell.push(0);
            cell.extend_from_slice(payload);
            cell
        })
        .collect()
}

fn commit_group(host: &mut Vec<Vec<u8>>, cells: Vec<Vec<u8>>, expected: &str) -> (Vec<Shard>, u32) {
    let mut payload = Vec::new();
    let mut shards = Vec::new();
    let count = cells.len();
    for (index, cell) in cells.into_iter().enumerate() {
        assert_eq!(cell[0], 0, "ROM cells must start with STOP");
        assert!((2..=PAYLOAD_BYTES + 1).contains(&cell.len()));
        assert!(index + 1 == count || cell.len() == PAYLOAD_BYTES + 1);
        payload.extend_from_slice(&cell[1..]);
        let mut address = [0; 20];
        address[16..].copy_from_slice(&(host.len() as u32).to_be_bytes());
        shards.push(Shard {
            address,
            code_hash: NativeKeccak.digest(&cell),
        });
        host.push(cell);
    }
    require_digest(&payload, expected);
    (shards, payload.len() as u32)
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

    let mut bytes = Vec::new();
    let (code, code_len) = commit_group(
        &mut bytes,
        encoded_cells(Path::new(&parameters[0]), "code", 36),
        CODE,
    );
    let (functions, functions_len) = commit_group(
        &mut bytes,
        encoded_cells(Path::new(&parameters[0]), "index", 1),
        FUNCTIONS,
    );
    let (controls, controls_len) = commit_group(
        &mut bytes,
        raw_to_cells(&fs::read(&parameters[1]).unwrap()),
        CONTROLS,
    );
    let (runtime, runtime_len) = commit_group(
        &mut bytes,
        raw_to_cells(&fs::read(&parameters[2]).unwrap()),
        RUNTIME,
    );
    let host = FixtureHost(Rc::new(bytes));
    let rom = |group, length| BytecodeRom::<_, 1>::new(host.clone(), group, length).unwrap();
    let mut program = RomCode::<_, 1, 8>::new(
        rom(&code, code_len),
        rom(&functions, functions_len),
        rom(&controls, controls_len),
        rom(&runtime, runtime_len),
    )
    .unwrap();
    let mut globals = program.globals(None).unwrap();

    // Only one synthetic Asyncify header page is opened against this logical
    // memory image. No NNUE pages are loaded and no engine initializer runs.
    let mut page = [0; PAGE_SIZE];
    let pointer = 16u32;
    page[16..20].copy_from_slice(&32u32.to_le_bytes());
    page[20..24].copy_from_slice(&80u32.to_le_bytes());
    let (siblings, memory_root) = page_proof(&page);
    let prior = Checkpoint {
        engine_identity: NativeKeccak.digest(CODE.as_bytes()),
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
