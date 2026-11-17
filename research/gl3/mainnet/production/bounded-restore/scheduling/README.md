# Bounded restore scheduling — selected combined profile

**Status: selected combined C passed full unchanged-engine WASM32 JIT diagnostics, native output/gas/canonical checks and seed-negative/witness tests. Its matching interpreter replay is RUNNING_NOT_ACCEPTED. Geometry, full BoLD lifecycle and production acceptance remain open.**

The cache-only candidate plus a 3 GiB soft limit still exhausted WASM32 memory. Fast diagnostics distinguish garbage awaiting collection from live restoration data. They run the actual Go WASM32 restore in the pinned Wasmer JIT, with only the unsupported C import replaced by an explicit STOP after the complete historical image has been authenticated. Exit 1 at that deliberate STOP is not an engine or proof success.

| Diagnostic | Result |
| --- | --- |
| Soft limit without scheduling | Reproduces guest OOM; effective limit is 3,221,225,472 bytes, while NumGC remains 2 and HeapAlloc exceeds NextGC |
| Explicit GC every 64 deltas | Traverses all history and authenticates the image; about 1.45 GB live heap at the last delta |
| Gosched after each 64 MiB of seed/delta bytes | Authenticates the image without OOM; HeapSys reaches about 3.60 GB |
| Explicit GC after each 64 MiB | Authenticates the image without OOM; HeapSys about 1.92 GB |
| Scheduled candidate, precise phase profile | After image authentication, one explicit collection drops HeapAlloc from 3,185,974,544 to 1,467,921,488 bytes |

The selected real-companion profile combines explicit collection after each 64 MiB of seed/delta bytes, a collection after image authentication, and the existing authenticated uncached accessor for immutable seed pages. Native scheduling helpers are no-ops. Only sealed delta chunks and the fixed immutable seed namespace use the optional reader; mutable writers retain ordinary reads. The engine, NNUE, node budget, hash size, thread count, retained history, verification math and gas formulas are unchanged. It keeps the original real `gl3aot.execute` import; it contains no diagnostic STOP or memory logger.

Native verification uses the unchanged terminal input. It preserves the exact four-field end state, 12,306,935 gas, block/state/receipt hashes and the 163,085,439-byte canonical state SHA-256 `5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6`.

The phase profile also records actual retained capacities: the terminal image allocation is about 466 MB; immutable seed code occupies 386,120,960 bytes of account-cache backing capacity; the shared reader cache occupies 355,669,248 bytes against a 268,435,456-byte logical limit. These are measured capacities, not additional removed memory. The selected profile removes the redundant immutable seed account-cache backing through the existing accessor. The shared reader buffer/cache implementation is unchanged.

## Full unchanged-engine comparison

All four profiles used the same unchanged C companion and exact terminal input. Each successful JIT run matched all four expected global-state fields. These are JIT diagnostics, not interpreter or one-step-proof acceptance.

| Profile | Go linear-memory high-water | C linear-memory high-water |
| --- | ---: | ---: |
| Previous scheduled baseline | 4,102,029,312 bytes | 711,655,424 bytes |
| A: byte-budget collection | 2,424,307,712 bytes | 711,655,424 bytes |
| B: uncached seed + yielding | 4,043,309,056 bytes | 711,655,424 bytes |
| **C: selected combination** | **2,097,676,288 bytes** | **711,655,424 bytes** |

Selected C completed the real-engine guest in 37.19 s (61.08 s including JIT compilation/setup), leaving 2,197,291,008 bytes below the Go module’s 4 GiB ceiling. The [full-C JIT report](../../../diagnostics/aot-jit/evidence/combined-final/profile/result.json) records separate non-shrinking Go/C memory sizes, exact hashes, actual exit 0 and all four fields. It does not infer an independent JIT gas meter; gas is bound by the identical computed block hash and native header.

## Selected source and running proof

The [source/caller provenance](comparison/C-combined/selected-source-provenance.json) and [complete patch against frozen c03c](comparison/C-combined/selected-C-vs-c03c.patch) identify the immutable-reader call sites and leave the main `vm.StateDB` interface unchanged. Native header, gas, canonical state, malformed/oversized/missing seed behavior and witness/error equivalence passed. Exact source files, build/run scripts and test logs are beside the manifest.

- Module root: `0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086`
- Machine SHA-256: `4bf7fe54c28ad0b6f2620df3ee6b4c6d87452f9ab76ec8be294eb7d4c934770e`
- Go guest SHA-256: `8d18145460e5f4c649895728fa089a52a04ead2c3fa5e7d10789d72d7de42fbd`
- Unchanged C companion SHA-256: `b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555`
- Exact-counter prover SHA-256: `cc5c9de07b2a739978e383cd4ac4baee3a1d49761c5c75ad414e12056cd7ab27`
- Unchanged input SHA-256: `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90`

The [machine manifest](comparison/C-combined/machine-manifest.json), [process manifest](comparison/C-combined/interpreter/process.json) and [dated running snapshot](comparison/C-combined/interpreter/live-snapshot.json) preserve the launch state: prover 65942, collector 65941, start 2026-11-17 00:35:20 UTC, one 14,400-second bounded run. The logging-only host tool was checked with a seven-step/every-step-witness smoke test. The controller preserves the real child exit before optional metrics. No unfinished result file is represented as a pass. Exact final counter, kickoff offset and current 2^40 private step geometry remain unaccepted until completion and binding review.

The full [diagnostic summary](diagnostics/diagnostic-summary.json), [native equivalence](native-equivalence.json), [candidate manifest](manifest.json), source helpers and [schedule patch](schedule.patch) preserve the exact boundaries and identities. The terminal input and failed interpreter artifacts remain unchanged. Native post-replay/post-GC heap is **not** a measurement of a live guest restoration budget.

This first-decision diagnostic does not prove late-game or 20-game capacity. Historical account objects and the address/hash map still grow with retained history. The final interpreter step budget must also fit the separately reviewed BoLD challenge geometry.
