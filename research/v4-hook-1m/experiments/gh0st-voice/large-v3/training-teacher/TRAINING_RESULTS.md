# Completed local training comparisons

The corrected teacher run completed successfully as a training job, but **failed the manual prose-quality review**. It still produces circular descriptions and long semantic loops. Lower validation loss and passing the numeric/repetition checks do not make it ready for release. No mainnet action was performed.

All runs retained the 1,235,968-parameter SimpleStories V2 architecture, tied 4,019-token vocabulary, 64-position causal attention window and Q12 export bounds. They used continuous paragraph packing without an inserted EOS between documents. Each saved checkpoint includes two unedited 512-token continuations; sampling continues through any model-produced EOS.

| Run | Supervised tokens | Steps | Source probabilities: authored/composition/public/teacher | Peak LR | Best saved step | Best / final mixture loss |
|---|---:|---:|---|---:|---:|---|
| `initial-8m` | 8,000,442 | 6,273 | 30/60/10/0% | 3e-5 | 500 | 4.2687 / 5.1482 |
| `foundation-4m` | 4,000,402 | 3,136 | 10/20/70/0% | 1e-5 | 3,136 | 4.5628 / 4.5628 |
| `teacher-v4-4m` | 4,000,117 | 3,130 | 10/15/15/60% | 1e-5 | 3,130 | 4.5466 / 4.5466 |
| `teacher-v4-final-4m` | 4,001,124 | 3,126 | 10/15/15/60% | 1e-5 | 3,126 | 4.5444 / 4.5444 |

The third row is explicitly **SUPERSEDED_DATASET_SNAPSHOT**. It used 13,456 teacher paragraphs before the source owner removed 28. Its completed report and checkpoints remain for provenance. The corrected fourth run used the final 13,428-paragraph source (10,616 train, 1,455 validation, 1,357 test). Aggregate losses across different source mixtures are not directly comparable.

The initial run overfit: its saved best checkpoint was at 633,590 supervised tokens, long before its full budget completed. All requested budgets were completed rather than silently returning an unchanged baseline. The corrected teacher run continued to improve held-out loss through its final step, but its output was not clear continuous speech. The proposed additional 8M-token extension was not launched following that review.

## Comparable held-out results

These are fixed per-source validation windows from the corrected cache, with no test data used. Values are mean token cross-entropy; lower is better.

| Checkpoint | Authored | Composition | Public-domain | Licensed teacher |
|---|---:|---:|---:|---:|
| Original pretrained base | 5.0411 | 5.3530 | 5.9235 | 5.7753 |
| Initial run, saved best step 500 | 4.1543 | 4.1265 | 5.3349 | 5.4781 |
| Initial run, final step 6,273 | 5.0108 | 5.1177 | 5.2535 | 5.7593 |
| Foundation run, final step 3,136 | 4.1558 | 4.1819 | 4.6613 | 5.0809 |
| Corrected teacher, final step 3,126 | 4.1464 | 4.1627 | 4.8621 | 4.6372 |

The corrected teacher's complete 1,024-token manual review found an extended “man” loop in seed 0 and an extended door/window loop in seed 42. Both passed the limited automatic repetition checks. See `../runs/teacher-v4-final-4m/manual-quality-review.json`, `source-validation-final.json` and `source-validation-baselines.json` for the evidence. No claim of novelty against the original pretraining corpus is made.

## Exact identities and optimizer

All four jobs started independently from pretrained weights SHA256 `4d7b846d32e636c70ed3a342ec53775d10d56b404c357865a75eb2dce0b78f94`; none resumed another run's optimizer. AdamW used its default betas/epsilon, weight decay 0.01, gradient-norm clipping at 1, a 3%-of-target warmup and a cosine schedule ending at 10% of peak learning rate. Training used FP32 and two CPU threads. Optimizer state is not saved; loading a checkpoint for another run starts a fresh optimizer/schedule.

All tensor audits passed. The explicit signed12 matrix/signed16 norm projections clipped **zero** parameter values in every completed run. That is an export constraint check, not proof of activation bounds or EVM gas.

Weight SHA256:

- Initial best: `601682500301de4bff0a5a9283b012631af5a53daa9fe66d9e0010b2637d65f5`
- Initial final: `6e7a4e43ecc82707b4fdf2e95df7c378884710830b27daf4f81cf6a8c57ec17a`
- Foundation final: `d39658cf5549802c55a123b5402b62c1c728ec5cdf43580c9bfb1a25e2776611`
- Superseded teacher final: `28a50bcd149b6eddaa8a0d481f9f881c7db1f78e1d211834eadd719ce06cf80e`
- Corrected teacher final: `c24d7fe2c13b14a3bf49924723580578a27666668fd9f92638f1fc29a386fa57`

Final teacher-source manifest SHA256: `4c930fc4de66f443572686f04d4cef0e8b29bc22436b298bd78ae516a4904248`. Corrected cache fingerprint: `59e61c5857ed74fe8b70183e79ac0bb5dd19f5950a7463729763eea7eb3af52f`. The run's `dataset-link.json` binds its exact source, merged and cache manifests. `frozen-artifacts.json` binds completed artifacts without rewriting them.

Further work should target short-context style and stable open-ended generation, not treat another loss reduction as sufficient. Any additional tone experiment belongs in a separate directory and must retain held-out material and full no-reset continuations.
