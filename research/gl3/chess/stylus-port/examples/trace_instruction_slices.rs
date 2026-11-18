//! Prepare two consecutive opening slices against the exact initialized guest.
//! Both calldata packets are independently replayed with authenticated memory.

mod support;

use std::{collections::BTreeMap, fs, path::Path};

use gl3_stockfish_stylus::{
    checkpoint_tree::{Digest, Keccak, MAX_PAGES},
    interpreter::{
        slice_group::{run_archived_slice, SavedContinuation, SliceHead, SliceRequest},
        sliced_guest::{Driver, DriverProgress},
        Limits, Machine,
    },
    memory::{Page, PageBackend, PagedMemory, PAGE_SIZE},
    resume::Checkpoint,
    search::Cursor,
    transaction::encode_header,
    witness_wire::{self, Archive, NodeInput, PageInput, WireError, TRANSACTION_BYTES},
};
use serde_json::json;
use sha2::{Digest as _, Sha256};
use support::{NativeKeccak, PinnedRom};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const SEED_SHA: &str = "2d7637246b973a1cfebfc7d1ad11d762797110d199b431b52272c6f0e3e0c1ef";
const LIMITS: Limits = Limits {
    values: 32768,
    locals: 32768,
    calls: 4096,
    blocks: 16384,
};
const LEAVES: usize = MAX_PAGES.next_power_of_two();

struct OldMemory<'a> {
    seed: &'a [u8],
    changed: &'a BTreeMap<u32, Page>,
    zero: Page,
}

impl OldMemory<'_> {
    fn page(&self, index: u32) -> &Page {
        self.changed.get(&index).unwrap_or_else(|| {
            let start = index as usize * PAGE_SIZE;
            self.seed
                .get(start..start + PAGE_SIZE)
                .map_or(&self.zero, |page| page.try_into().unwrap())
        })
    }
}

struct Trace<'a> {
    old: OldMemory<'a>,
    accessed: BTreeMap<u32, bool>,
    writes: BTreeMap<u32, Page>,
}

impl PageBackend for Trace<'_> {
    type Error = ();

    fn read_page(&mut self, index: u32, output: &mut Page) -> std::result::Result<bool, ()> {
        self.accessed.entry(index).or_insert(false);
        *output = *self
            .writes
            .get(&index)
            .unwrap_or_else(|| self.old.page(index));
        Ok(true)
    }

    fn write_page(&mut self, index: u32, page: &Page) -> std::result::Result<(), ()> {
        self.accessed.insert(index, true);
        self.writes.insert(index, *page);
        Ok(())
    }
}

struct ArchiveBytes<'a>(&'a [u8]);

impl Archive for ArchiveBytes<'_> {
    fn read(&mut self, offset: u32, out: &mut [u8]) -> std::result::Result<(), WireError> {
        let start = offset as usize;
        out.copy_from_slice(
            self.0
                .get(start..start + out.len())
                .ok_or(WireError::ArchiveUnavailable)?,
        );
        Ok(())
    }
}

struct Tree<'a> {
    offsets: &'a [u8],
    archive: &'a [u8],
    page_count: usize,
    zeros: Vec<Digest>,
    changes: BTreeMap<usize, Digest>,
}

