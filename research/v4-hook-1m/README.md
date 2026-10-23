# GH0ST: approximately 1M-parameter v4-hook research

**Status: initial local model adaptation and EVM component experiments.**

Branch: `research/v4-hook-1m` · Started: 23 October 2026 · Baseline: `d9d6306b8cbf0eb39e844097e7aa669afe82729e`

[Status and research gates](STATUS.md) · [Latest experiment](RESULTS-002.md) · [Model selection](MODEL-SELECTION.md) · [Research protocol](RESEARCH.md) · [Model attribution](model-data/NOTICE.txt)

## Optimized sentence model and real v4 integration

The [selected sentence-model candidate](OPTIMIZATION.md) improves movement-aware
wording while retaining the saved baseline and full reports, including grammar
regressions. It adds a multi-pool adapter verified with real local v4 PoolManager
swaps and token settlement. See [quality results](swap-speaker-535k/reports/QUALITY.md),
[adapter behavior](swap-speaker-535k/V4-ADAPTER.md), and the exact
[selected export](selected-quality-model.json). This is research code; local
validation does not imply a public-chain deployment.

## Execution policy

Run training, model selection and benchmarks locally. GitHub is used to publish source, saved weights and completed reports. Do not launch model training on GitHub Actions or other GitHub-hosted compute for this study.

## New track: one word on each swap

[SwapSpeaker](swap-speaker/README.md) is a separate **4,522-parameter recurrent language model** with **94 whole-word tokens (54 lexical words)**. It retains sentence context between swaps and executes one complete integer next-word step in `afterSwap`. This is distinct from the numerical forecasting candidate below. A [three-label control](one-word/README.md) is also retained. Training runs locally; source, completed artifacts and reports are published here.

The selected candidate is **IBM Granite TinyTimeMixer R2 plus a trained bounded fee head: 812,195 total parameters**. This is a numerical time-series model. The pretrained backbone is frozen; the new classification head is trained on synthetic volatility histories.

The initial test does **not** show that the large backbone improves the task: a 771-parameter history-only ablation scored higher. This negative result is retained as part of the research.

## What exists

| Component | Evidence and scope |
| --- | --- |
| Pretrained model selection | [Exact checkpoint, parameter accounting and alternatives](MODEL-SELECTION.md) |
| Actual model adaptation | [Training and evaluation implementation](python/model_experiment.py), [experiment configuration](configs/model-experiment.json), saved adapter weights and preprocessing |
| INT8 representation experiment | Rounded/dequantized CPU evaluation and saved compressed model weights; this is not native integer inference |
| Arithmetic optimization | [Signed INT8 kernel](benchmarks/Int8DotBenchmark.sol), [independent BigInt comparison and receipt benchmark](benchmarks/bench-kernel.mjs) |
| Hook interface research | [Bounded cached-policy hook](contracts/GH0STPolicyHook.sol), [future finalized-source interface](contracts/IFinalizedPolicySource.sol) |
| Research protocol | [Questions, measurements, limitations and next experiments](RESEARCH.md) |

**A complete 812,195-parameter EVM inference engine is not implemented.** The hook harness consumes policies from a mock trusted source; it does not verify or execute the TTM model. The model experiment, row-kernel experiment and hook integration are separate components, not an end-to-end onchain AI deployment.

## First model results

768 independent synthetic training histories, 192 validation histories and 384 held-out test histories. Each input contains 512 regularly sampled simulated volatility observations; labels classify the mean observed volatility over the following 96 steps. The three fee choices are illustrative labels, not economically optimized fees.

| Model or rule | Parameters | Held-out classification accuracy |
| --- | ---: | ---: |
| Adapted pretrained TTM, FP32 | 812,195 total; 6,915 trained | 90.625% |
| Adapted TTM with INT8-rounded/dequantized weights | Same architecture | 90.625% |
| Trained history-only ablation | 771 | **92.1875%** |
| Trailing 32-observation volatility rule | No trained weights | 89.3229% |
| Pretrained forecast with fixed thresholds | 805,280 frozen | 88.0208% |
| Constant training-majority class | No trained weights | 35.9375% |

The INT8 representation preserved **382/384 decisions (99.4792%)** relative to FP32. It changed two decisions while retaining the same aggregate accuracy. Computation and activations remain floating point in this experiment.

The saved compressed model file contains 812,195 signed-byte parameters, 138 FP32 tensor scales and serialization metadata. The recorded file is 853,435 bytes. See [model results](reports/model-benchmark.json), [sample-level predictions](reports/model-predictions.json) and [training curves](reports/model-training.json).

