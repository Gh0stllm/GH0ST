# Standard GH0ST L3 node

This lane builds the **base L3 first**: standard Nitro and Stylus, Robinhood Chain as parent, and the GH0ST native-gas configuration supplied by the separate deployment lane. It does not require an LLM seed or the experimental A11/A12 implementations. No public L3 or server has been launched.

The clean native node builds and an isolated local chain runs with **ArbOS 61, debug precompiles disabled and unchanged EVM/Stylus limits**. Every original file in the pinned Nitro source archive was compared after the build: none changed. Neither GH0ST experimental precompile nor the bridge Go module is present. The generated bindings and native dependencies are independent verified copies, so later research changes cannot alter this source tree.

## Fast local receipts

The chosen profile sets a **100 ms minimum delay between sequencer blocks** and a 5 ms queue poll. Nitro's source allows a configured delay down to 5 ms and defaults to 250 ms; 100 ms is our tested profile, not a protocol floor or a guaranteed response time.

On the local Apple M5 / 24 GiB development host, all **96 measured transactions** succeeded:

| Workload | Transactions / concurrency | Receipt p50 | Receipt p95 |
| --- | --- | --- | --- |
| Native transfers, sequential | 16 / 1 | 99.2 ms | 102.1 ms |
| Native transfers, bursts | 32 / 8 | 94.8 ms | 101.0 ms |
| Stylus signed dot, sequential | 16 / 1 | 98.4 ms | 102.0 ms |
| Stylus signed dot, bursts | 32 / 8 | 93.9 ms | 105.4 ms |

The burst workloads each processed 32 transactions in about 0.41 seconds, roughly 78 transactions/second in this bounded test. This is **not a saturation capacity measurement**. Setup also mined deployment, activation and warm-up transactions. The actual standard Stylus VM returned the exact expected signed dot result `-31` and activation version 3.

Measurements run from local raw-transaction submission to observing its mined receipt through loopback RPC. The chain had a fake ETH genesis balance, no public parent connection, no batch posting and no staking. They are not GH0ST fee estimates, Robinhood batch-confirmation times, Ethereum finality or evidence of LLM throughput. Public-server hardware, network latency and sustained load still need a deployment benchmark.

`evidence/receipt-benchmark.json` includes every measured receipt and workload timing. The ephemeral signing key exists only in memory; no existing wallet is read, and the child node shuts down after the test.

## Production baseline

[performance-profile.json](performance-profile.json) pins:

- Robinhood parent chain ID **4663**, with the child chain ID left for the reviewed deployment packet.
- Standard Nitro **v3.12.2**, production-compatible **ArbOS 61**, debug precompiles **off**.
- Official Linux/amd64 image `offchainlabs/nitro-node@sha256:c908f324a08b7332d1fa031b83b071cfa2d9edd8a364c4344d7c34b665bf08e9`.
- Official latest machine root `0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97`.
- HTTP bound to loopback behind a TLS and rate-limited gateway; no public privileged/debug/engine endpoints, and administrative access kept private.

The canonical machine root was read from the pinned official image's SHA-verified machines layer, including the `latest` symlink. No Docker image was executed. This root is deliberately separate from the experimental LLM machine root. The local binary is **darwin/arm64**, built with the pinned upstream Go **1.25.12**; it does not pretend to be a tested Linux server image.

The exact geth pin supports production ArbOS versions through 61, and the source implements its refund fix. `ArbSys.arbOSVersion()` reports `55 + internal version`, so the local probe returns 116 for ArbOS 61. This offset is decoded explicitly in the benchmark.

Offchain Stylus activation is disabled in this profile. The benchmark therefore submits the actual local activation transaction with a bounded 10-million gas allowance instead of enabling activation during gas estimation. No node gas cap or standard Stylus code, memory or SIMD policy is raised.

The base chain leaves room for later LLM integration, but a fast sequencer does not make large-model computation free or prove a custom runtime. Those research artifacts are preserved outside this lane. Initial deployment should use the standard official machine and complete normal rollup, gas-token, custody and hosting review before any public transaction or paid order.

## Reproduce locally

```sh
python3 build.py
python3 official-machine-root.py
node benchmark.mjs
```

`build.py` downloads SHA-pinned standard Nitro/geth source and official Go 1.25.12 into its own ignored cache. It expects the separately source-compiled bindings, `arbitrator.h` and pinned native `libstylus.a` from the earlier [native dependency build](../../nitro/README.md); `--artifact-root` can select another prepared source tree. Their complete binding-tree/header/library hashes are checked before independent copies are made. It rejects any experimental source/module and compares every original Nitro file to the pristine archive.

`benchmark.mjs` additionally needs the existing pinned ethers dependency and the reviewed normalized Stylus build. Its Go encoder uses only standard Nitro Brotli/prefix helpers. No server rental, existing keys, public transactions or automatic funding are involved.

Primary source pins: [Nitro v3.12.2 sequencer configuration](https://github.com/OffchainLabs/nitro/blob/v3.12.2/execution/gethexec/sequencer.go), [pinned supported ArbOS versions](https://github.com/OffchainLabs/go-ethereum/blob/30456d24d3cff444d3b0f246e9c7609477c7d4a1/params/config_arbitrum.go), [ArbSys version offset](https://github.com/OffchainLabs/nitro/blob/v3.12.2/precompiles/ArbSys.go), [official release](https://github.com/OffchainLabs/nitro/releases/tag/v3.12.2).
