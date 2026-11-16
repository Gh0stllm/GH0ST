# Wasm capability preflight

`check_wasm.py` decodes core Wasm sections, imports, declared memory and instruction immediates. It detects SIMD/relaxed SIMD, atomics/shared memory, memory64, floats, tail calls and reference features. Data bytes and integer immediates are not searched as raw opcode strings. Unsupported encodings, truncated sections and duplicate/out-of-order sections fail closed.

The checker is a **conservative preflight, not the Nitro validator, Stylus activation, ABI validation or a fraud prover**. Standard-library inspection is structural; an optional installed Wasmtime backend additionally validates generic Wasm static types. Every assessment reports `deploymentReady:false`. Brotli is optional and its unavailability blocks the compressed-size check. The 96 KiB compressed budget is a four-fragment size screening target; exact fragment headers/packing and chain settings still need activation checks.

## Profiles

- `stylus_v3_arbos60`: source-backed ordinary Stylus v3 / ArbOS60 defaults: 256 KiB decompressed module budget, approximately 96 KiB compressed four-fragment budget, 128 initial memory pages, no SIMD, threads, memory64 or reference instructions, and expected `vm_hooks` imports / `user_entrypoint`. **Floating point is enabled in the pinned Nitro parser** and is not blanket-rejected here. The 8 MiB bound is initial compiler memory, not a universal immutable runtime memory ceiling.
- `large_runtime_target`: an unimplemented design target for integer-only execution with paged committed weights, bounded module/initial-memory sizes and deterministic `gh0st_state` imports. Passing these constraints does **not** establish an installed VM, large-model support, matching replay or fraud proofs. SIMD remains disabled until its complete deterministic/proving path exists.

The profile does not approve external I/O imports, such as WASI filesystem/network calls or ICP host functions. Data/state pages require a separately implemented, metered and authenticated runtime API.

## Actual existing engine inspection

`stockfish-report.json` inspects the unchanged 103,089,852-byte ICP engine, SHA256 `725dc0c795262be21f1ffafec60f50aae3e9d00140add77e791a89eece0f417b`. Generic Wasmtime validation passed. The decoder observed 5,495 function bodies, 3,275 exports, SIMD, float instructions/types, ICP-specific host imports, and 1,847 initial memory pages. Ordinary Stylus correctly rejects this artifact for multiple independent reasons. The module contains about 98.8 MB of data; increasing only a size knob is not a compatible port.

The current module is valid ICP Wasm; its rejection is a target-runtime compatibility result, not a claim that the engine itself is malformed. Its file/model bytes and the selected search strength are unchanged.

## Reproduce

```sh
python3 -m unittest discover -s research/chess/l3/compatibility -p 'test_*.py' -v
research/chess/engine/.cache/venv/bin/python research/chess/l3/compatibility/check_wasm.py \
  research/chess/engine/.cache/optimized-engine/engine.asyncify.wasm \
  --out research/chess/l3/compatibility/stockfish-report.json
```

The actual-engine command intentionally exits2 for incompatibility. Its Wasmtime backend comes from the existing local engine virtual environment. Optional Brotli1.1.0 was installed only in this directory's ignored `.cache/deps`; no global package or live service changed. Modules already above the decompressed Stylus limit skip expensive compression because raw size already rejects them.

Twelve bounded fixture tests cover structural corruption, false SIMD detections in data/immediates, real SIMD, float policy differences, memory64/shared memory, initial-memory versus later-growth limits, forbidden host I/O, unknown instructions and raw module size.

## Pinned primary sources

`sources.json` pins SHA256 hashes of four official Nitro v3.12.2 source files:

- [Parser feature flags and user limits](https://github.com/OffchainLabs/nitro/blob/v3.12.2/crates/prover/src/binary.rs)
- [Compile memory and pricing configuration](https://github.com/OffchainLabs/nitro/blob/v3.12.2/crates/prover/src/programs/config.rs)
- [ArbOS program defaults](https://github.com/OffchainLabs/nitro/blob/v3.12.2/arbos/programs/params.go)
- [Fragment/decompression handling](https://github.com/OffchainLabs/nitro/blob/v3.12.2/arbos/programs/programs.go)

No financial transaction, deployment, model change or policy-limit increase is performed by this lane.
