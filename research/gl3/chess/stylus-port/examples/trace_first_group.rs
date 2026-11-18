//! Run the exact first 40 quanta on the private replay worker and report the
//! complete read set. An isolated Nitro execution still verifies the trace.

mod support;

use std::{collections::BTreeMap, fs, path::Path, time::Instant};

use gl3_stockfish_stylus::{
    checkpoint_tree::MAX_PAGES,
    interpreter::{guest::Stockfish, Limits, Machine},
    memory::{Page, PageBackend, PagedMemory, PAGE_SIZE},
    search::{run_group, Cursor},
    witness_wire::{self, NodeInput, PageInput, TRANSACTION_BYTES},
};
use serde_json::json;
use sha2::{Digest, Sha256};
use support::{NativeKeccak, PinnedRom};

const SEED_SHA: &str = "2d7637246b973a1cfebfc7d1ad11d762797110d199b431b52272c6f0e3e0c1ef";
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

struct TraceMemory<'a> {
    source: &'a [u8],
    read: BTreeMap<u32, bool>,
    writes: BTreeMap<u32, Page>,
}

impl TraceMemory<'_> {
    fn seed(&self, index: u32) -> &[u8] {
        let start = index as usize * PAGE_SIZE;
        self.source
            .get(start..start + PAGE_SIZE)
            .unwrap_or(&[0; PAGE_SIZE])
    }
}

impl PageBackend for TraceMemory<'_> {
    type Error = ();

    fn read_page(&mut self, index: u32, out: &mut Page) -> std::result::Result<bool, Self::Error> {
        self.read.entry(index).or_insert(false);
        if let Some(page) = self.writes.get(&index) {
            out.copy_from_slice(page);
        } else {
            out.copy_from_slice(self.seed(index));
        }
        Ok(true)
    }

    fn write_page(&mut self, index: u32, page: &Page) -> std::result::Result<(), Self::Error> {
        self.read.insert(index, true);
        self.writes.insert(index, *page);
        Ok(())
    }
}

fn offset(index: &[u8], entry: usize) -> Option<u32> {
    let start = 4 * entry;
    let offset = u32::from_be_bytes(index[start..start + 4].try_into().unwrap());
    (offset != u32::MAX).then_some(offset)
}

fn proof(
    queries: &[(u32, bool)],
    level: u32,
    node: usize,
    index: &[u8],
    pages: usize,
    zeros: &[[u8; 32]],
    output: &mut Vec<NodeInput>,
) {
    if queries.is_empty() {
        output.push(match offset(index, pages + node - 1) {
            Some(location) => NodeInput::Archive(location),
            None => NodeInput::Digest(level, zeros[level as usize]),
        });
        return;
    }
    if level > 0 {
        let mask = 1 << (level - 1);
        let split = queries.partition_point(|(page, _)| page & mask == 0);
        proof(
            &queries[..split],
            level - 1,
            node * 2,
            index,
            pages,
            zeros,
            output,
        );
        proof(
            &queries[split..],
            level - 1,
            node * 2 + 1,
            index,
            pages,
            zeros,
            output,
        );
    }
}

