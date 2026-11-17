# Stylus and unchanged LLM validity proofs

**Status: source audit and integration design. The existing ethrex EVM proofs do not prove Stylus, and no new Stylus or full-LLM validity proof is accepted.** Frozen EVM guests and prior benchmark evidence remain unchanged.

The user has prioritized the base ZK chain, RPC, explorer and GH0ST bridge before LLM support. The current execution lane therefore targets an ordinary EVM transfer through the canonical ArbOS STF. Full Stylus and unchanged-model inference remain later acceptance gates; the model is not being reduced to meet this change in order.

## What the existing artifacts actually do

| Artifact | Verified scope | Missing for this request |
|---|---|---|
| The current ethrex/SP1 EVM guest | Ethereum EVM execution | ArbOS dispatch, Stylus activation/instrumentation, WASM execution, ink/gas and EVM host calls |
| GH0ST Stylus tensor contract | Actual Nitro activation and twelve kernel ABI cases | Complete transformer inference |
| GH0ST TinyStories runtime | Complete existing 3,745,984-parameter INT8/Q12 variant, all eight layers and 50,257 logits; canonical state and KV | Ordinary Stylus `user_entrypoint`/ABI, authenticated model/state persistence and a validity proof |

The TinyStories artifact is the existing 39,300-byte WASM, SHA `d7ebddffb302ab1ffe5a13edc2d06109d8375ab143bfa923d1af9e2c139052c5`. Model data is 4,401,034 bytes, SHA `6dc6dd216d0c4b12b81b0844244423e53bb8d7e4c726b8e6205683708971ef1f`. Its established arithmetic and 64-token context must remain unchanged. INT8/Q12 was already the model variant; it is not FP32 identity. No smaller model, fewer layers, vocabulary truncation or shorter supported context is proposed.

Source: [existing model/runtime boundary](../../../chess/l3/llm/README.md), [actual Stylus kernel activation](../../../chess/l3/nitro/stylus-native/README.md).

## Official Nitro research is relevant, but not a ready feature switch

Arbitrum's August 2026 update describes proving its real STF and Stylus in SP1, while identifying inbox and production integration work still ahead. That is an upstream research direction, rather than evidence that our pinned EVM guest supports Stylus. [Official update](https://blog.arbitrum.io/zk-settlement-is-coming/).

