# Fixed-bank retention · native allocator prototype

**The small native allocator works; twenty-game capacity remains blocked.**
Four fixed 4 KiB cells plus one descriptor stayed at **five current accounts**
through twenty allocator epochs. Every copied byte came from verified real
preterminal/completed engine-image windows. All twenty historical roots still
restored, while old code versions remained stored separately.

This is **not twenty games, twenty engine decisions, a whole VM/TT test, a
production ABI, a guest replay, or a storage-pruning acceptance**. No engine was
run, model/search setting changed, selected865 byte modified, or public
transaction sent. It supports the [persistent-layout change](../twenty-game-capacity/NEXT-GATE.md)
needed after the [measured 20×80 storage failure](../twenty-game-capacity/README.md).

| Actual Runpod result | Evidence |
| --- | --- |
| Native suite | exit 0 · 6 top-level tests + 3 subtests |
| Test process | 1.026906015 s wall clock including guard polling · 25,124 KiB max RSS |
| Final compile | exit 0 · 2.060847517 s after cold dependency build |
| Peak isolated cache/temp/binary | 325,959,680 bytes, below 1 GB guard |
| Current cells | 4 × 4,150 code bytes = **16,600 bytes**, unchanged across epochs |
| Current accounts | **5** at every committed root |
| Retained raw historical code | **100 code versions / 340,851 bytes** |
| Historical availability | all 20 roots reconstructed from the same unpruned in-memory raw DB |
| Selected/full-dispute sources | unchanged |

## What it demonstrates

The native library derives addresses from a fixed prototype domain, bank ID and
page index. Owner, job, epoch, generation and content hashes do not allocate new
cell addresses. A bounded descriptor carries owner/epoch/generation, presence
bits, exact globals bytes and a **window-only** commitment. A new epoch clears
logical presence without destroying old code. Normal updates retain the epoch
and write journaled page code and descriptor atomically.

Each cell has a STOP prefix and version/bank/epoch/index/content-hash header.
Reads use ordinary StateDB code access, verify backing and reject missing,
corrupt, stale or foreign cells. Native writes preserve account balance, nonce
and unrelated storage. Unexpected preexisting code is rejected, not overwritten.
There is no native VM accelerator/cache in this prototype.

Actual tests exercise:

* twenty ordinary allocator generations and epoch reset with byte-for-byte
  fixture/global equality;
* funded, nonzero-nonce cells and descriptor, including unrelated storage;
* caller, epoch/generation and index bounds;
* failure after real partial cell writes, with complete StateDB rollback;
* missing/corrupt/stale backing, StateDB copy isolation and outer snapshots;
* an **ordinary EVM outer contract REVERT** after a test-only native hook writes
  the cells, plus actual precompile out-of-gas rejection before its writer runs;
* twenty committed allocator epochs, fixed current account count, and recovery
  through every retained historical state root.

The EVM hook exists only in that test EVM instance. Its caller is a fixed trusted
test role; it is **not production caller authentication or a deployed precompile**.
Its constant gas charge is only an OOG/journal test, not a proposed production
tariff. The allocator accepts trusted fixture/engine bytes; exposing caller-
supplied memory as an import method would be an unsafe new protocol and is absent.

## Actual data, deliberately small scope

The fixture verifies full source-file hashes, then copies only pages
`24342`, `25366`, `27395`, `27396` from the two real 466,157,568-byte image files.
All four pages change in the authenticated final delta. Fixture output totals
32,889 bytes including normalized exact global values.

| Source | SHA-256 |
| --- | --- |
| Preterminal image | `3cab2f8a2133c5b762a1744a290a8f5db150209e7c706adf9374d66b7ece3446` |
| Completed image | `26ade604551c291ab4d6e2194dbf45a4cfb8f895d914443d3740ac55422a92f7` |
| Authentic final delta | `8abd2b02f3f3f708f3f5d94242587493dd2bde6c888a4ec023119c8e1a1973ab` |
| Portable module, unchanged | `1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc` |

Alternating these real windows is allocator stress, not a valid twenty-move
chess trajectory. The prototype does not identify the semantic role of each
window or verify the remaining memory/TT. Its SHA window commitment is not the
existing full-image tree/root. The current constructor caps at 256 sample pages;
whole-runtime sizing and a production format require separate work.

## What remains

Reusing addresses bounds **current references**, not all retained disk. The
historical code measurement intentionally demonstrates this distinction; no
pruning or public archive was tested. A real profile must preserve every engine
byte/global/TT/history, integrate dirty pages and full image authentication,
meter cold work/gas, share A14/A15 admission, handle migration/shared references,
and prove rollback/recording/reorg/cache behavior across the actual guest.
Historical data must remain available for every recovery/reorg/challenge window.

Those changes require a **new versioned STF and proof module**. They cannot be
silently introduced under selected865. The [migration/acceptance plan](MIGRATION.md)
keeps that work separate from the active selected865 dispute run.

## Provenance and preserved failures

Frozen source `bank.go` SHA:
`bdfc4929f4dfea2f645099d103f58fc0309fab255f59097c0be1d1cb168c7954`.
Test SHA: `3faf3b912b92ec12007ffa4b0790b9440ade4dc8aaa1d5248c7c5e0b5e884d59`.
Binary SHA: `90ced35bef9ff34c0b46caa29ed9aac2c2602f954515b4c083e868155470534f`.

The first setup attempt stopped before Go because a new parent directory was
missing. The first cold compile then rejected two pinned-geth test-adapter API
differences; its exact failure/source/32.07-second receipt are retained. The
corrected final compile and native suite passed. No failed attempt is relabeled.

All execution used the existing Runpod with two Go CPUs, an isolated cache/temp
directory, a 1 GB owned-scratch guard and a 6 GiB whole-disk free-space floor.
The full dispute had priority; no DB copy, search, guest build, infrastructure
purchase or shared source edit occurred. Source, fixture and compact receipts
are under `evidence/` and `fixture/`. No Git commit/publication was made here.
