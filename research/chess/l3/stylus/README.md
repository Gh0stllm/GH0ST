# Stylus contract compatibility probe

This is a real Rust contract compiled with **Stylus SDK 0.10.10**, plus a Solidity interface and caller. Its bounded signed-integer tensor operations provide a small compatibility target for GH0ST L3. It is not a complete LLM, a deployed Stylus program, or an activated Nitro chain.

The contract exposes `kernelVersion`, `dotProduct`, `linearRelu` and `argmax` through the Solidity ABI. Vectors are limited to 256 lanes, mismatched/empty/oversized inputs revert, signed arithmetic is exact, linear addition checks overflow and argmax ties choose the first index. There is no external model service, network call, file read or uncommitted inference state.

## Verified locally

- Four native integer-kernel tests pass.
- The actual compiled Wasm `user_entrypoint` passes twelve Solidity-encoded ABI cases in Wasmtime, including revert cases. Only six explicit simulated `vm_hooks` are supplied; unexpected imports fail.
- Wasmtime validates the module with SIMD and relaxed SIMD disabled.
- The release Wasm is 25,401 bytes, below the ordinary 256 KiB decompressed limit and even below the 96 KiB compressed ceiling before compression. Size alone does not prove Stylus activation compatibility.
- Solidity 0.8.30 compiles the interface/caller, and all four interface selectors agree with the ABI used against the Wasm.

Wasm SHA256: `50c3f59bb8bdbd6b6883835ce5caf24a58057e526ea3989d77403ad921db723c`.

`evidence/wasm-abi.json`, `native-tests.json` and `solidity-compile.json` give the exact scopes. These are **local runtime and ABI tests**, not Nitro activation, ink/gas metering, fraud proofs, a cross-language on-chain transaction, or a twenty-game benchmark. The host simulator supplies zero message value and no reentrancy; it is not a security substitute for ArbOS.

## Reproduce

Run in this directory with Rust 1.99.1, `wasm32-unknown-unknown`, and the committed Cargo lockfile:

```sh
cargo test --locked
cargo build --locked --release --target wasm32-unknown-unknown
node tests/abi-cases.mjs
../../engine/.cache/venv/bin/python tests/wasm_abi.py
node tests/compile-solidity.mjs
```

The Node scripts use the existing `research/chess` dependencies. The Python script needs Wasmtime; the current test used the project's existing engine virtual environment. `evidence/wasm-abi.json` records its package version. Artifacts stay in ignored `target/`; the source/lockfile and hashes are committed. Run from this directory so Cargo reads `.cargo/config.toml` and its explicit feature/memory settings.

## Integration still required

Activate/check this contract on a real local GH0ST Nitro instance, verify the actual Stylus parser/host/metering, execute the Solidity caller against it, and exercise the matching proving path before claiming chain support. Ordinary Stylus's code, memory and SIMD constraints still apply. A large model needs the separate custom deterministic runtime; these small fixed-point kernels do not remove those constraints.

Primary references: [Stylus Rust SDK source](https://github.com/OffchainLabs/stylus-sdk-rs), [pinned crate source](https://docs.rs/crate/stylus-sdk/0.10.10/source/Cargo.toml), [Stylus overview](https://docs.arbitrum.io/stylus/gentle-introduction), [custom execution and proving requirements](https://developer.arbitrum.io/launch-arbitrum-chain/extend-the-protocol/stf).

No transaction, deployment, server rental or paid action is performed by these scripts.