fn run(args: &[std::ffi::OsString]) -> Result<()> {
    let bundle = PinnedRom::load(
        Path::new(&args[0]),
        Path::new(&args[1]),
        Path::new(&args[2]),
    );
    let source = fs::read(&args[3])?;
    if format!("{:x}", Sha256::digest(&source)) != SEED_SHA {
        return Err("Incorrect fixed replay seed".into());
    }
    let archive = Path::new(&args[4]);
    let index = fs::read(archive.join("offsets.bin"))?;
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(archive.join("manifest.json"))?)?;
    let leaves = MAX_PAGES.next_power_of_two();
    let page_count = source.len() / PAGE_SIZE;
    if manifest["imageSHA256"].as_str() != Some(SEED_SHA)
        || index.len() != 4 * (page_count + 2 * leaves - 1)
    {
        return Err("Incorrect fixed replay archive".into());
    }
    let output = Path::new(&args[5]);
    let fuel: u64 = args[6]
        .to_str()
        .ok_or("Invalid instruction ceiling")?
        .parse()?;
    let mut backend = TraceMemory {
        source: &source,
        read: BTreeMap::new(),
        writes: BTreeMap::new(),
    };
    // The native trace can keep the immutable tables resident. The contract
    // still uses its original bounded Wasm cache and meters its own execution.
    let mut program = bundle.program::<64, 16_384>();
    let mut globals = program
        .globals(Some([120_685_200, 0, 0]))
        .map_err(|_| "Invalid pinned globals")?;
    let start = Instant::now();
    let (step, instructions, logical_bytes) = {
        let memory = PagedMemory::<_, 16>::new(&mut backend, source.len() as u64)
            .map_err(|_| "Cannot map historical snapshot")?;
        let machine = Machine::new(
            program,
            memory,
            &mut globals,
            Limits {
                values: 32_768,
                locals: 32_768,
                calls: 4096,
                blocks: 16_384,
            },
        );
        let mut guest = Stockfish::new(machine, fuel);
        let step = run_group(&mut guest, Cursor::default(), 0, Some(b"e2e4"))
            .map_err(|error| format!("Exact guest group failed: {error:?}"))?;
        guest
            .memory()
            .flush()
            .map_err(|_| "Could not flush trace pages")?;
        (step, fuel - guest.fuel_left(), guest.memory().len())
    };
    if step.cursor.quanta != 40 || step.decision.is_some() {
        return Err("First 40-quantum cursor differed".into());
    }
    let wall = start.elapsed().as_secs_f64();
    let zero = [0; PAGE_SIZE];
    let read_set: Vec<_> = backend
        .read
        .iter()
        .map(|(&i, &writable)| (i, writable))
        .collect();
    let pages: Vec<_> = read_set
        .iter()
        .map(|&(i, writable)| {
            let archived = ((i as usize) < page_count)
                .then(|| offset(&index, i as usize))
                .flatten();
            (
                i,
                writable,
                archived.map_or(PageInput::Inline(&zero), PageInput::Archive),
            )
        })
        .collect();
    let mut siblings = Vec::new();
    proof(
        &read_set,
        leaves.ilog2(),
        1,
        &index,
        page_count,
        &witness_wire::zero_subtrees(&mut NativeKeccak),
        &mut siblings,
    );
    let required = 6
        + pages
            .iter()
            .map(|page| {
                if matches!(page.2, PageInput::Archive(_)) {
                    10
                } else {
                    6
                }
            })
            .sum::<usize>()
        + siblings
            .iter()
            .map(|node| {
                if matches!(node, NodeInput::Archive(_)) {
                    5
                } else {
                    1
                }
            })
            .sum::<usize>();

    let mut scratch = [0; PAGE_SIZE];
    let mut journal = Sha256::new();
    let mut journal_bytes = 0;
    let mut changed_pages = 0;
    for (&index, page) in &backend.writes {
        if backend.seed(index) != page {
            let (mode, encoded) = witness_wire::encode_page(page, &mut scratch);
            journal.update(index.to_be_bytes());
            journal.update([mode as u8]);
            journal.update((encoded as u16).to_be_bytes());
            journal.update(&scratch[..encoded]);
            journal_bytes += 7 + encoded;
            changed_pages += 1;
        }
    }
    fs::create_dir(output)?;
    let inline =
        witness_wire::encode_archived(&mut NativeKeccak, &pages, &siblings, TRANSACTION_BYTES - 1);
    let code_packet = witness_wire::encode_code_witness(&mut NativeKeccak, &pages, &siblings);
    if let Ok(packet) = &code_packet {
        if required != packet.len() {
            return Err("Wire size expectation differed from encoded packet".into());
        }
        fs::write(output.join("code-witness.bin"), packet)?;
    }
    if let Ok(packet) = &inline {
        fs::write(output.join("witness.bin"), packet)?;
    }
    let report = json!({
        "scope": "Exact pinned guest executed offline for the first 40 quanta, with no Nitro metering, receipts, or subsequent groups",
        "quanta": step.cursor.quanta,
        "observedNodes": step.cursor.observed_nodes,
        "guestInstructions": instructions,
        "logicalMemoryBytes": logical_bytes,
        "elapsedSeconds": wall,
        "readPages": read_set.len(),
        "writePages": backend.writes.len(),
        "changedPages": changed_pages,
        "archivedWitnessBytes": required,
        "packetWritten": inline.is_ok(),
        "codePacketWritten": code_packet.is_ok(),
        "journalDataBytes": journal_bytes,
        "journalSHA256": format!("{:x}", journal.finalize()),
        "logDataGasFloor": journal_bytes * 8,
    });
    fs::write(output.join("read-set.json"), serde_json::to_vec(&read_set)?)?;
    fs::write(
        output.join("trace.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!("{report}");
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 7 {
        return Err("Pass CORE_CELLS CONTROL_INDEX RUNTIME_INDEX RAW_SEED ARCHIVE_DIR NEW_OUTPUT_DIR INSTRUCTION_CEILING".into());
    }
    let trace = std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(move || run(&args).map_err(|error| error.to_string()))?;
    trace
        .join()
        .map_err(|_| "Native witness trace panicked")??;
    Ok(())
}
