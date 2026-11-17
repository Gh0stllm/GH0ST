# GL3 · authenticated native checkpoints

**The isolated native checkpoint works on the exact completed first decision.**
It replaces 2,464 active delta links with 64 standalone pieces, then restores the
same 466,157,568 memory bytes, globals, TT, history and canonical state. The
unchanged full-strength next decision also matches its complete frozen golden.
This is native research evidence; the production STF and selected proof worker
have not been modified.

| Runpod result | Measured evidence |
| --- | --- |
| Final native regression group | Exit 0 · 31.878 s · 5 named tests / 28 PASS events |
| Default build without opt-in tag | Exit 0 · A15 absent; A14 ABI unchanged |
| Completed image | 466,157,568 bytes · e7e5 / 24,000,033 nodes / depth 38 |
| Active ancestry | 2,464 old deltas → 64 ordinary GSD1 pieces |
| Checkpoint bodies | 162,059,912 bytes |
| Full canonical bytes | 163,085,439 · exact frozen SHA256 match |
| Finalize | 1.032–1.049 ms · 7,352,018 research gas · zero code/image/history reads |
| Sampled native regression peak RSS | 6,421,964 KiB; fixture includes copied historical code |
| Next full-strength native decision | b8c6 / 24,000,311 / depth 39 · full canonical unchanged |
| Direct native-handler continuation benchmark | Exit 0 · 229.103 s total; continuation 197.707 s |
| Independent guest / production acceptance | **Not established** |

[Native receipt](evidence/native-v10/completed-native.json) ·
[actual process exit](evidence/native-v10/test-exit.json) ·
[test log](evidence/native-v10/test.log) ·
[default-profile test](evidence/disabled-v8/test.log) ·
[full-strength continuation](evidence/continuation-v9/continuation-result.json)

## How the opt-in profile works

`gl3_checkpoint_integration` registers a separate native precompile at `0xa15`.
The unchanged `0xa14` profile remains available. A15 uses an independent namespace
domain; passing the A15 namespace or a salted job through A14 does not reach the
A15 game or its builder lock. Both profiles retain the shared single-active-game reservation
and shared one-heavy-work-call-per-block budget.

1. **Begin** freezes authoritative owner, job, generation, root and source-head
   metadata. It allocates no VM and does not sweep historical code.
2. **Work** authenticates the frozen source, compares at most **7 MiB** of memory
   with the fixed genesis, and writes an ordinary content-addressed GSD1 piece.
   Worst-case encoded size is 8,257,580 bytes, below the 8 MiB piece bound and
   existing 32 MiB blob limit. The first piece has a zero predecessor; each next
   piece points to the preceding checkpoint piece. Caller-supplied image bytes
   are never accepted.
3. **Verify** authenticates one bounded piece, its exact predecessor, memory
   length and sorted word coverage. All ranges must have been generated and all
   pieces verified.
4. **Finalize** checks bounded builder metadata and switches **only Head/Deltas**.
   It performs no VM call, image rehash or old-history walk. Root, globals,
   generation, history, request and progress remain unchanged. `DeltaBytes` keeps
   its existing informational value because the metadata switch is deliberately
   limited to those two fields.

Begin/advance/release are locked during a checkpoint. Cancellation preserves a
monotonic nonce and leaves unreachable pieces intact. It does not erase accounts.
Native caches bind the exact frozen source and generated prefix, rebuild from
authoritative StateDB after stale-code/reorg detection, and never authorize a
state transition. RPC/recording restoration shares the existing admission token
through restoration, use and VM close. The live cache mutex spans actual use.

## What was actually tested

The native fixture verifies the original 1,914,805,529-byte captured input hash,
reads its authenticated seed and delta ancestry, and copies those exact sealed
accounts into a fresh real StateDB. It then adds the native-accepted final delta
and completed metadata from the [final-state export](../../production/bounded-restore/final-state-export/).
This is a private test-only import; no import method is exposed in the ABI. The
capture is a sparse witness, so it is not presented as a complete mutable parent
database.

