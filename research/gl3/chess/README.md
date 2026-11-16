# Full-strength GL3 chess integration

Active research: integrate the full pinned Stockfish19 NNUE engine into a custom GL3 state transition and matching replay/prover. This is not a deployed chain or finished proof.

The strength policy stays fixed: complete98,511,183-byte network,24,000,000 nodes per decision, Hash128MiB, one worker, skill20, strength limiting off, MultiPV1 and retained TT/history between moves. The native and replay targets must match exact moves, actual node counts and canonical retained state. No weaker move may replace an unfinished search.

The implementation compiles a shared C++ engine into an in-process native library and a scalar Wasm companion for Nitro's WAVM prover. A canonical checkpoint explicitly serializes future-affecting logical state, omitting process pointers and architecture padding. The native node must restore authoritative chain state before each decision. The proof target must execute the engine instructions, not trust an external process or an operator-signed result.

The first implementation bounds a transition by the entire fixed24m search. Mid-search interruption aborts the transition and retries from the prior committed state; it never publishes a partial-strength decision. Further slicing must preserve the exact search and future state before it can be promoted.

Hardware direction: up to **USD100/month**, prioritizing sustained CPU performance and recovery over the cheapest shared VPS. No server purchase is authorized or performed by these local checks.

## Gates

- [ ] Full native/portable engine source and model identities pinned.
- [ ] Consecutive24m searches and retained checkpoints match across native and Wasm.
- [ ] Caller/job/policy/state binding and fail-closed recovery verified.
- [ ] Actual GL3 EVM calls execute the engine and commit its state.
- [ ] Matching custom node/replay/prover artifacts built.
- [ ] Full engine-bearing replay and proofs verified, including corruption rejection.

Build caches, binaries and model data remain ignored. Completed results will be appended to the [GL3 history](../HISTORY.md) as each gate passes.
