# S0UL-1M build status

Updated 21 October 2026. [Branch](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/GH0ST-S0UL-1M) · [Detailed first report](REPORT-001.md).

| Component | Status | Evidence |
| --- | --- | --- |
| Research charter | Published and preserved | [Original proposal](PROPOSAL.md) |
| Model implementation | Implemented; exact 984,192 parameters | [Model](s0ul/model.py) |
| Tokenizer and synthetic tasks | Implemented | 1,440 train / 270 validation / 270 test; [manifest](reports/data-manifest.json) |
| Supervised training | Pilot-001 complete | 1,200 CPU steps; best validation checkpoint at step 100 |
| Held-out float quality | Fails autonomous-use readiness | 85/270 exact actions: 31.48%; [raw outputs](reports/test-pilot-001.json) |
| Integer reference | Complete Python forward/generation | 85/270 exact; 269/270 token-sequence agreement with float; zero saturation |
| INT8 export and verification | Implemented | 1,010,176-byte mixed-precision payload; 12 raw shards |
| Contract memory, action gate and kernel | Implemented as independent primitives | 12 local EVM tests passed |
| Python checks | 50 tests passed locally for Campaign-002 | Model, datasets, evaluator, exports, integer reference, duration/resume, campaign selection and publication |
| GitHub CI | Passed: tests, training, evaluation, exports and artifact upload | [Successful run](https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39615161322) |
| Full EVM transformer inference | Implemented; trained 128-row run verified | Exact 1,024/1,024 decision logits; [evidence](reports/solidity-inference-ci-128.json) |
| Teacher distillation | Pending | Initial dataset is rule-labelled, not teacher generated |
| Robinhood Chain deployment | Not started | No public-chain transactions or funds used |

## Recorded updates

1. Research charter and implementation tracker.
2. Model, task dataset, supervised training/evaluation, numeric exports, integer reference and local Solidity primitives.
3. Parser hardening, regression checks and reproducible CI with research artifacts.
4. Pilot-001 quality reports, raw failures, integer comparison and updated research gates.

Valid action syntax does not establish correct intent. The initial pilot is a research checkpoint, not a production agent or an on-chain inference deployment.

## CI dependency correction

The first remote run passed all 33 Python checks, then failed during `npm ci` because Ganache bundled a Darwin-only `fsevents` entry without its optional flag. The lockfile now preserves that upstream optional dependency correctly. A fresh Linux installation and all 12 EVM tests passed with the correction. The independent GitHub workflow subsequently passed all checks, reproduced training/evaluation and uploaded a 6,552,875-byte research artifact. [Remote verification](reports/ci-verification-pilot-001.json).

## Campaign-002 preparation

Three independent CPU lanes are configured for one continuous 3,600-second training session each: `scratch-42`, `scratch-43-low-lr` and `warm-42`. The warm lane starts from the CI checkpoint in run 39615161322, which is also the final baseline. It is separate from the original locally recorded pilot checkpoint.

The v2 dataset contains 28,800 unique training requests and 900 validation requests. A separately authored, hash-frozen 360-request challenge is reserved for evaluation after validation selection. No challenge results are used to tune this campaign. The elapsed-time learning-rate schedule, optimizer/RNG checkpoints and final off-interval validation passed a real short-duration smoke run and 50 unit checks. The smoke result is an implementation check, not evidence of model quality.

[Preregistered protocol](TRAINING-PLAN-002.md) · [Data manifest](reports/data-v2-manifest.json) · [Short duration smoke](reports/advanced-training-smoke.json). The workflow will append completed measurements here and upload the selected weights, full optimizer state and reports after all three one-hour lanes finish.

## Campaign-002 launch record

All three runners passed the 50 Python checks and entered their one-hour training steps on 21 October 2026, between 14:38:28 and 14:38:34 UTC. Each lane is configured for 3,600 seconds after model/data preparation. Training is expected to finish around 15:39 UTC, followed by validation selection and the frozen final evaluation.

[Live training and eventual checkpoint artifacts](https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39618506314) · [Launch evidence](reports/hour-39618506314-launch.json). This records the observed launch, not completed training or an accuracy result.

## One-hour campaign 39618506314 — completed

Three parallel one-hour lanes completed. Selected **warm-42** using full validation results before opening the frozen final challenge.

On the same 360-request final challenge: selected float **58.89%**, frozen original baseline **17.22%**, selected integer **58.89%** exact action-and-argument correctness.

