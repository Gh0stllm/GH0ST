# Retained game cache: isolated ICP experiment

**Four consecutive Black decisions and an explicit new-game reset passed on local PocketIC. This is a test-only policy-equivalence result. No paid path, public canister, signing, funds, production multi-game cache or complete ICP game is implemented.** The original synchronous/continuation modules, shared Stockfish sources and optimized native binary are unchanged.

The experiment preserves Black's own transposition table (TT) and worker histories between decisions within one isolated game. Every decision still receives the complete initial FEN and UCI move history, runs Stockfish 19 at full skill with the complete pinned NNUE, uses one worker and 128 MiB Hash, and searches a full 3m-node budget across update calls. An explicit new-game boundary clears TT/worker state.

## What actually passed

Inputs are the first four consecutive Black decisions from the completed native Larsen game in [inputs.json](inputs.json), with the source game JSON hash recorded there. A fresh, isolated optimized upstream native process first reproduced the saved game's move, actual nodes and depth while retaining its cache. The isolated ICP module then matched both references exactly:

| Black decision | Move | Actual nodes | Depth | ICP updates | Local cycles debited for search |
|---|---|---:|---:|---:|---:|
| Ply 2, after `1.b3` | `e7e5` | 3,000,559 | 26 | 30 | 150,777,396,772 |
| Ply 4 | `b8c6` | 3,000,325 | 26 | 30 | 149,741,478,404 |
| Ply 6 | `d7d5` | 3,000,319 | 28 | 30 | 137,596,514,427 |
| Ply 8 | `f8d6` | 3,000,560 | 27 | 30 | 127,137,064,013 |
| After explicit second-game reset, repeat ply 2 | `e7e5` | 3,000,559 | 26 | 30 | 150,779,922,847 |

Ply 8 is the first move divergence from the previous cleared-cache line: the retained policy produces `...Bd6` rather than `...e4`, matching the saved retained native candidate. It is therefore a meaningful check that the changed policy reaches ICP, rather than a comparison of only the initially empty-cache response.

The second-game reset reproduced the original first response exactly in move, node count and depth. Unauthorized reset was rejected. [Actual local ICP per-update/cycle/memory evidence](evidence/pocketic-retained.json), [fresh native reference and reset](evidence/native-reference.json).

All searches used a 100k-node yield quantum. The largest sampled update among the four consecutive decisions was **6,136,571,028 instructions**, below the 40 billion single-message limit. The complete searches still run to their full 3m-node target. Local wall times depend on this test machine and concurrent work and are not mainnet latency estimates.

## State and billing observations

The first explicit new-game initialization, including initial network/engine preparation, debited **5,523,184,545 local cycles**. The second new-game reset, with the NNUE already resident, debited **252,870,380 local cycles**. Installation is recorded separately in the evidence. Search cycle totals above exclude these explicit setup/reset calls.

After initialization and every decision, measured total canister memory stayed at **637,713,252 bytes (608.171 MiB)**; Wasm linear memory stayed at **467,533,824 bytes (445.875 MiB)**. The weights remain resident across decisions and the reset. These are artificial local PocketIC balance debits and memory observations, not a paid deployment bill or a guaranteed billing schedule. Currency conversions are separate from these measured cycle counts.

## The Hash reset trap is explicitly avoided

`Option::operator=` invokes its change callback even when a Hash assignment repeats the same value. `set_tt_size` then resizes/clears the TT. Removing only `search_clear` would therefore fail to retain the cache.

[retained_adapter.cpp](retained_adapter.cpp) removes **both** per-search Hash assignment and per-search `search_clear`. It requires the fixed 128 MiB configuration during a search. `gh0st_stockfish_new_game` assigns Hash only if its current value differs from 128, then clears the game state at that explicit boundary. The exact adapter change is in [retained-adapter.patch](retained-adapter.patch). Full move history is supplied on every decision independently of the retained heuristic cache.

The runtime permits one active search and sequentially selects the four frozen histories. New-game reset is rejected while a continuation is active. It accepts the same fixed synthetic local-test principal as the earlier experiment. This is not a public arbitrary-game API.

## Module and inputs

Module SHA-256: `78c44df3d4258a3e9d9fc644d68cc099645c46f35c9241828ad57e92ce7d23bd`; size **102,991,378 bytes (98.220 MiB)**. Only IC system imports remain. The complete official NNUE bytes were verified in initial linear memory. [Artifact identity](evidence/artifact.json).

Stockfish commit: `edb0d9db6731067ec50ce619ff372b463bc4dd5d`; NNUE SHA-256: `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2`. The full compiler/model pins and licenses remain in the parent engine package. [Source hashes and unchanged baseline/native artifact hashes](evidence/source-hashes.json).

With the existing pinned local environment/toolchain prepared, run from the chess workspace:

```sh
research/chess/engine/.cache/venv/bin/python research/chess/engine/continuation/retained-experiment/build.py
research/chess/engine/.cache/venv/bin/python research/chess/engine/continuation/retained-experiment/native_reference.py
research/chess/engine/.cache/venv/bin/python research/chess/engine/continuation/retained-experiment/test_pocketic.py
```

Build outputs/configuration are isolated under `engine/.cache/retained-engine/`. The build reads shared pinned source/toolchain inputs without regenerating or editing them. The test owns and stops its local PocketIC server and uses artificial cycles. No production identity is read.

## Limits of this result

This verifies the changed cache policy for four consecutive replayed positions and a reset. It does not replay the complete native drawn game on ICP, show an unbeatable engine, or establish a universal repair for the earlier checkmate. The full-game native strength experiments have separate evidence and limitations.

The prototype inherits the earlier experiment's production blockers: no durable multi-game capacity reservation/queue, per-game cache partition or safe interleaving, retry-safe job/step journal, completion cache, cancellation unwind, upgrade recovery or paid-game authority adapter. The inherited synchronous `search` export must not interleave with an active retained continuation. Cache ownership must remain explicit before any production adoption; results from different games must not share one mutable engine silently.

License: GPL-3.0-or-later, with upstream notices preserved in the parent package.
