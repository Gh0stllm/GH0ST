# Complete first-block benchmark

This implements the first convolution decoder block of the pinned LiquidAI/LFM2.5-230M model using a Solidity engine, with optional generated EVM weight programs. It is an inference building block, not a complete chatbot. `../COMPILED-WEIGHTS-RESULTS.md` contains the latest execution/deployment trade-off; `../OPTIMIZATION-RESULTS.md` and `../TEST-RESULTS.md` preserve the earlier studies. All public-chain interaction is read-only; no latest public replay has been approved or completed.

## What executes in the contracts

The block performs RMS normalization, a 3072-by-1024 input projection, three-tap gated causal convolution, a 1024-by-1024 output projection, residual addition, a second RMS normalization, and the complete gated feed-forward network with 2560 hidden units. It maintains two previous convolution vectors across token positions.

The model data uses 355 immutable bytecode shards totaling 6,098,948 payload bytes, plus one engine contract. Each token position needs `begin()` and 383 `step()` calls. Intermediate vectors and the progress cursor persist in contract storage. Any caller can advance a job; only the owner can begin a new input, and active inputs cannot be replaced. A caller supplies transactions, not trusted intermediate arithmetic.

The harness supplies the initial embedding vector from an offline fixture. Tokenization, embedding lookup, the remaining thirteen blocks, attention/KV state, vocabulary projection, decoding, chat history, and agent actions are not implemented in this engine. The prototype serves one sequence at a time. Its owner can submit arbitrary input vectors; production input provenance is a later integration gate.

`LfmBlock.sol` provides the scalar arithmetic. `LfmBlockSwar.sol` computes four exact signed integer products per EVM multiply using polynomial packing and bias removal. This reduces gas without changing the integer specification. It does not introduce parallel blockchain execution. Independent row work could be scheduled differently, but the chain still charges for its computation and later stages depend on earlier outputs.

The October 20 follow-up, `LfmBlockSwar6.sol`, uses six 40-bit lanes per multiply, with a scalar tail for incomplete groups. Every polynomial coefficient is less than `6 * 15 * 2^32 < 2^39`; bits 200 through 239 contain the desired coefficient exactly. A 40-bit mask removes the partial next coefficient above it. With biased inputs `A = x + 2^31` and weights `B = w + 8`, the signed six-product sum is `coefficient + 6 * 2^34 - 8 * sum(A) - 2^31 * sum(B)`. No precision or rounding change is introduced. The three complete local positions use 1,060,952,306, 1,025,162,033 and 1,022,975,335 gas. Public-chain fee tables still use the earlier four-lane run.

The latest selected engine, `LfmBlockOptimized.sol`, inherits `LfmBlockWide5U2.sol` and adds `advance(count)` for atomic batches of 1–8 steps. Five 48-bit coefficient lanes allow accumulation across a complete row because `2560 * 15 * 2^32 < 2^48`. Bias correction moves outside the inner loop. Multiply-and-mask nibble spreading and measured two-pair loop unrolling reduce decoding overhead. The original weight files are unchanged. The full derivation, candidate comparison and tests are in `../OPTIMIZATION-RESULTS.md`.

With the new kernel alone, the third position uses 508,768,231 gas. Batching lowers it to 399,282,174 gas and 52 transactions. Every one of the original 383 computation chunks still emits a digest. Batches use permissionless self-calls to the existing `step()` entry point, sharing warm storage access. A failure reverts the whole batch; requesting more steps than remain stops at stage 11. The old single-step interface remains available. This is a new engine deployment, not an upgrade of an existing instance.

The subsequent `LfmBlockCodeweights.sol` variant compiles the fixed weights into 4,192 executable EVM programs, bound through eleven code books. The engine still prepares activations and performs all input-dependent arithmetic on chain. This reduces the third position to 143,986,402 gas. It retains the original 355 data shards and adds one engine, for 4,559 contracts and 17,893,032,220 total local deployment gas. The earlier version is retained because it has far lower deployment cost. `compiled_weights.py` regenerates every executable program from the original int4 rows; no model output is precomputed.

