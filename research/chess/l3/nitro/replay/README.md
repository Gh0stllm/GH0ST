# Experimental replay machine

This preserved research lane belongs to the later custom LLM phase. The initial L3 will use the standard production Nitro/Stylus path with debug precompiles disabled; this custom machine is not its proposed production root.

The native pinned prover tool builds on darwin/arm64. All eight upstream companion modules now compile: forward, soft-float, wasi_stub, host_io, user_host, arbcompress, arbcrypto and program_exec. Exact Rust 1.93.0 standard libraries and Nitro's pinned SoftFloat source were fetched into task-local caches. The cached WASI SDK compiles the pinned C sources without a global CMake or Docker installation.

The complete current replay Wasm is compiled with the validated transaction-local dirty-store integration, normalized and linked with those companions. Actual `prover --generate-binaries` succeeds, generating a WAVM binary, until-host-IO state and module root `0x8ebe7b0dfc015b942a24dd9c7251eb4d34fa1dfd71f36131946b3172d01a28bb`. The raw Go replay build hashes to `3e8b176d7a72bd488f129efb6c458f7c6b85dd3725438b789b38f4f49647cce7`; pinned reencoding produces machine-input hash `a9aaed2af02aa994075f0f6d62e591aee7f9d36ff004fec1c6cbae9c6af16e72`. These are explicitly different bytes in the recorded raw-to-normalized build pipeline. This is an experimental custom module root, not an official upstream production root.

Three additional filesystem imports linked by Go/Wazero were absent from Nitro's minimal WASI stub. [The patch](wasi-deny-io.patch) exports exactly their actual signatures and unconditionally executes `unreachable`. It never returns fake success or provides filesystem, network, clock or model data. Any attempted call is rejected. The reviewed model guest itself imports nothing and is never given WASI capabilities.

Machine generation is stronger than package compilation but does not execute a full inference, replay a model-bearing block, or challenge a fraudulent result. Those remain explicit later gates. Further embedded-model diagnostics were deferred when the user chose to build the base L3 first.

To reproduce after the exact native source build and complete `cmd/replay` build are prepared:

```sh
python3 replay/fetch-deps.py
python3 replay/build-c-libs.py
python3 replay/build-rust-libs.py
python3 replay/generate-machine.py
```

The scripts use the existing cached Rust 1.93.0 and WASI SDK installations, clone any needed Rust extension into their own cache, and preserve exact pins. `generate-machine.py` uses the pinned canonicalizer from the real Stylus activation recipe. It records machine identity and leaves inference/challenge flags false. No model weights, generated node/prover binaries or replay machine binaries are committed.

[evidence/complete-replay-machine.json](../evidence/complete-replay-machine.json) records the final root and artifact hashes. [Dependency closure](../evidence/replay-dependency-closure.json), [native tool build](../evidence/native-prover-tool-build.json) and [final source builds](../evidence/final-source-artifact-rebuilds.json) distinguish compilation, machine generation and unperformed proof execution.
