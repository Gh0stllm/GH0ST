# GH0ST gas refinement — 20 October 2026

The balanced candidate, **SixBitFixed**, executes the complete matrix benchmark for **1,214,316,532 gas**. The fastest candidate, **SixBitPredecoded2**, uses **1,187,396,568 gas**. Every output in both full runs matches the independent integer reference.

These are new experiments rebuilt from the recovered source. The missing historical 50-experiment series has not been restored. Its reported 1,288,206,221-gas result remains a historical report, not a reproduced control. The new balanced and fastest totals are numerically 5.74% and 7.83% below that report, respectively; their deployment layouts differ.

## Measured execution and modeled storage

| Kernel / format | All-matrix receipt gas | Reduction from reproduced baseline | Complete weight-file bytes | Modeled weight deployment, 60 KiB payloads |
| --- | ---: | ---: | ---: | ---: |
| Reproduced `SixBitFast` / compact endpoints | 2,965,180,104 | — | 72,045,528 | 15,648,599,873 |
| `SixBitShifted` / variable 4–5-byte metadata | 1,269,161,930 | 57.20% | 75,005,280 | 16,289,043,694 |
| **`SixBitFixed` / fixed 5-byte metadata** | **1,214,316,532** | **59.05%** | **75,641,184** | **16,421,055,512** |
| `SixBitPredecoded2` / 7-byte metadata | 1,187,396,568 | 59.96% | 78,484,832 | 17,016,131,054 |

**Execution savings come with higher modeled weight-deployment cost.** The balanced format adds 4.94% to the recovered compact format's modeled deployment. The fastest format adds 8.74%. The earlier missing series reported 15,808,491,619 modeled deployment gas; neither new format reduces that reported deployment figure.

The fixed format is the recommended research candidate for repeated execution. Compared with variable metadata, its extra modeled storage gas is recovered after three complete matrix passes. The fastest format recovers its additional storage gas over the fixed format after 23 passes. These are gas-only arithmetic comparisons of this matrix benchmark, not financial break-even estimates or complete-token counts.

The fixed kernel itself is 2,032 runtime bytes and deploys locally for 488,780 gas, versus 3,647 bytes and 830,442 gas for the reproduced baseline. Kernel deployment is separate from the billions of gas for weight data.

## Scope

- 217 matrices, 90,996,736 weights, 165,440 verified rows, and 2,600 matrix-tile transactions per complete run.
- Exactly the selected six-bit weights, with signed-int16 synthetic inputs independently generated for each matrix. The tied embedding matrix is counted once as a full output projection.
- Local Anvil 1.8.5, Cancun, Solidity 0.8.30, optimizer enabled with 1,000,000 runs and via-IR. The local code-size limit is raised to 98,304 bytes, matching the prior experiment configuration.
- Receipt gas includes transaction input, weight-code reads, input preparation, matrix arithmetic and returned output. The reproduced baseline differs by 204 gas from the archived total because of test deployment/address ordering.
- **Not full Falcon inference or a token/reply cost.** Nonlinear operations, attention/Mamba recurrence, actual layer-to-layer activations, persistent state, tokenization, sampling, scheduling and agent execution remain excluded. No public transactions were sent.
- The under-one-billion execution target is still unmet. Activation precision and end-to-end model quality remain unresolved; exact integer-kernel results do not establish float32 inference equivalence.

