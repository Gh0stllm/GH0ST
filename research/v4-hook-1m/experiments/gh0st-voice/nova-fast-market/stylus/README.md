# N0VA exact WASM backend research

This is a local WASM research prototype with exact numerical tests and a separate official offline Nitro meter. It is not a deployed Stylus contract, a production hook, or a demonstrated 10-swaps-per-second system. The Node tests below are unmetered; the Nitro report measures execution and host-I/O gas under explicit chain-parameter scenarios, excluding the complete v4 transaction.

## Result

The sentence tests start from zero hidden state and BOS, with fixed features. They do not test continuation of an existing story or guarantee a new sentence for every arbitrary context. Sixteen seeds are evaluated; this is not an exhaustive uniqueness guarantee.

The unchanged 8,175,493-parameter Q10 model was ported to a dependency-free Rust/WASM kernel. All 502 generated words across 32 sentences match the independent Python reference exactly, including every token, punctuation choice, all 768 hidden-state values and all 197 branch logits after every word. Sixteen additional vectors cover extreme and mixed hidden states, feature limits and all supported temperature scales. Ten invalid-input cases reject.

The WASM artifact is 8,197 bytes and its memory occupies 3,932,160 bytes. On this computer, a complete 20-word sentence took about 10–11 ms in Node's unmetered WASM runtime, including the local JavaScript code-data and Keccak adapters. That timing excludes Stylus instrumentation, node/consensus work, transaction fees, v4 swaps and hook checks. It cannot be converted into gas or claimed as chain throughput.

The main change is architectural: roughly 2.67 MB of exact recurrent weights are copied once into WASM memory per sentence, then reused for all its words. Selected lexical heads and fused token inputs are loaded as needed. A 20-word case made 241 code-read calls and copied 3,994,342 bytes. All weights remain in the simulated immutable on-chain code store; the JavaScript adapter substitutes only for host I/O in this local test.

Evidence: `wasm-results.json`, `wasm-probe-results.json`, `wasm-kernel/src/lib.rs`, `export-raw.py`, `benchmark-wasm.mjs` and `test-probes.mjs`.

## Official local gas evidence

[The offline Nitro report](../audit/official-stylus-meter.json) uses the upstream Nitro v3.12.1 instruction meter and native host implementation. It records a 20-word sentence at 10,001,077 execution gas for the raw kernel and 4,968,343 for packed3 under its 24 KB maximum-code-size scenario. The corresponding 96 KB scenarios are 10,507,177 and 5,571,043 gas. These figures include charged code accesses; initial-memory charges, invocation overhead and the whole v4 hook/swap transaction are separately identified or excluded. The frozen compute candidate is the 32-way unrolled packed3 kernel. For the same 20-word sentence it measures 3,189,326 execution gas in the 24 KB scenario and 3,792,026 in the 96 KB scenario, before the separately identified initial-memory/invocation/full-swap costs. The unchanged model and exact numerical outputs are retained.

This is a real instrumented runtime measurement, but it is not a Robinhood receipt. Chain configuration has not been checked by RPC. The complete sentence still exceeds the 700,000-gas budget implied by a 7M gas/second scenario at ten swaps per second.

## Robinhood compatibility evidence

Robinhood's official [protocol-contract list](https://docs.robinhood.com/chain/protocol-contracts/) includes `ArbWasm` at `0x71` and `ArbWasmCache` at `0x72`. Its [node guide](https://docs.robinhood.com/chain/run-a-full-node/) says the chain runs ArbOS 61. This is meaningful evidence that Stylus infrastructure exists. It does not establish current program activation permissions, per-chain prices, resource settings, or measured performance. No chain RPC was queried.

Arbitrum documents [EVM/WASM interoperability](https://docs.arbitrum.io/stylus) and [code-read/Keccak host operations](https://developer.arbitrum.io/stylus/advanced/hostio-exports). A Solidity v4 hook can in principle call a WASM model through a validated ABI and retain its existing pool binding and strict failure policy.

## What is still missing

- **Actual Stylus gas measurement.** Docker/Nitro and cargo-stylus were not initially installed. The official Rust 1.91 compiler and `wasm32-unknown-unknown` target have now been installed only under `toolchain/`; the kernel builds offline. The separate official offline Nitro meter report records compute and host-I/O measurements. Full v4 swap overhead and live chain configuration remain outside that benchmark.
- **Production host bindings.** The current code-data addresses are fixture IDs resolved by the local adapter. They must be replaced with pinned immutable catalogs and their exact model/code commitments.
- **Production ABI and state handling.** The exported methods are numerical test functions, including memory inspection pointers. They do not provide a Solidity ABI, preserve on-chain story state, enforce pool access, or implement transaction-level rollback. A zero result from the bounded `sentence` function means no terminal was found; the production entrypoint/hook must revert that trade. It must not publish the partial output.
- **Activation lifecycle.** Stylus programs require reactivation after a configured expiry or upgrade. [Arbitrum's introduction](https://developer.arbitrum.io/stylus/gentle-introduction) describes a default 365-day period. This creates a liveness dependency for a strict hook: expired inference would stop trading. Any deployment design needs permissionless keepalive, expiration monitoring and explicit expiry tests. The prototype has none of these yet.

The existing token, pool binding, LP lock, slippage checks and fail-closed inference policy have not been changed by this experiment. The WASM backend has not been integrated with them.

## Reproduction

Run `export-raw.py` with the research Python environment, build `wasm-kernel/Cargo.toml` in release mode for `wasm32-unknown-unknown`, then run `benchmark-wasm.mjs`. The compiler uses the local `CARGO_HOME` and `RUSTUP_HOME` beneath `toolchain/`; it does not require changing the system PATH. `make-probes.py` and `test-probes.mjs` reproduce the additional numerical and rejection tests.

Only official Rust distribution downloads were used for the compiler installation. No private keys, chain endpoints, transactions or public deployments are needed for these tests.

### Reproduce both frozen WASM variants

From this directory, run `./reproduce-local.sh`. It performs only local file reads, compilation and numerical tests. The script uses the project-local Rust installation, never contacts a chain RPC, and never signs or submits a transaction. `NODE_BINARY` and `PYTHON_BINARY` may override the documented local runtime paths.

`BUILD-MANIFEST.json` binds source hashes, compiled WASM hashes and test-report hashes. Small compiled artifacts are copied to `artifacts/`; downloaded toolchains, large generated model bytes and build caches are ignored. The raw and packed3 arithmetic candidates remain separate. See `PACKED3.md` for the latter's exactness proof and I/O tradeoff.

The optional `meter-entrypoint` feature adds a fixed-seed `user_entrypoint` for an isolated Stylus runtime experiment. It rejects nonempty calldata/reentrancy and returns failure if a terminal is not reached. It emits 80 little-endian token/punctuation bytes for the seed-42 sentence. This benchmark wrapper is not a Solidity ABI or a production model adapter.

A separate `meter-seed-entrypoint` feature accepts exactly four big-endian seed bytes for the 16-seed gas distribution. It preserves the same temperature/features and all numerical semantics; `packed3-seed-entry-parity.json` verifies the complete output identifiers and final state for seeds 42–57.

The frozen unroll32 sources and reproduction scripts are under `../kernels/wasm-unroll/`. `BUILD-MANIFEST.json` binds both its fixed-seed and four-byte-seed artifacts, and copies the compiled WASM into this folder’s `artifacts/`. The finite seed experiment resets from zero/BOS and is not a continuous-story test.
