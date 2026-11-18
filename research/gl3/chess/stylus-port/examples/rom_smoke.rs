//! Read the exact pinned guest ROM and run its stack-pointer and Asyncify exports.
//!
//! `cargo run --offline --example rom_smoke -- CELL_DIR CONTROL_INDEX RUNTIME_INDEX`
//! `CELL_DIR` is the output of `partition_guest.py --output-dir`. The two index
//! files are the SIMD guest's outputs from `tools/inspect_instructions`.

use std::{env, fs, path::Path, rc::Rc};

use gl3_stockfish_stylus::{
    checkpoint_tree::{Digest, Keccak, MAX_PAGES},
    interpreter::{rom_code::RomCode, Limits, Machine},
    memory::{PagedMemory, PAGE_SIZE},
    resume::{Checkpoint, ResumeBackend, WitnessPage},
    rom::{Address, BytecodeRom, CodeHash, CodeHost, Shard, PAYLOAD_BYTES},
    search::Cursor,
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

impl NativeKeccak {
    fn permute(a: &mut [u64; 25]) {
        const RHO: [u32; 25] = [
            0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61,
            56, 14,
        ];
        const ROUNDS: [u64; 24] = [
            0x0000_0000_0000_0001,
            0x0000_0000_0000_8082,
            0x8000_0000_0000_808a,
            0x8000_0000_8000_8000,
            0x0000_0000_0000_808b,
            0x0000_0000_8000_0001,
            0x8000_0000_8000_8081,
            0x8000_0000_0000_8009,
            0x0000_0000_0000_008a,
            0x0000_0000_0000_0088,
            0x0000_0000_8000_8009,
            0x0000_0000_8000_000a,
            0x0000_0000_8000_808b,
            0x8000_0000_0000_008b,
            0x8000_0000_0000_8089,
            0x8000_0000_0000_8003,
            0x8000_0000_0000_8002,
            0x8000_0000_0000_0080,
            0x0000_0000_0000_800a,
            0x8000_0000_8000_000a,
            0x8000_0000_8000_8081,
            0x8000_0000_0000_8080,
            0x0000_0000_8000_0001,
            0x8000_0000_8000_8008,
        ];
        for round in ROUNDS {
            let column: [u64; 5] =
                std::array::from_fn(|x| a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20]);
            let mut b = [0; 25];
            for y in 0..5 {
                for x in 0..5 {
                    let index = x + 5 * y;
                    let theta = column[(x + 4) % 5] ^ column[(x + 1) % 5].rotate_left(1);
                    b[y + 5 * ((2 * x + 3 * y) % 5)] = (a[index] ^ theta).rotate_left(RHO[index]);
                }
            }
            for y in 0..5 {
                for x in 0..5 {
                    a[x + 5 * y] =
                        b[x + 5 * y] ^ ((!b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y]);
                }
            }
            a[0] ^= round;
        }
    }

    fn absorb(state: &mut [u64; 25], block: &[u8]) {
        for (lane, bytes) in state.iter_mut().zip(block.chunks_exact(8)) {
            *lane ^= u64::from_le_bytes(bytes.try_into().unwrap());
        }
        Self::permute(state);
    }
}

impl Keccak for NativeKeccak {
    fn digest(&mut self, bytes: &[u8]) -> Digest {
        const RATE: usize = 136;
        let mut state = [0; 25];
        let mut blocks = bytes.chunks_exact(RATE);
        for block in &mut blocks {
            Self::absorb(&mut state, block);
        }
        let tail = blocks.remainder();
        let mut last = [0; RATE];
        last[..tail.len()].copy_from_slice(tail);
        last[tail.len()] = 1;
        last[RATE - 1] |= 0x80;
        Self::absorb(&mut state, &last);
        let mut digest = [0; 32];
        for (dst, value) in digest.chunks_exact_mut(8).zip(state) {
            dst.copy_from_slice(&value.to_le_bytes());
        }
        digest
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
    let mut pages = [WitnessPage::read_only(0, &page)];
    let mut hash = NativeKeccak;
    let trusted = prior.commitment(&mut hash);
    let backend = ResumeBackend::new(&mut hash, trusted, prior, &mut pages, &siblings, 1).unwrap();
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
    println!("Pinned Stockfish ROM passed: stack={INITIAL_STACK}, Asyncify states=0,1,0,2,0, authenticated pages=1, guest instructions={}", 1024 - fuel);
}
