# Nitro execution integration

This is a working **local, debug-only** integration against pinned Nitro v3.12.2. Real Geth EVM calls now reach the complete reviewed TinyStories model through a custom ArbOS precompile, and the normalized Stylus contract activates and executes in the actual Nitro Stylus VM. The built node also boots in isolated loopback development mode and mines four local Stylus/Solidity transactions. No public chain, production activation or successful fraud-proof challenge is claimed.

## Verified execution

| Component | Actual check |
| --- | --- |
| Tensor primitive, `0xA11` | Native Nitro ABI dispatch, real Geth memory StateDB, metered ArbOS storage, caller isolation and rollback |
| Complete LLM, `0xA12` | Real Geth `CALL`/`STATICCALL` through the registered debug wrapper; 18 commits for one full token position; all 50,257 logits and final checkpoint match the native/WASI oracle |
| LLM backend equivalence | Interpreter and optional native compiler match outputs, checkpoint and measured fixture gas; separate two-position storage tests also match the complete Geth state root |
| Stylus | Actual ArbWasm activation and 12 real EVM ABI cases, including expected reverts; no mocked host hooks |
| WASI | Complete Nitro `precompiles` package, including both custom implementations and verified debug registrations, compiles to `wasip1/wasm` |
| Native node/replay | Complete `cmd/nitro` native binary and complete upstream `cmd/replay` WASI artifact compile with the debug overlays; no boot or proof challenge in this milestone |
| Native dependencies | Exact Rust 1.93.0 builds the pinned Wasmer/Brotli-based `libstylus.a`; real `arbitrator.h` generated with cbindgen 0.29.2 |

The full model has 3,745,984 pretrained parameters, eight transformer layers and all 50,257 vocabulary logits. Runtime SHA256 is `d7ebddffb302ab1ffe5a13edc2d06109d8375ab143bfa923d1af9e2c139052c5`; 4,401,034 weight bytes hash to `6dc6dd216d0c4b12b81b0844244423e53bb8d7e4c726b8e6205683708971ef1f`. The complete model is separate from the small tensor primitive and ordinary Stylus contract.

The ABI full-position fixture took 16.129 seconds with the default interpreter and 2.206 seconds with the optional native compiler on this machine. Both returned token 2402, logits SHA256 `44f7ac472b255db705be0be97f0ad9b820dd985530ac16fd3534363081b2787a`, and checkpoint `5972420b6f0fdc3fd42191dbb299e0dd8fafaeefca9023cf99db33c6d2da8f3a`. These are local timings, not a network latency promise.

`evidence/llm-abi-dispatch-{interpreter,native-compiler}.json` and their `-run.json` records include actual named test run/pass output. Checks cover static-call rejection, actual context caller ownership, stale generation, duplicate jobs, bounded work, append, absent/corrupt genesis data, debug-only gating and actual EVM out-of-gas rollback after writes. `evidence/llm-abi-backend-parity.json` compares both backends.

The independent two-position ArbOS-store fixture compares 100,514 logits over 36 commits. Both backends produce full Geth state root `0x80057c9f2b93dc8adc983db80f06341a1a675a81cec5e1a21a3ed9460d599c64`; see `evidence/arbos-backend-parity.json`. Backend selection does not enter job metadata or change storage gas.

## State and trust boundaries

The full LLM implementation and Solidity interface live in [the bridge overlay](../bridge/nitro-overlay/). `integration-build.py` copies these into the actual pinned Nitro package, applies both registration patches and verifies the resulting source. `SeedGhostLLMGenesis` accepts explicit reviewed runtime/model bytes at trusted genesis preparation; it is not an EVM upload method. A missing model fails closed. Jobs derive their owner from the actual precompile context. Weights, job metadata, checkpoints and logits persist in ArbOS storage; advancing a job creates fresh guest memory, hashes all stored model bytes and copies those verified bytes before privileged bootstrap. No network, filesystem, external inference process, clock or GPU participates inside the state transition.

The separate tensor primitive is a resumable int8 dot product with 4096-element registration and 1024-MAC step bounds. Its native tests cover seven chunk sizes, fresh store reconstruction, owner/input binding and failed atomic commits. Both custom addresses use Nitro's `debugOnly` wrapper. Standard EVM and Stylus limits remain enforced; no global SIMD or memory-limit change is hidden here.

