# GH0ST Stockfish 19 engine lane

Status: **real ICP-compatible Wasm built and executed in local PocketIC; no public canister deployed and paid entry must remain closed.** The engine uses Stockfish 19's complete official NNUE network, full skill, and deterministic fixed-node search. This is not an Elo measurement or an unbeatable-bot claim.

## What is pinned

- Stockfish release `sf_19`, commit `edb0d9db6731067ec50ce619ff372b463bc4dd5d`.
- Full `nn-1a298aa575a0.nnue`: **98,511,183 bytes**, SHA-256 `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2`.
- `Threads=1`, `Skill Level=20`, `UCI_LimitStrength=false`, `MultiPV=1`, no pondering, no Syzygy files. TT and search histories are cleared once for each independent decision. The complete initial FEN and UCI move history are provided to preserve repetition awareness.
- The full network is embedded in the module, not downloaded by an off-chain decision server. Every NNUE byte was reconstructed and verified in the module's initial linear memory.
- The official explicit SSE-to-Wasm SIMD path uses unchanged, hash-pinned Emscripten compatibility headers with WASI SDK 25. Relaxed SIMD is not enabled. Native versus ICP move/node/depth equality was checked across the position cases below.

Source and compiler inputs are in [source-lock.json](source-lock.json). Upstream engine source, network, toolchains, Python environment and binaries are deliberately ignored under `.cache/` and `build/`. The public files contain pins, runtime patches, licenses, build commands and evidence.

## Measured result

The current synchronous canister artifact is **101,257,329 bytes (96.567 MiB)**, SHA-256 `062dd9eb4bcba1e028168e48e42053fcad40b3b7e9bdb63dd6deb8edd8f2e3e3`. Its code section and total module fit ICP's 12 MiB and 100 MiB limits, and all remaining imports are IC system API imports. See [the module inspection](evidence/wasm-artifact.json).

| Build/search | Local ICP instruction count | Result |
|---|---:|---|
| Scalar, 10k nodes, start warm | 5.441 billion | completes |
| Plain compiler SIMD, 10k nodes, start warm | 5.534 billion | completes, no useful reduction |
| Explicit SSE/Wasm SIMD, 10k nodes, start warm | 0.855 billion | completes; about 6.4x fewer instructions in this one comparison |
| Explicit SIMD, 100k nodes, start cold | 9.435 billion | completes |
| Explicit SIMD, 250k nodes, Kiwipete cold | 16.156 billion | completes |
| Explicit SIMD, 500k nodes, Kiwipete cold | 28.022 billion | completes |
| Explicit SIMD, 500k nodes, upstream high-threat stress position cold | 32.452 billion | completes |
| Explicit SIMD, 500k nodes, start cold | 29.804 billion | completes on the previous wrapper artifact |
| Explicit SIMD, 500k nodes, Ruy Lopez with full history | 24.382 billion | completes |
| Explicit SIMD, 1m nodes, start cold | reaches the 40 billion message ceiling | traps; never substitutes a smaller search |

These are local PocketIC execution counters, not public-chain receipts or mainnet latency. Counters are sampled immediately before final response encoding. The first search includes NNUE/worker initialization; later searches retain initialized network memory but clear TT and search histories. **500k is a tested candidate, not a demonstrated worst-case bound for every legal position.**

The final-wrapper suite ran seven position cases at each of 250k and 500k nodes: cold tactical middlegame, warm start, Ruy Lopez history/castling, Kiwipete, mate, promotion, and a pawn endgame. All fourteen executions matched the native upstream build exactly in best move, actual nodes and completed depth; wrong callers were rejected at both budgets. [Final execution evidence](evidence/pocketic-sse-simd-final-verification.json). Separate [native verification](evidence/native-verification.json) covers repeated warm reuse, invalid FEN/history, already checkmated positions and stalemate.

An additional [upstream threat stress suite](evidence/pocketic-threat-stress-verification.json) tested two positions deliberately containing many changed threats at both budgets, followed by start/history rechecks. All eight searches matched the native reference exactly; both caller checks passed. The largest measured cold call was **32.452 billion instructions at 500k nodes**, leaving less headroom than the ordinary opening samples. This still does not prove an instruction bound for every legal position.

The [Black-side suite](evidence/pocketic-black-flow-verification.json) also verifies the intended opponent role: after a human's `1.e4` from cold initialization, a Black tactical middlegame, and an odd-ply opening history. All three Black results match native moves/nodes/depth at 500k nodes. The cold reply to `1.e4` is `e7e5` at 500,098 nodes/depth 20 and 27.869 billion instructions.

Stockfish checks node exhaustion periodically, so actual nodes may slightly exceed the requested budget. A legal search may instead exhaust its maximum iterative depth: the pinned source has `MAX_PLY=246`, so completed depth 245 is a valid terminal reason. The canister emits `node_budget` only when actual nodes meet the request, or `max_depth` only for positive nodes at depth 245. Any other unexplained early stop returns a fault.

