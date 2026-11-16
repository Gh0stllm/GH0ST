# Real local Nitro Stylus activation

The reviewed GH0ST tensor contract was activated through **ArbWasm in actual native Nitro v3.12.2**, using real Geth EVM and an in-memory ArbOS60 dev state. All twelve Solidity-encoded cases then ran through real Geth `StaticCall` and the native Stylus/Wasmer runtime, including expected reverts. No simulated `vm_hooks` were supplied.

This is a local integration test, not a booted chain, sequencer transaction, server deployment, settlement or fraud-proof test. The fixture uses artificial local balances and an explicit large local gas budget. No real funds or keys are used.

## Compatibility correction discovered

The original Rust release Wasm (25,401 bytes, SHA256 `50c3f59bb8bdbd6b6883835ce5caf24a58057e526ea3989d77403ad921db723c`) failed actual Nitro activation: the reference-types-disabled validator rejected a padded `call_indirect` table-zero encoding with `zero byte expected` at offset0x60e.

Nitro itself canonicalizes some compiled modules with a `wasm2wat`/`wat2wasm` roundtrip. Here the pinned wasmparser/wasm-encoder0.245.1 roundtrip canonically re-encodes the module without changing instruction semantics. The corrected artifact is **23,102 bytes**, SHA256 **`e15336947f6bc96a6e29c5eab5d0ad84ffb8d76422f03866115766d1173b5527`**. It is the artifact validated by this test; the original raw Rust output must not be described as successfully activated.

Actual local activation returned Stylus version3 and consumed **3,459,090 gas** in this particular dev-state call. This is not a complete deployment bill or production fee quote. All twelve cases passed, covering version, signed dot product, 256-lane extremes, positive/clamped linear output, first-index argmax ties, dimension/empty/oversized errors, overflow and unknown selector.

## Reproduce

First prepare the real native Nitro dependencies using the parent directory's `native-build.py`, and compile the sibling `l3/stylus` contract as its README describes. Then run:

```sh
python3 research/chess/l3/nitro/stylus-native/run.py
```

The runner builds a tiny pinned Rust canonicalizer, asserts both input/output hashes, copies this test into the ignored local Nitro source, and executes one test using actual runtime hooks. The generated module stays ignored. `result.json` gives case-by-case output and local gas use; `canonicalization.json` identifies the transformation.

Primary code: [Nitro activation](https://github.com/OffchainLabs/nitro/blob/v3.12.2/precompiles/ArbWasm.go), [real geth hooks](https://github.com/OffchainLabs/nitro/blob/v3.12.2/gethhook/geth-hook.go), [upstream canonicalization](https://github.com/OffchainLabs/nitro/blob/v3.12.2/scripts/remove_reference_types.sh).
