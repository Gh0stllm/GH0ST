# Twenty-game storage gate

**BLOCKED — 20 games × 80 Black decisions are not accepted within 1 TB.**
The unchanged first full-strength decision adds **1,618,883,770 unique code bytes**.
Every one of those bytes remains referenced by the latest state. Repeating that
measured unique-code rate for 1,600 decisions gives **2.59 TB of code alone**,
before trie versions, receipts, recovery/proof data and operating reserve.
This is an explicit planning extrapolation, not 1,600 executed searches or a
claim that all future positions have identical storage costs.

## Direct measurements

The probe opened the **closed, genuine persisted full-decision recovery DB** on
Runpod with Pebble `ReadOnly=true`. It checked all stored code hashes, enumerated
genesis/current account references, authenticated all delta bodies, and cold
restored every memory byte, globals, TT and history. It ran **no search or
transaction**. Selected865 and the engine/search policy are unchanged.

| Measured fact | Exact result |
| --- | ---: |
| Completed decision | e7e5 · 24,000,033 nodes · depth 38 |
| Persisted head | block 2469 · `0x9b196e18ade898fae7988ab3eeb1881a759a4ec1edf7a53d91f2ba1b7c798ae5` |
| Unique genesis code, shared once | 265,789,224 bytes |
| Added immutable delta code | **1,618,883,770 bytes / 99,983 accounts** |
| Current unique code | 1,884,672,994 bytes |
| Code unreferenced by current head | **0 bytes** |
| Current account/code references | 171,831 accounts / 171,826 code accounts |
| Authenticated ancestry | 2,464 bodies / 1,617,883,940 raw bytes |
| Retained logical KV data | 2,111,879,094 bytes / 1,144,456 records |
| Three child DBs: file lengths / allocated blocks | 2,194,800,755 / 2,468,929,536 bytes |
| Cold restore + full canonical serialization | 9.810667835 seconds |
| Restored memory | 466,157,568 bytes · SHA `26ade604…a92f7` |
| Full canonical, including TT/history | 163,085,439 bytes · SHA `5f9762c7…f28c6` |
| Probe Go process | exit 0 · 39.518796627 s including build · 3,719,948 KiB max RSS |

The full memory/canonical hashes exactly match the separately frozen completed
image export. The complete report and code/key-value categories are in
[`completed-database-measurement.json`](evidence/completed-database-measurement.json).
All 164,781 unique code records were checked against their Keccak keys. Missing
address-preimage warnings from the hash-scheme dump do not omit accounts:
`OnlyWithAddresses=false`, code/storage expansion disabled, and every code
reference resolved with zero missing code hashes.

### Preserved metadata-gate failure

The original strict **all-file metadata unchanged** gate failed. Pinned Pebble's
Unix `vfs.Lock` calls `os.Create(LOCK)` even for a read-only database, updating
the existing empty `l2chaindata/LOCK` timestamp. All **297 file contents, hashes,
sizes, allocated blocks and inodes** remained identical, and every non-LOCK
timestamp remained unchanged. The LOCK time was not restored or hidden.

The Go measurement/restoration passed; its stronger timestamp policy did not.
Both facts remain separate in the original before/after manifests, failure log,
and [source-backed reconciliation](evidence/lock-metadata-reconciliation.json).
No chain, trie, code or receipt data was written or pruned.

## Capacity envelope

Assume 20 games, 80 Black decisions each, one shared genesis, and the observed
first-decision **unique-code** rate with no additional cross-decision dedup.
These figures exclude every non-code overhead.

| Planning scenario | Code payload |
| --- | ---: |
| One game × 80 decisions | 129.78 GB |
| 20 independent states after one decision each | 32.64 GB |
| 20 games × 80 decisions | **2,590,479,821,224 bytes / 2.59 TB** |

| Advertised decimal disk | Illustrative reserve | Maximum average new unique code per decision for 1,600 decisions | Reduction/dedup needed versus measured rate |
| --- | ---: | ---: | ---: |
| 512 GB | 20% | 255.83 MB | **84.20%**, before other overhead |
| 1 TB | 20% | 499.83 MB | **69.12%**, before other overhead |

At that unchanged measured rate, raw-code-only arithmetic fits about three
80-decision games on 512 GB or six on 1 TB with this reserve. These are **not
accepted game capacities**: later positions vary, historical/trie overhead is
not modeled as a constant, and cross-game dedup was not measured. Identical
game prefixes can reuse content-addressed bytes; divergent delta ancestry and
TT/search contents can create new bytes. No assumed dedup ratio certifies the
target. Sensitivities and exact integer arithmetic are saved in
[`twenty-game-envelope.json`](evidence/twenty-game-envelope.json).

**Twenty simultaneously active games are a separate unsupported feature.**
A14/A15 share one active-game reservation and one heavy-operation admission.
The 32.64 GB row is only storage arithmetic, not admission, RAM, throughput or
20-way play acceptance. Sequential total history and simultaneous active state
must not be merged into one claim.

## Why checkpointing or generic pruning is insufficient

The accepted isolated **native A15 experiment** reduces the active restore
ancestry from 2,464 deltas to 64 pieces totaling 162,059,912 body bytes. Its next
unchanged full 24m-node decision also matched the complete frozen golden.
Neither experiment deletes the old code accounts; second-decision storage
growth was not measured here. A smaller active ancestry is not a smaller total
retained database. A15 remains native research, not a selected guest/STF upgrade.

In the measured A14 DB, **all code is still referenced at current head**.
A generic historical-root pruner must retain that code. Ordinary compaction
cannot remove it. `releaseGame` changes metadata/admission, not the old blob
accounts. Even perfect historical pruning therefore cannot supply the required
live-state bound under the existing layout.

The needed change is a **separately versioned authoritative storage layout**:
fixed reusable page cells/banks, or authenticated retirement with complete
shared-reference accounting. It must preserve all memory/globals/TT/history,
account balance/nonce safety, journals, reorgs, cache identity and recorded
witnesses. Historical code/root availability then needs its own challenge-safe
retention/archive policy. This changes the STF and needs a new proof module;
there is no honest native-only storage fix that silently retains selected865's
existing root. See the [concrete next gate](NEXT-GATE.md) and earlier
[retention design](../retention-design/README.md).

## Scope, provenance and cleanup

All compilation, scanning, hashing, arithmetic and cold restoration ran on the
existing Runpod with at most two Go CPUs. No full DB was copied, no search was
rerun, and the new packet is compact. Exact source/data hashes are in
[`data-source-provenance.json`](evidence/data-source-provenance.json) and
[`source-manifest.json`](evidence/source-manifest.json).

The parallel cleanup audit independently rechecked 47 frozen failed-CLI evidence
files, three controller binaries and duplicate account streams. Root then
deleted **only the three inactive failed/unready startup directories**, preserving
the small evidence/archive and the passing CLI/full-decision databases. Actual
space recovered was 5,090,443,264 bytes. The audit, root receipt and preserved
archive are included under `cleanup/`; this probe performed no deletion. Build
caches, accepted DBs, selected source/input/proofs and the engine remain intact.

This packet blocks the twenty-game storage claim. It does not invalidate the
separately completed one-decision recovery, selected865 replay, or native A15
continuation; none of those narrower results establishes 20-game mainnet capacity.
