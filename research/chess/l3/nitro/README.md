# Nitro deterministic tensor integration experiment

This lane contains working bounded integer-kernel code and a concrete **debug-only** precompile overlay against Nitro v3.12.2. It is not a booted chain, complete LLM, activated precompile or matching fraud prover.

## What works locally

The portable Go package registers an immutable SHA256-addressed int8 test vector, creates caller-scoped jobs, and resumes exact dot-product computation over bounded chunks. Every weight, input, cursor and accumulator is stored through a word-keyed store; no process-global cache, network, filesystem, clock or external inference process participates in the computation. The demo registration bound is4096 elements and each step is limited to1024 multiply-accumulates. Those are test bounds, not a claim of large-model support.

The complete Nitro `precompiles` package, including the overlay, now successfully builds on the upstream replay compilation target `GOOS=wasip1 GOARCH=wasm`. This is actual typechecking against the real pinned Nitro packages, not a stub fixture.

Native Go tests compare4096-element results across seven different chunk sizes, recreate the backing store between chunks, test caller/input binding, reject reused jobs/invalid budgets, verify failed atomic commits do not advance state, and ensure state cannot leak between stores. The same package cross-compiles to Go's `wasip1/wasm` target. That package build is not a Nitro prover module.

The Solidity0.8.30 interface compiles and its four function signatures/mutabilities match the ABI embedded in the Go overlay. No EVM call was executed.

## Nitro adapter

`overlay/precompiles/ArbGhostTensor.go` uses actual pinned Nitro APIs: precompile `Context`, `Burn`, `State.BackingStorage`, metered ArbOS `Storage.Get/Set`, and the ordinary ABI dispatch helper. Its state lives in the `GH0ST_TENSOR_V1` ArbOS substorage namespace. Caller identity comes from the precompile context, not user-supplied owner bytes. Any failed write must return its error to the EVM caller so the entire call rolls back.

`register-debug-only.patch` applies cleanly to the pinned `precompiles/precompile.go` and registers the proposed0xA11 test address through Nitro's `debugOnly` wrapper. This is deliberately unavailable on a normal production chain. The patch does not raise standard Stylus code/memory limits or enable SIMD. Its provisional computation charges have not been benchmarked and are not a fee quote.

The overlay is a tensor primitive, **not a call into the separate TinyStories LLM runtime**. Connecting that runtime requires a defined deterministic operator/state ABI, paged immutable model roots, exact checkpoint persistence, full replay equivalence and matched proving semantics.

## Provenance and limits

`evidence/source-check.json` records the source archive and exact upstream file hashes and successful patch applicability/API-declaration checks. `evidence/native-tests.jsonl` contains actual native Go test output. `evidence/abi.json` records Solidity ABI compilation/parity. `evidence/nitro-build-attempt.json` records the initial build failure. `evidence/nitro-build-exact-geth.json`, `evidence/nitro-build-generated-abi.json` and `evidence/nitro-wasm-package-build.json` record the dependency followthrough, native-header block and actual successful Wasm-package compilation.

Exact pinned go-ethereum submodule `30456d24d3cff444d3b0f246e9c7609477c7d4a1` and precompile-interface submodule `7e88c8cc53c2e96201a23c638f1536557b9cb68b` were fetched. All19 interfaces were compiled with the existing Solidity compiler, then the original upstream `solgen/gen.go` generated the real Go bindings. The complete `precompiles` package including this overlay builds successfully to the upstream WASI/Wasm target.

The native package build still fails at missing `arbitrator.h` and the matching native `libstylus` build. No node was booted and no complete replay/prover or fraud-proof execution is claimed. Package compilation does not test ABI dispatch at runtime, EVM rollback, chain storage, or an actual LLM call.

A subsequent bounded native-library attempt used the installed Rust1.99.1 compiler (upstream requests1.93.0). The offline attempt reported uncached `ruint2`; the online attempt then failed at the absent pinned Wasmer submodule `crates/tools/wasmer/lib/api`. The source archive also lacks the Brotli C submodule and no `cbindgen` binary is installed. Upstream's `cc_brotli` feature can avoid a separate CMake build but still requires the pinned C sources. No unsupported-Darwin conclusion was reached. The native library/header remain unbuilt, and both attempts terminated without leaving a runner. See `evidence/native-stylus-feasibility.json` and `evidence/native-stylus-online-attempt.json`.

Before any production chain: compile the complete pinned node and replay/prover from the same source; assign a reviewed custom activation version/genesis; meter model uploads and every state operation; reject a deliberately incorrect result through a real local fraud-proof challenge; compare whole inference checkpoints across node/replay/prover; then measure real gas, latency and operating costs. None of those gates is represented by a checksum or a documentation checkbox.

## Reproduce

From this directory:

```sh
python3 bootstrap.py
.cache/go/bin/go test -C portable -count=1 -v ./...
GOOS=wasip1 GOARCH=wasm .cache/go/bin/go build -C portable ./...
python3 check-source.py
node compile-abi.mjs
python3 integration-build.py
```

`bootstrap.py` downloads public pinned source and a SHA-verified official Go1.25.4 toolchain into ignored `.cache/`. The ABI check uses the existing chess project's pinned `solc` dependency. No keys, paid services, server provisioning or mainnet calls are involved.

Primary references: [pinned precompile dispatch](https://github.com/OffchainLabs/nitro/blob/v3.12.2/precompiles/precompile.go), [context and gas](https://github.com/OffchainLabs/nitro/blob/v3.12.2/precompiles/context.go), [ArbOS storage](https://github.com/OffchainLabs/nitro/blob/v3.12.2/arbos/storage/storage.go), [custom state-transition/prover requirements](https://developer.arbitrum.io/launch-arbitrum-chain/extend-the-protocol/stf).
