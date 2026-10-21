# GH0ST five-bit experiment

Five-bit weights reduce the compact full-model file to **60,670,936 bytes** and modeled weight deployment to **13,178,709,482 gas** using candidate 60 KiB payload shards. That is **15.78% below compact six-bit**, or **19.75% below the recent balanced six-bit layout**. The model architecture and parameter count are unchanged; the quantized weight values change.

The trade-off is measurable behavioral drift. On the same 32-prompt development suite, five-bit matches the original model's next-token choice at **85.23%** of reference positions, compared with **92.81%** for six-bit. This is agreement with the original model, not task accuracy or a percentage of intelligence retained. The original model itself makes substantial errors.

This is a separate experimental candidate. The selected six-bit deployment manifests remain unchanged. No training, public deployment, paid model API use, or external inference service was used.

## Deployment size

| Representation | Complete file bytes | Modeled weight deployment, candidate 60 KiB payloads |
| --- | ---: | ---: |
| Existing compact six-bit | 72,045,528 | 15,648,599,873 |
| Recent balanced six-bit | 75,641,184 | 16,421,055,512 |
| **Compact five-bit** | **60,670,936** | **13,178,709,482** |
| Five-bit with precomputed scale metadata | 63,824,224 | 13,860,518,373 |

The portable 24 KiB layout is also recorded: **13,253,501,326** modeled gas for compact five-bit and **13,939,251,470** for precomputed metadata. The larger layout requires a chain that supports those code sizes. These are standard Cancun creation-cost projections, not live Robinhood/BNB fees or receipts for deploying the whole model. Engine, tokenizer, controller, shard-address directory and chain-specific data fees remain excluded.

The five-bit code stream is 16.67% smaller than the six-bit stream. Unchanged nonmatrix tensors, tensor descriptors, group metadata and deployment overhead make the complete deployment reduction smaller when comparing equivalent compact formats. The larger 19.75% comparison also reflects changing from the recent execution-oriented layout to compact metadata.

## Model quality

All variants were generated anew from the same pinned original checkpoint. Group size is 64, offsets/scales use Q24, and all nonmatrix tensors retain their exact BF16 bits. No activation calibration, retraining or fine-tuning was performed. Five-bit is quantized directly from the original weights, not by truncating the six-bit export.

| Metric | Original | Six-bit | Five-bit |
| --- | ---: | ---: | ---: |
| Next-token agreement with original, 765 reference positions | 100% | 92.81% | 85.23% |
| First generated token matches original | 32/32 | 29/32 | 26/32 |
| Entire generated sequence matches original | 32/32 | 8/32 | 5/32 |
| Mean token KL divergence from original | 0 | 0.029602 | 0.129567 |
| Existing exact-format checks passed | 3/14 | 3/14 | 2/14 |

Original and six-bit generations each reproduce all 32 historical outputs exactly. The rebuilt six-bit export also matches its historical SHA-256. Five-bit and six-bit produce identical full generated sequences on 3/32 prompts.

The tests reuse development prompts and cap generation at 32 new tokens. They are not an independent held-out benchmark, and some answers are truncated. Agreement measures drift rather than correctness. The exact-format score is intentionally strict and is not general semantic accuracy.

A concrete regression: the original and six-bit models return exactly `BALANCE` for the action-name prompt. Five-bit produces a lengthy explanation containing the action name, failing the requested format. Some changes improve individual outputs: five-bit reproduces the original noon note and cat-name reply where six-bit differed. None of this establishes safe autonomous decisions; the original model already gets several balance, permission and factual questions wrong. Contract spending and recipient rules remain independent of generated text.

## Solidity formats and correctness

`FiveBitCompact.sol` stores bit-packed BF16 endpoint metadata and reconstructs the selected Q24 scale. The division/rounding rule changes from denominator 63 to 31 and includes float32 halfway corrections. Its converter supports reconstructed upper endpoints near zero, which can fall below the range observed by the earlier six-bit encoder. Every recovered offset and scale is checked against the five-bit source export.

