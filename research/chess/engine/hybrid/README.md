# Retained 24m ICP engine for the hybrid game

This lane implements the production-target chess engine API for the ICP brain / Robinhood game coordinator. It has an **immutable 24,000,000-node budget**, full Stockfish 19 skill, the complete official NNUE, one worker, 128 MiB Hash and a 100k-node continuation quantum. There is no client budget/strength setting and no weaker fallback.

The code is locally tested. Public deployment, funding, coordinator signing, canonical Robinhood state validation and paid activation are separate gates owned by the coordinator/game lanes. One successful search is not an Elo rating or a guarantee that no challenger can win.

## Artifact

Release Wasm: `engine/.cache/hybrid-engine/engine.asyncify.wasm`.

- SHA-256: `4ed393570169b4a068182031c59acdc8171238205b720e57d8f0915a1e5d252e`
- Size: **103,080,772 bytes**, within ICP's 100 MiB limit.
- Stockfish commit: `edb0d9db6731067ec50ce619ff372b463bc4dd5d`.
- Full NNUE SHA-256: `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2`; every NNUE byte is verified in the module's initial memory.
- Only `ic0` imports remain. The inherited synchronous `search` and all synthetic prototype methods are absent. The test journal-seeding endpoint is excluded from the release build.

[Artifact inspection](evidence/artifact.json), [Candid API](engine.did), [adapter](adapter.cpp), [runtime](runtime.cpp).

## Reservation, history and caller binding

Installation arguments are `(coordinator: principal, config_hash: blob32)`. The configured coordinator is the only caller allowed to reserve, begin, advance, read replicated progress or release. There is no hardcoded synthetic production principal or runtime configuration setter. Canister controllers retain the normal IC ability to upgrade/reinstall; that trust remains explicit.

`reserve_game(game_id)` acquires the engine's single retained-game slot before the first bot search, after the coordinator verifies the paid native game. Repeating the same reservation does not clear the cache. A different game receives `Busy`. The reservation remains held between bot decisions until the coordinator acknowledges canonical RH terminal settlement with `release_game`.

A Job contains `game_id`, `position_hash`, `ply`, `initial_fen`, and the complete UCI move list. The engine checks encoding, FEN/move legality through Stockfish, and `ply == moves.len()`. After the first completed decision, the next request must contain the same initial FEN and exactly:

```
previous searched history + previous bot best move + one new human move
```

Ply advances by two. Jumps, changed initial FEN, branches and an altered previous bot move are rejected. The coordinator independently verifies the position commitment against canonical Robinhood native game state; the engine binds that supplied commitment but does not fetch RH RPC itself.

Hash is assigned only if it differs from 128 during explicit new-game setup. Both repeated per-search Hash assignment and per-search `search_clear` are absent: repeating the same Hash option value would still clear upstream's TT. TT and worker histories therefore remain owned by the one reserved game. The first job after a new reservation starts from cleared game state.

## Job IDs and exact retry behavior

The engine derives the job ID as SHA-256 of:

```
"GH0ST_ENGINE_JOB_V1"
+ length-prefixed config_hash
+ length-prefixed game_id
+ length-prefixed position_hash
+ little-endian u32 ply
+ length-prefixed initial_fen
+ little-endian u32 move_count
+ each length-prefixed UCI move
```

Each length prefix is little-endian u32. The coordinator stores the returned engine job ID separately from its own RH/transcript job ID.

- First `begin` commits step 1. Repeating the identical Job returns the **original first reply**, byte-identically, even after later steps or completion.
- Reusing the same game/ply with different bound input returns `ConflictingJob`.
- `advance(job_id, expected_step=N)` executes only when N is the current pending step. It commits and returns step N+1.
- Retrying an already executed advance returns its cached step N+1 without running the search twice. Future/zero steps fail without mutation.
- `read_progress` is a replicated update for inter-canister uncertainty recovery; `get_result` is the equivalent query. They return the latest committed reply. The coordinator must recover progress before choosing another step after an uncertain call.
- `get_info` is a replicated read with identity, configuration, reservation and `cycle_balance:nat`; public query `status` exposes the same nonsensitive operational fields.

Completed results require the full node budget, or the pinned Stockfish maximum completed depth 245 with positive work. Other unexplained stops become `Faulted`, never a weaker successful move. The coordinator must reject faulted results for signing.

## Durable journal and release/upgrade behavior

