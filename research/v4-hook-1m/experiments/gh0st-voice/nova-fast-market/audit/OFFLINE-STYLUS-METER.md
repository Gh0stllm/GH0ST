# Official offline Stylus meter: N0VA full sentences

Local research only, 2026-10-24. No RPC calls, chain changes, or deployments.

A native build of **official Nitro v3.12.1** successfully activated and executed the exact Rust/WASM prototypes on Apple Silicon without Docker or a running Nitro chain. This uses Nitro's instruction instrumentation, native VM, dynamic memory/copy pricing, and host functions. It is not a wall-clock speed estimate and not the unmetered Stylus SDK TestVM.

## Result

All successful variants emitted the exact same 20 neural word/punctuation IDs for seed 42. The model weights, integer arithmetic, and neural sampler were preserved.

| Kernel | Measured execution gas | Initial memory, separately | Cached invocation, separately |
|---|---:|---:|---:|
| Raw | 10,001,077 | 61,289 | 690 |
| Three-lane packing | 4,968,343 | 93,772 | 761 |
| Delta compression + packing | 6,479,866 | 97,918 | 777 |
| Packed, unroll 8 | 3,582,915 | 93,772 | 763 |
| Packed, unroll 16 | 3,320,523 | 93,772 | 766 |
| **Packed, unroll 32** | **3,189,326** | **93,772** | **773** |
| Packed, unroll 64 | 3,229,723 | 93,772 | 786 |
| Packed, unroll 128 | Rejected: 392 locals exceeds 348 | — | — |

The selected kernel is **unroll 32**. Its separate four-byte seed-input wrapper passed native metering for all 16 seeds, 42–57, producing complete sentences of 11–21 words. Every emitted word and punctuation ID matched the independent numerical reference.

| Selected kernel, 16 reset-state sentences | Minimum | Mean | Maximum |
|---|---:|---:|---:|
| Measured execution gas | 2,004,074 | 2,617,497.69 | 3,324,867 |
| Execution + initial memory + cached invocation | 2,098,619 | 2,712,042.69 | 3,419,412 |

The four-byte seed wrapper adds two gas to the seed-42 execution sample compared with the fixed-seed wrapper. These fixtures reset hidden state for each seed and use neutral swap features. They are **not** a continuous 16-swap story or a real pool test.

At the earlier reference pricing target of 7M gas/second, ten such sentences per second would require about **27.12M gas/second for these measured/known components alone**, before pool settlement and state storage. This does not meet the 700k total gas-per-swap budget. The 7M figure is a reference pricing/speed target, not a demonstrated hard transaction acceptance ceiling; this experiment does not establish a hard TPS limit.

## What is charged

- Actual upstream WASM opcode instrumentation and basic-block metering, Stylus version 3.
- Actual native host implementation, including Keccak, argument/output copies, host entry cost, and code-return copy pricing.
- Real local weight bytes in **24,000-byte payloads plus a one-byte STOP prefix**, below ordinary 24,576-byte EVM code limits.
- Nonzero cold/warm account access cost through a small local EVM adapter, using the pinned geth `WasmAccountTouchCost` formula. Each isolated test starts with a cold access list. The adapter's returned code is real model data, not an empty or free placeholder.
- Initial memory is calculated separately using the upstream `MemoryModel`. Invocation is calculated separately from the activated module's metadata and the upstream Go formula.

The measured execution field already includes code access and native host copy charges. Do not add those a second time. The source also preserves a **hypothetical** 98,304-byte `maxCodeSize` pricing scenario; it still uses 24KB shards. Those rows are sensitivity checks, not a claim that 96KB data contracts can be deployed under normal EVM limits.

## Configuration and limits

The explicit scenario is Stylus version 3, activation ArbOS version 61, 10,000 ink per gas, 22,000 maximum stack depth (the upstream ArbOS-50 upgrade limit), 128 memory pages, two free pages, and 1,000 gas per added page with the official exponential memory schedule. The selected module uses 74 initial pages. The chain's actual owner-configurable parameters were **not queried or verified**.

