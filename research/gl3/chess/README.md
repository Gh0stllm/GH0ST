# Full-strength GL3 chess integration

**Native/Wasm parity and actual EVM dispatch passed.** Active research: integrate the full pinned Stockfish19 NNUE engine into a custom GL3 state transition and matching replay/prover. This is not a deployed chain or finished proof.

The strength policy stays fixed: complete98,511,183-byte network,24,000,000 nodes per decision, Hash128MiB, one worker, skill20, strength limiting off, MultiPV1 and retained TT/history between moves. The native and replay targets must match exact moves, actual node counts and canonical retained state. No weaker move may replace an unfinished search.

The implementation compiles a shared C++ engine into an in-process native library and a scalar Wasm companion for Nitro's WAVM prover. A canonical checkpoint explicitly serializes future-affecting logical state, omitting process pointers and architecture padding. The native node must restore authoritative chain state before each decision. The proof target must execute the engine instructions, not trust an external process or an operator-signed result.

The first implementation bounds a transition by the entire fixed24m search. Mid-search interruption aborts the transition and retries from the prior committed state; it never publishes a partial-strength decision. Further slicing must preserve the exact search and future state before it can be promoted.

Hardware direction: up to **USD100/month**, prioritizing sustained CPU performance and recovery over the cheapest shared VPS. No server purchase is authorized or performed by these local checks.

## Gates

- [x] Full native/portable engine source and model identities pinned.
- [x] Consecutive24m searches and retained checkpoints match across native and Wasm.
- [x] Caller/job/policy/state binding and fail-closed recovery verified.
- [x] Actual GL3 EVM calls execute the engine and commit its state.
- [x] Matching custom node/replay/prover artifacts built.
- [ ] Full engine-bearing replay and proofs verified, including corruption rejection.

Build caches, binaries and model data remain ignored. Completed results will be appended to the [GL3 history](../HISTORY.md) as each gate passes.

## Verified integration gates

| Path | Result | What this establishes |
| --- | --- | --- |
| Scalar native ↔ scalar Wasm |4/4 consecutive full24m decisions; exact moves, nodes, depths and all163,085,439 checkpoint bytes | Portable deterministic engine and retained state for these fixtures |
| Accelerated native |4/4 identical decisions/checkpoints,18.7–20.5s per decision on local M5 | Native vector acceleration preserved the tested results |
| Actual local EVM / ArbOS | Two consecutive full24m decisions,17.3–17.9s on the later run | Real precompile calls commit authoritative state; no external engine API |
| Failure/retry | Caller isolation, duplicate/stale/illegal input, full-model/state corruption, idempotent retry and one-gas-short rollback passed | OOG rolled back actual code pages, metadata and the entire trie root |
| Complete custom machine | Root`0xdc64c010de5e7a45fa4c83dde4e6d165ab0abf1a0f074e2ef2a086207edf3ebe` | Full Go replay and direct C++ engine link into a generated WAVM machine |

[Native/Wasm evidence](evidence/native-wasm-parity.json) · [Actual EVM evidence](evidence/actual-evm-dispatch.json) · [Machine artifacts](evidence/custom-machine-build.json)

Local timings exclude hosted CPU variation. Scalar Wasm JIT took188–222s per decision; this is separate from native move latency and from the still-unmeasured full WAVM proof execution. A complete generated machine is not a completed replay or fraud proof. The experimental A13 extension remains debug-only in an isolated custom profile. The clean standard core is untouched.

The fixed search used roughly32.6m prototype gas per EVM fixture. This is an unreviewed research tariff, not a public fee quote. A mined-block rehearsal explicitly reviews and records any custom gas limits. Full retained state is about155.5MiB per game, and historical storage growth still needs measurement.
