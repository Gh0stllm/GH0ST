# Fast real-engine guest diagnostics

**The scheduled candidate passed the original captured terminal block under diagnostic Wasmer JIT: 57.04 seconds total, 32.48 seconds inside the guest.** All four final global-state fields match exactly. The unchanged failed control reproduced its guest OOM in 34.02 seconds.

This is a fast diagnostic gate. It is **not** WAVM interpreter validation, a one-step proof, full BoLD finality, mainnet acceptance or interpreter replay of the entire 24-million-node search. The captured block finishes a previously executed full-strength native decision; earlier blocks are represented by its authenticated captured state/preimages.

| Run | Actual exit | Final state | Time |
|---|---:|---|---:|
| Frozen failed `c03c` control | 1; guest exit 2 | OOM; no match | 34.02 s |
| Scheduled real-engine candidate | 0 | All four fields match | 57.04 s |

The successful state is block `0x8d33a6345311761aef5c7ee9e5528350f17beda843d0563cfdd103aeec70d738`, zero send root, batch `2470`, position `0`. Its full computed block hash binds the independently saved native header's **12,306,935 gas**. No separate JIT gas meter is claimed. The successful guest allocated 4,102,029,312 bytes, leaving limited WASM32 memory headroom.

## Measured memory profiles

A later host-only observability patch reports Go and C linear memories separately. Since these WebAssembly memories can only grow, their final allocated sizes are their exact linear-memory high-water marks. This is distinct from sampled host RSS. The [profile evidence](evidence/memory-profile-comparison/summary.json) preserves source manifests, native comparisons, raw exits, four-field results and resource samples.

| Sealed guest profile | Go peak | C peak | Guest / total time | Result |
|---|---:|---:|---:|---|
| Scheduled baseline | 3,912 MiB | 711,655,424 bytes | 32.82 / 57.08 s | All four fields match |
| A: forced GC per 64 MiB + boundary | 2,312 MiB | 711,655,424 bytes | 37.11 / 62.33 s | All four fields match |
| B: scheduled + uncached immutable seed | 3,856 MiB | 711,655,424 bytes | 29.95 / 54.33 s | All four fields match |
| C: final combined A + B | **2,000.5 MiB** | 711,655,424 bytes | 37.19 / 61.08 s | All four fields match |

All successful profiles returned actual exit zero with the exact same real companion and original input. A leaves **1,784 MiB** below the Go memory's 4 GiB ceiling; B leaves 240 MiB. A and B ran in parallel, so these measurements are diagnostic timings, not production latency. Native header, gas and canonical-state comparisons passed for each; B's malformed/missing-seed, witness and backing-code-error regressions also passed. The host JIT with memory instrumentation has SHA-256 `043efee0448d3e61d78f5fb20dce4b59d6cc5a24e68a759f10531f63d6c1ed4c`.

The [single final combined C run](evidence/combined-final/summary.json) also passed actual exit zero, the exact four fields, native header/gas/canonical checks and repeated seed-negative/witness checks. Its Go peak is **2,097,676,288 bytes**, leaving **2,095.5 MiB** below the 4 GiB ceiling—311.5 MiB more headroom than A. The sealed guest SHA-256 is `8d18145460e5f4c649895728fa089a52a04ead2c3fa5e7d10789d72d7de42fbd`; the real C companion and input remain unchanged. No further variant was run.

The production lane owns the profile source changes and the next bounded interpreter run with the exact counter CLI. Selecting a diagnostic candidate does not accept that interpreter run, a one-step proof or a lifecycle that has not completed.

## What changed

Only the isolated **host JIT linker** changed. It instantiates the exact C companion, registers `gl3aot__execute` as the Go guest's `gl3aot.execute` import, and attaches Go memory after the Go instance exists. Four checked callbacks implement byte and little-endian word loads/stores into that Go memory. Missing memory and out-of-bounds accesses trap.

The companion also imports `fd_close`, `fd_seek` and `fd_write`. Those use the existing pinned Nitro WASI implementation with a **separate companion-memory environment**. No OS WASI is linked. C iovec pointers and `nwritten` therefore address C memory, while the four bridge callbacks address Go memory. The complete import inventory and pinned behavior hashes are saved with the evidence.

Three small cross-module tests passed: exact copying and memory separation, bounds/growth/traps and failed-store atomicity, and companion WASI buffer separation plus pinned error behavior. The initial import-gap attempts failed before guest execution and remain preserved.

## Exact inputs

| Artifact | SHA-256 |
|---|---|
| Unchanged C engine companion | `b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555` |
| Original captured input | `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90` |
| Failed control Go guest | `1edf3aa423444d55794c5347cba4b8f93f697981d69d99dd6439a7b18cd40670` |
| Scheduled candidate Go guest | `cb3e018ec606d1309f99eaf7c44aeffd5bfc46426ad82cbd802552641b093ac0` |
| Diagnostic JIT | `0d8a9c8ea7217bb6a6ed0bb551f57362f51c465805aded0e7208a0c63f946bfb` |

This lane did not modify either guest or the C engine. The production lane supplied the scheduled candidate; both sealed guest files and the common companion are checked before and after execution. Engine policy and strength were unchanged.

## Reproduction and separate host tool

All extraction, Rust installation, builds, ABI tests, hashing and execution run on the owned Runpod Linux worker under `/root/gl3-aot-jit`. Local work is editing, inspection and transfers only. The staged source bundle, isolated Rust **1.93.0**, unchanged `Cargo.lock`, verified Brotli source commit and exact host diffs are recorded. Builds use at most four workers.

Use `bootstrap-linux.py`, `apply-linker.py`, `build.py` and `replay.py` on the worker. The bridge is enabled by `GL3_AOT_COMPANION`; structured diagnostic state is written to `GL3_AOT_JIT_REPORT`. A missing companion import fails rather than replacing the engine.

A separately recorded prover CLI adds only `GL3_EXACT_FINAL_STEPS <count>` after its existing final-status log. Its binary is `/root/gl3-aot-jit/bin/prover-exact-final-steps`; the original `/root/prover`, prover-library math, guest bytes and proof roots remain unchanged. It built and passed `--help` and an actual [7-step tiny-WASM counter smoke](evidence/counter-cli-smoke/counter-smoke.json). That smoke executed no chess engine; the exact chess-terminal termination count has **not** yet been measured by the helper.