`FiveBitShifted.sol` stores exact precomputed offsets/scales in variable 4–6-byte records. Both kernels read eight five-bit codes from each 40-bit block, expand them into 32-bit lanes, and use signed polynomial accumulation for int16 activations. A group contains 64 weights. The bound `64 * 31 * 32768 = 65,011,712 < 2^26` leaves room for the fixed extraction guard; this does not establish equivalence to float32 full-model inference.

Both complete encoded files round-trip the entire five-bit export byte-for-byte, including every nonmatrix tensor. This preserves the five-bit candidate exactly; it does not preserve the six-bit or original weights. Local arithmetic and deployment validation results are in `kernel-results.json`; measured totals are summarized in `measurement-summary.json`.

Both kernels passed all **217 matrices and 165,440 output rows**, plus 96 signed-extreme/zero/lane checks, 13 malformed-input rejections, 10,000 dilation checks and 19,499 scale-boundary checks. All 12 sampled shard deployments matched the modeled gas and returned the expected stored bytes.

| Kernel | Complete matrix receipt gas | Local kernel deployment gas |
| --- | ---: | ---: |
| FiveBitCompact | 2,046,886,981 | 617,959 |
| FiveBitShifted | 1,264,676,406 | 551,890 |

Compact metadata minimizes weight deployment but increases repeated execution cost. Relative to recent balanced six-bit, compact five-bit adds about 833 million gas per matrix pass while reducing modeled deployment by about 3.24 billion; this gas-only advantage is exhausted after four complete passes. This is not a token/reply cost or an economic forecast. Precomputed metadata offers a different trade-off: somewhat higher deployment with faster execution. Both five-bit layouts have the same CPU quality results because their decoded weights are identical.

The matrix benchmark uses synthetic int16 vectors independently for each matrix. It excludes tokenizer behavior, nonlinear operations, attention/Mamba recurrence, real interlayer activations, persistent state, sampling and scheduling. No complete on-chain Falcon inference or public deployment is claimed. The all-file cross-shard reader/scheduler is still unimplemented; benchmark tiles are deployed as individual local shards.

## Reproduce

Use Python 3.12 and the versions in `requirements.txt`, Solidity 0.8.30, Node and Anvil 1.8.5. Install compiler dependencies with `npm ci --prefix contract-benchmark` from the repository root. The local EVM benchmark uses Cancun with a raised 98,304-byte code limit, matching the prior harness; this is not a live-chain configuration claim.

Obtain `model.safetensors` from `tiiuae/Falcon-H1-Tiny-90M-Instruct` revision `e6389502a0b12cd8da894b395ba5bf7436873b16`, respecting the upstream Falcon-LLM license. Its SHA-256 must be `199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578`. Keep model binaries outside the Git tree.

```bash
python falcon-agent/fivebit-study/prepare.py --checkpoint /absolute/path/model-cache
python falcon-agent/fivebit-study/quality.py --checkpoint /absolute/path/model-cache --exports /absolute/path/fivebit-exports
python falcon-agent/fivebit-study/codec.py --source /absolute/path/fivebit-exports/int5 --output /absolute/path/fivebit-encoded
node falcon-agent/fivebit-study/compile.cjs
python falcon-agent/fivebit-study/benchmark.py --source /absolute/path/fivebit-exports/int5 --exports /absolute/path/fivebit-encoded --anvil /absolute/path/anvil
python falcon-agent/fivebit-study/summarize.py
```

`prepare.py` verifies the checkpoint and six pinned configuration/tokenizer files. `quality.py` loads with `trust_remote_code=False`, keeps all model arithmetic and activations float32 on CPU, and records full prompts, outputs and tokens. It also measures lossless Zstd sizes, which are CPU storage experiments with no implemented EVM Zstd decoder.

The new raw five-bit export hash is `1545797b0fdeebac528ed0f3e2746f672b5220663b1a2a799ea92db52b509c2a`. The compact hash is `2ed4f93b7485ce8c2a9e9b24af48aaa4b736bc349fc2b0bd451f3637ced7c7fa`; the precomputed-metadata hash is `53b705b7e44013880a9038f190a77d82610fae11a57bef77b5fc865ac126483f`.
