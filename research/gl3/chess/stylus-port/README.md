# Stockfish on standard GL3 Stylus

The port targets the existing GL3 execution rules. Search runs inside the
contract. The prepared model, engine and continuation must reproduce the
[reviewed reference result](../sliced/evidence/simd-full24m-parity.json).

| Reference | Value |
| --- | --- |
| Stockfish source | `edb0d9db6731067ec50ce619ff372b463bc4dd5d` |
| Portable guest SHA-256 | `1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc` |
| Original 98,511,183-byte NNUE SHA-256 | `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2` |
| Search policy | 24,000,000 nodes, Hash 128 MiB, one thread, Skill 20, full retained state |
| Fixture | White `e2e4`, Black `e7e5`, 24,000,033 actual nodes, depth 38 |
| Canonical retained state | 163,085,439 bytes, SHA-256 `5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6` |
| Work grouping | 9,853 engine quanta, 246 groups of 40 and one final group of 13 |

## Compiled Stockfish candidate

The [candidate builder](tools/build_aot_candidate.py) checks the portable
guest, model and WABT 1.0.42 translation before building the engine with
WASI SDK 25. The compiled code calls the checked guest-memory interface.
Its Wasm size report excludes the two immutable model and initialization
segments, which the builder exports separately. The Wasm variants leave
paging to the host and measure executable size before activation work.

On an isolated Linux worker with WABT 1.0.42 source, the pinned `wasm2c`
output, WASI SDK 25, a C compiler and Python `brotli` installed, run from
`stylus-port` with the source paths and a fresh output directory.

```sh
python3 tools/build_aot_candidate.py "$guest" "$generated" "$wabt_source" \
  "$wasi_sdk/bin/clang" compiled
python3 tools/run_aot_reference.py compiled/libgl3aot.so compiled/reference.json
```

The [native parity host](probe/aot_flat_memory.c) loads the same seed into
flat memory and runs the same lowered C. The reference runner executes
all 247 groups and reconstructs the native engine from its memory and
continuation globals at three boundaries. Its scope is engine parity in
the fixture. Stock Stylus execution must separately pass activation,
checkpoint, signed transaction size, gas and mixed-traffic tests.

## Private Runpod rehearsal

The [code-backed checkpoint rehearsal](evidence/code-backed-first-group-20261118.json)
reduced the signed opening search transaction to **4,758 bytes**. The
private Nitro node admitted it and reverted at **32,000,000 L2 gas**.
An isolated replay returned out of gas, and the stored checkpoint matched
its previous value. The 294,385-byte witness occupied twelve immutable
genesis cells. Publishing those cells as contract code would require at
least **58,879,400 gas** for code deposit, separately from search.