The results establish a reproducible synthetic functional experiment. They do not establish market performance, statistical superiority, improved LP returns, resistance to manipulation or suitability for live fee selection.

## Additional evaluation and operation audit

The frozen candidates were tested on **8,192 additional synthetic histories**. On 4,096 histories from the original generator, the pretrained candidate scored **90.89%**, versus **91.28%** for the history-only control (paired exact p = 0.0929). A faster-switching stress scenario favoured the pretrained candidate by 1.61 percentage points; this is exploratory and does not establish market performance.

One complete prediction executes **7,813,824 linear multiply-accumulates** across 53 linear calls, before counting all normalization, nonlinearities and other arithmetic. This is not a gas estimate. [Experiment 002](RESULTS-002.md) retains the full comparison, operation trace, reproduction commands and per-sample results.

## First arithmetic results

Solidity 0.8.30, optimizer enabled with 200 runs, Shanghai EVM, local Ganache. Both kernels enforce the same signed INT32 ABI validation. The optimized version reads a 32-byte group of signed INT8 weights at once.

| Row width | Scalar read from deployed code | Packed read from deployed code | Receipt-gas reduction |
| --- | ---: | ---: | ---: |
| 128 | 138,404 | 89,812 | 35.11% |
| 512 | 477,896 | 283,396 | 40.70% |
| 1,024 | 924,606 | 535,562 | 42.08% |

All **120 method/vector comparisons** matched an independent BigInt oracle. **30 invalid-input cases** reverted, including malformed signed ABI words, invalid dimensions and out-of-range shard reads. Twenty actual local transaction receipts supply the gas table.

These are isolated row-dot measurements, including transaction overhead. They exclude complete model normalization, nonlinearities, patch mixing, observations, hook execution and swap settlement. **Do not interpret the reduction as full-model or full-swap gas savings.** [Complete kernel report](reports/kernel-benchmark.json).

## Hook boundary

`GH0STPolicyHook` binds one dynamic-fee pool, one model identity and one policy-source address. It checks recorded snapshots, validity windows, tick drift, policy identity/monotonicity and configured fee bounds before returning a `beforeSwap` fee override. It falls back to a fixed fee for invalid or unavailable policies.

The policy-source implementation in the test harness is **trusted and mocked**. A supplied `finalized` flag or model hash does not prove model execution. Replacing the mock with an authenticated onchain inference engine and binding the complete input history are outstanding work.

The v4 tests use upstream types and address-permission validation with a local ABI/state-layout manager harness. They do not run a complete real PoolManager swap or establish router integration. No live-chain deployment is performed by the reproduction commands below.

## Reproduce

From this directory, using Python 3.12 and Node:

```bash
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python python/model_experiment.py --download
.venv/bin/python python/verify_model.py
.venv/bin/python python/evaluate_generalization.py
.venv/bin/python python/audit_operations.py

npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run bench:kernel
npm run bench:evm
```

The checkpoint download is pinned to an immutable Hugging Face revision. The script verifies source digests, checks tensor counts and uses installed model-library code, with no downloaded Python execution. Subsequent runs can omit `--download`. Exact environment and source hashes are included in the reports.

The pinned base checkpoint, trained heads, preprocessing, held-out fixtures and compressed representation are included under `model-data/`. A fresh checkout can run `python/verify_model.py` before retraining. Node 24 was used for local EVM verification; Ganache falls back to its JavaScript implementation when its optional native module is unavailable.

## Directory guide

| Path | Contents |
| --- | --- |
| `configs/` | Pinned source hashes, seeds, model settings and bounded action labels |
| `python/` | Training, saved-artifact prediction and reproducibility checks |
| `model-data/` | Checkpoint, adapted weights, preprocessing, fixtures and upstream notices |
| `contracts/` | Bounded cached-policy hook and policy-source interface |
| `tests/evm/` | Local callback harness and adversarial policy tests |
| `benchmarks/` | Signed INT8 row kernels and independent BigInt oracle |
| `scripts/` | Local EVM measurements |
| `reports/` | Machine-readable results, provenance and sample-level predictions |

## Next research gate

The next gates are a faithful full-model integer reference, real regularly sampled pool histories and complete PoolManager integration. Additional synthetic evaluation has not established an advantage on the primary original-generator endpoint; the regime-transition result should be tested further. Preserve both successful and negative measurements before making any full-model gas or economic claim.
