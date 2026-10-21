# S0UL-1M — first implementation and supervised pilot

Date: 21 October 2026. Status: local research; no Robinhood Chain deployment.

## Main finding

The 984,192-parameter transformer can be trained, exported, and executed with an integer-only Python inference reference. The first narrow synthetic pilot achieves **85/270 exact held-out actions (31.48%)**. It does not meet the intended agent reliability requirement.

Every held-out output satisfies the strict action grammar and terminates correctly. Syntax validity does not establish semantic correctness. Observed failures include wrong assets, missing-argument guessing and failure to copy unseen task or preference arguments.

## Experimental setup

- Four decoder layers, width 128, four attention heads, ReLU FFN width 640, tied 512-token embedding/output matrix, 128-token context.
- Exactly 984,192 total trainable parameters, including embeddings and learned normalization gains.
- Fixed byte/domain tokenizer; no pretrained model, teacher checkpoint, teacher labels or distillation.
- 1,440 training / 270 validation / 270 test examples, with disjoint request templates, block ranges and selected argument values.
- Response-token supervised cross entropy; AdamW; seed 42; batch 32; learning rate 0.001; 1,200 steps; four CPU threads.
- Checkpoint selection used validation cross entropy only. Test and exploratory challenge results were not used to choose or retrain this checkpoint.
- Local training elapsed 83.47 seconds. Lowest validation response loss occurred at step 100: 1.9256, from an untrained baseline 6.3119. Validation loss rose to 3.2626 by step 1,200 while training batch loss fell, indicating overfitting.

## Full held-out results

| Model execution | Exact action and arguments | Grammar + EOS | Scope |
| --- | --- | --- | --- |
| Float32 training reference | 85/270 (31.48%) | 270/270 | Local CPU |
| INT8 matrices dequantized to float32 | 85/270 (31.48%) | 270/270 | Mixed precision; not integer-only inference |
| Complete integer reference | 85/270 (31.48%) | 270/270 | Local Python/NumPy integer forward/generation |

Integer generation matched the floating model's exact output-token sequence on 269/270 requests (99.63%); zero values saturated. The one differing request was answered incorrectly by both numerical paths. This is agreement with the same trained model, not a model-accuracy score. [Integer details and raw outputs](reports/integer-evaluation-pilot-001.md).

A separate hand-authored exploratory challenge set scored 8/27 exact responses. It was authored after checkpoint freeze and is not a statistical robustness benchmark. [All challenge results](reports/adversarial-pilot-001.json).

## Numeric and contract implementation

The initial mixed-precision export occupies 1,010,176 bytes across 12 raw shards of at most 90,000 bytes each. It retains FP32 row scales and norms. The complete integer candidate has a separate 1,102,856-byte payload with Q24 scales, Q14 activations, fixed RoPE and exponential tables. These figures exclude some manifest/packaging overhead and do not determine a contract count or deployment cost.

The full integer reference uses integer arithmetic during forward/generation. Offline conversion uses floating point. This is a specified quantized approximation, not exact reproduction of float32 arithmetic.

Solidity source implements bounded caller-owned memory, typed action proposals, caller-bound balance reads, and signed INT8 row-dot operations from calldata or contract bytecode. The gate does not prove model provenance, authenticate prompt text, or execute transfers/tasks.

| Local EVM row width | Calldata dot gas | Bytecode-read dot gas |
| --- | --- | --- |
| 128 | 135,650 | 136,913 |
| 640 | 586,702 | 580,430 |

These are local Shanghai EVM transaction measurements, including intrinsic gas and excluding deployment. They are neither complete-model inference costs nor Robinhood Chain fee quotes. [Compiler, hashes and full measurement conditions](reports/evm-kernel.json).

## Verification

- 33 Python tests passed: architecture/count/causality, tokenizer and split integrity, strict output validation, export/hash checks, integer arithmetic and bundle-loader regressions.
- 12 local EVM tests passed: memory ownership and bounds, proposal validation, balance reads, packed signed arithmetic, bytecode reads and invalid dimensions.
- An independent GitHub CI run passed all checks, regenerated a supervised research checkpoint, evaluated it, verified both export paths and uploaded its binary artifacts for 30 days. [Successful run](https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39615161322) · [Verified run/artifact metadata](reports/ci-verification-pilot-001.json). The CI checkpoint is separate from the local pilot used for the metrics above.

## What remains

The highest-priority gap is training/generalization quality, especially argument copying and unfamiliar language. A later experiment should broaden training coverage and compare a teacher-distilled student against a supervised control without using the final test set for selection.

Complete Solidity transformer inference, on-chain tokenization, continuation, provenance/authentication and requester-funded integration remain outstanding. No public transaction was submitted. Deployment should follow adequate model-quality evidence and a complete gas benchmark.

## Reproducibility

[Commands](README.md#reproduce-locally) · [Training report](reports/training-pilot-001.json) · [Dataset manifest](reports/data-manifest.json) · [Float test outputs](reports/test-pilot-001.json) · [Integer test outputs](reports/integer-evaluation-pilot-001.json) · [INT8 export manifest](reports/int8-export-pilot-001.json).
