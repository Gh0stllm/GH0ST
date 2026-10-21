# S0UL-1M two-hour hard training campaign

Registered 21 October 2026 before training. The user requested another two hours of harder, tighter training. Three parallel lanes each receive a 7,200-second run-walltime budget. The model remains exactly 984,192 parameters with the existing tokenizer and 128-token context.

## Initialization and data

All lanes start from the previous campaign's validation-selected winner, `warm-42`, from run [39618506314](https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39618506314). Checkpoint SHA-256:

`3647f818b2c6a187d5127ecaf3101308fcc84320491b655c0da98098a08d4665`

Its previously reported 58.89% exact correctness is on the historical 360-request challenge. That is a regression benchmark, not the new challenge's baseline score.

The v3 generator produces **63,000 training requests, 1,080 validation requests and 540 fresh challenge requests**, with seed `20261021`. It retains familiar v2 training phrase families and adds negated alternatives, corrected copied arguments, quoted distractors, requests with missing fields and unsupported requests. Two independently requested operations map to `CLARIFY|request`. Source-action counts are balanced; actual action counts differ because these multi-operation examples become clarification requests. Both are recorded in the manifest.

Validation and challenge use separate authored core phrases, copied-string pools and task-ID ranges. Warm-start training may have seen individual words and task IDs; novelty here concerns complete requests, phrase families and this campaign's copied-string pools. No old validation/test records or model failures are imported into training. Context-overflow candidates are rejected, never truncated, and response lengths fit the existing 32-token generation budget.

Dataset SHA-256 identities are committed before launch:

| File | SHA-256 |
| --- | --- |
| Training | `e3bb3382e69b09b7488ac7cfb9b0c5f009dd25228c20041f01e36699c3245928` |
| Validation | `1e56410a37175dfbedd2bb8ce43ef2ee173c25cd2759f877799e388f8b1e74ff` |
| Fresh challenge | `2832112d7aa0f357bf3eb09d137abfbe46b89d58103d3755362132dd8c10d4d7` |

Every runner checks its regenerated dataset against the [committed manifest](reports/data-v3-manifest.json). Training reads only training and validation records.

## Three candidate configurations

| Lane | Seed | Peak learning rate | Weight decay | Label smoothing | Hard replay fraction |
| --- | --- | --- | --- | --- | --- |
| warm-uniform-42 | 42 | 0.0004 | 0.05 | 0 | 0 |
| warm-hard-43 | 43 | 0.0004 | 0.05 | 0.02 | 0.25 |
| warm-hard-low-lr-44 | 44 | 0.0002 | 0.10 | 0.02 | 0.35 |

These are practical candidate configurations, not a controlled single-factor experiment. All use batch size 32, two CPU threads, AdamW, gradient clipping at 1.0, 120-second warmup and elapsed-time cosine decay to 5% of the peak rate. Learned normalization gains are excluded from weight decay.

Hard replay ranks observed **training-only unsmoothed response cross entropy**, with EMA factor 0.9. The top pool holds at most 2,048 examples and refreshes every 1,000 optimizer updates. Most draws remain uniform; no validation prediction or test record enters the replay scores. Label smoothing affects training loss only. Validation and reported cross entropy remain unsmoothed.

## Duration, checkpointing and selection

The two-hour clock begins after dataset/model preparation. It includes normal validation and checkpoint work; optimizer compute is recorded separately. Early stopping is disabled. A one-million-step ceiling guards runaway execution rather than setting the intended duration. Checkpoints retain weights, optimizer, RNG and replay state, and exact interrupted/resumed training is tested.

Every 1,000 updates and at termination, evaluate full-validation cross entropy and greedy generation on a reproducible, class-balanced 270-request validation subset. Preserve the best checkpoint by exact action-and-argument count, using full-validation cross entropy to break ties. The original initialization is also evaluated, so deterioration does not automatically replace a better starting checkpoint.

After all lanes complete, rerank their best checkpoints on the complete 1,080-request validation set. Freeze the winner and its hash before opening the fresh challenge. Evaluate both the preceding winning checkpoint and the selected model on that same 540-request challenge. Export the selected weights and run the integer reference, reporting accuracy and float/integer agreement separately.

Only after selection, also measure both float models on the historical 360-request challenge, hash `67624db57500eda43102c7b1d298157ce5287bc9a59a73d09219d9a9859535e8`. Report it separately from the fresh challenge. Neither challenge selects the winner.

## Execution and publication

The [two-hour workflow](../.github/workflows/s0ul-hard.yml) launches only from an explicit `[train-hard-2h]` source commit or manual dispatch. Ordinary changes do not start or cancel a training campaign. GitHub logs show validation/checkpoint progress. Lane artifacts and the selected checkpoint are retained for 90 days. The final job publishes measured reports automatically under `reports/hard-RUN_ID/` and appends the build tracker.

Preflight checks cover data integrity, bounded context/output lengths, deterministic replay/resume, selection before challenge access, publication and a real short run using the full model and dataset. A short smoke test establishes implementation behavior, not training quality.

This is offline rule-labelled supervised training, without teacher distillation or a new on-chain deployment. Improvement is measured, not guaranteed; the prior checkpoint and all previous reports remain preserved.
