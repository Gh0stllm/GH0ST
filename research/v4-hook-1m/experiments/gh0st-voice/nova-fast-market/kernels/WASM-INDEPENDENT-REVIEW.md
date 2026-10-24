# Independent local WASM review

Status: **arithmetic/data prototype verified; production integration and gas unproven**.

The reviewed Rust source is `../stylus/wasm-kernel/src/lib.rs`, initially SHA-256 `d4251fb9da146f7ed2a8806babaacea35aa14d7e1b62d0e02b35a97f31faa186`. The local Node host is `../stylus/benchmark-wasm.mjs`, SHA-256 `3d33deddf1a3963dfcc93b0293ee3d8e8a39302fc4195b036211f79c59a1fa48`. The reviewed source now additionally includes a feature-gated fixed diagnostic meter entrypoint; its current SHA-256 is `bbe6f50adfb1deb6892fdf802c9f85749b9757bd70baf9cbf6beaaddc2d7b236`. The data checks remain independently bound to the selected model.

## Verified independently

`wasm-data-review.json` checks 4,573,189 raw quantized matrix/bias values against the selected `reference.npz`. All match. The feature/bias tail, fused inputs, activation/sampling tables and both vocabulary files match the selected export byte-for-byte. Six fused embedding rows and all five punctuation folds were also reconstructed directly from the reference matrices.

The checkpoint identity is `904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3`; the source reference archive hash is `9e7cfa1b40330a69fbc1b5278fafa51a151d9fcd94e8f12273f385a50b578c0d`.

`wasm-host-review.json` executes the exact local host function bodies with 31 valid/adversarial boundary cases. It verifies allowed virtual address kinds, canonical address bytes, shard boundaries, final-shard bounds, destination bounds, fixed Keccak input length and Keccak input/output bounds. Invalid requests reject before copying. These tests concern the Node fixture only.

## Integer semantics

The raw matrices are little-endian signed 16-bit values. Head biases are little-endian signed 32-bit. The retained feature tail is big-endian signed 16-bit, and fused values are big-endian signed 40-bit. The Rust readers match those formats.

Matrix accumulation uses `i64`; each division is signed integer truncation toward zero, matching the Solidity/EVM reference. The reset gate, update gate, candidate and final interpolation preserve the original operation order. All recurrent values stay within [-1024, 1024].

Even using full int16 weight bounds, a 384-cell recurrent dot product is at most 12,884,901,888 in magnitude. A six-feature sum is at most 805,306,368. Signed 40-bit fused inputs and these sums remain far below `i64` limits. The sigmoid index clamps to 256 before table access. The candidate and interpolation are bounded by their sigmoid outputs.

Sampling preserves maximum subtraction, temperature division, integer table indexing, big-endian exponent values, and the Keccak ABI layout for the supported seed/index domain. At most 128 weights of 2^32 sum to 2^39, so iterative 256-bit entropy reduction via a `u64` remainder is safe: each intermediate is below 2^47.

The data offsets cover exactly the expected matrix shapes: core matrices 3,456 × 384 values; group heads 128 × 772 bytes; selected word heads 64 × 772 bytes; five punctuation heads; five per-word punctuation biases. Input checks bound previous token, previous punctuation, temperature, hidden cells and features.

## Scope gaps that remain

- This is a dependency-free local WASM kernel, not an activated Stylus contract. A feature-gated fixed-seed diagnostic `user_entrypoint` now exists; it rejects nonempty calldata and reentrancy, starts from zero state with seed 42, uses a 32-word cap and returns packed token/punctuation words. A production pool entrypoint and canonical Solidity ABI wrapper remain absent.
- The virtual host addresses are fixture identifiers, not deployed catalog addresses. Production code/catalog commitments and immutable model identity checks still need implementation and tests.
- Initial input exports support the benchmark's 32-bit seed and zero-state reset. Full 32-byte seeds, arbitrary validated state and complete uint64 sequence-boundary behavior need a production interface.
- `sentence(max)` permits up to 64 words in this prototype, whereas the strict tested Solidity hook permits 32. A zero return marks absent terminal punctuation but does not roll back local WASM state. The production transaction wrapper must enforce the agreed cap and atomic failure semantics.
- Test inspection pointers expose local memory to the JS harness. They are not a safe public contract API.
- The process is single-threaded with mutable module memory. A production contract must bind recurrent state to the one authorized pool and restore it correctly for each call.

## Performance interpretation

The 20-word local run reads **3,994,342 bytes across 241 host calls**. Loading and authenticating that data, memory metering, host calls, Keccak, persistent state, the swap and the event all remain part of any real transaction budget.

The observed local WASM elapsed time excludes Stylus instruction/host metering, validation/activation, sequencer limits, consensus and PoolManager execution. It cannot establish a 700,000-gas sentence or 10 swaps per second. A metered local Stylus integration is required before making either claim.

The compact sentence hook removes per-word diagnostic events while retaining per-word decoding and chained state hashes. That avoids the previous diagnostic-event lower bound; it does not resolve or measure the WASM execution budget.

## Subsequent offline metering and selected kernel

The later official local Nitro meter results are in `../audit/official-stylus-meter.json`. The selected unroll32 variant is documented in `wasm-unroll/README.md` and `wasm-unroll/SUMMARY.json`. Under the pinned Stylus v3 / ArbOS 61 / 10,000 ink-per-gas scenario, its 20-word diagnostic uses 3,189,326 execution gas, plus separately modeled memory and cached invocation costs of 93,772 and 773 gas. The 16-seed sweep is in `../audit/official-stylus-best-seeds.json`.

This supersedes the earlier absence of instruction/host metering, but it does not establish production Robinhood configuration or full-swap gas. Actual model catalogs, canonical production ABI, pool state binding and end-to-end sentence transaction semantics still require implementation and validation. The 700,000-gas complete-sentence target remains unmet.
