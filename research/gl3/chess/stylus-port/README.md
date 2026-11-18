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
  space and a bounded resident cache. The contract backend will authenticate
  data and persist its own pages.
- [Search grouping](src/search.rs) calls the bound guest for each quantum,
  checks cursor progress and returns one checkpoint boundary per group.
- [Receipt verification](tools/verify_full_move.py) checks a captured move
  for the exact reference result, checkpoint, group continuity, activated
  private contract identity, canonical receipts and measured limits.

## Work remaining

The pinned guest allocates at least 128 MiB of contiguous linear memory.
Standard GL3 limits physical Stylus memory to 128 pages of 64 KiB. The
generated C uses raw guest pointers for scalar and SIMD operations, data
initialization, bulk memory and checkpoint access. The port must lower all
of those accesses to the paged backend before activation.

After that, run the exact opening on an isolated stock Nitro chain with
GL3's limits. Confirm the captured result, cold restart and resume, and
record every group and ordinary transfer confirmation time. A measurement
of one full move is still pending.

Build and test records for this lane belong here. The live GL3 node and its
storage are outside the execution scope.