Storage totals model the complete encoded file, tensor descriptors, STOP prefixes, creation, transaction data, initcode and memory. They exclude the shard-address directory, tokenizer, inference engine, controller and chain-specific data fees. Both 24 KiB and 60 KiB layouts are recorded in `storage-results.json`. The 60 KiB layout requires a chain that supports larger code limits; it is not a portable Ethereum-mainnet layout. The default limits are described in [EIP-170](https://eips.ethereum.org/EIPS/eip-170) and [EIP-3860](https://eips.ethereum.org/EIPS/eip-3860).

The full-file layouts and test tiles are distinct: the benchmark deploys each complete matrix tile in one shard. A validated reader/scheduler for a full file split across shards remains unimplemented. No current BNB or Robinhood execution-limit or monetary-fee claim is made.

## Changes that reduced gas

1. **Signed polynomial accumulation.** The prepared activation word represents signed coefficients directly. After eight packed multiplications, a fixed rounding guard and arithmetic shift extract the signed dot product. This removes the old per-group sum-of-codes bias correction.
2. **Two-step weight dilation.** Four nonoverlapping copies of a 48-bit code word select four 12-bit chunks; one more multiplication/mask splits them into eight 32-bit lanes. This replaces three widening stages and avoids helper-call overhead.
3. **Precomputed exact scales.** The encoder stores the already-selected Q24 scale. It avoids reconstructing BF16 high endpoints and repeating float32 halfway-rounding corrections during every execution. This changes representation only.
4. **Compact integer offsets.** For `SixBitFixed`, a common power of two is factored out of offsets per tensor/tile. A five-byte record stores a signed 19-bit offset coefficient and a 21-bit scale. Decoding restores the original Q24 offset exactly.

For the signed extraction, every polynomial coefficient has absolute value at most `64 × 63 × 32768 = 132,120,576 < 2^27`. With radix `2^32`, the lower coefficients cannot reach the rounding guard at bit 223. Adding `2^223` and taking `SAR(224, ...)` therefore extracts the desired signed coefficient exactly. Higher coefficients are multiples of `2^256` and disappear under EVM multiplication. This argument applies to the documented int16 input bounds.

The activation-spreading multiplication shortcut was **rejected**: overlapping fields introduced carries and failed an exact-output test. Activations retain the verified OR/shift preparation. `rejected-experiments.json` preserves the failure and other nonselected approaches.

## Evidence

- `full-results.json`: reproduced baseline, variable metadata, and fastest kernel over all matrices.
- `fixed-full-results.json`: complete balanced-kernel run.
- `validated-candidates.json`, `fixed-validation.json`: 56 representative/edge input cases plus boundary groups from all 217 matrices for each selected kernel; include signed extrema, zero, alternating values and isolated negative lanes.
- `invariant-results.json`: 10,050 independent dilation checks and 10,000 signed-polynomial checks.
- `input-validation.json`: 34 malformed-input rejection checks.
- `storage-results.json`: all three formats round-trip the entire selected export byte-for-byte, including nonmatrix tensors.
- `deployment-validation.json`: 18 sample deployments with exact code-byte checks and modeled gas matching local receipts.
- `candidate-results.json`, `compiler-results.json`, `dilation-results.json`, `two-stage-results.json`: measured intermediate experiments. These sample-only results are not substituted for complete-model runs.
- `provenance.json`: compiler settings and source/runtime hashes. `generate.py` produces the inspected Solidity candidates; `compile.cjs` compiles them.

Original checkpoint SHA-256: `199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578`.

Rebuilt selected six-bit export SHA-256: `a0e3121e433f8fc000219ec629c0ab361749d9190f903118e7a96a7c4c29cead`. Every compact tensor hash also matched the recovered manifest.

Balanced file SHA-256: `35430bdcf50d14b3894e4d72578f24df64c42bca947cf8573d6c4642a5fbdb49`.

## Reproduce

Use Python 3.12, the versions in `requirements.txt`, PyTorch 2.14.1+cpu, Node, and Anvil 1.8.5. Run commands from the repository root. Install Solidity dependencies with `npm ci --prefix contract-benchmark`.

Download `model.safetensors` from the pinned [Falcon checkpoint](https://huggingface.co/tiiuae/Falcon-H1-Tiny-90M-Instruct/tree/e6389502a0b12cd8da894b395ba5bf7436873b16), respecting its upstream license. The script checks its exact hash. Store model binaries outside the Git tree.

```bash
python falcon-agent/gas-refinement/rebuild_source.py --checkpoint /absolute/path/model.safetensors --output /absolute/path/int6
python falcon-agent/gas-refinement/generate.py
node falcon-agent/gas-refinement/compile.cjs
python falcon-agent/gas-refinement/verify_invariants.py
python falcon-agent/gas-refinement/benchmark.py --source /absolute/path/int6 --anvil /absolute/path/anvil --candidates SixBitFixed --output falcon-agent/gas-refinement/fixed-validation.json
python falcon-agent/gas-refinement/benchmark.py --source /absolute/path/int6 --anvil /absolute/path/anvil --candidates SixBitFixed --full --no-baseline --output falcon-agent/gas-refinement/fixed-full-results.json
python falcon-agent/gas-refinement/benchmark.py --source /absolute/path/int6 --anvil /absolute/path/anvil --candidates SixBitShifted,SixBitPredecoded2 --full --output falcon-agent/gas-refinement/full-results.json
python falcon-agent/gas-refinement/export_formats.py --source /absolute/path/int6 --output /absolute/path/optimized
python falcon-agent/gas-refinement/verify_inputs.py --anvil /absolute/path/anvil
python falcon-agent/gas-refinement/verify_deployment.py --exports /absolute/path/optimized --anvil /absolute/path/anvil
```

The compiler sweep is reproducible with `compiler_sweep.cjs`; it adds the four optimizer-run variants to `compiled.json`. The smaller standalone scripts use local loopback RPC only and contain no public signing/broadcast path.