## Numeric specification

| Component | Representation |
| --- | --- |
| Activations and stored vectors | Signed int32 Q16, overflow rejected |
| Dense weights | Symmetric signed int4, per-row scaling, exported values -7 through 7 |
| Dense scales and convolution coefficients | Signed int32 Q24 |
| RMS gamma | Signed int32 Q16 |
| RMS epsilon | 42950 in Q32 |
| RMS denominator | Integer square root of floor(mean square) plus epsilon |
| SiLU | Sigmoid Q30 lookup table on [-16,16], spacing 1/64, linear interpolation; tails clamped |
| Offline rounding | Ties to even |
| Runtime signed division | Truncation toward zero |

The signed-weight arithmetic also handles -8 for testing, although the symmetric exporter never emits it. Four biased products fit within a 64-bit polynomial coefficient; coefficients cannot carry into adjacent lanes. See the derivation in `LfmBlockSwar.sol`.

`reference.py` uses Python arbitrary-precision intermediates where int64 could overflow, then checks stored int32 ranges. Exact contract/reference agreement establishes this integer program's correctness on the tested inputs. It does not establish agreement with the original floating-point model or full-model text quality.

## Reproduce

Use the root Python environment and install `requirements-lock.txt` from this folder for the tested environment. Install the pinned Node dependency using the existing package lock:

```bash
npm ci --prefix contract-benchmark
python3 block-benchmark/generate_unrolled.py
node block-benchmark/compile.cjs
.venv/bin/python block-benchmark/run_local.py --variant swar --anvil /absolute/path/to/anvil
.venv/bin/python block-benchmark/run_local.py --variant swar6 --anvil /absolute/path/to/anvil
.venv/bin/python block-benchmark/run_local.py --variant optimized --batch-size 1 --anvil /absolute/path/to/anvil
.venv/bin/python block-benchmark/run_local.py --variant optimized --batch-size 8 --anvil /absolute/path/to/anvil
.venv/bin/python block-benchmark/compare_public.py
.venv/bin/python block-benchmark/quality_sweep.py
.venv/bin/python block-benchmark/tool_quality.py
.venv/bin/python block-benchmark/precision_stress.py
.venv/bin/python block-benchmark/summarize_results.py
.venv/bin/python block-benchmark/summarize_optimization.py
```

Run those commands from the project root. Foundry Anvil v1.8.5 was used; its official release URL, commit and verified archive digest are in `toolchain.json`. No binary or install script is bundled. The local runner launches and stops its own loopback-only Anvil child, checks chain ID 31337, and uses only disposable simulator accounts. It accepts no public RPC argument.

The Solidity compiler is 0.8.30, optimizer 200 runs, via IR, targeting Paris-compatible bytecode. Local execution uses Cancun gas rules and a 16,777,216 block gas limit. Public sampled calls separately check compatibility with each queried network. They are not mined transactions.

The included weight shards allow the EVM benchmark to run without downloading the full checkpoint. CPU quality/export commands require the pinned checkpoint in the Hugging Face cache; the root reference command can download it. Remote model Python execution is disabled. `export_block.py` regenerates the modified layer data and three exact reference fixtures. `manifest.json` records every shard hash, dimensions, arithmetic policy, model revision and original three test token IDs.

## Results and scope

