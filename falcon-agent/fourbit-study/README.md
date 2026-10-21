<!-- GH0ST reading guide: additive navigation. -->

**GH0ST / THE DEPLOYED WEIGHT LAYER**

[Project home](../../README.md) · [Architecture](../../docs/ARCHITECTURE.md) · [Evidence and costs](../../docs/EVIDENCE.md) · [Inference runtime](../runtime/README.md)

This study explains the selected four-bit export, packed matrix arithmetic and cross-shard reads. Its matrix-pass benchmarks measure the linear-algebra layer. [The architecture guide](../../docs/ARCHITECTURE.md#the-inference-pipeline) shows the additional work required for token generation; [the evidence guide](../../docs/EVIDENCE.md#gas-fees-and-budgets) separates modeled deployment, actual receipts and local inference.

---

# GH0ST four-bit optimization

20 October 2026. **The RH weights/kernel/index stage is complete: 497 four-bit contracts verified, or 499 including the two historical pilots.** The selected research candidate is `affine64_s12z4`. All 495 weight contracts preserve the pinned export bytes. See the [final deployment report](mainnet/batch-0004.md), [complete address manifest](mainnet/deployment-manifest.json) and [deployment controls](DEPLOYMENT.md). A [separate bounded inference prototype](../runtime/README.md) is now implemented, validated locally and deployed on RH as the 500th contract including historical pilots. It remains unintegrated with website chat and the agent controller. See the [runtime receipt](../runtime/mainnet-runtime.json).

GH0ST is built using artificial intelligence technology from the Technology Innovation Institute. The original Falcon checkpoint, model revision and upstream license remain unchanged; see [the model notice](../licenses/NOTICE.md).

## Measured result

| Measure | Previously selected compact six-bit | Selected four-bit |
|---|---:|---:|
| Complete weight file, including descriptors and non-matrix tensors | 72,045,528 bytes | 48,626,528 bytes |
| Weight shards | 1,173 at 60 KiB runtime | 495 at 96 KiB runtime |
| Kernel and weight deployment gas | 15,649,430,315 | 10,553,905,726 including a new address index |
| All-matrix execution gas | 2,965,180,104 | 1,131,959,017 including cross-shard reads |
| Output rows checked against exact integer arithmetic | 165,440 | 165,440 |
| Matrix tiles | 2,600 | 680 |

The proposed stage is **495 weight contracts + one matrix kernel + one address index = 497 new contracts**. Including the two earlier six-bit pilot contracts gives **499 contracts**. The original raw creation payloads were rejected by RH. Their lossless replacements now fit the conservative 95,000-byte bound and reproduce identical runtime bytes on local EVM. The count is a layout budget for weights, index and matrix arithmetic. This weight stage excludes the tokenizer, inference runtime and agent integration. A separate bounded runtime is now implemented locally; on-chain raw-text tokenization and controller integration remain pending and may require further work. **499 is the current stage budget, not a guaranteed final system count.**

The historical raw-payload deployment reduction was **32.56%**. The currently usable lossless encoding reduces local stage deployment gas by **5.37%** versus the selected six-bit package. Matrix-pass gas falls **61.82%** against the currently selected/deployed six-bit kernel. Earlier six-bit experiments had already reached 1.187 billion matrix gas at substantially higher weight-deployment cost; the new four-bit pass is **4.67% below that faster historical experiment**, not 61.82% below it.

These are standard Cancun gas measurements on local Anvil with RH-sized code limits, not RH receipts or live ETH quotes. All 495 full-sized/final data shards were deployed locally and their complete runtime bytes checked; each receipt matched the creation-gas formula. Index deployment used local addresses, so its exact calldata gas changes with real addresses. RH L1 posting fees are excluded. The prior public pilot is preserved in [mainnet receipts](../rh-deployment/mainnet/batch-0001-receipts.json).

## What changed

- Quantized every 2D matrix to four bits, starting from the pinned original checkpoint. All original BF16 non-matrix tensors remain unchanged.
- Used 16 separate calibration texts to measure input activation second moments. Selected clipping, integer scales and zero points with a weighted reconstruction-error search. No evaluation prompt was used for calibration and no training was performed.
- Stored a 12-bit scale code and 4-bit zero point per 64 weights, with one shared Q24 scale unit per matrix. A group uses 32 code bytes plus 2 metadata bytes. The shared unit is multiplied once per output row.
- Widened eight nibbles into 32-bit lanes with two multiply-and-mask operations, then used signed polynomial multiplication for eight simultaneous products. Prepared input vectors are reused across rows.
- Added `WeightReader.sol` and `dotFile`, which read actual full-matrix tiles through immutable shard-address indexes, including splits within headers, metadata and codes.
- Compared compiler runs 200 and 1,000,000. For a 64-by-512 affine tile, runs 1,000,000 used **432,638 gas**, versus **795,848** with runs 200. The selected compiler is solc 0.8.30, viaIR, Cancun, runs 1,000,000.
- Swept 32/64/128/256-row tiles for both actual matrix widths, 512 and 768 columns. Selected 256 rows for both. The full pass uses the same seeded int16 input stream as the preserved six-bit benchmark.

Signed polynomial correctness depends on bounded int16 inputs and the supported group sizes. Even a 128-weight group has coefficient magnitude at most `128 * 15 * 32768 = 62,914,560`, below the signed 32-bit lane bound. The final rounding correction prevents lower signed coefficients from corrupting the extracted dot product. Exact NumPy comparisons, edge vectors and full matrix checks validate the implementation.

## Candidate selection and quality

| Four-bit candidate | File bytes | Stage contracts including old pilot | Development next-token agreement | Mean token KL |
|---|---:|---:|---:|---:|
| Symmetric, group 32, 8-bit scales | 48,626,528 | 499 | 75.56% | 0.348750 |
| Symmetric, group 64, 12-bit scales | 47,915,616 | 492 | 75.69% | 0.405045 |
| **Affine, group 64, 12-bit scales + zero points** | **48,626,528** | **499** | **75.03%** | **0.363916** |
| Affine, group 128 | 47,204,704 | 485 | 70.33% | 0.488921 |
| Symmetric group 32 + second-order rounding feedback | 48,626,528 | 499 | 75.29% | 0.370525 |

Selection was made on the 32 development prompts: affine group 64 had the same file size as the lowest-drift candidate, approximately 12% lower representative kernel gas, and mean KL within 5% of that candidate. This is a measured compromise, not a proof of a global optimum or quality equivalence.

The additional inverse-Hessian/Cholesky rounding experiment reduced regularized calibration reconstruction loss but worsened development KL from 0.348750 to 0.370525. It was **rejected**. Its source, export hash, quality results and full-matrix measurements are retained. This custom GPTQ-style experiment used static quantizer records, activation ordering and per-row calibration-loss fallback; it kept the tied embedding unchanged from the clipped source and did not implement a sequential whole-model GPTQ pipeline.

The selected candidate was then tested once on **16 held-out prompts**, fixed before candidate evaluation:

| Held-out measure | Six-bit reference | Selected four-bit |
|---|---:|---:|
| Agreement with original next-token predictions, 300 positions | 94.33% | 79.67% |
| Mean reference-token KL | 0.020505 | 0.255933 |
| Same first token as original | 15/16 | 11/16 |
| Identical full greedy continuation | 8/16 | 3/16 |
| Narrow exact-answer/format checks | 3/12 | 3/12 |

**Quantization causes material behavioral drift.** Token agreement is not task accuracy or a percentage of intelligence retained. The original model itself passes only 2/12 held-out exact-answer checks; these small synthetic tests do not certify a useful autonomous agent. Generations are capped at 32 new tokens. Full prompts, responses and token IDs are recorded in the JSON reports. CPU quality evaluation uses float32 activations and does not validate a future fixed-point activation or state implementation.

## Verification and deployment boundary

For each of two compiler settings, four kernels passed 52 arithmetic vectors, 16 cross-shard reader checks and 44 malformed-input/index checks. Tests include int16 extrema, zeros, alternating signs, isolated negative lanes, group-count/format errors and out-of-bounds reads. The selected full pass verified **217 matrices, 90,996,736 weight elements and every one of 165,440 output rows** through the real 495-shard file and its index.

`dot` accepts an isolated matrix tile contract. `dotFile` accepts an index, matrix-file offset, first row, row count, column count and int16 input vector. The caller must pin the reviewed immutable index and correct tensor descriptor. The stored whole-file SHA-256 is an identity record; it is not rechecked over 48 MB on every call. The kernel validates layouts, dimensions, file bounds and shard code lengths. It does not authenticate arbitrary caller-supplied model indexes. Metadata starts must be byte-aligned; all selected model shapes satisfy this.

This matrix study alone does not implement full token generation. The subsequent [bounded runtime prototype](../runtime/README.md) implements deterministic activation arithmetic, attention/Mamba state, scheduling and greedy generation locally; it uses off-chain tokenization and its prepaid runtime is now deployed, but is not integrated with agent actions. Matrix gas is not full-token gas, and all-matrix passes include the shared embedding matrix rather than claiming it is read in full during every actual token step.

`deployment-plan.json` pins the selected file, compiled kernel and lossless creation measurements. `creation-validation.json` verifies every replacement shard. The local lossless total is **14,809,327,109 gas** including kernel/index, compared with the historical raw-only **10,553,905,726** shown above. The increase pays for constructor decompression; deployed model bytes and inference gas are unchanged. See [DEPLOYMENT.md](DEPLOYMENT.md) for 25-contract review batches, fee bounds, journal migration and recovery. Live progress is recorded separately in [mainnet/batch-0001.md](mainnet/batch-0001.md).

## Format and pins

Selected weight SHA-256:

`9cc5e90880d96ff15bf4110f7970a7ea473c9b86576298691ade1e745672e7a9`

Original checkpoint SHA-256:

`199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578`

The complete file starts with `GH0ST4Q1`, a tensor count and fixed 32-byte tensor descriptors. Every matrix starts with a 16-byte `G4Q1` header containing group count, group size, scale width, zero-point flag and Q24 scale unit. Metadata is packed MSB first; each eight-weight block is nibble-packed with its first logical weight in the low nibble of a big-endian 32-bit word. The exact integer weight is `(code - zero) * scale_code * scale_unit`, interpreted as Q24. Non-matrix tensors retain original little-endian BF16 bytes.

`selected-manifest.json` includes every tensor's shape, range and digest. `deployment-plan.json` adds every shard's offset, runtime hash, initcode hash and modeled gas. `summary.json` is the machine-readable comparison. Large model binaries remain outside ordinary Git history and can be rebuilt from these pinned sources.

## Reproduce

Use the packages in `requirements.txt`, local Anvil 1.8.5, and the repository's solc 0.8.30 dependency. Set `GH0ST_MODEL_CACHE` to a directory containing the pinned original checkpoint and configuration/tokenizer files; set `ANVIL` to the local executable. All benchmark transactions go only to loopback chain 31337. No keys or public RPC are accepted by the local harness.

```bash
python falcon-agent/fivebit-study/prepare.py --checkpoint "$GH0ST_MODEL_CACHE"
python falcon-agent/gas-refinement/rebuild_source.py --checkpoint "$GH0ST_MODEL_CACHE/model.safetensors" --output "$GH0ST_MODEL_CACHE/int6"
python falcon-agent/fourbit-study/quality.py --checkpoint "$GH0ST_MODEL_CACHE" --exports "$GH0ST_MODEL_CACHE/fourbit-study"
python falcon-agent/fourbit-study/generate.py
node falcon-agent/fourbit-study/compile.cjs 200
node falcon-agent/fourbit-study/compile.cjs 1000000
python falcon-agent/fourbit-study/benchmark.py --anvil "$ANVIL" --runs 200
python falcon-agent/fourbit-study/benchmark.py --anvil "$ANVIL" --runs 1000000
python falcon-agent/fourbit-study/feedback.py --checkpoint "$GH0ST_MODEL_CACHE" --exports "$GH0ST_MODEL_CACHE/fourbit-study" --collect --variant sym32_s8
python falcon-agent/fourbit-study/quality.py --checkpoint "$GH0ST_MODEL_CACHE" --exports "$GH0ST_MODEL_CACHE/fourbit-study" --stage refinement --selected sym32_s8_feedback
python falcon-agent/fourbit-study/quality.py --checkpoint "$GH0ST_MODEL_CACHE" --exports "$GH0ST_MODEL_CACHE/fourbit-study" --stage heldout --selected affine64_s12z4
python falcon-agent/fourbit-study/benchmark.py --anvil "$ANVIL" --full --variant affine64_s12z4 --exports "$GH0ST_MODEL_CACHE/fourbit-study"
node falcon-agent/fourbit-study/creation/compile.cjs
python falcon-agent/fourbit-study/validate_creation.py --weights "$GH0ST_MODEL_CACHE/fourbit-study/affine64_s12z4/weights.bin" --cache "$GH0ST_MODEL_CACHE/fourbit-creation" --anvil "$ANVIL"
python falcon-agent/fourbit-study/prepare.py --export "$GH0ST_MODEL_CACHE/fourbit-study/affine64_s12z4"
python falcon-agent/fourbit-study/summarize.py --exports "$GH0ST_MODEL_CACHE/fourbit-study"
```

Local gas benchmarks fix base fee to zero to avoid synthetic block-fee escalation during hundreds of large deployments. This does not change `gasUsed`; it is not a zero-cost claim about RH.

Primary references: [RH code limits](https://docs.robinhood.com/chain/differences-from-ethereum/), [RH fees](https://docs.robinhood.com/chain/gas-and-fees/), [GPTQ paper](https://arxiv.org/abs/2210.17323), [AWQ paper](https://arxiv.org/abs/2306.00978). The clipping implementation is custom activation-weighted quantization, not an AWQ implementation. Published GPU/model results do not establish performance or quality for this EVM/Falcon experiment.
