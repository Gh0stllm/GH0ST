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

## Actual block and independent native replay

The local custom chain mined block9 with the full-strength decision and posted it in parent batch9. Its block hash is`0x7a9d39bf51bb0cafe01bf146dc1049a899523876d494b10f11720b7ce8deed87`, state root`0x9c50e9babdf18478c79f7d91cc646ba504ae3aa07fc2131708f57841cc24c4de`. A fresh native replay process using only the recorded batch/preimages reproduced the complete block hash, send root and inbox position. The block recorder also performed the full search and required the same canonical block hash.

[Local mined receipts](evidence/mined-block.json) · [Independent replay](evidence/native-replay.json) · [Early real Solidity witness verification](evidence/prefix-solidity-steps.json)

The local research profile explicitly set100m max transaction/block gas and a120s sequencing queue timeout. Full search took18.8s to receipt; complete independent native replay took21.8s. The whole interpreter replay is still running. Genesis model pages are imported from verified bytes before startup; no host file or external engine result is admitted during block execution.

## Reproduce the local research

1. Prepare the pinned full engine with `research/chess/engine/tools/fetch_sources.py` and `prepare_port.py`; install the pinned WASI SDK and native Nitro prerequisites described in the inherited research.
2. Run `python3 research/gl3/chess/engine/build.py --target both`, then `build_replay.py`. The current accelerated native target is macOS ARM; Linux CPU acceptance is a separate gate before hosting.
3. Run `prepare_test_bindings.mjs` for the actual upstream test utilities. The full-block test is `TestGL3ChessMinedBlockAndInputs` under the isolated Nitro `system_tests` package. It needs explicit `GL3_CHESS_MODEL`, `GL3_CHESS_BLOCK_EVIDENCE`, `GL3_CHESS_WASM_ROOT`, the pinned local Geth executable and the generated machine directory.
4. `native_replay.py` independently executes the recorded complete block and compares all global-state fields; `negative_replay.py` requires rejection of a missing authenticated parent header.
5. Run the real Rust prover on the generated `machine.v2.wavm.br` and recorded `input.json`, with `--require-success`. It must reach the expected complete end state, not merely finish initialization. `verify_steps.mjs` checks exported witnesses with real Solidity OSP contracts and rejects corrupt witnesses/pre-state hashes.

Caches contain the full network, binary artifacts and large replay inputs. They are intentionally ignored. Source, fixtures' identities, measured outputs and reproduction recipes are published; regenerated local parent timestamps can change block hashes, while the pinned chess checkpoint must still match.

## Actual search-loop proof witnesses

The pinned Solidity OSP accepted actual `Stockfish::Search::Worker::search` witnesses at steps119,733,151,745,122,111,322,114 and124,706,547,715, including arithmetic and memory transitions. Every altered pre-state/witness probe was rejected. The independent100b-step witness matches byte for byte across the two interpreter drivers. These are real search-loop proofs, separately labeled from the complete end-state replay that remains running.

[Verifier results](evidence/search-loop-solidity-steps.json) · [Actual witnesses](evidence/search-loop-witnesses.json) · [Bounded collection scope](evidence/search-loop-collection.json)

The diagnostic driver executes the same interpreter instructions and limits only witness collection and Merkle-hash concurrency. Its `--witnesses-only` mode makes partial coverage explicit. The first broad symbol filter caught `Worker::clear`; the corrected filter requires the actual search/qsearch function. No initializer witness is counted as search-loop evidence. The reviewed engine extension must be promoted separately from all development-only precompiles before any public launch.