- `../results/block-local.json`: original scalar execution of all three positions, every step digest and all persisted vectors.
- `../results/block-swar-local.json`: optimized execution, 48 randomized/extreme projection cases, nonlinear boundary tests, input permissions, and state-changing rollback/replay.
- `../results/block-swar6-local.json`: the same complete local checks for the six-lane variant; all 1,149 step digests and 36 persisted-vector checks match.
- `simulation-cases-swar6.json.gz`: fifteen captured six-lane states for future public-node checks; these have not been run against public endpoints.
- `../results/block-optimized-batch1-local.json` and `block-optimized-batch8-local.json`: full selected-kernel runs with and without batching. Batched gas is recorded per transaction, not incorrectly attributed to each internal chunk.
- `../results/kernel-sweep-*.json`: nine distinct kernel candidates, each checked against 68 model/random/extreme cases; calldata-heavy microbenchmarks are separate from full-block gas.
- `simulation-cases-optimized-batch8.json.gz`: fourteen captured batch states. The latest public-node replay was blocked by automatic approval review because it would disclose prototype code and intermediate state to third-party endpoints. No completed public validation is claimed for this variant.
- `../results/optimization-summary.json`: validated totals for the latest exact optimization study.
- `../results/block-compiled-batch8-local.json`: complete execution and deployment receipts for all 4,559 contracts in the compiled-weight variant.
- `../results/compiled-weight-kernels.json`: 71 focused generated-program tests, including extremes, padding, overflow and input lengths.
- `compiled-weight-data/` and `compiled-weight-manifest.json`: executable model-derived constants, provenance, hashes and source-row coverage. The model license still applies.
- `../results/compiled-weight-summary.json`: verified execution/deployment comparison and gas-only break-even calculation. Regenerate using `summarize_codeweights.py`.
- `prior-optimized-baseline/`: source and complete compiler artifact for the earlier 399-million-gas measurement. The new virtual `_projectAt` hook changes the recompiled baseline slightly; use the archive for its exact historical bytecode.
- `simulation-cases-swar.json.gz`: fifteen captured states, expected return values and exact local gas receipts for independent public-node simulations.
- `../results/block-public-*.json`: read-only chain checks and fee modeling, including preserved initial attempts and their errors.
- `../results/precision-stress.json`: 256 additional token positions at each of int4 and int8, evaluated by the CPU integer first-block reference. These extra positions were not run in EVM.
- `../results/quality-sweep.json`: thirteen full-model CPU prompts at four weight precisions. Floating-point runtime arithmetic remains in use.
- `../results/tool-quality.json`: sixteen full-model CPU native tool-call cases at four precisions. Calls are parsed as data and never executed.

The archived scalar source/compiler output in `scalar-baseline/` corresponds to the original receipt baseline. The current scalar source adds a diagnostic projection entry point and fixes its arbitrary-stride handling. Rerunning the current scalar source can slightly change dispatcher gas; the optimized run uses the current source.

Two Solidity issues found during testing were fixed before the passing optimized run: integer square root at 2, and scale-header alignment for short probe rows whose byte stride is not divisible by four. A later review widened CPU convolution reference intermediates; all three original fixture output hashes were rechecked unchanged. The first two failure reports remain included.

## Fee model

Per-position planning cost uses the complete local receipt sum multiplied by the greater of 1.05 and the largest sampled public estimate/local receipt ratio, then the snapshot gas price. This is a planning cushion, not a guaranteed bound.

For Base, an unsigned type-2 transaction is supplied to the chain's fee oracle. Separate L1 estimates and upper estimates are saved. Planning totals add one begin and 383 step L1 upper estimates. Operator fees are checked at three gas values; nonzero values cause the script to stop pricing rather than assume they are zero.

Robinhood's public gas estimate includes execution and L1 data costs, so the calibration uses that bundled estimate and does not add L1 a second time. BSC uses BNB and does not add Ethereum L1 fees. Its public endpoint prunes old state, so each case pins a fresh block and records it. Base and Robinhood cases use one pinned block per run. Public endpoint errors are evidence of an incomplete RPC test, not a contract failure.

Deployment costs are separate. Local deployment gas is measured for all 356 contracts. The per-position cost table excludes deployment; no full public deployment budget, token price, reply price or inclusion latency is claimed.

## Derived weights

The binary model data has been modified by offline quantization and fixed-point packing. It remains subject to the upstream LFM Open License v1.0, reproduced in `../LFM-LICENSE.txt`. `data/NOTICE.txt` identifies the source and modifications. The MIT SPDX label on the newly written Solidity code does not relicense model weights.