Actual EVM/ABI calls exercise real Keccak addresses, code storage, journals and
gas: owner/generation/root locks, A14 bypass attempts, shared reservation, actual
RPC permit denial/error/pre-cancellation, OOG, outer StateDB rollback, missing
original backing, stale native-code fallback, exact range coverage, missing or
corrupt checkpoint pieces, partial finalize, outer-Finalize rollback and
cancel/nonce ABA. Re-encoding the same image also preserves an existing shared
immutable piece with a deliberately nonzero nonce and balance. Separate pure
regressions bind the cache to the source and piece prefix and deny 32 concurrent
RPC leases while one permit is held. Cold restoration checks every memory byte
by SHA256 and the unchanged image root before comparing full canonical bytes.

Earlier failed fixtures remain in `evidence/native-v4`, `native-v5` and
`native-v6`: owner setup, a rollback-induced nil accelerator map, and treating a
sparse witness as a complete mutable DB respectively. The final fixture fixes
those causes and does not suppress StateDB errors.

## Limits that remain

The **new memory scan and newly written piece are bounded; inherited cold source
restoration is not bounded by 7 MiB**. A cold/recording Work still restores the
whole frozen source history. In this native fixture successful Work calls ranged
from 0.121 to 2.422 seconds; this does not establish uniform block latency, guest
memory/witness cost, or a production gas tariff. Recording/prover acceptance
remains separate.

Finalize relies on the sealed immutable-code writer invariant. The profile
rejects debug-enabled execution; production must also prevent privileged mutable
writers or upgrades from violating that invariant between verification and
finalization. No production configuration is approved by this test. Injected
missing/corrupt pieces are rejected during Verify, and a cold reader rejects
corrupt backing. A metadata-only Finalize is not a physical-disk audit.

Old delta accounts are retained. Checkpointing reduces the active restore chain,
not total disk use. Shared-code reference accounting, challenge-safe archives,
resurrection/dust/nonces and actual pruning remain independent gates. There is
**no 20-game storage or mainnet-readiness claim**.

## Reproduce in the isolated Runpod tree

Only the isolated tree is patched: registration adds
`insertGhostChessCheckpointProfile(insert)` after the existing slice insertion.
The enable/disable stubs preserve the default build. The engine/runtime/tree
sources remain unchanged.

```sh
python3 run-group.py --label native-review \
  --pattern '^TestGL3Checkpoint(ProfileABIAndDomain|AcceleratorIdentity|RPCAdmissionLease|RealEVMGuardPreflight|CompletedNativeStateDB)$'
python3 run-group.py --label disabled-review --disabled \
  --pattern '^TestGL3CheckpointProfileDisabled$'
```

The separately executed opt-in continuation uses `--next-decision`. It destroys all live
VM/search caches, authenticates a cold checkpoint restore, runs the same full
24-million-node next decision, and compares the frozen b8c6 / 24,000,311 / depth
39 result and complete canonical hash. Canonical serialization only uses an
isolated VM that is then closed. The actual native result completed 2,489
operations / 9,955 engine steps and matched the entire 163,085,439-byte canonical
SHA256 `b06a3f26b0b276c0109fb1888fa32727714ada8abb00cbec8f857bec8308068b`.
This is a direct native-handler benchmark, not mined-block or public move latency.
It confirms unchanged continuation in the native profile, not guest proof or
production admission.

Compiled A15 source SHA256:
`0645d3ce0785585115af05a68ab448233addaad5d8aa35620229e05a453d97b9`.
All compiled/test source and binary identities are preserved in the
[source manifest](evidence/native-v10/source-manifest.json) and
[binary receipt](evidence/native-v10/binary.json). All builds and tests ran on
Runpod; local work was source editing and read-only evidence transfer.
