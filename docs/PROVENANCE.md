# Provenance and verification

[Project home](../README.md) · [Recovery inventory and gaps](recovery/RECOVERY.md) · [Contributing](../CONTRIBUTING.md)

This guide separates the history of the GitHub publication from evidence about the software. It was prepared on 26 October 2026 against public `main` at [`d9d6306b`](https://github.com/Gh0stllm/GH0ST/commit/d9d6306b8cbf0eb39e844097e7aa669afe82729e).

## Why a new repository has 980 commits

GitHub reports this repository was created at **2026-10-21 19:39:18 UTC**. Its initial public history was built by republishing recovered files. The [recovery record](recovery/RECOVERY.md) identifies the earlier repository as `8tk8m2kv9f-lang/GH0ST` and explicitly says the original Git history was not transferred.

A complete enumeration of the pinned `main` history found:

| Observation | Result |
| --- | --- |
| Reachable commits | 980 |
| Earliest commit | 21 October 2026, 19:43:09 UTC |
| Latest commit in this snapshot | 22 October 2026, 19:10:48 UTC |
| Commit dates, UTC | 811 on 21 October; 169 on 22 October |
| Subjects beginning with `Restore` | 769; a message classification, not an assessment of each diff |
| Authorship recorded by this public history | One account, `Gh0stllm` |

[Machine-readable history audit](provenance/history-audit-2026-10-26.json).

The root commit is [Initialize GH0ST recovery](https://github.com/Gh0stllm/GH0ST/commit/12c7a6321b966b4262e54d46f0908cd9edc7b78e). Another commit [removed the bulk importer and switched to individual-file restoration](https://github.com/Gh0stllm/GH0ST/commit/e6312f817384b36e173f7270894d9780c52ea371). A [single-file restoration](https://github.com/Gh0stllm/GH0ST/commit/87960a9b58207256520f8704a5e459083fba0bad) and the [final 25-artifact restoration](https://github.com/Gh0stllm/GH0ST/commit/d9d6306b8cbf0eb39e844097e7aa669afe82729e) show the publication pattern.

These records explain why commit volume is a poor measure of development effort here. They do not establish an intent to inflate activity. They also do not make the repository older or demonstrate that every technical claim is correct.

To reproduce the history count from a clone containing that commit:

```bash
git rev-list --count d9d6306b8cbf0eb39e844097e7aa669afe82729e
git log --format='%cI %s' d9d6306b8cbf0eb39e844097e7aa669afe82729e
git show --stat e6312f817384b36e173f7270894d9780c52ea371
```

Later commits will increase the current count; this audit remains pinned to the import snapshot.

## What “recovered” means

The recovery assembled surviving source, reports, model artifacts and published assets from separate workspaces and saved files. The recovery record describes **43 pre-recovery commits preserved locally**, but their original commit IDs, parents and branch graph are not part of this public import. Public import timestamps are not the original creation dates of the files.

| Material | Available evidence | Limit |
| --- | --- | --- |
| Historical binary artifacts | [Per-file recovery manifest](recovery/historical-binaries-provenance.json) and [large-file reconstruction instructions](recovery/RECOVERY.md#large-model-files) | The manifest reports 4,552 matching files; this documentation update did not independently rehash them all |
| Recovered media | [Source names, destination paths and hashes](recovery/media-provenance.json) | A content hash identifies bytes, not the date or author who first created them |
| Earlier prose and workflows | [README snapshot](recovery/README.docs-cleanup-snapshot.md), [source snapshot](recovery/README.solidity-source-snapshot.md) and [original workflows](recovery/original-workflows/) | Historical descriptions may predate later results |
| New navigation and explanatory prose | This guide and the current README | These are new documentation, not recovered original research |
| Unavailable history and research | [Explicit missing-material list](recovery/RECOVERY.md#verification-boundaries-and-missing-material) | Missing original branches, conversations and artifacts must not be inferred from recollection |

The source archive is identified in the recovery record by SHA-256 `44fee2c717891e06c546908056eacb6f3044b3be09e7baf665059a07ce4317b7`. An internal manifest is useful for integrity checking; it does not replace an external archive or an independently timestamped publication.

## Check the implementation and execution

Start with the [S0UL Solidity inference source](../s0ul-1m/contracts/S0ULInference.sol), [reproduction guide](../s0ul-1m/FULL-SOLIDITY.md), [pinned dependencies](../s0ul-1m/package.json) and [tests](../s0ul-1m/tests/). Local arithmetic and tokenizer checks can run without sending chain transactions:

```bash
git clone https://github.com/Gh0stllm/GH0ST.git
cd GH0ST
git checkout d9d6306b8cbf0eb39e844097e7aa669afe82729e
cd s0ul-1m
npm ci --ignore-scripts --no-audit --no-fund
npm run test:math
npm run test:tokenizer
```

These tests cover specific components. Full inference, model quality and gas comparisons have their own workloads and conditions in the reproduction guide.

For public execution, inspect:

| Evidence | Where to check |
| --- | --- |
| Chain and deployed code | Robinhood Chain, chain ID 4663; engine `0x07bB8455Db0928bEBEb3E7F27A22A0599AF1b650`; [Sourcify source](https://repo.sourcify.dev/4663/0x07bB8455Db0928bEBEb3E7F27A22A0599AF1b650) |
| Contract creation | [Deployment journal](../s0ul-1m/deployments/robinhood-mainnet.json); transaction `0x389d9661edfbe6fb3c82b85b3b6fba68102ea1b4364543264380b037c4ddc67e` |
| Request 1 completion | [Generation journal](../s0ul-1m/deployments/robinhood-mainnet-generation.json); final transaction `0x35c6bfd477222cef2f1c07d121f1427d5635cc5659c46fdc8de7728182b1e24f` |
| Full recorded comparison | [Project-authored verification report](../s0ul-1m/reports/robinhood-mainnet-inference-check.json) and [read-only checker source](../s0ul-1m/scripts/check-mainnet-inference.mjs) |
| Fresh, limited recheck | [26 October read-only chain check](provenance/chain-check-2026-10-26.json) |

The 26 October recheck queried the public RPC at `https://rpc.mainnet.chain.robinhood.com`. It confirmed the chain ID, deployed engine code hash, successful creation and final completion receipts, and stored request-1 output IDs `[268, 2]` (`WAIT`, then EOS). It did **not** repeat the complete 398-receipt accounting or 1,024-logit comparison; those remain results of the published project checker. A separate checker is not the same as an independent external audit.

This is evidence of one narrow completed on-chain computation. It does not establish broad language-model quality, production readiness, security audit coverage or adoption.

## Assessment boundaries

GH0ST remains early-stage, single-maintainer research with limited public adoption. Those are valid maturity limits. Repository age, upload count and the word “recovered” alone cannot determine whether a particular arithmetic result or chain execution is valid.

Evaluate each claim against its source, model identity, inputs, measured outputs and reproduction method. Preserve failed experiments and unavailable material as such. Future imports should be grouped and labelled; new results should identify the actual experiment and verification performed.
