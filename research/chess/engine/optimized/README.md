# Optimized full-strength ICP engine

This isolated lane preserves the hybrid engine's **24,000,000-node Stockfish 19 search**, full pinned NNUE, 128 MiB hash, one thread, skill 20, and retained per-game TT/history. It reduces measured computation and update hops. The frozen [`../hybrid/`](../hybrid/) release remains unchanged. No public deployment, entry payment, signing, or token transfer was performed by these tests.

## Actual local ICP evidence

[`evidence/pocketic-full24m.json`](evidence/pocketic-full24m.json) completed two consecutive searches against one upstream optimized native process retaining its state. Both actual PocketIC results matched **best move, exact node count, and depth**:

| Position | Best move | Nodes | Depth | Updates | Search cycles debited |
|---|---|---:|---:|---:|---:|
| Black after e4 | e7e5 | 24,000,033 | 38 | 35 | 972,560,540,260 |
| Same game after e5, Nf3 | b8c6 | 24,000,311 | 39 | 33 | 912,147,778,563 |

The first decision used about **21.5% fewer cycles** than the clean frozen baseline's 1,239,070,157,514 and **85.4% fewer update calls** than its 240 (6.86 times fewer). These are measured examples, not universal cost or latency ceilings. Cycle intervals exclude model initialization/reservation and include the harness's retry/read checks. PocketIC time is set before canister creation, avoiding deferred multi-year storage charges. See [`evidence/comparison.json`](evidence/comparison.json) for exact comparison scopes.

Local timing in the first full-search record begins after the initial two steps; it must not be described as a complete production move-latency measurement. Fewer consensus hops are demonstrated, while public-network latency remains unmeasured.

The rebuilt module used 647,773,966 bytes of canister memory in the warm paused-search snapshot (about 617.8 MiB); this is a snapshot, not a universal peak bound.

All 27 full-search/API checks passed, including auth, altered-body rejection, byte-identical retries, expected-step recovery, sequential-history enforcement, terminal release, and durable refundable upgrade faults. [`evidence/pocketic-api.json`](evidence/pocketic-api.json) separately checks the rebuilt release. [`evidence/kernel-exactness.json`](evidence/kernel-exactness.json) records four million actual-Wasm SIMD/scalar output comparisons, randomized accumulator wraparound, and every activation pair against endpoint weight pairs, with zero mismatches. Two native-exact searches are equivalence evidence, not a claim of unbeatable chess or an Elo measurement.

## What changed

1. **Adaptive update slicing.** The existing deterministic Stockfish `check_time` boundary reads IC's per-message instruction counter. At 28,000,000,000 it saves the exact protected C++ stack and yields. It resumes that same search, TT, history, worker state, and NNUE accumulators; it never restarts or substitutes a shallower answer. The full immutable node budget is unchanged. Default Asyncify indirect-call instrumentation and the previously verified suspended-stack-pointer rewind remain intact.
2. **Exact sparse affine representation.** Only the small 1024→32 affine matrices gain derived signed-i16 even/odd-pair arrays at network load (524,288 additional bytes across eight buckets). The original signed-i8 weights remain unchanged and remain the source for parameter hashing/serialization. Input activations are in 0..127: the feature product is at most `255*255 >> 9 = 127`. Original SSE signed-i16 pair saturation is therefore unreachable (`-32512..32258`). Two standard integer `i32x4.dot_i16x8_s` operations and additions give exactly the original four-product i32 sums, including modulo-2^32 accumulator behavior. No relaxed SIMD is enabled.
3. **Wasm accumulator tiling.** Stockfish's manual SIMD-register tiling limit changes from 12 to 32 for this Wasm build, reducing repeated loop/address work. SIMD lanes, weights, feature update order per lane, and integer arithmetic are unchanged. No NNUE feature is omitted.