A checksummed, bounded binary journal in the IC WASI stable filesystem stores the pinned caller/configuration, reservation, exact requests and cached step replies. Journal writes and the corresponding engine step commit in one replicated update. A trap rolls the update back to the previous committed checkpoint.

The journal does **not** pretend to serialize a recursive engine stack or retained TT across a code upgrade. Post-upgrade, any still-reserved game is explicitly faulted with `upgrade_lost_retained_engine_state`. A pending job gains a durable Faulted reply. Original cached BEGIN/step replies remain available for audit/retry until terminal release; no suspended job is silently initialized again.

`release_game` is coordinator-only. If a search is paused, it requests stop and rewinds to unwind safely, marks the unfinished result as a fault and never publishes its partial best move. After canonical terminal acknowledgement it prunes that game's reply journal, clears reservation/current job **and active fault flags**, and records the closed game ID. This allows a fresh game to be admitted after a refund/upgrade incident. A closed game cannot begin or reserve again. No controller-only public bypass releases an arbitrary live game.

Bounds: one game; at most 512 jobs per game, 1,024 moves per request, 256 cached replies per job, 128 MiB journal snapshot, and 4,096 closed game IDs. Search admission fails if durable capacity is unavailable; a paid game that cannot be served remains eligible for its native bot-timeout refund. The launch readiness check and maintenance policy must account for these bounds. Closed-ID archival maintenance is required before that explicit lifetime bound is reached.

## Actual local verification

A complete immutable24m search from a non-default initial FEN (Black after `1.e4`, empty relative move list) completed across **240 actual PocketIC updates**, exactly matching a fresh optimized native reference:

```
bestmove e7e5
nodes    24,000,033
depth    38
```

Sampled instructions summed to **1,235,356,558,692**; the largest sampled step was **6,452,044,129**. The measured local cycle debit over the search interval was **1,237,795,678,347 cycles**. That interval includes the test's duplicate/recovery API calls and excludes initial reservation/model setup. Counters sample before journal persistence/reply encoding; cycle debits include those costs.

[Full24m evidence](evidence/pocketic-full24m-pre-release-cleanup.json) records the module before the small terminal-release fault-flag cleanup (`29a582…64414`). The engine/search code and budget are unchanged in the current artifact. [Current release API regression](evidence/pocketic-api.json) separately verifies the cleanup, including healthy admission after cancellation/upgrade release. Final coordinator-to-RH/signing integration is recorded by the hybrid-brain lane.

The full test passed 25 authorization, capacity, arbitrary-input, exact-retry, conflicting-job, retained-history, cancellation and upgrade checks. The current release's targeted API regression passed 21 checks, including byte-identical cached replies across upgrade and fault flags cleared after release.

A separate test-only build seeds a conservative journal volume: **512 jobs × 256 cached replies × 1,024 moves per job**, then executes real engine begin/advance updates. Both updates completed under PocketIC's 40B instruction enforcement. Full cycle debits including journal rewrite and reply were **7,300,567,382** and **7,075,683,253 cycles**; sampled pre-persist engine instructions were **4,970,731,729** and **4,739,672,373**. [Volume evidence](evidence/pocketic-volume.json). This is a bounded volume/position test, not a universal instruction-bound proof for every legal chess position.

All balances are artificial local cycles, not a paid mainnet bill. No transfer, public deployment, funding or ECDSA signing occurs in this engine test harness.

## Rebuild and test

Use the parent engine's pinned environment/toolchains and sources. From the repository root:

```sh
research/chess/engine/.cache/venv/bin/python research/chess/engine/hybrid/build.py
research/chess/engine/.cache/venv/bin/python research/chess/engine/hybrid/inspect_artifact.py
research/chess/engine/.cache/venv/bin/python research/chess/engine/hybrid/test_pocketic.py --quick
# Complete fixed24m reference test, when needed:
research/chess/engine/.cache/venv/bin/python research/chess/engine/hybrid/test_pocketic.py
# Isolated journal-volume instrumentation, never the release artifact:
research/chess/engine/.cache/venv/bin/python research/chess/engine/hybrid/build.py --volume-test
research/chess/engine/.cache/venv/bin/python research/chess/engine/hybrid/test_volume.py --quick
```

Build output is ignored under `.cache/hybrid-engine/`; the volume variant uses `.cache/hybrid-volume/`. Shared upstream/native/baseline sources and artifacts are read-only inputs. Source and build fingerprints are in [source-hashes.json](evidence/source-hashes.json). Parent GPL and upstream compatibility-header licenses apply.