[Detailed evidence](reports/hour-39618506314/SUMMARY.md) · [Workflow and trained checkpoint artifacts](https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39618506314). These are synthetic-domain measurements; full Solidity inference and Robinhood Chain deployment remain separate work.

## Campaign-003 preparation — two-hour hard training

Three new parallel lanes each have a 7,200-second run-walltime budget, starting from the preceding `warm-42` winner. V3 provides 63,000 training requests, 1,080 validation requests and a fresh, hash-frozen 540-request challenge. Hard replay targets high-loss training examples while retaining uniform coverage; low label smoothing and stronger weight decay are compared with a uniform-training control. The architecture and tokenizer remain unchanged.

Checkpoints retain the optimizer, RNG and replay state. Validation preserves the best checkpoint and selects the final lane before either challenge is evaluated. Reports will include fresh float/integer results and a separate historical regression comparison against the preceding checkpoint.

[Preregistered training protocol](TRAINING-PLAN-003.md) · [V3 manifest](reports/data-v3-manifest.json). Launch and completion are recorded separately; this preparation entry does not assert that training has started or improved accuracy.

## Campaign-003 expansion — 20 total lanes

The user requested maximum lanes and the preceding trained model as baseline. The original three lanes continue in [run 39629553411](https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39629553411); 17 supplementary two-hour lanes are configured, all initialized from the same trained `warm-42` checkpoint. The fixed grid compares learning rate, replay strength, smoothing, weight decay and seed repeats. The combined report will rank all 20 on validation only and compare the winner against the preceding trained model.

[Expansion protocol and fixed grid](TRAINING-PLAN-003-MAX.md). Configuration and observed launch are recorded separately.

## Campaign-003 verified expanded launch

Observed 2026-10-21T15:58:05.351Z: **19 lanes entered their two-hour training steps; 1 lane remained queued**. All 20 are configured to initialize from the hash-verified trained `warm-42` checkpoint. Each lane receives 7,200 seconds from its own run start; a queued lane starts when GitHub assigns a runner.

[Original three lanes](https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39629553411) · [Supplementary 17 lanes and combined final report](https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39630021281) · [Observed launch evidence](reports/hard-max-39630021281-launch.json). No new final accuracy is available at launch.

## Two-hour campaign 39629553411 — completed

3 parallel lanes completed with observed run-walltime budgets of 7200 seconds (including normal validation and checkpoint work). Selected **warm-hard-low-lr-44** using full validation results before opening the frozen final challenge.

On the same 540-request final challenge: selected float **42.04%**, frozen reference baseline **40.93%**, selected integer **42.04%** exact action-and-argument correctness.

[Detailed evidence](reports/hard-39629553411/SUMMARY.md) · [Workflow and trained checkpoint artifacts](https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39629553411). These are synthetic-domain measurements; full Solidity inference and Robinhood Chain deployment remain separate work.

## Complete Solidity inference — implementation and verification

The isolated `research/GH0ST-S0UL-Solidity` branch now implements the complete integer-v1 model, fixed tokenizer, immutable 48-shard weight store, causal KV cache and bounded continuation. It pins the trained 20-lane winner, checkpoint `44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692`.

67 Python checks, component EVM suites and all eight final native integration tests passed. The actual trained checkpoint generated `WAIT`, EOS from `Wait.` with all 1,024 integer logits matching exactly and zero saturation. At 128 rows it used 398 transactions and 892,989,640 inference gas; the maximum single transaction used 11,927,948 gas. An independent older 32-row Ganache control also matched all 512 logits for a separate raw-input case. The source compiles within standard runtime/initcode limits. No public Robinhood Chain deployment has occurred.

The faster row mode supports up to 128 rows per continuation. A matched small CLI test reduced transactions by 16% and gas by 7.23%; the full text request's calculated 32-to-128-row transaction reduction is 61.06%, with no matched full-model gas/time claim. The final native 32-row comparison could not be retrieved after GitHub returned HTTP 403 with an account-suspended error. Code was already pushed through `e094cc76980b2a7d622fbf520faca5e0fbb7884c`; final reports/documentation are preserved locally.

[Complete runtime guide](FULL-SOLIDITY.md) · [Exact source model](reports/solidity-source-model.json) · [Local CLI evidence](reports/solidity-cli-fast-local.json) · [Verified faster runtime](reports/solidity-optimization-summary.json).