Full raw NNUE initial-memory bytes are verified in [`evidence/artifact.json`](evidence/artifact.json): `nn-1a298aa575a0.nnue`, SHA256 `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2`, 98,511,183 bytes. Stockfish 19 commit is `edb0d9db6731067ec50ce619ff372b463bc4dd5d`.

Transient counter profiles in [`evidence/profiling.json`](evidence/profiling.json) identified roughly 47% feature-transform and 36% affine work. A generic extmul/shuffle dot candidate was measured slower and rejected; it is absent from the selected artifact. The selected small-matrix layout/tiling were promoted only after full native-exact searches. No unsafe Asyncify `ignore-indirect` shortcut was applied.

## Update cap and journal proof

The release reports immutable `Info` fields:

```candid
quantum : nat32;             // 0: no fixed node quantum
yield_policy : text;        // "instruction-budget"
instruction_target : nat64; // 28_000_000_000
```

All other [`engine.did`](engine.did) methods and auth/idempotency semantics match the frozen hybrid API. The coordinator must pin this module hash and explicitly accept these yield fields. Clients cannot choose a node budget or instruction target.

[`evidence/pocketic-volume.json`](evidence/pocketic-volume.json) uses a separately built **test-only** module to seed 512 jobs × 256 cached replies × 1,024 moves. A real first update and real resumed update completed under PocketIC's 40B instruction cap, debiting 30,350,096,903 and 30,349,667,650 cycles including the worst-volume journal rewrite and reply. Samples immediately before persistence were 28.019B and 28.013B instructions. The selected release has no seed/profile/synchronous-search endpoint. This tests a conservative journal shape and two execution slices; it does not prove a universal worst-position instruction bound.

## Build and reproduce

Use the parent engine's pinned local dependencies and prepared read-only source inputs; see [`../source-lock.json`](../source-lock.json), [`../requirements-build-lock.txt`](../requirements-build-lock.txt), and parent source/license documentation. Every mutated C++ source, derived matrix, object, and module belongs to this lane's ignored cache; shared/native/frozen sources are untouched.

```sh
research/chess/engine/.cache/venv/bin/python research/chess/engine/optimized/build.py --expanded-affine --registers 32
research/chess/engine/.cache/venv/bin/python research/chess/engine/optimized/inspect_artifact.py
research/chess/engine/.cache/venv/bin/python research/chess/engine/optimized/test_kernel.py
research/chess/engine/.cache/venv/bin/python research/chess/engine/optimized/test_pocketic.py
research/chess/engine/.cache/venv/bin/python research/chess/engine/optimized/build.py --volume-test --expanded-affine --registers 32
research/chess/engine/.cache/venv/bin/python research/chess/engine/optimized/test_volume.py --quick
```

Selected module: `../.cache/optimized-engine/engine.asyncify.wasm`, **103,089,852 bytes**, SHA256 **`725dc0c795262be21f1ffafec60f50aae3e9d00140add77e791a89eece0f417b`**. Rebuilding from the published source produced identical bytes. Binaries/NNUE caches remain ignored; source pins, patches/build code, licenses, and local evidence are reviewable. See [`evidence/source-hashes.json`](evidence/source-hashes.json).

## Preserved operational limits

One reserved game remains the safe capacity. Admission must reserve it before paid RH entry; canonical terminal acknowledgement must release it. No interleaved game can overwrite retained caches. Hash is assigned only when initialization requires changing it, never per decision. The root coordinator independently validates RH canonical state, game/ply/transcript/config bindings, legal results, engine principal/module, and minimum cycles.

Durable job/reply journals do not serialize the live TT or protected C++ stack. An upgrade while a game is reserved explicitly faults the game and requires canonical cancellation/refund handling; it must not silently recreate an active game. Existing bounded retention and archive limits remain. Production integration, module sealing/signing, queue/capacity decisions, actual public latency and operating-cost monitoring, independent release review, and any paid launch remain separate gates. No weaker fallback is available.