## Boundary with game authority

[engine.did](src/engine.did) defines the real Candid API. A dedicated Rust game authority calls this C++ engine canister by authenticated replicated update. The engine receives an immutable job/configuration ID, initial FEN, complete move list, node budget and hash size. It echoes IDs, engine/net identity, best move, actual nodes, depth, stop reason and instructions. Only the authority principal pinned at installation may search; request node/hash/configuration must exactly match the deployment configuration.

Installation and post-upgrade arguments are `(authority_text, config_hash_blob32, fixed_nodes_nat64, fixed_hash_mb_nat32)`. There are no default production values or public strength controls. The game authority independently validates legality and handles an engine trap as a service fault/refund. The engine itself holds no GH0ST tokens and cannot settle the prize.

The portable C ABI is declared in [gh0st_engine.h](include/gh0st_engine.h). The full-history function is required for real games; a current FEN alone does not encode prior repetitions. The current engine is synchronous; retries can recompute the same deterministic search, and the authority remains responsible for exactly-once game transitions.

## Rebuild locally

Use Python 3.13.18 in a project-local virtual environment and install `requirements-build-lock.txt`. Then, from this directory:

```sh
.cache/venv/bin/python tools/icpp_local.py install-wasi-sdk
.cache/venv/bin/python tools/icpp_local.py install-rust
.cache/venv/bin/python tools/build_wasm.py
.cache/venv/bin/python tools/inspect_wasm.py
.cache/venv/bin/python tools/build_native.py
.cache/venv/bin/python tools/build_native.py --port
.cache/venv/bin/python tools/verify_native.py
```

The toolchain wrapper rebases icpp's paths into `.cache/toolchain/` without changing `HOME`, global Rust or an active ICP identity. `fetch_sources.py` verifies the release commit, every network byte and every SIMD header hash before compilation. `prepare_port.py` emits [the exact source patch](patches/single-worker.patch). Search and NNUE evaluation algorithms remain upstream; the patch changes scheduling, clock use, unused platform dependencies, and embedding syntax.

To reproduce local ICP execution, place the official PocketIC 16.1.0 binary at `.cache/pocket-ic`, matching the release checksum recorded in `source-lock.json`, then run:

```sh
.cache/venv/bin/python tools/test_pocketic.py --budgets 250000,500000 --cold-tactical --extended --output pocketic-sse-simd-final-verification.json
```

The harness starts and stops its own local server, creates isolated canisters with artificial cycles, performs chunked installation, and never reads a production identity or funds an on-chain canister. It verifies successful responses against a native upstream reference. Native wall time is recorded for engineering purposes only.

## Remaining gates

Before paid use: complete full authority-to-engine local integration, broaden worst-case instruction calibration with ample headroom, verify timeout/refund behavior, commit the final fixed configuration, and audit the escrow/prize bridge separately. Public deployment, cycles funding and paid activation have not occurred.

A separate [test-only continuation experiment](continuation/experiment/README.md) now proves exact full Stockfish searches across actual local ICP update calls: three 1m-node cases across 50 updates each, and a 3m-node Black response across 30 updates. The latter completes 3,000,212 nodes at depth 28, exactly matching native, using 147.202 billion instructions in aggregate and at most 10.361 billion in one update. It preserves the original recursive search and full NNUE rather than restarting smaller searches. The baseline artifact above is unchanged.

That experiment is not a production service. Durable multi-game capacity/queue handling, immutable job/step IDs, retry idempotency, cancellation/upgrade recovery, removal or gating of competing engine mutations, and the paid-game authority adapter remain required. Its explicit source, limits and actual per-call evidence are separate from the synchronous baseline. Paid entry stays closed.

## Upstream sources and licenses

[Official Stockfish 19 release](https://github.com/official-stockfish/Stockfish/releases/tag/sf_19), [pinned source](https://github.com/official-stockfish/Stockfish/tree/edb0d9db6731067ec50ce619ff372b463bc4dd5d), [ICP resource limits](https://docs.internetcomputer.org/references/resource-limits/), [ICP SIMD support](https://docs.internetcomputer.org/guides/canister-management/optimization/), [icpp installation](https://docs.icpp.world/installation.html).

Stockfish and this engine integration are GPL-3.0-or-later; see [the full license](LICENSE-STOCKFISH-GPL3.txt) and [authors](STOCKFISH-AUTHORS.txt). Emscripten compatibility-header license alternatives are preserved in [LICENSE-EMSCRIPTEN.txt](LICENSE-EMSCRIPTEN.txt). Redistribution of a deployed modified engine must retain notices and provide the corresponding buildable source and patch inputs.
