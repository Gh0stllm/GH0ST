# Stylus contract compatibility probe

This is a real Rust contract compiled with **Stylus SDK 0.10.10**, plus a Solidity interface and caller. Its bounded signed-integer tensor operations provide a small compatibility target for GH0ST L3. The normalized build has passed actual native Nitro activation and twelve real EVM calls in local in-memory ArbOS state. This does not establish a booted chain, public deployment or complete LLM.

The contract exposes `kernelVersion`, `dotProduct`, `linearRelu` and `argmax` through the Solidity ABI. Vectors are limited to 256 lanes, mismatched/empty/oversized inputs revert, signed arithmetic is exact, linear addition checks overflow and argmax ties choose the first index. There is no external model service, network call, file read or uncommitted inference state.

## Verified locally

- Four native integer-kernel tests pass.
- The actual compiled Wasm `user_entrypoint` passes twelve Solidity-encoded ABI cases in Wasmtime, including revert cases. Only six explicit simulated `vm_hooks` are supplied; unexpected imports fail.
- Wasmtime validates the module with SIMD and relaxed SIMD disabled.
- Raw Rust output is 25,401 bytes. **Canonical re-encoding is required**: LLVM's padded `call_indirect` table-zero encoding fails the reference-types-disabled Nitro parser. The pinned wasmparser/wasm-encoder 0.245.1 re-encoder produces a 23,102-byte module with unchanged instruction semantics. The actual Nitro test accepted this artifact, compressed to 8,875 bytes.
- Solidity 0.8.30 compiles the interface/caller, and all four interface selectors agree with the ABI used against the Wasm.

Raw Wasm SHA256: `50c3f59bb8bdbd6b6883835ce5caf24a58057e526ea3989d77403ad921db723c`. Activated canonical Wasm SHA256: `e15336947f6bc96a6e29c5eab5d0ad84ffb8d76422f03866115766d1173b5527`.

`evidence/wasm-abi.json` and `wasm-abi-canonical.json` use simulated host hooks. Separate [actual native Nitro evidence](../nitro/stylus-native/README.md) uses real ArbWasm activation and Geth `StaticCall`, with no mocked hooks: all twelve cases pass. Activation consumed 3,459,090 gas in that local development fixture; it is not a mainnet quote. No sequencer transaction, booted node, full fraud challenge or twenty-game benchmark is established.

## Reproduce

Run in this directory with Rust 1.99.1, `wasm32-unknown-unknown`, and the committed Cargo lockfile:

```sh
cargo test --locked
cargo build --locked --release --target wasm32-unknown-unknown
python3 build_normalized.py
node tests/abi-cases.mjs
../../engine/.cache/venv/bin/python tests/wasm_abi.py
../../engine/.cache/venv/bin/python tests/wasm_abi.py --wasm target/gh0st_stylus_kernel.canonical.wasm --out evidence/wasm-abi-canonical.json
node tests/compile-solidity.mjs
```

The Node scripts use the existing `research/chess` dependencies. The Python script needs Wasmtime; the current test used the project's existing engine virtual environment. `evidence/wasm-abi.json` records its package version. Artifacts stay in ignored `target/`; the source/lockfile and hashes are committed. Run from this directory so Cargo reads `.cargo/config.toml` and its explicit feature/memory settings.

## Integration still required

Boot a local GH0ST node, submit real sequencer transactions, execute the Solidity caller against it, and exercise the matching proving path before claiming deployed chain support. The native activation test already covers the pinned parser/host on its local fixture. Ordinary Stylus's code, memory and SIMD constraints still apply. A large model needs the separate custom deterministic runtime; these small fixed-point kernels do not remove those constraints.

Primary references: [Stylus Rust SDK source](https://github.com/OffchainLabs/stylus-sdk-rs), [pinned crate source](https://docs.rs/crate/stylus-sdk/0.10.10/source/Cargo.toml), [Stylus overview](https://docs.arbitrum.io/stylus/gentle-introduction), [custom execution and proving requirements](https://developer.arbitrum.io/launch-arbitrum-chain/extend-the-protocol/stf).

No transaction, deployment, server rental or paid action is performed by these scripts.