impl Tree<'_> {
    fn offset(&self, index: usize) -> Option<u32> {
        let start = index.checked_mul(4)?;
        let offset = u32::from_be_bytes(self.offsets.get(start..start + 4)?.try_into().unwrap());
        (offset != u32::MAX).then_some(offset)
    }

    fn node(&self, index: usize, height: u32) -> NodeInput {
        if let Some(value) = self.changes.get(&index) {
            return NodeInput::Digest(height, *value);
        }
        self.offset(self.page_count + index - 1).map_or(
            NodeInput::Digest(height, self.zeros[height as usize]),
            NodeInput::Archive,
        )
    }

    fn digest(&self, index: usize, height: u32) -> Digest {
        match self.node(index, height) {
            NodeInput::Digest(_, digest) => digest,
            NodeInput::Archive(start) => self.archive[start as usize..start as usize + 32]
                .try_into()
                .unwrap(),
        }
    }

    fn proof(
        &self,
        queries: &[(u32, bool)],
        height: u32,
        index: usize,
        output: &mut Vec<NodeInput>,
    ) {
        if queries.is_empty() {
            output.push(self.node(index, height));
        } else if height != 0 {
            let boundary = queries.partition_point(|(page, _)| page & (1 << (height - 1)) == 0);
            self.proof(&queries[..boundary], height - 1, 2 * index, output);
            self.proof(&queries[boundary..], height - 1, 2 * index + 1, output);
        }
    }

    fn replace(&mut self, page_index: u32, bytes: &Page) {
        let mut index = LEAVES + page_index as usize;
        let mut leaf = [0u8; PAGE_SIZE + 1];
        leaf[1..].copy_from_slice(bytes);
        self.changes.insert(index, NativeKeccak.digest(&leaf));
        let mut height = 0;
        while index > 1 {
            index /= 2;
            let mut pair = [1u8; 65];
            pair[1..33].copy_from_slice(&self.digest(2 * index, height));
            pair[33..].copy_from_slice(&self.digest(2 * index + 1, height));
            self.changes.insert(index, NativeKeccak.digest(&pair));
            height += 1;
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn run(args: &[std::ffi::OsString]) -> Result<()> {
    if args.len() != 8 {
        return Err("Pass CORE_CELLS CONTROL_INDEX RUNTIME_INDEX RAW_SEED ARCHIVE_DIR GENESIS_DIR OUTPUT INSTRUCTION_BUDGET".into());
    }
    let bundle = PinnedRom::load(
        Path::new(&args[0]),
        Path::new(&args[1]),
        Path::new(&args[2]),
    );
    let seed = fs::read(&args[3])?;
    if hex(&Sha256::digest(&seed)) != SEED_SHA {
        return Err("The CPU fixture differs from the exact initialized guest".into());
    }
    let archive_path = Path::new(&args[4]);
    let offsets = fs::read(archive_path.join("offsets.bin"))?;
    let archive = fs::read(archive_path.join("archive.bin"))?;
    let genesis = Path::new(&args[5]);
    let config = fs::read(genesis.join("config.bin"))?;
    let header = fs::read(genesis.join("checkpoint.bin"))?;
    let mut tree = Tree {
        offsets: &offsets,
        archive: &archive,
        page_count: seed.len() / PAGE_SIZE,
        zeros: witness_wire::zero_subtrees(&mut NativeKeccak).to_vec(),
        changes: BTreeMap::new(),
    };
    let mut head = SliceHead::initial(Checkpoint {
        engine_identity: NativeKeccak.digest(&config),
        job_identity: config[4..36].try_into()?,
        memory_root: tree.digest(1, LEAVES.ilog2()),
        cursor: Cursor::default(),
        globals: [120_685_200, 0, 0],
        memory_bytes: u32::try_from(seed.len())?,
        complete: false,
    });
    if encode_header(&head.checkpoint).as_slice() != header {
        return Err("Seed root and genesis checkpoint differ".into());
    }
    let output = Path::new(&args[6]);
    let budget: u32 = args[7].to_str().ok_or("Budget is not UTF-8")?.parse()?;
    if !(1..=1_000_000).contains(&budget) {
        return Err("Use an instruction budget up to 1,000,000".into());
    }
    fs::create_dir(output)?;
    let mut live = BTreeMap::new();
    let mut continuation: Option<SavedContinuation> = None;
    let mut results = Vec::new();
    for index in 0..2 {
        let mut trace = Trace {
            old: OldMemory {
                seed: &seed,
                changed: &live,
                zero: [0; PAGE_SIZE],
            },
            accessed: BTreeMap::new(),
            writes: BTreeMap::new(),
        };
        let mut program = bundle.program::<16, 2048>();
        let mut globals = program
            .globals(Some(head.checkpoint.globals))
            .map_err(|e| format!("Globals: {e:?}"))?;
        let mem = PagedMemory::<_, 16>::new(&mut trace, u64::from(head.checkpoint.memory_bytes))
            .map_err(|e| format!("Memory: {e:?}"))?;
        let mut machine = Machine::new(program, mem, &mut globals, LIMITS);
        let mut driver =
            Driver::new(head.checkpoint.cursor).map_err(|e| format!("Driver: {e:?}"))?;
        if let Some(saved) = &continuation {
            driver = Driver::decode(&saved.driver).map_err(|e| format!("Driver resume: {e:?}"))?;
            machine
                .restore(&saved.machine)
                .map_err(|e| format!("Machine resume: {e:?}"))?;
        }
        let mut fuel = u64::from(budget);
        let progress = driver
            .run(&mut machine, Some(b"e2e4"), &mut fuel)
            .map_err(|e| format!("Trace: {e:?}"))?;
        if progress != DriverProgress::Pending || fuel != 0 {
            return Err("Expected a suspended opening invocation".into());
        }
        machine
            .memory()
            .flush()
            .map_err(|e| format!("Flush: {e:?}"))?;
        let frame = machine.snapshot().map_err(|e| format!("Snapshot: {e:?}"))?;
        drop(machine);

        let queries: Vec<_> = trace
            .accessed
            .iter()
            .map(|(&page, &writable)| (page, writable))
            .collect();
        let pages: Vec<_> = queries
            .iter()
            .map(|&(page, writable)| {
                let stored = ((page as usize) < tree.page_count && !live.contains_key(&page))
                    .then(|| tree.offset(page as usize))
                    .flatten();
                (
                    page,
                    writable,
                    stored.map_or(PageInput::Inline(trace.old.page(page)), PageInput::Archive),
                )
            })
            .collect();
        let mut proof = Vec::new();
        tree.proof(&queries, LEAVES.ilog2(), 1, &mut proof);
        let witness =
            witness_wire::encode_archived(&mut NativeKeccak, &pages, &proof, TRANSACTION_BYTES - 1)
                .map_err(|e| format!("Witness: {e:?}"))?;
        let before = if index == 0 {
            head.checkpoint.commitment(&mut NativeKeccak)
        } else {
            head.commitment(&mut NativeKeccak)
        };
        let mut call = vec![5];
        call.extend_from_slice(&u16::try_from(config.len())?.to_be_bytes());
        call.extend_from_slice(&config);
        call.extend_from_slice(&encode_header(&head.checkpoint));
        call.extend_from_slice(&head.instructions.to_be_bytes());
        call.extend_from_slice(&head.continuation);
        call.extend_from_slice(&budget.to_be_bytes());
        let machine_len = continuation.as_ref().map_or(0, |c| c.machine.len());
        call.extend_from_slice(&u16::try_from(machine_len)?.to_be_bytes());
        if let Some(saved) = &continuation {
            call.extend_from_slice(&saved.driver);
            call.extend_from_slice(&saved.machine);
        }
        call.extend_from_slice(&witness);
        if call.len() + 200 >= TRANSACTION_BYTES {
            return Err("Slice witness exceeds the transaction envelope".into());
        }

        let request = SliceRequest {
            trusted_head: head.commitment(&mut NativeKeccak),
            prior: head,
            continuation: continuation.as_ref().map(SavedContinuation::as_ref),
            opening_history: Some(b"e2e4"),
            max_witness_pages: TRANSACTION_BYTES / 6,
            interpreter_limits: LIMITS,
            instruction_budget: u64::from(budget),
        };
        let (verified, replacements) = run_archived_slice::<_, _, 16, 2048, 16>(
            bundle.program(),
            &mut NativeKeccak,
            request,
            &witness,
            witness.len(),
            2 * 1024 * 1024,
            ArchiveBytes(&archive),
        )
        .map_err(|e| format!("Authenticated trace: {e:?}"))?;
        let next = verified
            .continuation
            .ok_or("Authenticated replay did not suspend")?;
        if next.machine != frame
            || next.driver != driver.encode()
            || verified.instructions != u64::from(budget)
        {
            return Err("Authenticated replay differs from the fresh cold trace".into());
        }
        let changed: Vec<_> = trace
            .writes
            .into_iter()
            .filter(|(page, data)| data != trace.old.page(*page))
            .collect();
        if changed.len() != replacements.len() {
            return Err("Unexpected checkpoint write count".into());
        }
        for (page, bytes) in changed {
            tree.replace(page, &bytes);
            live.insert(page, bytes);
        }
        if tree.digest(1, LEAVES.ilog2()) != verified.head.checkpoint.memory_root {
            return Err("Checkpoint tree differed from the authenticated trace".into());
        }
        head = verified.head;
        fs::write(output.join(format!("slice-{index}.bin")), &call)?;
        results.push(
            json!({"before": hex(&before), "after": hex(&head.commitment(&mut NativeKeccak)),
            "instructions": head.instructions, "guestQuanta": head.checkpoint.cursor.quanta,
            "readPages": queries.len(), "changedPages": replacements.len(), "callBytes": call.len(),
            "nextMachineBytes": next.machine.len(), "witnessBytes": witness.len()}),
        );
        continuation = Some(next);
    }
    let report =
        json!({"scope":"Two cold bounded exact Stockfish instruction traces", "slices":results});
    fs::write(
        output.join("trace.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!("{report}");
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(move || run(&args).map_err(|error| error.to_string()))?
        .join()
        .map_err(|_| "Native instruction trace panicked")??;
    Ok(())
}
