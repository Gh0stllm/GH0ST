# Frozen N0VA WASM dot-loop optimization

The selected candidate is **unroll32**. It preserves every Q10 value and arithmetic operation while executing 32 packed dot terms per loop iteration.

## Local results

The official offline Nitro v3.12.1 meter, commit `70fa99a6e711f09eedd96a907290c3df0f3bcf7d`, accepts unroll32 under the tested Stylus v3 / ArbOS 61 configuration. At 10,000 ink/gas and the 24KB code-size scenario, its fixed 20-word sentence uses **3,189,326 execution gas**. An additional **93,772 initial-memory gas** and **773 cached invocation gas** are reported separately. This excludes transaction intrinsic gas, persistent neural state, complete Solidity hook execution and pool settlement.

| Variant | Metered execution gas, 20 words |
| --- | ---: |
| Raw i16 kernel | 10,001,077 |
| Packed-three kernel | 4,968,343 |
| Lossless physical compression + packed-three | 6,479,866 |
| Unroll 8 | 3,582,915 |
| Unroll 16 | 3,320,523 |
| **Unroll 32** | **3,189,326** |
| Unroll 64 | 3,229,723 |
| Unroll 128 | Rejected: 392 WASM locals exceeds 348 |

The bounded sweep is complete. All five unroll variants passed 502-word reference parity; rejected activation means full128 is not a usable candidate despite numerical parity. Unroll32 also passed 16 extreme numeric vectors and ten invalid-input/cap checks. The seed entrypoint passed 16 seeds producing 11–21 words, plus invalid-calldata-length and reentrancy rejection checks.

These are local tests only. Mainnet chain configuration was not queried or established. There were no public transactions, deployments or RPC calls. A 700,000-gas complete sentence and 10 swaps/second have **not** been achieved. The metered kernel alone exceeds that target.

## Selected artifacts

- `artifacts/nova-unroll32-fixed.wasm`: fixed-seed meter entrypoint, 19,877 bytes; SHA-256 `5beada261ba66b4b0b06832892cdcd80281eb54d55a2b944e649b5bdabfbce95`.
- `artifacts/nova-unroll32-seeds.wasm`: four-byte big-endian seed entrypoint, 19,961 bytes; SHA-256 `b43f134ee74ef48e95aacb18f1eba5bab0865251ccbaa15d4b510ed6216be624`.
- `32/src/lib.rs`: frozen selected source; SHA-256 `3e027ef6cd538da1d9077b3cdde47fd6fdb9d41b9d7a9893b246864ffabcefc2`.
- `32-seeds/src/lib.rs`: same kernel with seed wrapper; SHA-256 `44d7145ace69b102603931905ae05b528f33607e35f9fbd6b81f8c172a6a5a43`.

The small `.wasm` files are copied outside build directories for publication. Learned model binaries are not duplicated here. Both modules read the exact `../../stylus/packed3-model` export through the local fixture host.

## Reproduction

From `research/v4-hook-1m`, use the installed Rust **1.91.0** toolchain and Node runtime. `build.py` only verifies the selected source files by default. Its frozen templates are local; `--write` recreates exactly those source files and does not retrain or rewrite data.

```sh
python3 experiments/gh0st-voice/nova-fast-market/kernels/wasm-unroll/build.py
cargo build --manifest-path experiments/gh0st-voice/nova-fast-market/kernels/wasm-unroll/32/Cargo.toml --release --target wasm32-unknown-unknown --features meter-entrypoint --offline
cargo build --manifest-path experiments/gh0st-voice/nova-fast-market/kernels/wasm-unroll/32/Cargo.toml --release --target wasm32-unknown-unknown --target-dir experiments/gh0st-voice/nova-fast-market/kernels/wasm-unroll/32/target-plain --offline
cargo build --manifest-path experiments/gh0st-voice/nova-fast-market/kernels/wasm-unroll/32-seeds/Cargo.toml --release --target wasm32-unknown-unknown --features meter-seed-entrypoint --offline
node experiments/gh0st-voice/nova-fast-market/kernels/wasm-unroll/benchmark.mjs 32
node experiments/gh0st-voice/nova-fast-market/kernels/wasm-unroll/test-probes.mjs 32
node experiments/gh0st-voice/nova-fast-market/kernels/wasm-unroll/test-seed-entry.mjs
```

The meter's independent report and runtime harness are under `../../audit/official-stylus-meter.json` and `../../audit/nitro-meter-source`. Its scenario assumptions and excluded costs are part of the report.

## Limitations

This remains a numerical kernel with diagnostic entrypoints, not a production pool contract. It still needs immutable real model/catalog addresses, model identity checks, canonical ABI, continuous pool-bound state, strict atomic sentence failure, production network validation, and complete metered hook/pool integration. The raw `sentence(max)` test export permits a partial-state marker on no terminal punctuation; production callers must revert instead. Both diagnostic entrypoints enforce a 32-word cap, return failure on no terminal punctuation, and reject reentrancy.


The final seed sweep is in `../../audit/official-stylus-best-seeds.json`: all 16 seeds match the reference, with 11–21 words. Execution is 2,004,074–3,324,867 gas. Including the separately modeled memory and cached invocation yields 2,098,619–3,419,412 gas, before full-swap costs.

For official offline meter reproduction, follow `../../audit/OFFLINE-STYLUS-METER.md`. From `audit/`, set `NOVA_NITRO_SOURCE` to the pinned local Nitro checkout and run `./run-official-meter.sh` using Rust 1.93 and the already cached dependencies. This runs locally and needs no deployment or chain RPC.
