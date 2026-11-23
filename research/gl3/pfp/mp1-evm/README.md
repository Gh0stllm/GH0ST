# Robinhood M-P1 Q5 inference research

This folder targets the exact 2,976,901-byte model in the [compact model benchmark](../bench/mp1-packed.md). The components currently run as independent fixed-point contracts or full-image local reference code. The stateful composition and full Robinhood image replay remain pending.

- [Fixed-point reference](reference/mp1_fixed.py) generates a 16×16 image from the packed weights with the 16-step guided sampler. [Six-caption comparison](reference/evidence/six-caption-comparison.json) records output parity with the prior WebGPU test.
- [Weight reader](runtime/Mp1ModelData.sol) binds all 31 shards to the exact [model manifest](runtime/model-manifest.json). Its [isolated EVM test](runtime/isolated-storage-evidence.json) covers cross-shard reads, changed shard order and range errors.
- [Linear kernels](kernel/) and [normalization, attention and sampler operations](runtime/) include read-only Robinhood gas and output comparisons.
- [Execution schedule](scheduler/README.md) defines bounded steps and checks for a stateful runner. Its [projection](scheduler/prototype-projection.json) gives 58.49 ETH for the measured stages scaled across the image at 22,012,000 wei per gas. A complete contract replay would measure full-image gas including state storage.

Recreate the selected Q5 package with the [pack scripts](weights/README.md), then use it as the `--pack` input to `reference/mp1_fixed.py`. `runtime/check-model-data.mjs` tests storage on an isolated Anvil instance. `runtime/benchmark.mjs` uses the public Robinhood RPC and state overrides for read-only operation testing. The mainnet gas projections exclude job state and the operations listed in the projection report.