These are **partial execution costs**, not complete swap receipts. Excluded work includes persistent hidden-state load/save, production feature and entropy derivation, model/weight identity pinning, EVM hook validation, decoder and sentence event, router/PoolManager/token settlement, intrinsic transaction gas, L1/data fees, program lookup/access overhead outside the native VM, and deployment/activation transactions. A cached program is a separate assumption from warm weight addresses. The uncached invocation estimate is also recorded in JSON.

The Rust prototype uses local fixture addresses and a test-only entrypoint. It is not a production hook ABI or an audited deployment. Existing Solidity fail-closed/rollback tests apply to the separate EVM hook; this file does not claim a completed EVM–Stylus pool integration.

## Correctness evidence

- `official-stylus-meter.json`: official activation and native token/punctuation equality for the kernel sweep, including the 64 performance result and 128 validator rejection.
- `official-stylus-best-seeds.json`: official native equality and gas for seeds 42–57 on the winning seed wrapper.
- `official-meter-summary.json`: arithmetic used above, with full-swap and hard-TPS flags explicitly false.
- `official-meter-manifest.json`: source revision, WASM SHA-256 hashes, toolchain and configuration.
- Separate sibling `kernels/wasm-unroll/` reports compare every hidden-state value and score across 502 generated words and 16 boundary vectors, plus invalid-input/cap checks. That numerical reference testing uses unmetered Node WASM. Native metering verifies every emitted token/punctuation ID; activation strips diagnostic pointer exports, so native full-hidden-state hashes are not claimed.

## Reproduction

The committed files are the small test patch, test source, script, reports and manifest. Local vendored sources, toolchains and build caches are ignored.

Use Rust **1.93.0**, an Apple Silicon native C/C++ toolchain, and the two pinned Nitro submodules. The first dependency fetch needs network access; the actual test runs offline. Fetch the pinned official source in a separate local directory:

```sh
git clone --filter=blob:none --no-checkout https://github.com/OffchainLabs/nitro.git /tmp/nova-nitro-meter
git -C /tmp/nova-nitro-meter sparse-checkout init --cone
git -C /tmp/nova-nitro-meter sparse-checkout set crates brotli
git -C /tmp/nova-nitro-meter checkout 70fa99a6e711f09eedd96a907290c3df0f3bcf7d
git -C /tmp/nova-nitro-meter submodule update --init brotli crates/tools/wasmer
```

The submodule command checks out `brotli` and `crates/tools/wasmer` at the revisions recorded in the manifest. Install the documented Rust version and fetch Cargo dependencies from the Nitro workspace (`cargo fetch --locked`). Build the WASM artifacts using the sibling kernel reproduction instructions first. Then run from this audit folder:

```sh
NOVA_NITRO_SOURCE=/tmp/nova-nitro-meter ./run-official-meter.sh
```

The script verifies the Nitro commit, applies only the adapter/test patch, and runs the two tests with `--offline --locked`. `CARGO_HOME`, `CARGO_TARGET_DIR`, and a dedicated Rust toolchain can be supplied by the caller. The existing local build used dedicated directories under `audit/` and did not replace the system Rust installation.

## Primary sources

- [Pinned Nitro source](https://github.com/OffchainLabs/nitro/tree/v3.12.1), commit `70fa99a6e711f09eedd96a907290c3df0f3bcf7d`.
- [Official pricing/instrumentation configuration](https://github.com/OffchainLabs/nitro/blob/v3.12.1/crates/prover/src/programs/config.rs).
- [Official host code-copy charging](https://github.com/OffchainLabs/nitro/blob/v3.12.1/crates/wasm-libraries/user-host-trait/lib.rs).
- [Pinned geth account access formula](https://github.com/OffchainLabs/go-ethereum/blob/5eee8f546e7602b7deeef7909f291bbebc77e233/core/vm/operations_acl_arbitrum.go).
- [Default parameters and upgrade values](https://github.com/OffchainLabs/nitro/blob/v3.12.1/arbos/programs/params.go).
- [Invocation-cost translation](https://github.com/OffchainLabs/nitro/blob/v3.12.1/arbos/programs/programs.go).
- [Official gas/ink concepts](https://developer.arbitrum.io/stylus/concepts/gas-metering).
