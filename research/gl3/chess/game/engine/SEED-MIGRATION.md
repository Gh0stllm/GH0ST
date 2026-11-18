# Install the initialized A14 engine

The custom runtime's private chain imports Stockfish at genesis. GL3 started
with the base Nitro runtime. This migration installs the same engine seed
through A14 after the live execution and proof runtimes agree on its activation.
Historical blocks need the base profile. The activation height and production
runtime pairing are separate release requirements.

| Initialized engine commitment | Value |
| --- | --- |
| Portable engine SHA-256 | `1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc` |
| Genesis image root | `5d89d556e3c7cede4a0e4c80928f84ffa02274053cf0cfa82413dc82c6a2c407` |
| Raw initialized memory | 466,157,568 bytes |
| Nonzero pages | 71,823 of 113,808 |
| Seed globals, in order | `gl3_global_0=120685200`, `gl3_global_98=0`, `gl3_global_99=0` |

The [checkpoint study](../../../mainnet/storage/checkpoint-study/evidence/measurement.json)
records the genesis image root and code-account count. The
[authenticated fixture](../../../mainnet/storage/checkpoint-prototype/evidence/initial-48/fixture-metadata.json)
records the initial globals. The raw seed must come from the pinned engine
immediately after its initialization. A saved search includes changed bytes and
globals and cannot pass the seed commitment.

## Bounded import

The seed installer submits 7,113 sequential chunks of 16 pages each.
A chunk contains a bitmap, only its nonzero pages, and 14 sibling hashes proving
its location in the existing image tree. A14 authenticates all sixteen pages,
the engine and initial globals before writing. The cursor updates with the
writes in the same transaction. A failed call leaves the cursor and pages
unchanged. The next accepted chunk must be in a later block.

The write uses the existing seed cell addresses and encoding, and rejects
conflicting code. Zero pages require no code writes. The last chunk writes the
same seed metadata that the private genesis importer produces. Chess entry
remains closed until that metadata exists, the game coordinator is registered
and its prize pool has been funded.

The maximum page payload is 65,536 bytes per call before ABI and proof overhead.
At 200 gas per retained code byte, writing all 71,823 originally nonzero pages
has a source-derived code-write charge of 58,923,589,200 gas. That excludes
calldata, reads, proof computation, storage metadata and parent-chain fees.
At 0.00001 GH0ST per gas, that write component alone costs 589,235.892
GH0ST. Measure execution and calldata gas after activation before allocating
the migration budget. This figure excludes the game prize and deployment fee.

## Generate transaction arguments

`seed_chunks.py` reads a raw initialized memory file. It verifies the entire
commitment before emitting an argument object per selected chunk. The script
uses local file input and prints unsigned arguments.

```sh
python3 seed_chunks.py /path/to/initialized-stockfish.raw --start 0 --count 1
```

On ownerless GL3, the Robinhood UpgradeExecutor nominates a dedicated seed
installer through the [restricted parent bootstrap](ownerless/PARENT-ACTIVATION.md#restricted-bootstrap).
The address must be controlled by the project and able to pay GL3 gas. Wait
for verified A14 activation before submitting the nomination. Verify the
installed address and read `seedMigrationProgress()` before sending a
chunk. Advance from the canonical cursor after each successful receipt.

A14 reports the exact module and seed commitment through `engineStatus()`
when the import completes. The parent executor can then register the
deployed chess coordinator. Paid play requires that registration and a
separately funded prize pool.

This document describes the import and its verification steps. Neither a
deployment of the coordinator nor a verified A14 activation proves that
seed chunks have been installed.