The reviewed Stylus build requires normalization of LLVM padded LEB encoding. The raw 25,401-byte artifact failed actual Nitro parsing. The **activated normalized artifact** is 23,102 bytes, SHA256 `e15336947f6bc96a6e29c5eab5d0ad84ffb8d76422f03866115766d1173b5527`; activation consumed 3,459,090 gas in the local fixture. [Stylus native evidence](stylus-native/README.md) and the sibling normalized build pipeline record both identities.

## Remaining production gates

The LLM fixture deliberately grants 2 billion gas per call. One measured advance uses 245,844,125 gas, and all fixture calls including failure probes use about 10.09 billion gas, excluding genesis storage. These exceed ordinary transaction limits. Separate storage accounting measures 2,775,581,600 gas for model registration and 14,997,157,400 gas across the two-position test including rollback probes. Its system burner has no normal transaction cap; these figures are storage work measurements, not deploy/play fees or a full computation tariff.

A production path still needs authenticated immutable model pages seeded outside ordinary user calls, efficient checkpoint writes, reviewed computation pricing and explicit bounded transaction work. Reducing charged prices or silently raising limits would not prove safety or affordability. This integration has no public bulk model-upload ABI.

The complete native `cmd/nitro` binary for **darwin/arm64** and upstream `cmd/replay` WASI artifact are now built from this integrated source. A Linux/amd64 server binary/image is not built. The replay artifact is 33,485,567 bytes with SHA256 `55107e87a98a55aecbf459b668da9bbffd801673f6147c532af331201ab70982`; it has not been executed or converted into a matched prover machine. Exact main/legacy Solidity source produced real ABI and bytecode bindings; Safe artifacts were verified against pinned compiler input and output. Available NPM artifacts were not blindly reused because an actual production HostIo source mismatch was found. See `evidence/contract-source-compilation.json`, `evidence/native-node-build.json` and `evidence/complete-replay-build.json`. The node was booted only in isolated loopback development mode: four local transactions deployed and activated Stylus and called it from Solidity; twelve RPC ABI cases passed and the stored result was `-31`. A12 with absent genesis data failed closed. That boot does not seed or run the full model. No parent contracts were deployed, public transactions sent or fraudulent result challenged. See [the reproducible RPC check](dev-rpc/README.md). Production additionally needs a reviewed activation/genesis, matching complete node/replay/prover artifacts, whole-inference replay equivalence and an actual successful challenge against a deliberately incorrect computation. Package compilation alone does not establish those properties.

## Reproduce

From this directory, with the separate LLM fixtures built and the bridge module present:

```sh
python3 integration-build.py
python3 native-build.py --llm-abi
python3 native-build.py --reuse-build --full-model
python3 stylus-native/run.py
node dev-rpc/run.mjs
```

The first native command rebuilds pinned local dependencies; `--reuse-build` uses already prepared headers/libraries. `--llm-abi` runs both exact named ABI tests and requires their pass records, preventing a zero-test success from counting. `--full-model` additionally runs the separate two-position ArbOS-store fixture. All downloads and build outputs stay under ignored caches. No keys, paid services or financial actions are involved.

The native recipe requires actual Rust 1.93.0 (`RUST_TOOLCHAIN_BIN` can select it) and installs cbindgen locally. `cc_brotli` builds the exact pinned Brotli C sources without CMake. `bootstrap.py` supplies SHA-verified official Go 1.25.4; all Go runs set `GOTOOLCHAIN=local`.

Pins: Nitro v3.12.2 archive SHA256 `8dabf6d465b25b261333fc6225a1bcda06b59f8a8227ce7ecd8f0bbb6629af4c`; geth `30456d24d3cff444d3b0f246e9c7609477c7d4a1`; interfaces `7e88c8cc53c2e96201a23c638f1536557b9cb68b`. [Native dependency evidence](evidence/native-libraries.json) records exact Wasmer/Brotli pins and artifact hashes. Earlier failed attempts remain historical evidence, superseded by the successful native and WASI records.

Primary references: [pinned dispatch](https://github.com/OffchainLabs/nitro/blob/v3.12.2/precompiles/precompile.go), [gas context](https://github.com/OffchainLabs/nitro/blob/v3.12.2/precompiles/context.go), [ArbOS storage](https://github.com/OffchainLabs/nitro/blob/v3.12.2/arbos/storage/storage.go), [custom STF requirements](https://developer.arbitrum.io/launch-arbitrum-chain/extend-the-protocol/stf).
