# Integer contract benchmark

This is the first measured contract computation slice, not the full agent. Solidity provides a baseline for a future Rust/Stylus comparison. All public-chain operations are read-only simulations; no public deployment or spend occurred.

## Computation

The fixture contains the first four rows of `model.layers.0.feed_forward.w1.weight` from the pinned LFM checkpoint and a real activation captured at the final prompt token. Each row has 1,024 coefficients. The prompt is `Set my goal to learn Solidity.`

The offline exporter quantizes weights to signed int4 using a separate max-absolute-value scale per row and the activation vector to signed int16. The contract computes exact integer dot products. Scaling back to floating point is recorded for comparison only and is **not** performed in the contract. One fixture cannot establish full-model quantization quality.

Expected integer outputs:

```text
207214, -150983, 410232, -109613
```

`Int4Kernel.sol` provides three paths:

- `dotCalldata`: the caller supplies packed coefficients and activations.
- `dotFromCode`: coefficients are read from an immutable bytecode data shard; activations are supplied in calldata.
- `computeAndStore`: the second path plus a stored result hash and run counter, to measure a small persistent state change.

The last path is unrestricted benchmark code. It contains no production authorization or funds. A result hash does not preserve all activation values for continuation. A full inference engine must source intermediate activations from its own verified execution state; this slice accepts them as test inputs.

## Local execution results

Compiler: Solidity 0.8.30, optimizer 200 runs, via IR, Paris target. Execution: Py-EVM, with the exact VM/package versions in `../results/contract-local.json`. Kernel runtime: 1,325 bytes.

All 18 checks passed: nine arithmetic fixtures tested through both input paths, eight invalid-input checks and a persistent commitment/counter check. Cases include signed extrema, the accumulator bound, odd packed lengths and random matrices. Separate real-LFM measurements matched the integer reference for one, two and four rows.

| LFM projection slice | Multiply-accumulates | Local gas: coefficients in calldata | Local gas: coefficients in shard |
| --- | ---: | ---: | ---: |
| 1 × 1,024 | 1,024 | 276,451 | 271,620 |
| 2 × 1,024 | 2,048 | 496,459 | 483,964 |
| 4 × 1,024 | 4,096 | 936,935 | 908,608 |

These are successful **local transaction receipt gas totals**, including transaction overhead. They exclude Robinhood-specific fee accounting.

Additional local receipt measurements:

- Kernel deployment: 339,359 gas.
- Four-row weight shard deployment (2,048 weight bytes): 509,433 gas.
- Four-row computation plus first result commitment/counter write: 953,025 gas.
- Repeating the same result with a counter update: 916,025 gas. A different result or larger checkpoint has different write costs.

## Robinhood simulation

`simulate_robinhood.py` uses an explicit allowlist of read-only RPC methods. It supplies the compiled runtime, packed weight shard and fictitious sender funding as temporary state overrides. It checks dot-product output and the result commitment, then requests gas estimates for the two deployments and two computation paths.

The exact outcomes are in `../results/contract-robinhood-simulation.json` when available. Errors are retained instead of substituted with local measurements. Gas-price multiplication is a point-in-time fee estimate. According to Robinhood's fee documentation, its standard gas estimator accounts for both L2 execution and L1 data fees. Estimates are not paid transaction receipts or guarantees.

The recorded Robinhood simulation matched both the integer outputs and the commitment. At its quoted gas price of 20,000,000 wei per gas:

| Operation | RPC gas estimate | Estimated ETH |
| --- | ---: | ---: |
| Kernel deployment | 346,532 | 0.00000693064 |
| 2,048-byte weight shard deployment | 520,770 | 0.00001041540 |
| Four-row computation | 922,728 | 0.00001845456 |
| Four-row computation plus first result commitment | 967,491 | 0.00001934982 |

The two deployments plus one computation with a commitment total **0.00003669586 ETH estimated**. This is a tiny benchmark budget only. Zero ETH was spent. The block, timestamp and raw estimates are retained in the JSON report.

Even a successful `eth_call` proves only execution by the queried node under the supplied simulation state. It does not prove consensus inclusion, publicly available weight contracts, persistent state, Stylus activation, or full-model viability.

## Reproduce

From the package root, use Python 3.12 and Node.js. The exported fixture is included, so re-running the local contract benchmark does not require loading the model.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install torch==2.14.1+cpu --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install -r contract-benchmark/requirements-lock.txt
cd contract-benchmark
npm ci --ignore-scripts
node compile.cjs
../.venv/bin/python benchmark.py
../.venv/bin/python simulate_robinhood.py
```

To reproduce the real model fixture, run `../.venv/bin/python export_slice.py` before `benchmark.py`. This downloads/loads the pinned public model and needs additional RAM/disk space. The original LFM license at the package root also applies to the derived weight slice.

`simulation-input.json` contains unsigned call/creation data and dummy simulation addresses. None of those addresses is a deployment claim or funding destination.

## Next gate

The new Base comparison is documented in `../CHAIN-COMPARISON.md`. Reproduce it with `../.venv/bin/python compare_chains.py` from this directory. It reuses the exact fixture and bytecode, checks simulated deployment runtimes and computation outputs, and accounts for chain-specific fee components. It does not deploy contracts or infer a token's cost from a four-row calculation.

Run the same integer workload through Stylus and verify activation/resource limits. Then measure a complete model block and a full next-token pass, including scaling, nonlinear functions, state reads/writes and the output vocabulary projection. Deployment count, gas per token and reply cost remain unknown until those larger measurements exist.

Primary references:

- https://docs.soliditylang.org/en/latest/using-the-compiler.html
- https://docs.robinhood.com/chain/gas-and-fees/
- https://docs.arbitrum.io/stylus/gentle-introduction
