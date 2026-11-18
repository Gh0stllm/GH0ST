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

## Validation

The Rust library passed its eight paging and cursor tests and a Wasm target
type check. A small fixture against the pinned generated C header passed
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
cell boundaries. The cells are inputs for a compact interpreter that
still needs to execute the full guest instruction set.

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
representations from memory captures at actual group boundaries. A codec
alone does not authenticate pages or make prior receipt logs readable by
the contract. Receipt-backed checkpoints would need a committed page root
and verified witnesses for cold reads, within the sequencer's input limit.

Bind the seed, mutable pages and continuation to the contract's own state.
Then activate the program and run the exact opening on an isolated stock
Nitro chain with GL3's limits. Confirm the captured result, cold restart and
resume, and record every group and ordinary transfer confirmation time. A
full Stylus move and its effect on ordinary block production remain unmeasured.

Build and test records for this lane belong here. The live GL3 node and its
storage are outside the execution scope.
