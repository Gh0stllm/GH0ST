# Exact Stockfish continuation experiment

**Test-only prototype, verified across real local PocketIC update calls. No public deployment, production game adapter, entry fee, treasury action or signing path is enabled.** The ordinary synchronous engine in the parent directory is unchanged.

This module pauses and resumes one complete Stockfish 19 fixed-node search across ICP messages. It preserves the recursive search, full official NNUE network, transposition table, histories and accumulated nodes. It does not restart a smaller search on every call or replace the model. The search still uses full skill and one worker.

## Actual local ICP evidence

| Complete search | Updates | Final result, exactly matching native | Total ICP instructions | Largest update |
|---|---:|---|---:|---:|
| 1m nodes, White start | 50 | `e2e4`, 1,000,324 nodes, depth 23 | 61,238,557,794 | 6,446,937,664 |
| 1m nodes, Black after `1.e4` | 50 | `e7e5`, 1,000,071 nodes, depth 23 | 56,213,407,856 | 6,424,866,423 |
| 1m nodes, Kiwipete | 50 | `d5e6`, 1,000,534 nodes, depth 20 | 58,140,412,017 | 6,449,424,917 |
| 3m nodes, Black after `1.e4` | 30 | `e7e5`, 3,000,212 nodes, depth 28 | 147,201,702,476 | 10,361,296,288 |

The 1m cases yield about every 20k nodes; the 3m case yields about every 100k nodes. Upstream stop-check intervals cause small node overshoot. Each row is one uninterrupted logical search resumed across separate replicated updates, with ordinary Candid decoding/reply activity between calls. Every individual call stayed below ICP's 40 billion instruction ceiling, while each complete search exceeded it in aggregate. Counters are sampled before final response encoding.

See the complete [1m per-call records](evidence/pocketic-1m-evidence.json), [3m per-call records](evidence/pocketic-3m-evidence.json), and [native/Wasmtime comparisons](evidence/wasmtime-evidence.json). These are local execution tests, not public-chain receipts, measured mainnet latency, an Elo rating, or a guarantee about every legal position. The independent small [recursive fixture](../../../protocol/asyncify-fixture/evidence.json) separately exercises stack canaries, address-taken locals, indirect callback captures, destructors and an unsafe shared-stack negative control.

## Module and identity

Tested module: **102,984,786 bytes (98.214 MiB)**, SHA-256 `f37127fa26859386344d02d3786705f97b86f2330879f17c532c612df00a81ee`. Code section: 3,909,882 bytes. Only `ic0` imports remain; no Asyncify host import or off-chain inference service remains. Both code and total module fit ICP's limits. [Artifact inspection](evidence/artifact.json).

Stockfish and NNUE pins are inherited from the parent [source lock](../../source-lock.json): commit `edb0d9db6731067ec50ce619ff372b463bc4dd5d`, full 98,511,183-byte network SHA-256 `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2`. Every original NNUE byte was verified in the transformed module's initial linear memory.

## Exact continuation boundary

[runtime.cpp](runtime.cpp) owns copied FEN/history and output buffers in persistent globals. A noinline engine thunk executes on its own reserved, aligned eight-MiB C++ linear-memory stack. Binaryen Asyncify stores Wasm locals/call indices in a separate four-MiB spill area. Both ranges have guard bytes.

[stack-switch.s](stack-switch.s) saves the host C stack pointer in a Wasm local, pivots to the engine stack, calls the thunk, then restores the host pointer. The yield leaf records the **suspended** engine stack pointer before starting unwind. Advance rewinds using that suspended pointer; resetting it to the original stack top corrupts live LLVM stack frames and is deliberately avoided. The runtime stops unwind before any Candid reply or ordinary message cleanup.

The build adds one yield checkpoint to `SearchManager::check_time` after its existing periodic check. The node budget itself stays at the complete 1m or 3m target. No TT reset, new `go`, strength change or position reset occurs on advance. The Asyncify pass leaves its runtime/trampoline uninstrumented, uses the exact `asyncify-removelist` option, and retains indirect-call instrumentation. IC system imports cannot initiate Asyncify transitions; only the recognized internal Asyncify runtime does so.

The design and known hazards were independently reviewed in [asyncify-review.md](../../../protocol/docs/asyncify-review.md). The review of this implementation found no additional critical stack/reply/lifetime flaw in the tested sequential scope. That is not a production audit.

## Rebuild and reproduce

Use the parent engine's pinned local environment/toolchains. From the parent engine directory:

```sh
.cache/venv/bin/python continuation/experiment/build.py
.cache/venv/bin/python continuation/experiment/verify_wasmtime.py
.cache/venv/bin/python continuation/experiment/test_pocketic.py
.cache/venv/bin/python continuation/experiment/test_pocketic.py --nodes 3000000 --quantum 100000 --positions 1 --output pocketic-3m-evidence.json
```

The build copies this source into ignored `.cache/asyncify-engine/`, applies the small checkpoint change to an isolated search-source copy, compiles with the parent pinned WASI/icpp toolchain, then applies Binaryen 116 Asyncify. It does not edit the baseline source or replace its artifact. The transformed module remains ignored. [Same-workspace rebuild evidence](evidence/rebuild.json) records the published build's comparison with the tested hash.

[prototype.did](prototype.did) documents the experimental extra wire methods. The compiled module retains the baseline Candid metadata; tests call the additional exported experimental methods with explicit wire types. The only accepted prototype caller is a fixed synthetic principal used by the local harness. The tests use three fixed position IDs; this is not an arbitrary-game service.

## Production gates still closed

- No durable multi-game engine queue or capacity reservation exists. The module has one shared Stockfish job. Paid entry must reserve capacity before acceptance; a concurrent game must not convert an ordinary busy queue into a service-fault refund.
- No immutable request/job identity, expected-step journal, duplicate-call cache, completion acknowledgement or retry-safe state machine exists. Repeating advance can advance twice. Tests issue valid sequential calls only.
- The inherited synchronous `search` export must not interleave with a paused job: it shares the singleton and can corrupt continuation state. A production module must remove or gate it and every other engine mutation.
- No cancellation unwind, recovery/reset, upgrade-while-pending policy, stable abort journal or refund adapter exists. Never reuse continuation bytes after changing the code layout.
- No production authority adapter consumes Pending/advance replies or binds them to a paid game's committed configuration. The experiment's input/caller controls are intentionally unsuitable for paid use.
- Broader position/quantum/fault/repetition/stack-depth testing, instruction headroom calibration and an independent production audit remain necessary. The shown maximum step is an observed result, not a universal bound.

These gates are separate from the verified mechanism: actual full-network Stockfish can now resume exactly beyond one ICP message's instruction budget. Financial settlement and public deployment remain outside this experiment.

License: GPL-3.0-or-later, with upstream licenses and notices retained in the parent engine package.
