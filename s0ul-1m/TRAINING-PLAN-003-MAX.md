# S0UL-1M two-hour campaign: expansion to 20 lanes

Registered 21 October 2026 before any Campaign-003 challenge results. The user requested maximum parallel lanes and explicitly required the preceding trained model as baseline. The original three lanes continue in [run 39629553411](https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39629553411); a supplementary workflow adds 17 lanes, for 20 total. Each lane receives its own 7,200-second run-walltime budget, including normal validation/checkpoint work.

Every lane starts from the same trained `warm-42` winner (historical exact correctness 58.89%), SHA-256 `3647f818b2c6a187d5127ecaf3101308fcc84320491b655c0da98098a08d4665`. The architecture, tokenizer, training source and hash-frozen v3 dataset are unchanged from [the original preregistration](TRAINING-PLAN-003.md). The new lanes use the same 63,000 training and 1,080 validation requests. No scratch-initialized lane is used.

## Fixed supplementary grid

| Additional lanes | Seeds | Learning rate | Weight decay | Smoothing | Replay fraction |
| --- | --- | --- | --- | --- | --- |
| Uniform learning-rate sweep | 45–48 | 0.00015 / 0.00025 / 0.0006 / 0.0008 | 0.05 | 0 | 0 |
| Unsmoothed replay sweep | 49–52 | 0.0004 | 0.05 | 0 | 0.15 / 0.25 / 0.35 / 0.50 |
| Smoothing sweep | 53–55 | 0.0004 | 0.05 | 0.01 / 0.02 / 0.05 | 0.25 |
| Weight-decay sweep | 56–58 | 0.0004 | 0.01 / 0.10 / 0.20 | 0.02 | 0.25 |
| Uniform seed repeat | 59 | 0.0004 | 0.05 | 0 | 0 |
| Hard-replay seed repeat | 60 | 0.0004 | 0.05 | 0.02 | 0.25 |
| Lower-rate seed repeat | 61 | 0.0002 | 0.10 | 0.02 | 0.35 |

At least half of every training batch remains uniformly sampled. This is an exploratory configuration search, with seeds varying across configurations; individual factor effects cannot be inferred causally. Learning-rate schedules, checkpoint rules and per-lane bounds remain unchanged.

## Combined selection and reporting

After the supplementary 17 lanes complete, restore their artifacts plus only the three original **lane** artifacts. Require exactly 20 distinct candidates, complete two-hour evidence, identical dataset/source hashes and the same warm-start checkpoint. Rank all 20 best checkpoints on full validation exact correctness, then response cross entropy, then lane name. Freeze the selected weights before challenge access. Compare against the preceding trained `warm-42` model, never the original untrained or pilot baseline.

The original three-lane workflow may automatically publish its preregistered 540-request challenge measurements earlier. These are a preliminary three-lane snapshot. All supplementary configurations and the combined selection rule are fixed now; no intermediate challenge score will alter training or select the 20-lane winner. The final report evaluates the same preregistered challenge and labels its earlier reporting explicitly. The historical 360-request challenge remains a separate regression measurement. No challenge results enter training, replay or candidate selection.

The max workflow allows 60 minutes for aggregation, including up to 15 minutes for original lane artifact availability. It publishes reports under `reports/hard-max-RUN_ID/` and retains selected weights/exports in its workflow artifacts. Publication retries reconstruct the report from the latest branch so another workflow's build-status append is preserved.

This uses standard public-repository Ubuntu runners. GitHub's documented standard concurrency varies by account plan: Free 20, Pro 40. The connector does not expose this account's plan, so 20 is the registered target, rather than an assertion that a higher paid-plan allowance has been verified. Other account jobs and runner availability may briefly queue lanes. [GitHub Actions limits](https://docs.github.com/en/actions/reference/limits).

The [expanded workflow](../.github/workflows/s0ul-hard-max.yml) launches only on `[train-hard-max]` or manual dispatch. Later status updates do not restart training.