The pinned Nitro 3.12.2 source, commit `5f02f3f03076343061f167e81b8e82ec5518064b`, has SP1 scaffolding. Its replay guest currently prints a mocked validation result rather than executing the STF. It must not be selected as an accepted validation guest. [Exact guest](https://github.com/OffchainLabs/nitro/blob/5f02f3f03076343061f167e81b8e82ec5518064b/crates/sp1/replay-program/src/main.rs).

The more complete branch is `zk-prove-any/sp1-runner`, pinned to `62f0625ad9bdb4e1ff42f08688429fc33618f181`. It runs the Go replay STF and Stylus through a Wasmer RV64 environment inside SP1. Its own README describes an executor showcase, not a completed production validity system. [Pinned instructions](https://github.com/OffchainLabs/nitro/blob/62f0625ad9bdb4e1ff42f08688429fc33618f181/crates/sp1/README.md).

The audit found concrete acceptance gaps:

- The host accepts supplied RV64 module artifacts by module-hash lookup and passes them to an unsafe Wasmer deserializer. The inspected path does not recursively verify a compiler proof binding those exact bytes to authenticated WASM code, module hash and instrumentation settings.
- The compiler program commits its generated binary, but the runner shown here only executes that compiler with `MinimalExecutor`; execution alone is not a recursive validity proof.
- `activate_v2` is unimplemented; `program_prepare` is a no-op. Full activation semantics are therefore not established by the shown runtime.
- Its SP1/toolchain differs from the working GL3 EVM benchmark: SP1 git `be6ebfe1412e4f7b2175cd767f60bf67dec67ac5`, RV64, Rust 1.93 and LLVM 21, rather than the current SP1 v5/RV32 pipeline.

These findings are pinned in [source-pins.json](source-pins.json). Primary files: [module loading](https://github.com/OffchainLabs/nitro/blob/62f0625ad9bdb4e1ff42f08688429fc33618f181/crates/sp1/program/src/replay.rs), [activation gap](https://github.com/OffchainLabs/nitro/blob/62f0625ad9bdb4e1ff42f08688429fc33618f181/crates/sp1/program/src/imports/programs.rs), [host compiler execution](https://github.com/OffchainLabs/nitro/blob/62f0625ad9bdb4e1ff42f08688429fc33618f181/crates/sp1/runner/main.rs).

Nitro's pinned source is BSL. Non-production research is distinct from production authorization; selecting this implementation does not silently remove the existing license decision. No license was accepted. [Pinned license](https://github.com/OffchainLabs/nitro/blob/62f0625ad9bdb4e1ff42f08688429fc33618f181/LICENSE.md).

## Two honest implementation routes

**Portable canonical interpreter — selected research route.** Compile Nitro's existing WAVM `prover::Machine` with JIT dependencies disabled into a zkVM guest. The crate currently bundles its interpreter entrypoint/helpers with the `native` feature, so disabling defaults alone removes `step_n`. The isolated experiment adds a `portable-interpreter` compile gate around the original executor/helpers without changing their opcode bodies. Its RV32 target typecheck, actual ELF link and bounded CPU guest execution passed. The missing RV32 Brotli C libraries were cross-compiled from the pinned canonical source, with a standard C allocation ABI supplied by Rust; decompression was not stubbed. [Build and source evidence](portable-probe/linked-profile/linked-manifest.json).

The first guest parses a tiny arithmetic WASM inside SP1, executes the canonical WAVM instructions and checks `12 + 7 = 19`. Actual exit was zero: 5,701,891 zkVM instructions, 0.155383 seconds of guest execution, 2.759854 seconds of setup and 1.814 GB sampled owned RSS. This establishes interpreter portability only. It does not execute ArbOS, a Stylus transaction, Brotli decompression or the LLM, and it generates no proof. The guest emitted the SDK's insecure RNG warning; its report used no unconstrained execution or hints. That warning and the exact report are retained rather than treated as a cryptographic acceptance result. [Execution receipt](portable-probe/execution/actual/result.json), [source and artifact identities](portable-probe/execution/manifest.json).

Parse and instrument the actual WASM inside the proved computation, execute the actual replay STF and Stylus programs, and authenticate every input/preimage. This avoids trusting an external compiler's AOT result. It preserves a clear connection to the canonical VM, but nested interpretation may be too expensive. A bounded execution/cycle screen must precede any full inference/proof claim. Relevant APIs are `Machine::from_binaries`, `add_program`, `set_global_state` and the compile-gated `step_n`. [Pinned interpreter](https://github.com/OffchainLabs/nitro/blob/5f02f3f03076343061f167e81b8e82ec5518064b/crates/prover/src/machine.rs).

**Proved AOT compilation and replay.** Harden the upstream RV64 path with a compiler proof that commits the authenticated WASM identity, Stylus version, instrumentation/debug settings and exact AOT bytes. The replay proof must verify that compiler proof before executing an artifact. It must also implement activation, authenticated input/state loading and public post-state commitments. This offers a better execution architecture, but is substantial integration work and requires a separately pinned complete proof/verifier stack.

A standalone proof of our raw LLM WASM is a useful independent milestone. It is **not** full Stylus/ArbOS compatibility and cannot close the requested feature. A signature, external inference result or oracle is not an execution proof.

See [the binding and acceptance plan](integration-plan.md). All work runs on Runpod. No new full STF, Stylus or LLM proof has been launched; cloud scheduling is coordinated with the other memory-heavy proof lanes. The compiler is pinned separately to the official `succinct-1.93.0-64bit` release, while this initial portability probe retains the SP1 v5 RV32 guest ABI and existing CPU host. The measured arithmetic execution establishes this narrow combination works; it does not establish compatibility for the entire STF.