The exact 40-quantum host trace executed **5,927,060,296 guest
instructions**. In the activated artifact, the interpreter dispatches
each one through a charged Wasm call. That instruction alone accounts
for a **2,252,282,912 L2 gas lower bound** for a completed group at the
rehearsal's 10,000 ink per gas. The remaining execution and checkpoint
costs are additional. The full move and mixed-traffic test are blocked
at the first group. [Pinned Nitro pricing](https://github.com/OffchainLabs/nitro/blob/5f02f3f03076343061f167e81b8e82ec5518064b/crates/prover/src/programs/meter.rs#L363-L395)

[The stock Nitro rehearsal](evidence/private-activation-20261118.json) loaded
the exact checkpoint archive and mined the canonical search contract in a
**23,864-byte signed deployment transaction**, using **5,208,580 L2 compute
gas**. Activation reverted. Nitro's replay compiler reported that it has
no implementation for the user module's `F64PromoteF32` instruction.
This is a stock Stylus compatibility failure that occurred before any
search transaction ran. The deployment size does not establish the size
of a 40-quantum search transaction or the block cadence under search load.
The bounded native traces produced no first-group witness. Eight ordinary
private transfers completed with a 611 ms p95 submission-to-receipt time
as a control without an on-chain search running.

The [integer-backed IEEE 754 build](evidence/softfloat-activation-20261118.json)
replaced those outer Wasm instructions with APFloat arithmetic while leaving
the guest executable, NNUE and search policy pinned. All **33 library tests**
passed on Runpod, including scalar edge cases and SIMD lane parity. The
108,138-byte Wasm fit across two stock Stylus fragments and **activated on
private ArbOS 61**. The root activation consumed 6,174,424 L2 compute gas.
This activation check used a small genesis and pinned commitments. The
exact seeded archive then loaded on a separate private Nitro database.

The [first 40-quantum trace](evidence/softfloat-first-group-20261118.json)
reached **98,566 search nodes** using the pinned guest. Its compact
witness needed **294,385 bytes**, for **298,406 bytes of calldata**
including configuration and checkpoint header. The witness builder
rejected the packet before signing. The changed-page logs would have
carried **11,607,598 bytes** and used **92,860,784 gas for data alone**,
above the 32-million L2 compute budget before the search or proof checks.
The activation succeeded, and the first search transaction failed
preflight. The complete on-chain move and block cadence during search
remain unverified. The rehearsal sent no mainnet transactions.

The [portable reference on the same worker](evidence/softfloat-portable-reference-20261118.json)
completed **247 groups** and reproduced `e7e5` at depth 38, **24,000,033
nodes**, and the pinned final checkpoint. The reference and integer-port
trace agreed on the first group's 98,566 nodes. The reference ran
off-chain and does not establish the Stylus port's terminal parity.

## Implemented

- [Guest preparation](tools/prepare_guest.py) identifies the exact program,
  embedded model, seed segments, indirect-call table, imports and mutable
  globals. It can export the seed segments byte for byte.
- [Paged memory](src/memory.rs) gives the guest a checked logical address
  space and a bounded resident cache. The cache supports overlapping bulk
  copies, fill and growth. The contract backend must authenticate data and
  persist modified pages.
- [Generated C lowering](tools/lower_wabt_header.py) checks the pinned wasm2c
  header and routes the guest's scalar, SIMD, bulk and memory lifecycle calls
  through [the page callback interface](tools/guest_paging.h). The active
  data segments no longer require contiguous host arrays.
- [Search grouping](src/search.rs) calls the bound guest for each quantum,
  checks cursor progress and returns one checkpoint boundary per group.
- [Grouped reference runner](../sliced/runtime/cmd/group40/main.go) records
  the same 40-quantum boundaries in the portable runtime for comparison.
- [Receipt verification](tools/verify_full_move.py) checks a captured move
  for the exact reference result, checkpoint, group continuity, activated
  private contract identity, canonical receipts and measured limits.
- [The bounded interpreter](src/interpreter/mod.rs) runs the pinned guest's
  control flow, calls, scalar arithmetic and SIMD semantics over paged
  memory. [The inspector](tools/inspect_instructions/README.md) validates
  the guest and emits control links, signatures, globals and table entries.
  The [Stockfish adapter](src/interpreter/guest.rs) calls the exact guest
  exports for the existing 40-quantum driver.
- [Cold resume](src/resume.rs) authenticates the checkpoint header and
  supplied old pages before execution. It isolates page writes until the
  new root is sealed, and a missing witness prevents a commit. The
  [group runner](src/interpreter/group.rs) connects those checks to the
  pinned Stockfish exports, flushes changed pages and derives the new root.

## Validation

The Rust library passed 27 component tests, including interpreter control
flow, memory, indirect calls and authenticated cold-resume behavior.
The 42 scalar implementations of the pinned SIMD compute instructions
matched native WebAssembly across 2,688 differential test vectors.
The inspector found 197 opcode kinds in the pinned guest, including 52
SIMD instructions. The remaining 10 SIMD opcodes are memory operations
and constants handled by the interpreter.
A [ROM smoke run](examples/rom_smoke.rs) executed 56 instructions from the
original guest, including its Asyncify resume exports, with an authenticated
4 KiB memory witness. The original stack pointer was 120,685,200 and the
Asyncify state changed `0 → 1 → 0 → 2 → 0`. The run exercised the actual
function cells and checkpoint reads alongside the earlier isolated tests.
A small fixture against the pinned generated C header passed
memory access, overlapping copy, growth and trap checks. The Go reference
command compiled with the pinned guest embedded. The full Stylus engine
requires its linked backend and checkpoint adapter.

With the pinned guest at `sliced/runtime/.cache/sliced.wasm`, run
`go run ./cmd/group40` from `sliced/runtime` to produce the grouped portable
reference. Run the complete engine on a dedicated test worker. This command
compares engine output and produces no Stylus receipts.
Pass `-checkpoint-traffic` to measure changed 4 KiB pages and 32-byte words
between the actual 40-quantum boundaries. This profiles the portable VM's
logical memory after initialization, before the diagnostic canonical export.
The counts exclude changed globals and storage framing, and they cannot
measure transient page traffic or contract gas.

## Activation and persistence

GL3's Stylus memory ceiling is 128 pages of 64 KiB. The guest's initial
logical address space is 128 MiB. Keep logical pages behind the callback
interface and measure real physical pages after linking. The [stock Nitro
activation rules](https://github.com/OffchainLabs/nitro/blob/v3.12.2/arbos/programs/programs.go#L417-L425)
also limit each decompressed Stylus program to 256 KiB under the [pinned
ArbOS parameters](https://github.com/OffchainLabs/nitro/blob/v3.12.2/arbos/programs/params.go#L19-L41).
The older scalar
replay companion has over 3 MiB of executable code before its model data,
so moving seed bytes alone leaves code size as a separate gate. The old
companion's size is a measurement of that artifact. Measure the new build
after lowering.

[Packing the exact guest](tools/partition_guest.py) measured 870,051 bytes
of code and control sections after separating the model and debug data.
Brotli quality 11 compressed those bytes to 180,008 bytes, above the
96 KiB four-fragment ceiling. The packer splits that stream across 36
ordinary immutable bytecode cells and adds a separate 7,494-byte function
directory. It preserves the original 98,648,903-byte encoded data section
in an additional 4,015 cells. [The bounded reader](src/rom.rs) checks each
cell's code hash against the engine manifest and reads functions across
cell boundaries. The interpreter uses those cells, 24,778 indexed
control links and a 1,764-byte runtime directory. The [linked interpreter
probe](probe/interpreter.rs) builds to 29,565 bytes of Wasm and 10,345 bytes
of prefixed Stylus runtime after Brotli compression with SIMD, bulk memory,
reference types and multivalue disabled in the outer program. The packaged
probe fits the ordinary single-contract size envelope. It ran the two
exact guest getters in an offline host fixture using the 51 ROM cells.
The fixture rejected the search selector, an unauthorized manifest and
a code hash mismatch. The full search contract's linked size and
activation still need a private Nitro rehearsal.

The [custom research runtime's full decision](../sliced/evidence/cachefix-full24m.json)
persisted a median 655,352-byte word-delta per four-quantum slice. Depositing
that many bytes as fresh contract code would cost about 131 million gas at
[200 gas per byte](https://eips.ethereum.org/EIPS/eip-3860) before search or
transaction overhead. The rehearsal budgets 32 million L2 gas per search
transaction. This calculation screens out copying
those same recorded payloads into stock Stylus bytecode. Measure exact
40-quantum read and write traces before choosing a different persistence
representation. The [checkpoint codec](src/checkpoint_codec.rs) exactly
replaces changed 32-byte words using a 16-byte bitmap per sparse 4 KiB
page. [The budget tool](tools/checkpoint_budget.py) compares lossless
representations from memory captures at actual group boundaries. The
[checkpoint tree](src/checkpoint_tree.rs) authenticates a batch of pages
and updates the root with the same proof. Cold resume still depends on
getting the pages to the contract. Nitro's [default sequencer limit](https://github.com/OffchainLabs/nitro/blob/v3.12.2/execution/gethexec/sequencer.go#L218-L226)
is 95,000 raw transaction bytes, which holds at most 23 raw 4 KiB pages
before signature, proof, or request framing. A receipt archive or replay
can recover past logs for witnesses. The [existing exact guest trace](../sliced/evidence/simd-dirty-cost.json)
already recorded 1,919 changed pages in the first quantum of the same
`e2e4` opening. This raw-witness adapter requires the old 4 KiB input for
each page it writes. That is at least **7,860,224 bytes** for the first
quantum, before read-only pages and proofs, over 82 times the 95,000-byte
envelope. The calculation rules out the raw input format for the first
40-quantum transaction.

## Compact cold-resume input

The [witness format](src/witness_wire.rs) encodes zero pages without a body,
uses lossless zero-run encoding for sparse pages and preserves dense pages
verbatim. It replaces known zero Merkle subtrees with a one-byte tag. The
[compact backend](src/compact_resume.rs) reconstructs the committed root
before execution and decompresses pages on demand. Evicted writes remain
compressed in a bounded overlay and only changed pages leave a successful
[40-quantum execution](src/interpreter/group.rs).

Dense old pages and nonzero proof nodes also support four-byte references
into an immutable archive. The GL3 adapter can read this archive from
code-hash-pinned contracts. The same page root still authenticates the
referenced bytes. A packet carries offsets only when the referenced archive
is already available to the contract.

An offline fixture opened 1,919 synthetic zero pages spread across the
logical address space. Its packet was **24,027 bytes**, including 12,507
proof nodes. It cold-read and changed two pages, forced eviction, and
verified finalization. A batch of 24 dense inline pages exceeded the cap
and was rejected. Those synthetic dense pages fit a **260-byte** packet
using archive references. The exact Stockfish Asyncify smoke test also
ran through an authenticated archive with a **38-byte** packet.

The archived [four-quantum private replay](../sliced/evidence/cachefix-next-native-replay.json)
contains 1,533,104 bytes of retained word deltas. Compressing each of its
94 captured fragments independently with zlib produced 283,693 bytes
before framing. This measures an older format's persistence cost. The
compact witness test sizes measure bytes supplied to the engine.

The full move requires an initialized archive and a way to make changed
pages available across groups within the gas budget. The [receipt checker](tools/verify_full_move.py)
now requires all 247 signed transactions to be under 95,000 bytes and
cross-checks their sizes from private RPC. Stockfish parity, gas and
block latency still require the full private Nitro run.

## Single-move transaction contract

The [search entry point](contract/search.rs) links the full interpreter and
compact resume path. Its constructor pins the exact ROM configuration and
initial checkpoint with two storage words. Each call authenticates the
supplied checkpoint before opening the witness, runs the grouped search,
and writes one new head. Receipt logs contain the encoded changed pages
and the new head. An archive reader can recover those bytes from receipts
without computing a chess move. Contract execution authenticates them
through the committed memory root at the next call.

The code-backed entry point accepts a bounded manifest of immutable
witness cells. It authenticates the same proof and runs the same guest
instructions as the inline entry point. A successful code-backed call
emits the checkpoint head and count of changed pages. A replayer can
recover the exact next image from the mined call, its on-chain inputs
and the pinned guest. A later witness must still match the committed root.
This avoids emitting page bodies as duplicate logs. The cost of publishing
the witness cells is separate from the cost of advancing the search.

The 294,385-byte opening witness needs twelve cells. Its manifest adds
628 bytes to the 4,021-byte header. All 34 library tests passed on Runpod,
including the larger code-backed wire parser. The seeded private
receipt and dispatch bound are recorded above.

The immutable archive's code hashes are stored in a code-resident
directory. A call supplies only the fixed-size engine manifest and the
directory's outer manifest. This avoids repeating a whole-archive list of
addresses in each transaction.

After [canonical re-encoding](../../../chess/l3/stylus/normalize/src/main.rs),
the linked build is **67,940 bytes of Wasm** and **23,626 bytes** with
the Stylus prefix and Brotli compression. It passed validation using
Nitro's WebAssembly feature flags. Its outer memory starts at 25 pages
and is capped at 128. In an offline host fixture the entry point
opened the exact engine ROM for a validly framed call, rejected an omitted
page witness without logging or updating the head, and rejected a stale
checkpoint and a nonzero value transfer. These checks cover the entry
point and failure handling. Activation, a successful search group, and
the real cost of publishing its changed pages require stock Nitro. The
Runpod activation result above is the first on-chain result for this build.

### Exact initialized snapshot for the rehearsal

[The recovery tool](examples/extract_seed.rs) recovered **466,157,568 bytes**
from the archived [private block replay](../sliced/evidence/cachefix-first-native-replay.json).
It read the source program identity and initial globals from ArbOS storage
in the pinned block's trie and reproduced the historical image commitment
`5d89d556e3c7cede4a0e4c80928f84ffa02274053cf0cfa82413dc82c6a2c407`.
The recovered raw image SHA-256 is
`2d7637246b973a1cfebfc7d1ad11d762797110d199b431b52272c6f0e3e0c1ef`.

[Archive packing](examples/pack_snapshot.rs) omitted zero pages and
deduplicated identical data. The verified snapshot needs **269,552,992
archive bytes** across **10,969 code cells** in the current layout. The
resulting checkpoint tree root is
`c325afeb4963e77707a5d02e7baa261fc8e358c7483b8c92a6285513b2bc9f75`.
The [private genesis packer](tools/rehearsal_genesis.mjs) emitted 11,044 code
accounts including the engine and directory. Its advance header and
directory manifest use **4,021 bytes** before the witness or signature.
Genesis allocation provides the checked bytes for private measurement.
On an existing chain, publishing this exact uncompressed archive as new
contract code would require about **53.9 billion gas** for archive code
deposit alone, before contracts, calldata, activation or execution.

[First-group tracing](examples/trace_first_group.rs) captures the pinned
engine's real read set and produces the exact compact witness if it fits.
[The private node launcher](tools/start_rehearsal_node.mjs) imports the
archive into a new database and starts stock Nitro on loopback on the
disposable worker at the 100 ms sequencing interval.
[The first-group runner](tools/rehearse_first_group.mjs) uses the funded
ephemeral signer on an isolated ArbOS 61 loopback RPC, deploys and
activates the search program, and verifies its signed transaction length,
gas receipt and committed 40-quantum head. It also reconstructs the head
commitment and compares the complete ordered page journal with the trace
byte for byte using its digest. The runner verifies the compute gas cap
separately from the simulated posting cost. End-to-end testing needs to show that
the receipt bytes can supply subsequent groups and reproduce the complete
24-million-node checkpoint while ordinary transfers keep their cadence.

## Checkpoint gas probe

The [probe](probe/checkpoint.rs) emits a configurable number of synthetic
checkpoint bytes in 4 KiB log chunks and persists a 32-byte commitment.
The compact build is 4,826 bytes of Wasm and 2,190 bytes of prefixed Brotli
runtime. An offline host fixture verified log bytes, Keccak commitments,
stale-root rejection, and the one-page memory cap. Private Nitro activation
and real gas measurements remain pending.

Build the probe from `stylus-port` and package it for isolated rehearsal.

```sh
rustc --edition 2021 --target wasm32-unknown-unknown --crate-type cdylib -C opt-level=z \
  -C panic=abort -C strip=symbols \
  -C target-feature=-simd128,-relaxed-simd,-bulk-memory,-reference-types,-multivalue \
  -C link-arg=-z -C link-arg=stack-size=32768 -C link-arg=--initial-memory=65536 \
  -C link-arg=--max-memory=65536 -o checkpoint-probe.wasm probe/checkpoint.rs
python3 tools/package_probe.py checkpoint-probe.wasm checkpoint-probe-package.json \
  --expected-sha256 "$(shasum -a 256 checkpoint-probe.wasm | cut -d ' ' -f 1)"
```

A private caller can send 68 bytes of raw calldata with a big-endian
four-byte payload length, the previous 32-byte commitment, and a 32-byte
seed. A new instance starts at commitment zero. Measure the transaction
receipt for full gas, including storage. The 44-byte return value reports
the next commitment, gas spent in the log loop, and the chunk count.

Bind the seed, mutable pages and continuation to the contract's own state.
Then activate the program and run the exact opening on an isolated stock
Nitro chain with GL3's limits. Confirm the captured result, cold restart and
resume, and record every group and ordinary transfer confirmation time. A
full Stylus move and its effect on ordinary block production remain unmeasured.

Build and test records for this lane belong here. The live GL3 node and its
storage are outside the execution scope.
